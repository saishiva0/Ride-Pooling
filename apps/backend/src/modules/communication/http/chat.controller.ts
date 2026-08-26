import type { Request, Response } from 'express';
import { getAuthenticatedUser } from '../../auth/http/auth.middleware.js';
import { parseRequest } from '../../api/parse.js';
import { sendData } from '../../api/response.js';
import { getRideChat, markRideChatRead, reportRideChatMessage, sendRideChatMessage } from '../application/chat.js';
import { messagePathSchema, readChatSchema, reportMessageSchema, rideIdPathSchema, sendMessageSchema } from './chat.schemas.js';

export async function getRideChatHandler(req: Request, res: Response): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);
  sendData(res, 200, await getRideChat({ rideId, userId: identity.userId }));
}

export async function sendRideChatMessageHandler(req: Request, res: Response): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);
  const { text } = parseRequest(sendMessageSchema, req.body);
  sendData(res, 201, await sendRideChatMessage({ rideId, userId: identity.userId, text }));
}

export async function markRideChatReadHandler(req: Request, res: Response): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId } = parseRequest(rideIdPathSchema, req.params);
  const body = parseRequest(readChatSchema, req.body ?? {});
  sendData(res, 200, await markRideChatRead({ rideId, userId: identity.userId, readAt: body.readAt ? new Date(body.readAt) : undefined }));
}

export async function reportRideChatMessageHandler(req: Request, res: Response): Promise<void> {
  const identity = getAuthenticatedUser(res);
  const { rideId, messageId } = parseRequest(messagePathSchema, req.params);
  const { detail } = parseRequest(reportMessageSchema, req.body ?? {});
  sendData(res, 201, await reportRideChatMessage({ rideId, messageId, userId: identity.userId, detail }));
}
