import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RidesStackParamList, SearchStackParamList, InboxStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import type { RideListItem } from '../../types/api';
import { useInbox, type InboxConversation, type PersistedChatMessage } from '../../contexts/InboxContext';
import { useAuth } from '../../contexts/AuthContext';
import { sendChatMessage } from '../../services/chat-api';
import { COLORS } from '../../constants/colors';
import { bookingIsCancelled, pickPreferredBookingForUser } from '../../utils/bookingStatus';
import { resolveOtherParticipantId, normalizeChatRideId } from '../../services/chat-storage';
import { fetchRideDetailRaw } from '../../services/rideDetailCache';
import { unwrapRideFromDetailResponse } from '../../utils/unwrapRideDetail';
import { isRideCompletedForChat } from '../../utils/rideChat';
import {
  setChatRefreshCallback,
  pickNotificationMessageId,
  pickNotificationMessageText,
  pickNotificationSenderId,
  type ChatNotificationPayload,
} from '../../navigation/handleNotificationNavigation';
import UserAvatar from '../../components/common/UserAvatar';

/** Poll thread while this screen is focused so new messages from the other person appear without leaving. */
const CHAT_THREAD_POLL_MS = 3000; // Legacy - no longer used with WebSocket

const ROUTE_LABEL_MAX = 15;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortLabel(str: string, max: number): string {
  const s = String(str).trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}

type ChatRouteProp =
  | RouteProp<RidesStackParamList, 'Chat'>
  | RouteProp<SearchStackParamList, 'Chat'>
  | RouteProp<InboxStackParamList, 'Chat'>;

