import { describe, expect, it } from 'vitest';
import { RideStatus } from '@prisma/client';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  canChatInRide,
  isValidMessageText,
  normalizeMessageText,
} from './chat-rules.js';

describe('chat rules', () => {
  it('allows only confirmed and in-progress rides', () => {
    expect(canChatInRide(RideStatus.CONFIRMED)).toBe(true);
    expect(canChatInRide(RideStatus.IN_PROGRESS)).toBe(true);
    expect(canChatInRide(RideStatus.PUBLISHED)).toBe(false);
    expect(canChatInRide(RideStatus.COMPLETED)).toBe(false);
    expect(canChatInRide(RideStatus.CANCELLED)).toBe(false);
  });
  it('normalizes and validates text limits', () => {
    expect(normalizeMessageText('  hello  ')).toBe('hello');
    expect(isValidMessageText('hello')).toBe(true);
    expect(isValidMessageText('   ')).toBe(false);
    expect(isValidMessageText('x'.repeat(CHAT_MESSAGE_MAX_LENGTH))).toBe(true);
    expect(isValidMessageText('x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1))).toBe(
      false,
    );
  });
});
