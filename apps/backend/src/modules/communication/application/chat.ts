import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  AuthorizationError,
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { findActiveBlockBetween } from '../../safety/infrastructure/block.repository.js';
import { canChatInRide, isValidMessageText, normalizeMessageText } from '../domain/chat-rules.js';
import {
  createMessage,
  ensureRideChat,
  findChatAccess,
  findMessageForReport,
  findRideChat,
  markRead,
} from '../infrastructure/chat.repository.js';
import { getEventPublisher } from '../../realtime/application/event-publisher.js';
import type { RealtimeEvent } from '../../realtime/domain/realtime-events.js';

function assertEligible(ride: Awaited<ReturnType<typeof findChatAccess>>, userId: string): NonNullable<typeof ride> {
  if (!ride) throw new NotFoundError('Ride not found');
  const eligible = ride.creatorId === userId || ride.participants.some((p) => p.userId === userId);
  if (!eligible) throw new AuthorizationError('You are not a participant in this ride');
  return ride;
}

function assertActive(status: NonNullable<Awaited<ReturnType<typeof findChatAccess>>>['status']): void {
  if (!canChatInRide(status)) {
    throw new BusinessRuleError('Chat is closed for this ride');
  }
}

export async function getRideChat(input: { rideId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const result = await findRideChat(tx, input);
    if (!result) throw new NotFoundError('Ride not found');
    if (!result.eligible) throw new AuthorizationError('You are not a participant in this ride');
    return {
      rideId: result.ride.id,
      status: result.ride.status,
      closed: !canChatInRide(result.ride.status),
      conversation: result.conversation
        ? {
            id: result.conversation.id,
            messages: result.conversation.messages,
            lastReadAt: result.conversation.readStates[0]?.lastReadAt ?? null,
          }
        : null,
    };
  });
}

export async function sendRideChatMessage(input: { rideId: string; userId: string; text: string }) {
  if (typeof input.text !== 'string' || !isValidMessageText(input.text)) {
    throw new ValidationError('text must contain 1–2000 non-whitespace characters', { field: 'text' });
  }
  const text = normalizeMessageText(input.text);

  const result = await prisma.$transaction(async (tx) => {
    const ride = assertEligible(await findChatAccess(tx, input), input.userId);
    assertActive(ride.status);
    const blocked = await findActiveBlockBetween(tx, input.userId, ride.creatorId === input.userId ? ride.participants[0]?.userId ?? input.userId : ride.creatorId);
    if (blocked) throw new AuthorizationError('Chat is unavailable between blocked users');
    const conversation = await ensureRideChat(tx, { rideId: input.rideId });
    const message = await createMessage(tx, {
      conversationId: conversation.id,
      senderId: input.userId,
      text,
    });
    return { ride, message };
  });

  const recipients = result.ride.creatorId === input.userId
    ? result.ride.participants.map((p) => p.userId)
    : [result.ride.creatorId, ...result.ride.participants.map((p) => p.userId).filter((id) => id !== input.userId)];
  const occurredAt = result.message.createdAt.toISOString();
  const events: RealtimeEvent[] = recipients.map((recipientUserId) => ({
    eventId: randomUUID(),
    type: 'CHAT_MESSAGE_CREATED',
    occurredAt,
    rideId: input.rideId,
    requestId: null,
    recipientUserId,
    data: { messageId: result.message.id, conversationId: result.message.conversationId, senderId: result.message.senderId, text: result.message.text },
  }));
  await getEventPublisher().publish(events);
  return result.message;
}

export async function markRideChatRead(input: { rideId: string; userId: string; readAt?: Date }) {
  const result = await prisma.$transaction(async (tx) => {
    const ride = assertEligible(await findChatAccess(tx, input), input.userId);
    const conversation = await ensureRideChat(tx, { rideId: input.rideId });
    const readAt = input.readAt ?? new Date();
    const state = await markRead(tx, { conversationId: conversation.id, userId: input.userId, readAt });
    return { rideId: ride.id, conversationId: conversation.id, lastReadAt: state.lastReadAt };
  });

  await getEventPublisher().publish([{
    eventId: randomUUID(),
    type: 'CHAT_READ_UPDATED',
    occurredAt: result.lastReadAt.toISOString(),
    rideId: input.rideId,
    requestId: null,
    recipientUserId: input.userId,
    data: { conversationId: result.conversationId, lastReadAt: result.lastReadAt.toISOString() },
  }]);
  return result;
}

export async function reportRideChatMessage(input: { rideId: string; messageId: string; userId: string; detail?: string }) {
  return prisma.$transaction(async (tx) => {
    const ride = assertEligible(await findChatAccess(tx, input), input.userId);
    const message = await findMessageForReport(tx, input.messageId);
    if (!message || message.conversation.rideId !== ride.id) throw new NotFoundError('Chat message not found');
    if (message.senderId === input.userId) throw new BusinessRuleError('You cannot report your own message');
    try {
      return await tx.report.create({
        data: {
          reporterId: input.userId,
          reportedId: message.senderId,
          rideId: ride.id,
          reason: 'INAPPROPRIATE_CONTENT',
          detail: input.detail?.trim() || `Chat message ${message.id}`,
        },
        select: { id: true, createdAt: true },
      });
    } catch (err) {
      throw new InternalError('Failed to report chat message', { cause: err });
    }
  });
}
