import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ChatConversationResponse, RideListItem } from '../types/api';
import { useAuth } from './AuthContext';
import {
  loadChatThreads,
  saveChatThreads,
  threadKey as getThreadKey,
  nameParticipantId,
  normalizeChatRideId,
  resolveOtherParticipantId,
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
import { normalizeChatStatus, type ChatDeliveryStatus } from '../utils/chatMessageStatus';

export type InboxMessageStatus = ChatDeliveryStatus;

/** Same shape as ChatScreen expects – isFromMe is computed from senderUserId vs currentUser. */
export interface PersistedChatMessage {
  id: string;
  text: string;
  sentAt: number;
  isFromMe: boolean;
  status: ChatDeliveryStatus;
}

export interface InboxConversation {
  id: string;
  ride: RideListItem;
  otherUserName: string;
  otherUserId?: string;
  otherUserAvatarUrl?: string;
  lastMessage: string;
  lastMessageAt: number;
  messageStatus: InboxMessageStatus;
  isLastMessageFromMe: boolean;
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
    update?: {
      lastMessage: string;
      lastMessageAt: number;
      messageStatus?: InboxMessageStatus;
      /** When omitted with an update, defaults to current user (outgoing). Set when restoring preview after failed send. */
      lastMessageSenderId?: string;
    },
    opts?: { otherUserAvatarUrl?: string }
  ) => void;
  getMessages: (ride: RideListItem, otherUserName: string, otherUserId?: string) => PersistedChatMessage[];
  addMessage: (ride: RideListItem, otherUserName: string, otherUserId: string | undefined, msg: PersistedChatMessage) => void;
  updateMessageStatus: (ride: RideListItem, otherUserName: string, otherUserId: string | undefined, messageId: string, status: ChatDeliveryStatus) => void;
  /** Replace optimistic client id with server message after POST succeeds. */
  reconcileOutboundMessage: (
    ride: RideListItem,
    otherUserName: string,
    otherUserId: string | undefined,
    clientMessageId: string,
    server: { id: string; text: string; sentAt: number }
  ) => void;
  removeMessageById: (
    ride: RideListItem,
    otherUserName: string,
    otherUserId: string | undefined,
    messageId: string
  ) => void;
  markAllAsRead: () => void;
  markConversationAsRead: (rideId: string, otherUserId?: string, otherUserName?: string) => void;
  /** Load messages for a thread from backend (call when opening chat). */
  loadThreadMessages: (
    rideId: string,
    otherUserId: string,
    otherUserName?: string,
    ride?: RideListItem,
    opts?: { cancelled?: () => boolean; /** Bypass 45s throttle (e.g. while chat is open and polling). */ force?: boolean }
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

/**
 * Reads `messages` from the exact `threadKey(rideId, viewerId, otherId)` buckets `addMessage` writes.
 * Tries every viewer id (e.g. mongo id vs phone) × raw vs resolved other id so optimistic sends always show.
 */
function messagesFromViewerThreadKeys(
  threads: StoredThreads,
  rideId: string,
  viewerIds: string[],
  rawOtherParam: string,
  resolvedOther: string
): StoredMessage[] {
  const rid = normalizeChatRideId(rideId);
  const others = [...new Set([resolvedOther, rawOtherParam].filter(Boolean))];
  const byId = new Map<string, StoredMessage>();
  for (const vid of viewerIds) {
    if (!vid) continue;
    for (const oid of others) {
      if (!oid) continue;
      const key = getThreadKey(rid, vid, oid);
      const t = threads[key];
      if (!t?.messages?.length) continue;
      for (const m of t.messages) {
        if (!byId.has(m.id)) byId.set(m.id, m);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
}

/** Same union as `getMessages` — used when merging API fetch so we never drop bucket-only rows. */
function localMessagesForThreadMerge(
  threads: StoredThreads,
  rideId: string,
  viewerIds: string[],
  otherUserIdParam: string | undefined,
  otherUserNameParam: string
): StoredMessage[] {
  const rid = normalizeChatRideId(rideId);
  const rawOid = (otherUserIdParam ?? '').trim();
  const resolvedOid = resolveOtherParticipantId(otherUserIdParam, otherUserNameParam);

  const fromBuckets = messagesFromViewerThreadKeys(threads, rid, viewerIds, rawOid, resolvedOid);

  let agg = allMessagesForConversation(threads, rid, viewerIds, rawOid, otherUserNameParam);
  if (resolvedOid !== rawOid) {
    agg = mergeMessagesById(
      agg,
      allMessagesForConversation(threads, rid, viewerIds, resolvedOid, otherUserNameParam)
    );
  }
  return mergeMessagesById(fromBuckets, agg);
}

/** Local thread used name-* id; server thread uses real userId — same ride + same display name. */
function isLocalAliasOfServerThread(
  t: StoredThread,
  rideId: string,
  currentUserId: string,
  serverOtherId: string,
  serverOtherName: string
): boolean {
  if (!t?.ride || normalizeChatRideId(t.ride.id) !== normalizeChatRideId(rideId)) return false;
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
  viewerIds: string[],
  otherUserIdParam: string,
  otherUserNameParam: string
): StoredMessage[] {
  const rid = normalizeChatRideId(rideId);
  const oid = (otherUserIdParam ?? '').trim();
  const oname = (otherUserNameParam ?? '').trim().toLowerCase();
  const nameFallback = oid ? '' : nameParticipantId(otherUserNameParam);
  const byId = new Map<string, StoredMessage>();

  const viewerSet = new Set(viewerIds.filter(Boolean));

  for (const t of Object.values(threads)) {
    if (!t?.ride || normalizeChatRideId(t.ride.id) !== rid) continue;
    if (!t.participantIds?.some((pid) => viewerSet.has(pid))) continue;
    const other = t.participantIds.find((id) => !viewerSet.has(id)) ?? '';
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
    // Real id vs name-* alias: same peer display name on the thread
    if (!match && oname) {
      const pn = (t.participantNames?.[other] ?? '').trim().toLowerCase();
      if (pn && pn === oname) match = true;
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
    if (k === canonicalKey || !t?.ride || normalizeChatRideId(t.ride.id) !== normalizeChatRideId(rideId)) continue;
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

function buildConversationsForUser(threads: StoredThreads, viewerIds: string[]): InboxConversation[] {
  const viewerSet = new Set(viewerIds.filter(Boolean));
  const list: InboxConversation[] = [];
  for (const key of Object.keys(threads)) {
    const t = threads[key];
    if (!t?.participantIds?.some((pid) => viewerSet.has(pid))) continue;
    if (t.deletedFor?.some((d) => viewerSet.has(d))) continue;
    const otherId = t.participantIds.find((id) => !viewerSet.has(id)) ?? '';
    const otherName = t.participantNames?.[otherId]?.trim() || 'User';
    const lastMsg = (t.messages ?? []).length > 0 ? t.messages[t.messages.length - 1] : null;
    const lastSenderId = (lastMsg?.senderUserId ?? t.lastMessageSenderId ?? '').trim();
    const isLastMessageFromMe = Boolean(lastSenderId && viewerSet.has(lastSenderId));
    const lastStatus = normalizeChatStatus(lastMsg?.status);
    const unreadCount = viewerIds.reduce((m, vid) => Math.max(m, t.unreadFor?.[vid] ?? 0), 0);
    list.push({
      id: key,
      ride: t.ride,
      otherUserName: otherName,
      otherUserId: otherId || undefined,
      otherUserAvatarUrl: t.otherUserAvatarUrl,
      lastMessage: t.lastMessage ?? '',
      lastMessageAt: t.lastMessageAt ?? 0,
      messageStatus: isLastMessageFromMe ? lastStatus : 'sent',
      isLastMessageFromMe,
      unreadCount,
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
    const rid = normalizeChatRideId(c.ride?.id ?? '');
    const key = c.threadKey || getThreadKey(rid, currentUserId, c.otherUserId ?? '');
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
    const avatarFromServer = c.otherUserAvatarUrl;
    next[key] = {
      ride: { ...c.ride, id: rid },
      participantIds: existing?.participantIds ?? participantIds,
      participantNames: { ...existing?.participantNames, ...participantNames },
      otherUserAvatarUrl:
        (typeof avatarFromServer === 'string' && avatarFromServer.trim()
          ? avatarFromServer.trim()
          : undefined) ?? existing?.otherUserAvatarUrl,
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
  /** Keep in sync with screens that read `user.id` / `user.phone` for thread membership. */
  const currentUserId = (user?.id ?? user?.phone ?? '').trim();
  const currentUserName = (user?.name ?? '').trim() || 'Me';
  /** Threads may store `phone` or `id` for the same viewer — match both when loading messages. */
  const viewerParticipantIds = useMemo(
    () => [...new Set([currentUserId, (user?.id ?? '').trim(), (user?.phone ?? '').trim()].filter(Boolean))],
    [currentUserId, user?.id, user?.phone]
  );

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
      opts?: { cancelled?: () => boolean; force?: boolean }
    ) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const rid = normalizeChatRideId(rideId);
      const key = getThreadKey(rid, currentUserId, otherId);
      const cancelled = opts?.cancelled;

      if (!opts?.force && shouldSkipThreadMessagesFetch(key)) {
        return;
      }

      /** Same-tick dedupe: register in-flight promise before any await (see chatFetchThrottle). */
      let inFlightPromise = getInFlightThreadFetch(key);
      if (!inFlightPromise) {
        inFlightPromise = Promise.resolve().then(async () => {
          let fromApi: StoredMessage[] = [];
          try {
            const msgs = await fetchThreadMessages(rid, otherUserId.trim() || otherId);
            fromApi = msgs.map((m) => ({
              id: m.id,
              text: m.text,
              sentAt: m.sentAt,
              senderUserId: m.senderUserId,
              status: normalizeChatStatus(m.status),
            }));
          } catch {
            return;
          }
          if (cancelled?.()) return;

          setThreadsByKey((prev) => {
            const t = prev[key];
            const localCombined = localMessagesForThreadMerge(
              prev,
              rid,
              viewerParticipantIds,
              otherUserId,
              otherUserName ?? ''
            );
            /** Server empty but device has history (any alias thread) — don't wipe */
            if (fromApi.length === 0 && localCombined.length > 0) return prev;
            /** Union API + aggregated locals + this thread's rows (avoids drops if alias matching misses `t`). */
            let merged = mergeMessagesById(fromApi, localCombined);
            if (t?.messages?.length) merged = mergeMessagesById(merged, t.messages);
            if (t) {
              const stripped = stripAliasThreads(prev, key, rid, currentUserId, otherUserId ?? '', otherUserName ?? '');
              return { ...stripped, [key]: { ...t, messages: merged } };
            }
            if (!ride) return prev;
            const ids = [currentUserId, otherId].sort() as [string, string];
            const stripped = stripAliasThreads(prev, key, rid, currentUserId, otherUserId ?? '', otherUserName ?? '');
            const rideNorm = { ...ride, id: rid };
            return {
              ...stripped,
              [key]: {
                ride: rideNorm,
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
    [currentUserId, currentUserName, viewerParticipantIds]
  );

  const conversations = useMemo(
    () => buildConversationsForUser(threadsByKey, viewerParticipantIds),
    [threadsByKey, viewerParticipantIds]
  );

  const ensureThread = useCallback(
    (ride: RideListItem, otherUserName: string, otherUserId: string | undefined): string => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const rid = normalizeChatRideId(ride.id);
      const key = getThreadKey(rid, currentUserId, otherId);
      const rideNorm = { ...ride, id: rid };
      setThreadsByKey((prev) => {
        if (prev[key]) return prev;
        const ids = [currentUserId, otherId].sort();
        const next: StoredThreads = {
          ...prev,
          [key]: {
            ride: rideNorm,
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
      update?: {
        lastMessage: string;
        lastMessageAt: number;
        messageStatus?: InboxMessageStatus;
        lastMessageSenderId?: string;
      },
      opts?: { otherUserAvatarUrl?: string }
    ) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const rid = normalizeChatRideId(ride.id);
      const key = getThreadKey(rid, currentUserId, otherId);
      const rideNorm = { ...ride, id: rid };
      const incomingAvatar = (opts?.otherUserAvatarUrl ?? '').trim();
      setThreadsByKey((prev) => {
        const existing = prev[key];
        const base: StoredThread = existing ?? {
          ride: rideNorm,
          participantIds: [currentUserId, otherId].sort() as [string, string],
          participantNames: { [currentUserId]: currentUserName, [otherId]: otherUserName.trim() || 'User' },
          lastMessage: '',
          lastMessageAt: Date.now(),
          lastMessageSenderId: '',
          messages: [],
          unreadFor: {},
        };
        const lastMessageSenderId =
          update == null
            ? base.lastMessageSenderId
            : update.lastMessageSenderId !== undefined
              ? update.lastMessageSenderId
              : currentUserId;
        const updated: StoredThread = {
          ...base,
          ride: { ...base.ride, ...rideNorm, id: rid },
          participantNames: { ...base.participantNames, [currentUserId]: currentUserName, [otherId]: otherUserName.trim() || 'User' },
          otherUserAvatarUrl: incomingAvatar || base.otherUserAvatarUrl,
          lastMessage: update?.lastMessage ?? base.lastMessage,
          lastMessageAt: update?.lastMessageAt ?? base.lastMessageAt,
          lastMessageSenderId,
        };
        return { ...prev, [key]: updated };
      });
    },
    [currentUserId, currentUserName]
  );

  const getMessages = useCallback(
    (ride: RideListItem, otherUserName: string, otherUserId?: string): PersistedChatMessage[] => {
      const list = localMessagesForThreadMerge(
        threadsByKey,
        ride.id,
        viewerParticipantIds,
        otherUserId,
        otherUserName
      );

      return list.map((m: StoredMessage) => ({
        id: m.id,
        text: m.text,
        sentAt: m.sentAt,
        isFromMe: viewerParticipantIds.some((v) => v && m.senderUserId === v),
        status: normalizeChatStatus(m.status),
      }));
    },
    [threadsByKey, viewerParticipantIds]
  );

  const addMessage = useCallback(
    (ride: RideListItem, otherUserName: string, otherUserId: string | undefined, msg: PersistedChatMessage) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const rid = normalizeChatRideId(ride.id);
      const key = getThreadKey(rid, currentUserId, otherId);
      const rideNorm: RideListItem = { ...ride, id: rid };
      const stored: StoredMessage = {
        id: msg.id,
        text: msg.text,
        sentAt: msg.sentAt,
        senderUserId: currentUserId,
        status: msg.status,
      };
      setThreadsByKey((prev) => {
        const t = prev[key] ?? {
          ride: rideNorm,
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
            ride: { ...t.ride, ...rideNorm, id: rid },
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
      status: ChatDeliveryStatus
    ) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const key = getThreadKey(normalizeChatRideId(ride.id), currentUserId, otherId);
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

  const reconcileOutboundMessage = useCallback(
    (
      ride: RideListItem,
      otherUserName: string,
      otherUserId: string | undefined,
      clientMessageId: string,
      server: { id: string; text: string; sentAt: number }
    ) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const key = getThreadKey(normalizeChatRideId(ride.id), currentUserId, otherId);
      setThreadsByKey((prev) => {
        const t = prev[key];
        if (!t) return prev;
        return {
          ...prev,
          [key]: {
            ...t,
            messages: t.messages.map((m) =>
              m.id === clientMessageId
                ? {
                    ...m,
                    id: server.id,
                    text: server.text,
                    sentAt: server.sentAt,
                    status: 'sent' as const,
                  }
                : m
            ),
          },
        };
      });
    },
    [currentUserId]
  );

  const removeMessageById = useCallback(
    (ride: RideListItem, otherUserName: string, otherUserId: string | undefined, messageId: string) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const key = getThreadKey(normalizeChatRideId(ride.id), currentUserId, otherId);
      setThreadsByKey((prev) => {
        const t = prev[key];
        if (!t) return prev;
        const removed = t.messages.find((m) => m.id === messageId);
        const messages = t.messages.filter((m) => m.id !== messageId);
        const unreadFor = { ...t.unreadFor };
        if (removed && viewerParticipantIds.some((v) => v && removed.senderUserId === v)) {
          unreadFor[otherId] = Math.max(0, (unreadFor[otherId] ?? 0) - 1);
        }
        return {
          ...prev,
          [key]: {
            ...t,
            messages,
            unreadFor,
          },
        };
      });
    },
    [currentUserId, viewerParticipantIds]
  );

  const markAllAsRead = useCallback(() => {
    setThreadsByKey((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const t = next[k];
        let unreadFor = t.unreadFor ? { ...t.unreadFor } : {};
        let changed = false;
        for (const vid of viewerParticipantIds) {
          if ((unreadFor[vid] ?? 0) > 0) {
            unreadFor[vid] = 0;
            changed = true;
          }
        }
        if (changed) next[k] = { ...t, unreadFor };
      }
      return next;
    });
  }, [viewerParticipantIds]);

  const markConversationAsRead = useCallback(
    (rideId: string, otherUserId?: string, otherUserName?: string) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const key = getThreadKey(normalizeChatRideId(rideId), currentUserId, otherId);
      setThreadsByKey((prev) => {
        const t = prev[key];
        if (!t) return prev;
        const unreadFor = { ...t.unreadFor };
        let changed = false;
        for (const vid of viewerParticipantIds) {
          if ((unreadFor[vid] ?? 0) > 0) {
            unreadFor[vid] = 0;
            changed = true;
          }
        }
        if (!changed) return prev;
        return {
          ...prev,
          [key]: { ...t, unreadFor },
        };
      });
    },
    [currentUserId, viewerParticipantIds]
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
      reconcileOutboundMessage,
      removeMessageById,
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
      reconcileOutboundMessage,
      removeMessageById,
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
