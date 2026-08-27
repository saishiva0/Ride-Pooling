import { describe, expect, it, vi } from 'vitest';
import { createChatApi } from './chat-api';

describe('chat API', () => {
  it('maps chat history dates', async () => {
    const request = vi.fn().mockResolvedValue({
      rideId: 'r1',
      status: 'CONFIRMED',
      closed: false,
      conversation: {
        id: 'c1',
        messages: [
          {
            id: 'm1',
            conversationId: 'c1',
            senderId: 'u1',
            text: 'hello',
            createdAt: '2026-08-26T10:00:00.000Z',
          },
        ],
        lastReadAt: null,
      },
    });
    const chat = createChatApi({ request } as never);
    const result = await chat.getRideChat('r1');
    expect(result.conversation?.messages[0].createdAt).toBeInstanceOf(Date);
  });
  it('uses the authenticated API client for send/read/report operations', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'm1',
        conversationId: 'c1',
        senderId: 'u1',
        text: 'hello',
        createdAt: '2026-08-26T10:00:00.000Z',
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const chat = createChatApi({ request } as never);
    await chat.sendMessage('r1', 'hello');
    await chat.markRead('r1');
    await chat.reportMessage('r1', 'm1', 'bad');
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/rides/r1/chat/messages',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/rides/r1/chat/read',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      '/rides/r1/chat/messages/m1/report',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
