import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
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
import { MAX_CHAT_WS_SUBSCRIPTIONS, compareInboxByLastMessageAtDesc } from '../utils/inboxList';
import { normalizeChatStatus, type ChatDeliveryStatus } from '../utils/chatMessageStatus';
import { chatWSManager } from '../services/chatWebSocketManager';
import { setInboxRefreshCallback } from '../navigation/handleNotificationNavigation';

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
  /** Merge an incoming row immediately (e.g. push preview while chat is open). Does not bump unread. */
  ingestIncomingMessage: (
    ride: RideListItem,
    otherUserName: string,
    otherUserId: string | undefined,
    incoming: { id: string; text: string; sentAt: number; senderUserId: string }
  ) => void;
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
    const unreadCount = viewerIds.reduce((m, vid) => Math.max(m, t.unreadFor?.[vid] ?? 0), 0);
    const hasAnyMessage =
      (t.messages ?? []).length > 0 || String(t.lastMessage ?? '').trim().length > 0;
    /** Chats tab: only threads with at least one message (or unread), not empty “placeholder” threads. */
    if (!hasAnyMessage && unreadCount === 0) continue;

    const lastMsg = (t.messages ?? []).length > 0 ? t.messages[t.messages.length - 1] : null;
    const lastSenderId = (lastMsg?.senderUserId ?? t.lastMessageSenderId ?? '').trim();
    const isLastMessageFromMe = Boolean(lastSenderId && viewerSet.has(lastSenderId));
    const lastStatus = normalizeChatStatus(lastMsg?.status);
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
  return list.sort(compareInboxByLastMessageAtDesc);
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
    const otherUid = (c.otherUserId ?? '').trim();
    /** Always use same key as GET messages / WS: sorted ride|user|user — avoids Invalid request on subscribe. */
    const key =
      rid && otherUid ? getThreadKey(rid, currentUserId, otherUid) : (c.threadKey || '').trim();
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
    const serverUnread = c.unreadCount ?? 0;
    const localUnread = existing?.unreadFor?.[currentUserId] ?? 0;
    const mergedUnread =
      serverUnread > 0 || localUnread > 0 ? Math.max(serverUnread, localUnread) : 0;
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
      unreadFor: { ...existing?.unreadFor, [currentUserId]: mergedUnread },
      deletedFor: Array.isArray(c.deletedFor) ? c.deletedFor : existing?.deletedFor,
    };
  }
  return next;
}