function formatRideDateTime(ride: RideListItem): string {
  if (ride.scheduledAt) {
    const d = new Date(ride.scheduledAt);
    if (!isNaN(d.getTime())) {
      const day = WEEKDAYS[d.getDay()];
      const datePart = `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `${day}, ${datePart}`;
    }
  }
  const dateStr = ride.scheduledDate ?? ride.rideDate ?? ride.date;
  const timeStr = ride.scheduledTime ?? ride.rideTime ?? ride.time;
  if (dateStr && timeStr) return `${dateStr} ${timeStr}`;
  return '—';
}

/** Prefer route param; then inbox thread / refreshed ride (list payloads often omit `publisherAvatarUrl` until detail). */
function resolvePeerAvatarUrl(
  routeUrl: string | undefined,
  ride: RideListItem,
  otherUserId: string | undefined,
  otherUserName: string | undefined,
  conversations: InboxConversation[]
): string {
  const fromRoute = (routeUrl ?? '').trim();
  if (fromRoute) return fromRoute;

  const peerId = resolveOtherParticipantId(otherUserId, otherUserName);
  const rid = normalizeChatRideId(ride.id);
  const matchConv = conversations.find((c) => {
    const convRideId = c.ride?.id;
    if (!convRideId) return false;
    return (
      normalizeChatRideId(convRideId) === rid &&
      resolveOtherParticipantId(c.otherUserId, c.otherUserName) === peerId
    );
  });
  const fromConv = (matchConv?.otherUserAvatarUrl ?? '').trim();
  if (fromConv) return fromConv;

  const ownerId = (ride.userId ?? '').trim();
  if (peerId && ownerId && peerId === ownerId) {
    const u = (ride.publisherAvatarUrl ?? '').trim();
    if (u) return u;
  }

  if (ride.bookings?.length && peerId && !peerId.startsWith('name-')) {
    for (const b of ride.bookings) {
      if ((b.userId ?? '').trim() !== peerId) continue;
      if (bookingIsCancelled(b.status)) continue;
      const u = (b.avatarUrl ?? '').trim();
      if (u) return u;
    }
  }

  return '';
}

export default function ChatScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<ChatRouteProp>();

  const { ride: rideParam, rideId: rideIdParam, otherUserName, otherUserId, otherUserAvatarUrl: routePeerAvatar } =
    route.params as {
      ride?: RideListItem;
      rideId?: string;
      otherUserName: string;
      otherUserId: string;
      otherUserAvatarUrl?: string;
    };

  // Try to get ride - either from param or from passed rideId
  let rideToUse = rideParam;
  if (!rideToUse && rideIdParam) {
    // If we only have rideId, we'll fetch the full ride
    rideToUse = { id: rideIdParam } as any;
  }
  
  const rideId = rideToUse?.id || rideIdParam;
  
  if (!rideId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.main}>
          <View style={styles.chatErrorWrap}>
            <Text style={styles.chatErrorText}>Ride information is missing. Go back and try again.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!otherUserId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.main}>
          <View style={styles.chatErrorWrap}>
            <Text style={styles.chatErrorText}>User information is missing.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }
  
  // Create a minimal ride object with at least the ID
  const [rideSnapshot, setRideSnapshot] = useState<RideListItem>(() => ({
    ...(rideToUse || {}),
    id: rideId,
  } as RideListItem));
  
  const ride = rideSnapshot;

  /** Align with persisted thread keys (`normalizeChatRideId` in InboxContext). */
  const rideIdForChat = useMemo(() => normalizeChatRideId(ride.id), [ride.id]);
  const rideForInbox = useMemo(
    () => ({ ...ride, id: rideIdForChat }),
    [ride, rideIdForChat]
  );
  const {
    conversations,
    addOrUpdateConversation,
    getMessages,
    addMessage,
    reconcileOutboundMessage,
    updateMessageStatus,
    loadThreadMessages,
    ingestIncomingMessage,
    markConversationAsRead,
  } = useInbox();
  const peerAvatarUrl = useMemo(
    () => resolvePeerAvatarUrl(routePeerAvatar, ride, otherUserId, otherUserName, conversations),
    [routePeerAvatar, ride, otherUserId, otherUserName, conversations]
  );
  const peerAvatarOpts = useMemo(
    () => (peerAvatarUrl ? { otherUserAvatarUrl: peerAvatarUrl } : undefined),
    [peerAvatarUrl]
  );
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const messages = useMemo(
    () => getMessages(rideForInbox, otherUserName, otherUserId),
    [getMessages, rideForInbox, otherUserName, otherUserId, conversations]
  );
  /**
   * `inverted` FlatList draws index 0 at the **bottom** (above the input). `getMessages` is oldest → newest,
   * so we reverse to newest → first so latest messages sit at the bottom like typical chat apps.
   */
  const messagesNewestFirst = useMemo(() => [...messages].reverse(), [messages]);
  /** FlatList needs more than length (e.g. same count, updated text). */
  const chatListExtraData = useMemo(() => {
    if (messages.length === 0) return '0';
    const last = messages[messages.length - 1];
    return `${messages.length}:${last?.id ?? ''}:${last?.sentAt ?? 0}:${last?.text?.length ?? 0}`;
  }, [messages]);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);

  const currentUserId = (user?.id ?? user?.phone ?? '').trim();
  const otherStoredId = resolveOtherParticipantId(otherUserId, otherUserName);
  const isRideOwner = Boolean(currentUserId && (ride.userId ?? '').trim() === currentUserId);
  /**
   * Notification/deep-link payloads for older completed rides can miss `otherUserId`.
   * Resolve a real peer id so thread fetch still returns existing messages.
   */
  const threadPeerUserId = useMemo(() => {
    const routePeer = (otherUserId ?? '').trim();
    if (routePeer) return routePeer;

    const peerFromConversation = conversations.find((c) => {
      if (!c.ride?.id || normalizeChatRideId(c.ride.id) !== rideIdForChat) return false;
      const nameMatch = (c.otherUserName ?? '').trim().toLowerCase() === (otherUserName ?? '').trim().toLowerCase();
      const id = (c.otherUserId ?? '').trim();
      return nameMatch && id && !id.startsWith('name-');
    });
    const convPeerId = (peerFromConversation?.otherUserId ?? '').trim();
    if (convPeerId) return convPeerId;

    if (!isRideOwner) {
      const ownerId = (ride.userId ?? '').trim();
      if (ownerId) return ownerId;
    } else if (ride.bookings?.length) {
      const nameLo = (otherUserName ?? '').trim().toLowerCase();
      const fromBooking = ride.bookings.find((b) => {
        const uid = (b.userId ?? '').trim();
        if (!uid || uid === currentUserId) return false;
        const n = (b.name ?? b.userName ?? '').trim().toLowerCase();
        return Boolean(nameLo) && n === nameLo;
      });
      const bookingPeerId = (fromBooking?.userId ?? '').trim();
      if (bookingPeerId) return bookingPeerId;
    }
    return '';
  }, [otherUserId, conversations, rideIdForChat, otherUserName, isRideOwner, ride.userId, ride.bookings, currentUserId]);

  const myBookingStatusCandidate = (() => {
    if (ride.bookings && currentUserId) {
      const mine = pickPreferredBookingForUser(ride.bookings, currentUserId);
      if (mine?.status) return mine.status;
    }
    return ride.myBookingStatus;
  })();

  const bookingStatusLabel = !myBookingStatusCandidate
    ? ''
    : bookingIsCancelled(myBookingStatusCandidate)
      ? 'Cancelled'
      : 'Booked';

  const chatEndedForRide = isRideCompletedForChat(ride, currentUserId);
  const canSend = !chatEndedForRide;

  useEffect(() => {
    if (rideParam) {
      setRideSnapshot((prev) => ({ ...prev, ...rideParam, id: rideParam.id || prev.id }));
    }
  }, [rideParam]);

  useFocusEffect(
    useCallback(() => {
      const id = (rideIdParam ?? rideParam?.id ?? '').trim();
      if (!id) return;
      let cancelled = false;
      fetchRideDetailRaw(id, { force: true, viewerUserId: currentUserId })
        .then((raw) => {
          if (cancelled) return;
          const fresh = unwrapRideFromDetailResponse(raw);
          if (fresh) setRideSnapshot((prev) => ({ ...prev, ...fresh, id: fresh.id || prev.id }));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [rideIdParam, rideParam?.id, currentUserId])
  );

  const openRideDetail = useCallback(() => {
    (navigation as { navigate: (name: 'RideDetail', params: { ride: RideListItem }) => void }).navigate(
      'RideDetail',
      { ride: rideSnapshot }
    );
  }, [navigation, rideSnapshot]);

  useEffect(() => {
    // Robustly hide bottom tab bar while inside chat.
    const parentNav = (navigation as any)?.getParent?.();
    parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
    return () => {
      parentNav?.setOptions?.({ tabBarStyle: undefined });
    };
  }, [navigation]);

  useEffect(() => {
    addOrUpdateConversation(rideForInbox, otherUserName, otherUserId, undefined, peerAvatarOpts);
  }, [rideForInbox, otherUserName, otherUserId, addOrUpdateConversation, peerAvatarOpts]);

  const markThisConversationRead = useCallback(() => {
    markConversationAsRead(rideIdForChat, otherUserId, otherUserName);
  }, [markConversationAsRead, rideIdForChat, otherUserId, otherUserName]);

  // Load fresh messages when chat screen opens (ensures we have latest data from API)
  useFocusEffect(
    useCallback(() => {
      const oid = threadPeerUserId.trim();
      const oname = otherUserName?.trim() || 'User';
      if (!oid && !oname) return undefined;

      let cancelled = false;

      /** Opening chat = read (inbox row tap does this; notification deep-link does not — clear badge here). */
      markThisConversationRead();

      void loadThreadMessages(rideIdForChat, oid ?? '', oname, rideForInbox, {
        cancelled: () => cancelled,
        force: true,  // Always load fresh data to ensure we have correct senderUserId
      })
        .then(() => {
          if (!cancelled) markThisConversationRead();
        })
        .catch(() => {
          console.error('[Chat] Failed to load initial messages');
        });

      return () => {
        cancelled = true;
      };
    }, [rideIdForChat, threadPeerUserId, otherUserName, loadThreadMessages, rideForInbox, markThisConversationRead])
  );

  /** Session may hydrate after first focus (killed app → notification). `loadThreadMessages` no-ops without user id. */
  useEffect(() => {
    if (!currentUserId) return;
    const oid = threadPeerUserId.trim();
    const oname = otherUserName?.trim() || 'User';
    if (!oid && !oname) return;
    void loadThreadMessages(rideIdForChat, oid ?? '', oname, rideForInbox, { force: true })
      .then(() => markThisConversationRead())
      .catch(() => {});
  }, [currentUserId, rideIdForChat, threadPeerUserId, otherUserName, loadThreadMessages, rideForInbox, markThisConversationRead]);

  /** Register callback for immediate refresh when a chat notification arrives while this screen is open. */
  useEffect(() => {
    setChatRefreshCallback(async (payload: ChatNotificationPayload) => {
      const sameRide = normalizeChatRideId(payload.rideId) === rideIdForChat;
      if (!sameRide) return false;
      const routePeer = resolveOtherParticipantId(otherUserId, otherUserName);
      const payloadPeer = resolveOtherParticipantId(payload.otherUserId, payload.otherUserName);
      const samePeer =
        routePeer === payloadPeer ||
        (otherUserId ?? '').trim() === (payload.otherUserId ?? '').trim();
      const sender = pickNotificationSenderId(payload.raw);
      const senderMatchesPeer = Boolean(sender && routePeer === resolveOtherParticipantId(sender, otherUserName));
      if (!samePeer && !senderMatchesPeer) return false;

      const mid = pickNotificationMessageId(payload.raw);
      const text = pickNotificationMessageText(payload.raw);
      const senderId = pickNotificationSenderId(payload.raw) ?? payload.otherUserId;
      if (mid && text && senderId) {
        ingestIncomingMessage(rideForInbox, otherUserName, otherUserId, {
          id: mid,
          text,
          sentAt: Date.now(),
          senderUserId: senderId,
        });
      }
      void loadThreadMessages(rideIdForChat, payload.otherUserId, payload.otherUserName, rideForInbox, {
        force: true,
      });
      return true;
    });
    return () => {
      setChatRefreshCallback(null);
    };
  }, [
    rideIdForChat,
    otherUserId,
    otherUserName,
    rideForInbox,
    loadThreadMessages,
    ingestIncomingMessage,
  ]);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardVisible(false);
        setLayoutKey((k) => k + 1);
      }
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const setFocused = (focused: boolean) => {
    setInputFocused(focused);
  };

  const pickupLabel = ride.pickupLocationName ?? ride.from ?? 'Pickup';
  const destinationLabel = ride.destinationLocationName ?? ride.to ?? 'Destination';
  const pickupShort = shortLabel(pickupLabel, ROUTE_LABEL_MAX);
  const destinationShort = shortLabel(destinationLabel, ROUTE_LABEL_MAX);
  const shortRoute = `${pickupShort} → ${destinationShort}`;
  const rideDateTimeStr = formatRideDateTime(ride);
  const displayName = otherUserName?.trim() || 'Driver';

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    if (chatEndedForRide) return;

    const clientId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const sentAt = Date.now();
    const optimistic: PersistedChatMessage = {
      id: clientId,
      text: trimmed,
      sentAt,
      isFromMe: true,
      status: 'sent',
    };
    addMessage(rideForInbox, otherUserName, otherUserId, optimistic);
    setMessage('');
    addOrUpdateConversation(
      rideForInbox,
      otherUserName,
      otherUserId,
      {
        lastMessage: trimmed,
        lastMessageAt: sentAt,
        messageStatus: 'sent',
      },
      peerAvatarOpts
    );

    const otherId = (otherUserId ?? '').trim();
    if (!otherId) {
      addOrUpdateConversation(
        rideForInbox,
        otherUserName,
        otherUserId,
        {
          lastMessage: trimmed,
          lastMessageAt: sentAt,
          messageStatus: 'sent',
        },
        peerAvatarOpts
      );
      return;
    }

    try {
      const res = await sendChatMessage({
        rideId: rideForInbox.id,
        otherUserId: otherId,
        text: trimmed,
      });
      reconcileOutboundMessage(rideForInbox, otherUserName, otherUserId, clientId, {
        id: res.id,
        text: res.text,
        sentAt: res.sentAt,
      });
      addOrUpdateConversation(
        rideForInbox,
        otherUserName,
        otherUserId,
        {
          lastMessage: res.text,
          lastMessageAt: res.sentAt,
          messageStatus: 'sent',
        },
        peerAvatarOpts
      );
    } catch {
      /** Keep the bubble in the thread; mark unsynced so we don't treat it as server-confirmed. */
      updateMessageStatus(rideForInbox, otherUserName, otherUserId, clientId, 'pending');
    }
  };

  const renderMessage = useCallback(({ item: msg }: { item: PersistedChatMessage }) => {
    return (
      <View
        style={[styles.bubbleRow, msg.isFromMe ? styles.bubbleRowMe : styles.bubbleRowThem]}
      >
        <View
          style={[
            styles.bubble,
            msg.isFromMe ? styles.bubbleMe : styles.bubbleThem,
          ]}
        >
          <Text style={[styles.bubbleText, msg.isFromMe && styles.bubbleTextMe]}>
            {msg.text}
          </Text>
          <View style={styles.bubbleFooter}>
            <Text
              style={[
                styles.bubbleTime,
                msg.isFromMe && styles.bubbleTimeMe,
              ]}
            >
              {formatMessageTime(msg.sentAt)}
            </Text>
          </View>
        </View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        key={`kb-${layoutKey}`}
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
      >
        <View style={styles.main}>
          {/* Header: when input focused, show short route in header */}
          <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <UserAvatar
              uri={peerAvatarUrl || undefined}
              name={displayName}
              size={40}
              backgroundColor={COLORS.primary}
              fallbackTextColor={COLORS.white}
              style={styles.headerAvatar}
            />
            <View style={styles.headerNameCol}>
              <Text style={styles.headerName}>{displayName}</Text>
              {inputFocused ? (
                <Text style={styles.headerRouteShort} numberOfLines={1}>{shortRoute}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Ride bar: opens ride detail for this chat’s ride */}
        <View pointerEvents={inputFocused ? 'none' : 'auto'}>
          <TouchableOpacity
            style={[
              styles.rideBar,
              inputFocused && styles.rideBarCollapsed,
            ]}
            onPress={openRideDetail}
            activeOpacity={0.8}
            disabled={inputFocused}
            accessibilityRole="button"
            accessibilityLabel="Open ride details"
          >
            <View style={styles.rideBarContent}>
              <Text style={styles.rideRoute} numberOfLines={1}>{shortRoute}</Text>
              {bookingStatusLabel ? (
                <Text style={styles.rideMeta}>
                  <Text style={styles.rideStatus}>{bookingStatusLabel}</Text>
                  {' • '}{rideDateTimeStr}
                </Text>
              ) : (
                <Text style={styles.rideMeta}>{rideDateTimeStr}</Text>
              )}
              <Text style={styles.rideBarHint}>Tap for ride details</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        {chatEndedForRide ? (
          <View style={styles.chatEndedBanner}>
            <Ionicons name="lock-closed-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.chatEndedBannerText}>
              This ride is completed. This chat is read-only.
            </Text>
          </View>
        ) : null}

        {/* Inverted list + newest-first data → latest bubbles sit above the input.
            Empty hint is overlaid (not ListEmptyComponent) so inverted transform cannot flip it. */}
        <View style={styles.chatListWrap}>
          <FlatList
            key={`chat-${messages.length}`}
            data={messagesNewestFirst}
            inverted
            keyExtractor={(m) => m.id}
            extraData={chatListExtraData}
            renderItem={renderMessage}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            style={styles.chatArea}
            contentContainerStyle={[
              styles.chatListContent,
              messages.length === 0 && styles.chatListContentEmpty,
              !canSend ? { paddingBottom: 26 } : null,
            ]}
          />
          {messages.length === 0 ? (
            <View style={styles.emptyChatOverlay} pointerEvents="none">
              <Text style={styles.emptyChatHint}>No messages yet</Text>
            </View>
          ) : null}
        </View>

        {/* Warnings */}
        <View style={styles.warnings}>
          <Text style={styles.moderationText}>
            We may moderate messages. You can also report inappropriate ones from our guidelines page.
          </Text>
          <View style={styles.scamRow}>
            <Ionicons name="warning" size={18} color={COLORS.error} />
            <Text style={styles.scamText}>
              To avoid scams, never visit links sent by members to pay or transfer money.{' '}
              <Text style={styles.linkText}>Learn more</Text>
            </Text>
          </View>
        </View>

          {/* Input row: stays above keyboard via KeyboardAvoidingView */}
          {canSend ? (
            <View style={[styles.inputRow, keyboardVisible && styles.inputRowKeyboardUp]}>
              <TextInput
                style={styles.input}
                placeholder={`Your message to ${displayName}`}
                placeholderTextColor={COLORS.textMuted}
                value={message}
                onChangeText={setMessage}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                multiline
                maxLength={1000}
                editable
              />
              <TouchableOpacity
                style={[styles.sendBtn, !message.trim() && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!message.trim()}
                activeOpacity={0.8}
              >
                <Ionicons name="send" size={20} color={message.trim() ? COLORS.white : COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.chatClosedRow}>
              <Text style={styles.chatClosedText}>This ride is completed. Chat is closed.</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  main: {
    flex: 1,
  },
  chatErrorWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  chatErrorText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerBack: {
    padding: 4,
    marginRight: 8,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAvatar: {
    marginRight: 10,
  },
  headerNameCol: {
    flex: 1,
  },
  headerRouteShort: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  headerName: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  rideBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rideBarCollapsed: {
    minHeight: 0,
    maxHeight: 0,
    paddingVertical: 0,
    overflow: 'hidden',
    borderBottomWidth: 0,
  },
  rideBarContent: {
    flex: 1,
  },
  rideRoute: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  rideMeta: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  rideStatus: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  rideBarHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
    fontWeight: '500',
  },
  chatEndedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  chatEndedBannerText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  chatListWrap: {
    flex: 1,
    position: 'relative',
  },
  chatArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  chatListContentEmpty: {
    flexGrow: 1,
  },
  emptyChatOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  chatListContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    flexGrow: 1,
  },
  emptyChatHint: {
    fontSize: 15,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  bubbleRowMe: {
    justifyContent: 'flex-end',
  },
  bubbleRowThem: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
  },
  bubbleMe: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 18,
  },
  bubbleThem: {
    backgroundColor: COLORS.backgroundSecondary,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    color: COLORS.text,
  },
  bubbleTextMe: {
    color: COLORS.white,
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  bubbleTime: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  bubbleTimeMe: {
    color: 'rgba(255,255,255,0.85)',
  },
  chatClosedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: COLORS.backgroundSecondary,
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  chatClosedText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  chatClosedRow: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  warnings: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: COLORS.background,
  },
  moderationText: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginBottom: 8,
  },
  scamRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  scamText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.error,
    lineHeight: 18,
  },
  linkText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 10,
  },
  inputRowKeyboardUp: {
    paddingBottom: 12,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
  },
  inputDisabled: {
    opacity: 0.65,
    borderColor: COLORS.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.border,
  },
});
