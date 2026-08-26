import { Router } from 'express';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../api/async-handler.js';
import {
  getRideChatHandler,
  markRideChatReadHandler,
  reportRideChatMessageHandler,
  sendRideChatMessageHandler,
} from './chat.controller.js';

export interface ChatRouterOptions {
  requireAuth: RequestHandler;
}

export function createChatRouter({ requireAuth }: ChatRouterOptions): Router {
  const router = Router();
  router.get(
    '/rides/:rideId/chat',
    requireAuth,
    asyncHandler(getRideChatHandler),
  );
  router.post(
    '/rides/:rideId/chat/messages',
    requireAuth,
    asyncHandler(sendRideChatMessageHandler),
  );
  router.patch(
    '/rides/:rideId/chat/read',
    requireAuth,
    asyncHandler(markRideChatReadHandler),
  );
  router.post(
    '/rides/:rideId/chat/messages/:messageId/report',
    requireAuth,
    asyncHandler(reportRideChatMessageHandler),
  );
  return router;
}