export function InboxProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, isAuthenticated, needsEmailVerification, needsProfileCompletion, isLoading } = useAuth();
  /** Match RootNavigator `sessionReady` — JWT + user id can exist before onboarding; skip chat list API until then. */
  const chatApiReady =
    !isLoading && isAuthenticated && !needsEmailVerification && !needsProfileCompletion;
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
  const [wsConnectedEpoch, setWsConnectedEpoch] = useState(0);
  const wsHandlersRef = useRef(new Map<string, (msg: any) => void>());
  /** Skip subscribe/unsubscribe churn when only thread *messages* changed, not WS subscription targets. */
  const wsDesiredSigRef = useRef('');
  /** Avoid stacking concurrent inbox list fetches from the poll timer + foreground resume. */
  const inboxPollInFlightRef = useRef(false);

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

  useEffect(() => {
    const unsubscribe = chatWSManager.onConnectionChange((connected) => {
      if (connected) {
        setWsConnectedEpoch((v) => v + 1);
      }
    });
    return unsubscribe;
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!chatApiReady || !currentUserId) return;
    try {
      const convs = await fetchConversations();
      setThreadsByKey((prev) => mergeServerConversationsIntoThreads(prev, convs, currentUserId, currentUserName));
    } catch {
      /* keep local */
    }
  }, [chatApiReady, currentUserId, currentUserName]);

  /** Poll / resume only — skips if a fetch is already running (same result as waiting, less load). */
  const runInboxPollIfIdle = useCallback(async () => {
    if (!chatApiReady || !currentUserId) return;
    if (inboxPollInFlightRef.current) return;
    inboxPollInFlightRef.current = true;
    try {
      await refreshConversations();
    } finally {
      inboxPollInFlightRef.current = false;
    }
  }, [chatApiReady, currentUserId, refreshConversations]);

  // Load conversations from backend so inbox survives app reinstall / device change
  useEffect(() => {
    if (!chatApiReady || !currentUserId) return;
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
  }, [chatApiReady, currentUserId, currentUserName]);

  /** Global WebSocket listener: receive messages for ANY thread, even if chat is closed. */
  useEffect(() => {
    if (!currentUserId || !threadsByKey) return;

    const viewerSet = new Set(viewerParticipantIds.filter(Boolean));

    // Handler for incoming WebSocket messages - update thread regardless of UI state
    const handleIncomingWSMessage = (threadKey: string) => (msg: any) => {
      setThreadsByKey((prev) => {
        let thread = prev?.[threadKey];

        if (!thread) {
          thread = {
            ride: {} as RideListItem,
            participantIds: ['', ''] as [string, string],
            participantNames: {},
            messages: [],
            lastMessage: '',
            lastMessageAt: 0,
            lastMessageSenderId: '',
            unreadFor: {},
          };
        }

        const stored: StoredMessage = {
          id: msg.id,
          text: msg.text,
          sentAt: msg.sentAt,
          senderUserId: msg.senderUserId,
          status: normalizeChatStatus(msg.status || 'sent'),
        };

        // Deduplicate: check if message already exists
        const existingIndex = thread.messages.findIndex((m) => m.id === msg.id);
        if (existingIndex >= 0) {
          const existing = thread.messages[existingIndex];
          if (existing.status === stored.status) {
            return prev;
          }
          const updated = [...thread.messages];
          updated[existingIndex] = stored;
          return {
            ...prev,
            [threadKey]: {
              ...thread,
              messages: updated,
              lastMessage: msg.text,
              lastMessageAt: msg.sentAt,
              lastMessageSenderId: msg.senderUserId,
            },
          };
        }

        // New message - add it sorted by timestamp
        const newMessages = [...thread.messages, stored].sort((a, b) => a.sentAt - b.sentAt);

        const unreadFor = { ...(thread.unreadFor ?? {}) };
        const isIncoming = !viewerParticipantIds.some((v) => v && msg.senderUserId === v);
        if (isIncoming) {
          for (const vid of viewerParticipantIds) {
            if (!vid) continue;
            unreadFor[vid] = (unreadFor[vid] ?? 0) + 1;
          }
        }

        const updated = {
          ...thread,
          messages: newMessages,
          lastMessage: msg.text,
          lastMessageAt: msg.sentAt,
          lastMessageSenderId: msg.senderUserId,
          unreadFor,
        };

        return {
          ...prev,
          [threadKey]: updated,
        };
      });
    };

    // Subscribe once per canonical thread key (sorted ride|user|user) — matches backend GET/WS.
    const desiredAll = new Map<string, { rideId: string; otherUserId: string }>();
    Object.values(threadsByKey).forEach((thread) => {
      if (!thread) return;
      if (!thread.participantIds?.some((pid) => viewerSet.has(pid))) return;
      const otherId = thread.participantIds.find((pid) => !viewerSet.has(pid)) ?? '';
      if (!otherId || otherId.startsWith('name-')) return;
      const rideId = normalizeChatRideId(thread.ride?.id);
      if (!rideId) return;
      const canonicalKey = getThreadKey(rideId, currentUserId, otherId);
      desiredAll.set(canonicalKey, { rideId, otherUserId: otherId });
    });

    /** Production-style cap: only the most active threads get live WS; rest use HTTP/polling. */
    const ranked = [...desiredAll.entries()].map(([canonicalKey, params]) => {
      const thread = threadsByKey[canonicalKey];
      const sortKey = thread?.lastMessageAt ?? 0;
      const unread = thread ? (thread.unreadFor?.[currentUserId] ?? 0) : 0;
      return { canonicalKey, params, sortKey, unread };
    });
    ranked.sort((a, b) => {
      if (b.unread !== a.unread) return b.unread - a.unread;
      return b.sortKey - a.sortKey;
    });
    const desired = new Map(
      ranked.slice(0, MAX_CHAT_WS_SUBSCRIPTIONS).map((e) => [e.canonicalKey, e.params])
    );

    const desiredSig = [...desired.entries()]
      .map(([k, v]) => `${k}|${v.rideId}|${v.otherUserId}`)
      .sort()
      .join('\n');
    const sigWithEpoch = `${desiredSig}#${wsConnectedEpoch}`;
    if (sigWithEpoch === wsDesiredSigRef.current) {
      return;
    }
    wsDesiredSigRef.current = sigWithEpoch;

    desired.forEach(({ rideId, otherUserId }, canonicalKey) => {
      if (!wsHandlersRef.current.has(canonicalKey) && chatWSManager.isConnected()) {
        const handler = handleIncomingWSMessage(canonicalKey);
        wsHandlersRef.current.set(canonicalKey, handler);
        chatWSManager.subscribe(canonicalKey, handler, { rideId, otherUserId });
      }
    });

    for (const threadKey of wsHandlersRef.current.keys()) {
      if (!desired.has(threadKey)) {
        chatWSManager.unsubscribe(threadKey);
        wsHandlersRef.current.delete(threadKey);
      }
    }
  }, [currentUserId, threadsByKey, viewerParticipantIds, wsConnectedEpoch]);

  // Full cleanup only on user switch/unmount, not on each thread update.
  useEffect(() => {
    wsDesiredSigRef.current = '';
    return () => {
      for (const threadKey of wsHandlersRef.current.keys()) {
        chatWSManager.unsubscribe(threadKey);
      }
      wsHandlersRef.current.clear();
    };
  }, [currentUserId]);

  const loadThreadMessages = useCallback(
    async (
      rideId: string,
      otherUserId: string,
      otherUserName?: string,
      ride?: RideListItem,
      opts?: { cancelled?: () => boolean; force?: boolean }
    ) => {
      if (!chatApiReady || !currentUserId?.trim()) return;
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
    [chatApiReady, currentUserId, currentUserName, viewerParticipantIds]
  );

  const bumpUnreadFromNotification = useCallback(
    (rideId: string, otherUserId: string, otherUserName: string): void => {
      const rid = normalizeChatRideId(rideId);
      const incomingOtherId = (otherUserId ?? '').trim();
      const incomingName = (otherUserName ?? '').trim().toLowerCase();
      if (!rid || !incomingOtherId) return;

      setThreadsByKey((prev) => {
        let changed = false;
        const next: StoredThreads = { ...prev };

        for (const [key, thread] of Object.entries(prev)) {
          if (!thread?.ride || normalizeChatRideId(thread.ride.id) !== rid) continue;
          if (!thread.participantIds?.some((pid) => viewerParticipantIds.includes(pid))) continue;
          const other = thread.participantIds.find((pid) => !viewerParticipantIds.includes(pid)) ?? '';
          const peerName = (thread.participantNames?.[other] ?? '').trim().toLowerCase();
          const samePeer = other === incomingOtherId || (peerName && peerName === incomingName);
          if (!samePeer) continue;

          const unreadFor = { ...(thread.unreadFor ?? {}) };
          for (const vid of viewerParticipantIds) {
            if (!vid) continue;
            unreadFor[vid] = (unreadFor[vid] ?? 0) + 1;
          }
          next[key] = { ...thread, unreadFor };
          changed = true;
        }

        return changed ? next : prev;
      });
    },
    [viewerParticipantIds]
  );

  useEffect(() => {
    setInboxRefreshCallback(async (rideId: string, otherUserId: string, otherUserName: string) => {
      if (!chatApiReady || !currentUserId) return false;
      bumpUnreadFromNotification(rideId, otherUserId, otherUserName);
      void refreshConversations();
      void loadThreadMessages(rideId, otherUserId, otherUserName, undefined, { force: true });
      return true;
    });
    return () => {
      setInboxRefreshCallback(null);
    };
  }, [chatApiReady, currentUserId, refreshConversations, loadThreadMessages, bumpUnreadFromNotification]);

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
      const rid = normalizeChatRideId(ride.id);
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const key = getThreadKey(rid, currentUserId, otherId);

      // If thread doesn't exist yet, load it from API in background (only if currentUserId ready)
      if (currentUserId && !threadsByKey[key]) {
        void loadThreadMessages(rid, otherUserId ?? '', otherUserName, ride).catch((err) => {
          console.error('[getMessages] Failed to load thread:', err);
        });
      }

      const list = localMessagesForThreadMerge(
        threadsByKey,
        ride.id,
        viewerParticipantIds,
        otherUserId,
        otherUserName
      );

      return list.map((m: StoredMessage) => {
        const isFromMe = viewerParticipantIds.some((v) => v && m.senderUserId === v);
        return {
          id: m.id,
          text: m.text,
          sentAt: m.sentAt,
          isFromMe,
          status: normalizeChatStatus(m.status),
        };
      });
    },
    [viewerParticipantIds, currentUserId, loadThreadMessages, threadsByKey]
  );

  const ingestIncomingMessage = useCallback(
    (
      ride: RideListItem,
      otherUserName: string,
      otherUserId: string | undefined,
      incoming: { id: string; text: string; sentAt: number; senderUserId: string }
    ) => {
      const otherId = resolveOtherParticipantId(otherUserId, otherUserName);
      const rid = normalizeChatRideId(ride.id);
      const threadKey = getThreadKey(rid, currentUserId, otherId);
      const stored: StoredMessage = {
        id: incoming.id,
        text: incoming.text,
        sentAt: incoming.sentAt,
        senderUserId: incoming.senderUserId,
        status: normalizeChatStatus('sent'),
      };
      setThreadsByKey((prev) => {
        let thread = prev[threadKey];
        if (!thread) {
          const ids = [currentUserId, otherId].sort() as [string, string];
          const rideNorm = { ...ride, id: rid };
          thread = {
            ride: rideNorm,
            participantIds: ids,
            participantNames: {
              [currentUserId]: currentUserName,
              [otherId]: otherUserName.trim() || 'User',
            },
            lastMessage: '',
            lastMessageAt: 0,
            lastMessageSenderId: '',
            messages: [],
            unreadFor: {},
          };
        }

        const existingIndex = thread.messages.findIndex((m) => m.id === incoming.id);
        if (existingIndex >= 0) {
          const existing = thread.messages[existingIndex];
          if (existing.text === stored.text && existing.sentAt === stored.sentAt && existing.senderUserId === stored.senderUserId) {
            return prev;
          }
          const updatedMsgs = [...thread.messages];
          updatedMsgs[existingIndex] = stored;
          return {
            ...prev,
            [threadKey]: {
              ...thread,
              messages: updatedMsgs,
              lastMessage: stored.text,
              lastMessageAt: stored.sentAt,
              lastMessageSenderId: stored.senderUserId,
            },
          };
        }

        const newMessages = [...thread.messages, stored].sort((a, b) => a.sentAt - b.sentAt);
        return {
          ...prev,
          [threadKey]: {
            ...thread,
            messages: newMessages,
            lastMessage: stored.text,
            lastMessageAt: stored.sentAt,
            lastMessageSenderId: stored.senderUserId,
          },
        };
      });
    },
    [currentUserId, currentUserName]
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

  // Safety-net poll every 30s while app is foreground (WS handles real-time; this catches gaps).
  // Paused when backgrounded to reduce network/battery. Initial load is handled by the effect above when `currentUserId` is set.
  useEffect(() => {
    if (!chatApiReady || !currentUserId) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const clearPoll = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startPoll = () => {
      if (intervalId != null) return;
      intervalId = setInterval(() => {
        void runInboxPollIfIdle();
      }, 30000);
    };

    const onAppStateChange = (next: AppStateStatus) => {
      if (next === 'active') {
        void runInboxPollIfIdle();
        startPoll();
      } else {
        clearPoll();
      }
    };

    const sub = AppState.addEventListener('change', onAppStateChange);

    if (AppState.currentState === 'active') {
      startPoll();
    }

    return () => {
      clearPoll();
      sub.remove();
    };
  }, [chatApiReady, currentUserId, runInboxPollIfIdle]);

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
      ingestIncomingMessage,
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
      ingestIncomingMessage,
    ]
  );

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxState {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used within InboxProvider');
  return ctx;
}
