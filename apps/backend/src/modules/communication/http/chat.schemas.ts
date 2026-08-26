import { z } from 'zod';

export const rideIdPathSchema = z.object({ rideId: z.string().min(1) });
export const messagePathSchema = z.object({ rideId: z.string().min(1), messageId: z.string().min(1) });
export const sendMessageSchema = z.object({ text: z.string().min(1).max(2000) });
export const readChatSchema = z.object({ readAt: z.string().datetime().optional() });
export const reportMessageSchema = z.object({ detail: z.string().max(2000).optional() });
