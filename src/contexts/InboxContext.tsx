import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ChatConversationResponse, RideListItem } from '../types/api';
import { useAuth } from './AuthContext';
import {
  loadChatThreads,
  saveChatThreads,
  threadKey as getThreadKey,
  type StoredThread,
  type StoredThreads,
  type StoredMessage,
} from '../services/chat-storage';
import { fetchConversations, fetchThreadMessages } from '../services/chat-api';
import {
  shouldSkipThreadMessagesFetch,
  markThreadMessagesFetchedOk,
  getInFlightThreadFetch,
  setInFlightThreadFetch,
  clearInFlightThreadFetch,
} from '../utils/chatFetchThrottle';
import { getInboxActivitySortKey } from '../utils/inboxList';

export type InboxMessageStatus = 'sent' | 'delivered';

/** Same shape as ChatScreen expects – isFromMe is computed from senderUserId vs currentUser. */
export interface PersistedChatMessage {
  id: string;
  text: string;
  sentAt: number;
  isFromMe: boolean;
  status: 'sending' | 'sent' | 'delivered' | 'read';
}

export interface InboxConversation {
  id: string;
  ride: RideListItem;
  otherUserName: string;
  otherUserId?: string;
  lastMessage: string;
  lastMessageAt: number;
  messageStatus: InboxMessageStatus;
  unreadCount: number;
}

type InboxState = {
  conversations: InboxConversation[];
  hasUnread: boolean;
  /** Re-fetch inbox from server (e.g. after peer sends message and thread is un-hidden). */
  refreshConversations: () => Promise<void>;
  addOrUpdateConversation: (
    ride: RideListItem,
    otherUserName: string,
    otherUserId?: string,
    update?: { lastMessage: string; lastMessageAt: number; messageStatus?: InboxMessageStatus }
  ) => void;
  getMessages: (ride: RideListItem, otherUserName: string, otherUserId?: string) => PersistedChatMessage[];
  addMessage: (ride: RideListItem, otherUserName: string, otherUserId: string | undefined, msg: PersistedChatMessage) => void;
  updateMessageStatus: (ride: RideListItem, otherUserName: string, otherUserId: string | undefined, messageId: string, status: PersistedChatMessage['status']) => void;
  markAllAsRead: () => void;
  markConversationAsRead: (rideId: string, otherUserId?: string, otherUserName?: string) => void;
  /** Load messages for a thread from backend (call when opening chat). */
  loadThreadMessages: (
    rideId: string,
    otherUserId: string,
    otherUserName?: string,
    ride?: RideListItem,
    opts?: { cancelled?: () => boolean }
  ) => Promise<void>;
};

const InboxContext = createContext<InboxState | null>(null);

/** Legacy key for backward compat; prefer threadKey from chat-storage for persistence. */
export function conversationKey(rideId: string, otherUserId?: string, otherUserName?: string): string {
  return `${rideId}|${otherUserId ?? ''}|${otherUserName ?? ''}`;
}

function mergeMessagesById(a: StoredMessage[], b: StoredMessage[]): StoredMessage[] {
  const byId = new Map<string, StoredMessage>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.sentAt - y.sentAt);
}

/** Local thread used name-* id; server thread uses real userId — same ride + same display name. */
function isLocalAliasOfServerThread(
  t: StoredThread,
  rideId: string,
  currentUserId: string,
  serverOtherId: string,
  serverOtherName: string
): boolean {
  if (!t?.ride || t.ride.id !== rideId) return false;
  if (!t.participantIds?.includes(currentUserId)) return false;
  const other = t.participantIds.find((id) => id !== currentUserId) ?? '';
  const sid = (serverOtherId ?? '').trim();
  const sname = (serverOtherName ?? '').trim().toLowerCase();
  if (!sid || other === sid) return false;
  if (!other.startsWith('name-')) return false;
  const pn = (t.participantNames?.[other] ?? '').trim().toLowerCase();
  return Boolean(pn && sname && pn === sname);
}

