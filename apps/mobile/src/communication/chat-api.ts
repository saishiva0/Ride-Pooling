import type { ApiClient } from '../api/client';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: Date;
}
export interface RideChat {
  rideId: string;
  status: string;
  closed: boolean;
  conversation: {
    id: string;
    messages: ChatMessage[];
    lastReadAt: string | null;
  } | null;
}

interface ChatMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
}
interface RideChatDto {
  rideId: string;
  status: string;
  closed: boolean;
  conversation: {
    id: string;
    messages: ChatMessageDto[];
    lastReadAt: string | null;
  } | null;
}

function mapChat(dto: RideChatDto): RideChat {
  return {
    ...dto,
    conversation: dto.conversation
      ? {
          ...dto.conversation,
          messages: dto.conversation.messages.map((m) => ({
            ...m,
            createdAt: new Date(m.createdAt),
          })),
        }
      : null,
  };
}

export function createChatApi(client: ApiClient) {
  return {
    async getRideChat(rideId: string): Promise<RideChat> {
      const result = await client.request<RideChatDto>(
        `/rides/${encodeURIComponent(rideId)}/chat`,
      );
      return mapChat(result);
    },
    async sendMessage(rideId: string, text: string): Promise<ChatMessage> {
      const result = await client.request<ChatMessageDto>(
        `/rides/${encodeURIComponent(rideId)}/chat/messages`,
        { method: 'POST', body: { text } },
      );
      return { ...result, createdAt: new Date(result.createdAt) };
    },
    async markRead(rideId: string): Promise<void> {
      await client.request(`/rides/${encodeURIComponent(rideId)}/chat/read`, {
        method: 'PATCH',
      });
    },
    async reportMessage(
      rideId: string,
      messageId: string,
      detail?: string,
    ): Promise<void> {
      await client.request(
        `/rides/${encodeURIComponent(rideId)}/chat/messages/${encodeURIComponent(messageId)}/report`,
        { method: 'POST', body: detail ? { detail } : {} },
      );
    },
  };
}
