/**
 * Chat API – conversations and messages from backend.
 * Requires backend to implement GET/POST /api/chat/* (see docs/CHAT_API_BACKEND.md).
 */
import api from './api';
import { API } from '../constants/API';
import type {
  ChatConversationsResponse,
  ChatMessagesResponse,
  ChatSendMessageRequest,
  ChatMessageResponse,
} from '../types/api';

export async function fetchConversations(): Promise<ChatConversationsResponse['conversations']> {
  const res = await api.get<ChatConversationsResponse>(API.endpoints.chat.conversations, {
    timeout: 15000,
  });
  return res?.conversations ?? [];
}

/** Zeros server-side unread for this thread so other devices see read state after GET /chat/conversations. */
export async function markChatThreadReadOnServer(rideId: string, otherUserId: string): Promise<void> {
  const rid = String(rideId ?? '').trim();
  const oid = String(otherUserId ?? '').trim();
  if (!rid || !oid) return;
  await api.post(API.endpoints.chat.read, { rideId: rid, otherUserId: oid }, { timeout: 12000 });
}

export async function fetchThreadMessages(
  rideId: string,
  otherUserId: string
): Promise<ChatMessageResponse[]> {
  const q = new URLSearchParams({ rideId, otherUserId }).toString();
  const path = `${API.endpoints.chat.messages}?${q}`;
  const res = await api.get<ChatMessagesResponse>(path, { timeout: 15000 });
  return res?.messages ?? [];
}

/** Backend may return the message at top level or under `data` / `message`. */
function unwrapChatMessagePayload(res: unknown): ChatMessageResponse | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as Record<string, unknown>;
  if (typeof r.id === 'string') {
    const sentAt = r.sentAt;
    const sentAtNum =
      typeof sentAt === 'number'
        ? sentAt
        : typeof sentAt === 'string'
          ? (() => {
              const t = Date.parse(sentAt);
              return Number.isNaN(t) ? Date.now() : t;
            })()
          : Date.now();
    return {
      id: r.id,
      text: typeof r.text === 'string' ? r.text : '',
      sentAt: sentAtNum,
      senderUserId: typeof r.senderUserId === 'string' ? r.senderUserId : '',
      status: typeof r.status === 'string' ? r.status : undefined,
    };
  }
  const inner = r.data ?? r.message;
  if (inner && typeof inner === 'object') {
    return unwrapChatMessagePayload(inner);
  }
  return null;
}

export async function sendChatMessage(
  payload: ChatSendMessageRequest
): Promise<ChatMessageResponse> {
  const res = await api.post<unknown>(API.endpoints.chat.send, payload, {
    timeout: 15000,
  });
  const msg = unwrapChatMessagePayload(res);
  if (!msg?.id) throw new Error('Invalid send message response');
  return msg;
}