/** Collect messages from every thread that is the same conversation (ride + other person). */
function allMessagesForConversation(
  threads: StoredThreads,
  rideId: string,
  currentUserId: string,
  otherUserIdParam: string,
  otherUserNameParam: string
): StoredMessage[] {
  const oid = (otherUserIdParam ?? '').trim();
  const oname = (otherUserNameParam ?? '').trim().toLowerCase();
  const nameFallback = otherUserNameParam ? `name-${otherUserNameParam}` : '';
  const byId = new Map<string, StoredMessage>();

  for (const t of Object.values(threads)) {
    if (!t?.ride || t.ride.id !== rideId) continue;
    if (!t.participantIds?.includes(currentUserId)) continue;
    const other = t.participantIds.find((id) => id !== currentUserId) ?? '';
    let match = false;
    if (oid && other === oid) match = true;
    else if (oid && other.startsWith('name-')) {
      const pn = (t.participantNames?.[other] ?? '').trim().toLowerCase();
      if (pn && oname && pn === oname) match = true;
    } else if (!oid && nameFallback && other === nameFallback) match = true;
    else if (!oid && oname && other.startsWith('name-')) {
      const pn = (t.participantNames?.[other] ?? '').trim().toLowerCase();
      if (pn === oname) match = true;
    }
    if (match) {
      for (const m of t.messages ?? []) {
        if (!byId.has(m.id)) byId.set(m.id, m);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
}

/** Remove other thread keys that are the same chat (local name-* vs server id). */
function stripAliasThreads(
  prev: StoredThreads,
  canonicalKey: string,
  rideId: string,
  currentUserId: string,
  paramOtherId: string,
  paramOtherName: string
): StoredThreads {
  const oid = (paramOtherId ?? '').trim();
  const oname = (paramOtherName ?? '').trim().toLowerCase();
  const next = { ...prev };
  for (const [k, t] of Object.entries(prev)) {
    if (k === canonicalKey || !t?.ride || t.ride.id !== rideId) continue;
    if (!t.participantIds?.includes(currentUserId)) continue;
    const other = t.participantIds.find((id) => id !== currentUserId) ?? '';
    if (other === oid) continue;
    if (oid && other.startsWith('name-')) {
      const pn = (t.participantNames?.[other] ?? '').trim().toLowerCase();
      if (pn && oname && pn === oname) delete next[k];
    }
  }
  return next;
}

function buildConversationsForUser(threads: StoredThreads, currentUserId: string): InboxConversation[] {
  const list: InboxConversation[] = [];
  for (const key of Object.keys(threads)) {
    const t = threads[key];
    if (!t?.participantIds?.includes(currentUserId)) continue;
    if (t.deletedFor?.includes(currentUserId)) continue;
    const otherId = t.participantIds.find((id) => id !== currentUserId) ?? '';
    const otherName = t.participantNames?.[otherId]?.trim() || 'User';
    list.push({
      id: key,
      ride: t.ride,
      otherUserName: otherName,
      otherUserId: otherId || undefined,
      lastMessage: t.lastMessage ?? '',
      lastMessageAt: t.lastMessageAt ?? 0,
      messageStatus: (t.lastMessageSenderId ? 'delivered' : 'sent') as InboxMessageStatus,
      unreadCount: t.unreadFor?.[currentUserId] ?? 0,
    });
  }
  return list.sort((a, b) => getInboxActivitySortKey(b) - getInboxActivitySortKey(a));
}

function mergeServerConversationsIntoThreads(
  prev: StoredThreads,
  convs: ChatConversationResponse[],
  currentUserId: string,
  currentUserName: string
): StoredThreads {
  const next = { ...prev };
  for (const c of convs) {
    const key = c.threadKey || getThreadKey(c.ride?.id ?? '', currentUserId, c.otherUserId ?? '');
    if (!key || !c.ride) continue;
    const existing = next[key];
    const participantIds = [currentUserId, (c.otherUserId ?? '').trim()].filter(Boolean).sort() as [string, string];
    const participantNames = {
      [currentUserId]: currentUserName,
      [c.otherUserId ?? '']: (c.otherUserName ?? 'User').trim(),
    };
    let mergedMsgs = existing?.messages ?? [];
    for (const [k, t] of Object.entries(next)) {
      if (k === key) continue;
      if (
        isLocalAliasOfServerThread(t, c.ride.id, currentUserId, c.otherUserId ?? '', c.otherUserName ?? '')
      ) {
        mergedMsgs = mergeMessagesById(mergedMsgs, t.messages ?? []);
        delete next[k];
      }
    }
    next[key] = {
      ride: c.ride,
      participantIds: existing?.participantIds ?? participantIds,
      participantNames: { ...existing?.participantNames, ...participantNames },
      lastMessage: c.lastMessage ?? existing?.lastMessage ?? '',
      lastMessageAt: c.lastMessageAt ?? existing?.lastMessageAt ?? 0,
      lastMessageSenderId: c.lastMessageSenderId ?? existing?.lastMessageSenderId ?? '',
      messages: mergedMsgs,
      unreadFor: { ...existing?.unreadFor, [currentUserId]: c.unreadCount ?? 0 },
      deletedFor: Array.isArray(c.deletedFor) ? c.deletedFor : existing?.deletedFor,
    };
  }
  return next;
}

export function InboxProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  const currentUserId = (user?.id ?? user?._id ?? '').trim();
  const currentUserName = (user?.name ?? '').trim() || 'Me';

  const [threadsByKey, setThreadsByKey] = useState<StoredThreads>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadChatThreads().then((threads) => {
      if (!cancelled) {
        setThreadsByKey(threads);
        setHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveChatThreads(threadsByKey);
  }, [threadsByKey, hydrated]);

  const refreshConversations = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const convs = await fetchConversations();
      setThreadsByKey((prev) => mergeServerConversationsIntoThreads(prev, convs, currentUserId, currentUserName));
    } catch {
      /* keep local */
    }
  }, [currentUserId, currentUserName]);

  // Load conversations from backend so inbox survives app reinstall / device change
  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    fetchConversations()
      .then((convs) => {
        if (cancelled) return;
        setThreadsByKey((prev) => mergeServerConversationsIntoThreads(prev, convs, currentUserId, currentUserName));
      })
      .catch(() => {
        /* keep local only if API not implemented or fails */
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, currentUserName]);

  const loadThreadMessages = useCallback(
    async (
      rideId: string,
      otherUserId: string,
      otherUserName?: string,
      ride?: RideListItem,
      opts?: { cancelled?: () => boolean }
    ) => {
      const otherId = (otherUserId ?? '').trim() || (otherUserName ? `name-${otherUserName}` : '');
      const key = getThreadKey(rideId, currentUserId, otherId);
      const cancelled = opts?.cancelled;

      if (shouldSkipThreadMessagesFetch(key)) {
        return;
      }

      /** Same-tick dedupe: register in-flight promise before any await (see chatFetchThrottle). */
      let inFlightPromise = getInFlightThreadFetch(key);
      if (!inFlightPromise) {
        inFlightPromise = Promise.resolve().then(async () => {
          let fromApi: StoredMessage[] = [];
          try {
            const msgs = await fetchThreadMessages(rideId, otherUserId.trim() || otherId);
            fromApi = msgs.map((m) => ({
              id: m.id,
              text: m.text,
              sentAt: m.sentAt,
              senderUserId: m.senderUserId,
              status: m.status,
            }));
          } catch {
            return;
          }
          if (cancelled?.()) return;

          setThreadsByKey((prev) => {
            const t = prev[key];
            const localCombined = allMessagesForConversation(
              prev,
              rideId,
              currentUserId,
              (otherUserId ?? '').trim(),
              otherUserName ?? ''
            );
            /** Server empty but device has history (any alias thread) — don't wipe */
            if (fromApi.length === 0 && localCombined.length > 0) return prev;
            const byId = new Map<string, StoredMessage>();
            for (const m of fromApi) byId.set(m.id, m);
            for (const m of localCombined) {
              if (!byId.has(m.id)) byId.set(m.id, m);
            }
            const merged = [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
            if (t) {
              const stripped = stripAliasThreads(prev, key, rideId, currentUserId, otherUserId ?? '', otherUserName ?? '');
              return { ...stripped, [key]: { ...t, messages: merged } };
            }
            if (!ride) return prev;
            const ids = [currentUserId, otherId].sort() as [string, string];
            const stripped = stripAliasThreads(prev, key, rideId, currentUserId, otherUserId ?? '', otherUserName ?? '');
            return {
              ...stripped,
              [key]: {
                ride,
                participantIds: ids,
                participantNames: { [currentUserId]: currentUserName, [otherId]: (otherUserName ?? 'User').trim() },
                lastMessage: '',
                lastMessageAt: 0,
                lastMessageSenderId: '',
                messages: merged,
                unreadFor: {},
              },
            };
          });
          if (!cancelled?.()) {
            markThreadMessagesFetchedOk(key);
          }
        });
        setInFlightThreadFetch(key, inFlightPromise);
      }
      try {
        await inFlightPromise;
      } finally {
        clearInFlightThreadFetch(key);
      }
    },
    [currentUserId, currentUserName]
  );

  const conversations = useMemo(
    () => buildConversationsForUser(threadsByKey, currentUserId),
    [threadsByKey, currentUserId]
  );

  const ensureThread = useCallback(
    (ride: RideListItem, otherUserName: string, otherUserId: string | undefined): string => {
      const otherId = (otherUserId ?? '').trim() || `name-${otherUserName}`;
      const key = getThreadKey(ride.id, currentUserId, otherId);
      setThreadsByKey((prev) => {
        if (prev[key]) return prev;
        const ids = [currentUserId, otherId].sort();
        const next: StoredThreads = {
          ...prev,
          [key]: {
            ride,
            participantIds: ids as [string, string],
            participantNames: { [currentUserId]: currentUserName, [otherId]: otherUserName.trim() || 'User' },
            lastMessage: '',
            lastMessageAt: Date.now(),
            lastMessageSenderId: '',
            messages: [],
            unreadFor: {},
          },
        };
        return next;
      });
      return key;
    },
    [currentUserId, currentUserName]
  );

  const addOrUpdateConversation = useCallback(
    (
      ride: RideListItem,
      otherUserName: string,
      otherUserId?: string,
      update?: { lastMessage: string; lastMessageAt: number; messageStatus?: InboxMessageStatus }
    ) => {
      const otherId = (otherUserId ?? '').trim() || `name-${otherUserName}`;
      const key = getThreadKey(ride.id, currentUserId, otherId);
      setThreadsByKey((prev) => {
        const existing = prev[key];
        const base: StoredThread = existing ?? {
          ride,
          participantIds: [currentUserId, otherId].sort() as [string, string],
          participantNames: { [currentUserId]: currentUserName, [otherId]: otherUserName.trim() || 'User' },
          lastMessage: '',
          lastMessageAt: Date.now(),
          lastMessageSenderId: '',
          messages: [],
          unreadFor: {},
        };
        const updated: StoredThread = {
          ...base,
          participantNames: { ...base.participantNames, [currentUserId]: currentUserName, [otherId]: otherUserName.trim() || 'User' },
          lastMessage: update?.lastMessage ?? base.lastMessage,
          lastMessageAt: update?.lastMessageAt ?? base.lastMessageAt,
          lastMessageSenderId: update ? currentUserId : base.lastMessageSenderId,
        };
        return { ...prev, [key]: updated };
      });
    },
    [currentUserId, currentUserName]
  );

  const getMessages = useCallback(
    (ride: RideListItem, otherUserName: string, otherUserId?: string): PersistedChatMessage[] => {
      const list = allMessagesForConversation(
        threadsByKey,
        ride.id,
        currentUserId,
        (otherUserId ?? '').trim(),
        otherUserName
      );
      return list.map((m: StoredMessage) => ({
        id: m.id,
        text: m.text,
        sentAt: m.sentAt,
        isFromMe: m.senderUserId === currentUserId,
        status: m.status,
      }));
    },
    [threadsByKey, currentUserId]
  );

  const addMessage = useCallback(
    (ride: RideListItem, otherUserName: string, otherUserId: string | undefined, msg: PersistedChatMessage) => {
      const otherId = (otherUserId ?? '').trim() || `name-${otherUserName}`;
      const key = getThreadKey(ride.id, currentUserId, otherId);
      const stored: StoredMessage = {
        id: msg.id,
        text: msg.text,
        sentAt: msg.sentAt,
        senderUserId: currentUserId,
        status: msg.status,
      };
      setThreadsByKey((prev) => {
        const t = prev[key] ?? {
          ride,
          participantIds: [currentUserId, otherId].sort() as [string, string],
          participantNames: { [currentUserId]: currentUserName, [otherId]: otherUserName.trim() || 'User' },
          lastMessage: '',
          lastMessageAt: 0,
          lastMessageSenderId: '',
          messages: [],
          unreadFor: {},
        };
        const unreadFor = { ...t.unreadFor };
        unreadFor[otherId] = (unreadFor[otherId] ?? 0) + 1;
        return {
          ...prev,
          [key]: {
            ...t,
            lastMessage: msg.text,
            lastMessageAt: msg.sentAt,
            lastMessageSenderId: currentUserId,
            messages: [...t.messages, stored],
            unreadFor,
          },
        };
      });
    },
    [currentUserId, currentUserName]
  );

  const updateMessageStatus = useCallback(
    (
      ride: RideListItem,
      otherUserName: string,
      otherUserId: string | undefined,
      messageId: string,
      status: PersistedChatMessage['status']
    ) => {
      const otherId = (otherUserId ?? '').trim() || `name-${otherUserName}`;
      const key = getThreadKey(ride.id, currentUserId, otherId);
      setThreadsByKey((prev) => {
        const t = prev[key];
        if (!t) return prev;
        return {
          ...prev,
          [key]: {
            ...t,
            messages: t.messages.map((m) => (m.id === messageId ? { ...m, status } : m)),
          },
        };
      });
    },
    [currentUserId]
  );

  const markAllAsRead = useCallback(() => {
    setThreadsByKey((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const t = next[k];
        if (t.unreadFor?.[currentUserId]) {
          next[k] = { ...t, unreadFor: { ...t.unreadFor, [currentUserId]: 0 } };
        }
      }
      return next;
    });
  }, [currentUserId]);

  const markConversationAsRead = useCallback(
    (rideId: string, otherUserId?: string, otherUserName?: string) => {
      const otherId = (otherUserId ?? '').trim() || (otherUserName ? `name-${otherUserName}` : '');
      const key = getThreadKey(rideId, currentUserId, otherId);
      setThreadsByKey((prev) => {
        const t = prev[key];
        if (!t || !(t.unreadFor?.[currentUserId] > 0)) return prev;
        return {
          ...prev,
          [key]: { ...t, unreadFor: { ...t.unreadFor, [currentUserId]: 0 } },
        };
      });
    },
    [currentUserId]
  );

  const hasUnread = conversations.some((c) => c.unreadCount > 0);

  const value = useMemo(
    () => ({
      conversations,
      hasUnread,
      refreshConversations,
      addOrUpdateConversation,
      getMessages,
      addMessage,
      updateMessageStatus,
      markAllAsRead,
      markConversationAsRead,
      loadThreadMessages,
    }),
    [
      conversations,
      hasUnread,
      refreshConversations,
      addOrUpdateConversation,
      getMessages,
      addMessage,
      updateMessageStatus,
      markAllAsRead,
      markConversationAsRead,
      loadThreadMessages,
    ]
  );

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxState {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used within InboxProvider');
  return ctx;
}
