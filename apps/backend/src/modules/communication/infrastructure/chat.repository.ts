import { Prisma, RideStatus } from '@prisma/client';

export const CHAT_MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  text: true,
  createdAt: true,
} as const;

export type ChatMessageRow = Prisma.ChatMessageGetPayload<{
  select: typeof CHAT_MESSAGE_SELECT;
}>;

export async function findRideChat(
  tx: Prisma.TransactionClient,
  params: { rideId: string; userId: string },
) {
  const ride = await tx.ride.findUnique({
    where: { id: params.rideId },
    select: {
      id: true,
      status: true,
      creatorId: true,
      participants: {
        where: { status: 'CONFIRMED' },
        select: { userId: true },
      },
    },
  });
  if (!ride) return null;
  const eligible =
    ride.creatorId === params.userId ||
    ride.participants.some((p) => p.userId === params.userId);
  if (!eligible) return { ride, eligible: false, conversation: null };

  const conversation = await tx.chatConversation.findUnique({
    where: { rideId: params.rideId },
    include: {
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: CHAT_MESSAGE_SELECT,
      },
      readStates: {
        where: { userId: params.userId },
        select: { lastReadAt: true },
      },
    },
  });
  return { ride, eligible: true, conversation };
}

export async function ensureRideChat(
  tx: Prisma.TransactionClient,
  params: { rideId: string },
) {
  return tx.chatConversation.upsert({
    where: { rideId: params.rideId },
    create: { rideId: params.rideId },
    update: {},
  });
}

export async function findChatAccess(
  tx: Prisma.TransactionClient,
  params: { rideId: string; userId: string },
) {
  return tx.ride.findUnique({
    where: { id: params.rideId },
    select: {
      id: true,
      status: true,
      creatorId: true,
      participants: {
        where: { status: 'CONFIRMED' },
        select: { userId: true },
      },
    },
  });
}

export async function createMessage(
  tx: Prisma.TransactionClient,
  params: { conversationId: string; senderId: string; text: string },
) {
  return tx.chatMessage.create({
    data: params,
    select: CHAT_MESSAGE_SELECT,
  });
}

export async function findMessageForReport(
  tx: Prisma.TransactionClient,
  messageId: string,
) {
  return tx.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      senderId: true,
      conversation: { select: { rideId: true } },
    },
  });
}

export async function markRead(
  tx: Prisma.TransactionClient,
  params: { conversationId: string; userId: string; readAt: Date },
) {
  return tx.chatReadState.upsert({
    where: {
      conversationId_userId: {
        conversationId: params.conversationId,
        userId: params.userId,
      },
    },
    create: {
      conversationId: params.conversationId,
      userId: params.userId,
      lastReadAt: params.readAt,
    },
    update: { lastReadAt: params.readAt },
  });
}

export function isActiveChatStatus(status: RideStatus): boolean {
  return status === RideStatus.CONFIRMED || status === RideStatus.IN_PROGRESS;
}
