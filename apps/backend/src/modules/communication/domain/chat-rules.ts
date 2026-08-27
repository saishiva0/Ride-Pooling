import { RideStatus } from '@prisma/client';

export const CHAT_MESSAGE_MAX_LENGTH = 2000;
export const CHAT_OPEN_RIDE_STATUSES = [
  RideStatus.CONFIRMED,
  RideStatus.IN_PROGRESS,
] as const;

export function canChatInRide(status: RideStatus): boolean {
  return (CHAT_OPEN_RIDE_STATUSES as readonly RideStatus[]).includes(status);
}

export function normalizeMessageText(value: string): string {
  return value.trim();
}

export function isValidMessageText(value: string): boolean {
  const normalized = normalizeMessageText(value);
  return normalized.length > 0 && normalized.length <= CHAT_MESSAGE_MAX_LENGTH;
}
