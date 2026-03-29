/**
 * Persists chat threads so both sender and receiver see the same conversation
 * after login (e.g. John sends to Puru → when Puru logs in, Puru sees John and the message).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RideListItem } from '../types/api';

const CHAT_THREADS_KEY = '@drivido_chat_threads';

export function threadKey(rideId: string, userId1: string, userId2: string): string {
  const a = [rideId, (userId1 || '').trim(), (userId2 || '').trim()].filter(Boolean);
  return [...a].sort().join('|');
}

/** Compare ride ids from API / storage (string vs occasional number in JSON). */
export function normalizeChatRideId(rideId: unknown): string {
  if (rideId == null) return '';
  return String(rideId).trim();
}

/** Local-only participant id; must match across inbox, chat, and merge logic. */
export function nameParticipantId(displayName: string | undefined): string {
  return `name-${(displayName ?? '').trim() || 'User'}`;
}

export function resolveOtherParticipantId(
  otherUserId: string | undefined,
  otherUserName: string | undefined
): string {
  const oid = (otherUserId ?? '').trim();
  if (oid) return oid;
  return nameParticipantId(otherUserName);
}

export interface StoredMessage {
  id: string;
  text: string;
  sentAt: number;
  senderUserId: string;
  /** `pending` = not yet confirmed; `sent` = on server / delivered to thread. */
  status: 'pending' | 'sent';
}

export interface StoredThread {
  ride: RideListItem;
  participantIds: [string, string];
  participantNames: Record<string, string>;
  /** Best-effort URL for the other participant’s profile photo (inbox / chat). */
  otherUserAvatarUrl?: string;
  lastMessage: string;
  lastMessageAt: number;
  lastMessageSenderId: string;
  messages: StoredMessage[];
  unreadFor: Record<string, number>;
  /** User ids who removed this thread from their inbox (UI must hide for them). */
  deletedFor?: string[];
}

export type StoredThreads = Record<string, StoredThread>;

export async function loadChatThreads(): Promise<StoredThreads> {
  try {
    const raw = await AsyncStorage.getItem(CHAT_THREADS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredThreads;
    return parsed || {};
  } catch {
    return {};
  }
}

export async function saveChatThreads(threads: StoredThreads): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAT_THREADS_KEY, JSON.stringify(threads));
  } catch {
    // ignore
  }
}
