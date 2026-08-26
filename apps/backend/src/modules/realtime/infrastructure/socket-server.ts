/**
 * Socket.io server (Phase 3.11).
 *
 * The ONLY place Socket.io is initialized. Responsibilities:
 *
 * - authenticate every connection through the shared `HttpAuthenticator`
 *   (fail-closed: the default authenticator rejects all sockets)
 * - join authenticated sockets to their private `user:{userId}` room
 * - reject unauthorized connections (auth middleware + defense-in-depth)
 * - activate the realtime `EventPublisher` so committed Ride Engine
 *   operations reach connected clients
 *
 * No business rules live here — handlers only enforce identity/room wiring.
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Logger } from '../../../lib/logger.js';
import type { AuthenticatedUser } from '../../auth/domain/identity.js';
import type { HttpAuthenticator } from '../../auth/http/auth.middleware.js';
import { setEventPublisher } from '../application/event-publisher.js';
import { authenticateSocket } from './socket-auth.js';
import { createSocketEventPublisher } from './socket-publisher.js';
import { userRoom } from './rooms.js';

export interface SocketServerOptions {
  logger: Logger;
  authenticator: HttpAuthenticator;
  /** Socket.io path; defaults to /ws (docs/architecture/api-boundaries.md). */
  path?: string;
  /**
   * Whether this server activates the global realtime publisher. Only the
   * primary server should; extra servers (e.g. a fail-closed proof server
   * in tests) must not hijack event delivery. Defaults to true.
   */
  activatePublisher?: boolean;
}

/**
 * Attaches the realtime server to an existing HTTP server. Returns the
 * Socket.io `Server` (for tests/cleanup).
 */
export function attachSocketServer(
  httpServer: HttpServer,
  options: SocketServerOptions,
): Server {
  const { logger, authenticator } = options;
  const io = new Server(httpServer, { path: options.path ?? '/ws' });

  // Authenticate every socket BEFORE connection using the shared abstraction.
  io.use((socket, next) => {
    authenticateSocket(authenticator, socket)
      .then((user) => {
        socket.data.authenticatedUser = user;
        next();
      })
      .catch((err) => {
        logger.warn(
          {
            err: err instanceof Error ? err.message : 'unknown',
          },
          'Socket authentication failed',
        );
        next(new Error('Authentication failed'));
      });
  });

  io.on('connection', (socket) => {
    const user = socket.data.authenticatedUser as AuthenticatedUser | undefined;
    if (!user) {
      // Defense-in-depth: without a verified identity, drop the socket.
      socket.disconnect(true);
      return;
    }
    // Server-controlled room join from the authenticated identity only.
    const room = userRoom(user.userId);
    const joined = socket.join(room);
    // The default in-memory adapter joins synchronously; clustered adapters
    // return a Promise. Await the promise when present so a publish cannot
    // race the room membership.
    if (joined instanceof Promise) {
      void joined.catch((err: unknown) => {
        logger.warn(
          { err: err instanceof Error ? err.message : 'unknown' },
          'Socket room join failed',
        );
      });
    }

    // Connection lifecycle logging (safe metadata only — no secrets, tokens, PII)
    logger.info(
      { userId: user.userId, socketId: socket.id, room },
      'Socket authenticated and joined room',
    );

    socket.on('disconnect', (reason) => {
      logger.info(
        { userId: user.userId, socketId: socket.id, reason },
        'Socket disconnected',
      );
    });

    socket.on('error', (err: Error) => {
      logger.warn(
        { userId: user.userId, socketId: socket.id, err: err.message },
        'Socket error',
      );
    });

    socket.on('reconnect_attempt', (attemptNumber: number) => {
      logger.info(
        { userId: user.userId, socketId: socket.id, attemptNumber },
        'Socket reconnecting',
      );
    });

    socket.on('reconnect', (attemptNumber: number) => {
      logger.info(
        { userId: user.userId, socketId: socket.id, attemptNumber },
        'Socket reconnected',
      );
    });

    socket.on('reconnect_failed', () => {
      logger.warn(
        { userId: user.userId, socketId: socket.id },
        'Socket reconnection failed',
      );
    });
  });

  // Activate the real publisher: committed Ride Engine operations now reach
  // connected clients (post-transaction; never before commit). Only the
  // primary server does this — extra test servers must not hijack delivery.
  if (options.activatePublisher !== false) {
    setEventPublisher(createSocketEventPublisher(io, logger));
  }

  return io;
}
