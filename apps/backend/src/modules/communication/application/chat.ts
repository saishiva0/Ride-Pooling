import { randomUUID } from 'node:crypto';
import { RideStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  AuthorizationError,
  BusinessRuleError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../../lib/errors.js';
import { findActiveBlockBetween } from '../../safety/infrastructure/block.repository.js';
import {
  canChatInRide,
  isValidMessageText,
  normalizeMessageText,
} from '../domain/chat-rules.js';
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

function assertEligible(
  ride: Awaited<ReturnType<typeof findChatAccess>>,
  userId: string,
) {
  if (!ride) throw new NotFoundError('Ride not found');
  if (
    ride.creatorId !== userId &&
    !ride.participants.some((p) => p.userId === userId)
  )
    throw new AuthorizationError('You are not a participant in this ride');
  return ride;
}
function assertActive(status: RideStatus): void {
  if (!canChatInRide(status))
    throw new BusinessRuleError('Chat is closed for this ride');
}

export async function getRideChat(input: { rideId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const result = await findRideChat(tx, input);
    if (!result) throw new NotFoundError('Ride not found');
    if (!result.eligible)
      throw new AuthorizationError('You are not a participant in this ride');
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

export async function sendRideChatMessage(input: {
  rideId: string;
  userId: string;
  text: string;
}) {
  if (typeof input.text !== 'string' || !isValidMessageText(input.text))
    throw new ValidationError(
      'text must contain 1–2000 non-whitespace characters',
      { field: 'text' },
    );
  const text = normalizeMessageText(input.text);
  const result = await prisma.$transaction(async (tx) => {
    const ride = assertEligible(await findChatAccess(tx, input), input.userId);
    assertActive(ride.status);
    const participantIds = [
      ride.creatorId,
      ...ride.participants.map((p) => p.userId),
    ].filter((id) => id !== input.userId);
    const blocked = (
      await Promise.all(
        participantIds.map((id) =>
          findActiveBlockBetween(tx, input.userId, id),
        ),
      )
    ).some(Boolean);
    if (blocked)
      throw new AuthorizationError(
        'Chat is unavailable because an active block exists',
      );
    const conversation = await ensureRideChat(tx, { rideId: input.rideId });
    const message = await createMessage(tx, {
      conversationId: conversation.id,
      senderId: input.userId,
      text,
    });
    await tx.notification.createMany({
      data: participantIds.map((userId) => ({
        userId,
        type: 'CHAT_MESSAGE' as const,
        title: 'New chat message',
        body: 'You have a new message in your ride chat',
        rideId: input.rideId,
      })),
    });
    return { ride, message };
  });
  const recipients = [
    result.ride.creatorId,
    ...result.ride.participants.map((p) => p.userId),
  ].filter((id) => id !== input.userId);
  const occurredAt = result.message.createdAt.toISOString();
  await getEventPublisher().publish(
    recipients.map((recipientUserId): RealtimeEvent => ({
      eventId: randomUUID(),
      type: 'CHAT_MESSAGE_CREATED',
      occurredAt,
      rideId: input.rideId,
      requestId: null,
      recipientUserId,
      data: {
        messageId: result.message.id,
        conversationId: result.message.conversationId,
        senderId: result.message.senderId,
        text: result.message.text,
      },
    })),
  );
  return result.message;
}

export async function markRideChatRead(input: {
  rideId: string;
  userId: string;
  readAt?: Date;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const ride = assertEligible(await findChatAccess(tx, input), input.userId);
    const conversation = await tx.chatConversation.findUnique({
      where: { rideId: input.rideId },
      select: { id: true },
    });
    if (!conversation)
      return { rideId: ride.id, conversationId: null, lastReadAt: null };
    const readAt = input.readAt ?? new Date();
    const state = await markRead(tx, {
      conversationId: conversation.id,
      userId: input.userId,
      readAt,
    });
    return {
      rideId: ride.id,
      conversationId: conversation.id,
      lastReadAt: state.lastReadAt,
    };
  });
  if (result.conversationId && result.lastReadAt)
    await getEventPublisher().publish([
      {
        eventId: randomUUID(),
        type: 'CHAT_READ_UPDATED',
        occurredAt: result.lastReadAt.toISOString(),
        rideId: input.rideId,
        requestId: null,
        recipientUserId: input.userId,
        data: {
          conversationId: result.conversationId,
          lastReadAt: result.lastReadAt.toISOString(),
        },
      },
    ]);
  return result;
}

export async function reportRideChatMessage(input: {
  rideId: string;
  messageId: string;
  userId: string;
  detail?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const ride = assertEligible(await findChatAccess(tx, input), input.userId);
    const message = await findMessageForReport(tx, input.messageId);
    if (!message || message.conversation.rideId !== ride.id)
      throw new NotFoundError('Chat message not found');
    if (message.senderId === input.userId)
      throw new BusinessRuleError('You cannot report your own message');
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
