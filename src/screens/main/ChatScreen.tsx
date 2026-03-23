import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RidesStackParamList, SearchStackParamList, InboxStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import type { RideListItem } from '../../types/api';
import { useInbox, type PersistedChatMessage } from '../../contexts/InboxContext';
import { useAuth } from '../../contexts/AuthContext';
import { sendChatMessage } from '../../services/chat-api';
import { COLORS } from '../../constants/colors';
import { bookingIsCancelled, pickPreferredBookingForUser } from '../../utils/bookingStatus';

const ROUTE_LABEL_MAX = 15;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Sent = single tick (e.g. net off at receiver). Delivered/Read = double tick. */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

export interface ChatMessage {
  id: string;
  text: string;
  sentAt: number;
  isFromMe: boolean;
  status: MessageStatus;
}

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

export default function ChatScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<ChatRouteProp>();
  const { ride, otherUserName, otherUserId } = route.params;
  const { addOrUpdateConversation, getMessages, addMessage, updateMessageStatus, loadThreadMessages } = useInbox();
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const messages = getMessages(ride, otherUserName, otherUserId);
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<ScrollView>(null);

  const currentUserId = (user?.id ?? user?.phone ?? '').trim();
  const isRideOwner = Boolean(currentUserId && (ride.userId ?? '').trim() === currentUserId);

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

  const canSend = true;

  useEffect(() => {
    addOrUpdateConversation(ride, otherUserName, otherUserId);
  }, [ride.id, otherUserName, otherUserId, addOrUpdateConversation]);

  // Load messages from backend when opening chat (survives reinstall / device change).
  // Cleanup avoids applying merged state after navigating away; InboxContext also TTL/dedupes fetches.
  useEffect(() => {
    const oid = otherUserId?.trim();
    const oname = otherUserName?.trim() || 'User';
    if (!oid && !oname) return;
    let cancelled = false;
    loadThreadMessages(ride.id, oid ?? '', oname, ride, { cancelled: () => cancelled }).catch(
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [ride.id, otherUserId, otherUserName, loadThreadMessages]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
    const otherId = (otherUserId ?? '').trim();
    if (otherId) {
      try {
        const res = await sendChatMessage({
          rideId: ride.id,
          otherUserId: otherId,
          text: trimmed,
        });
        addMessage(ride, otherUserName, otherUserId, {
          id: res.id,
          text: res.text,
          sentAt: res.sentAt,
          isFromMe: true,
          status: res.status,
        });
        addOrUpdateConversation(ride, otherUserName, otherUserId, {
          lastMessage: res.text,
          lastMessageAt: res.sentAt,
          messageStatus: 'sent',
        });
        setMessage('');
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        return;
      } catch {
        // Backend may not have chat API yet; fall back to local-only
      }
    }
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const sentAt = Date.now();
    const newMsg: PersistedChatMessage = {
      id,
      text: trimmed,
      sentAt,
      isFromMe: true,
      status: 'sending',
    };
    addMessage(ride, otherUserName, otherUserId, newMsg);
    setMessage('');
    addOrUpdateConversation(ride, otherUserName, otherUserId, {
      lastMessage: trimmed,
      lastMessageAt: sentAt,
      messageStatus: 'sent',
    });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    setTimeout(() => updateMessageStatus(ride, otherUserName, otherUserId, id, 'sent'), 600);
    setTimeout(() => {
      updateMessageStatus(ride, otherUserName, otherUserId, id, 'delivered');
      addOrUpdateConversation(ride, otherUserName, otherUserId, {
        lastMessage: trimmed,
        lastMessageAt: sentAt,
        messageStatus: 'delivered',
      });
    }, 1800);
  };

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
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>{displayName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.headerNameCol}>
              <View style={styles.headerNameRow}>
                <Text style={styles.headerName}>{displayName}</Text>
                <View style={styles.ratingBadge}>
                  <Ionicons name="star" size={12} color={COLORS.text} />
                  <Text style={styles.ratingText}>4.5/5</Text>
                </View>
              </View>
              {inputFocused ? (
                <Text style={styles.headerRouteShort} numberOfLines={1}>{shortRoute}</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => {}} hitSlop={8}>
              <Ionicons name="call-outline" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => {}} hitSlop={8}>
              <Ionicons name="ellipsis-horizontal" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Ride bar: visible by default; collapses when input focused (description in header) */}
        <TouchableOpacity
          style={[
            styles.rideBar,
            inputFocused && styles.rideBarCollapsed,
          ]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
          disabled={inputFocused}
          pointerEvents={inputFocused ? 'none' : 'auto'}
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
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>

        {/* Chat area */}
        <ScrollView
          ref={scrollRef}
          style={styles.chatArea}
          contentContainerStyle={[
            styles.chatAreaContent,
            messages.length > 0 && styles.chatAreaContentWithMessages,
            !canSend ? { paddingBottom: 26 } : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <Text style={styles.emptyChatHint}>
              No messages yet
            </Text>
          ) : (
            messages.map((msg) => (
              <View
                key={msg.id}
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
                    {msg.isFromMe && (
                      <View style={styles.tickWrap}>
                        {msg.status === 'read' ? (
                          <Ionicons name="checkmark-done" size={16} color={COLORS.primary} />
                        ) : (
                          <Ionicons name="checkmark" size={16} color={COLORS.textMuted} />
                        )}
                      </View>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>

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
          ) : null}
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  headerNameCol: {
    flex: 1,
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef08a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconBtn: {
    padding: 6,
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
  chatArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  chatAreaContent: {
    flexGrow: 1,
    padding: 16,
    justifyContent: 'center',
  },
  chatAreaContentWithMessages: {
    justifyContent: 'flex-end',
    paddingBottom: 8,
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
  tickWrap: {
    marginLeft: 2,
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
