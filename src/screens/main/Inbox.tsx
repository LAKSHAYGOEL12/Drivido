import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { InboxStackParamList } from '../../navigation/types';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMainTabScrollBottomInset } from '../../navigation/useMainTabScrollBottomInset';
import { Ionicons } from '@expo/vector-icons';
import { useInbox, type InboxConversation } from '../../contexts/InboxContext';
import { COLORS } from '../../constants/colors';
import { applyInboxVisibilityLimit, INBOX_VISIBLE_CHAT_MAX } from '../../utils/inboxList';
import UserAvatar from '../../components/common/UserAvatar';
import { ridePeerDeactivated } from '../../utils/deactivatedAccount';
import SkeletonBlock from '../../components/common/SkeletonBlock';

function formatConversationTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const h = date.getHours();
  const m = date.getMinutes();
  const am = h < 12;
  const h12 = h % 12 || 12;
  if (diffDays === 0) return `${h12}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
  return `${String(date.getDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()]}`;
}

export default function Inbox(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<InboxStackParamList>>();
  const mainTabScrollBottomPad = useMainTabScrollBottomInset();
  const { conversations, markConversationAsRead, refreshConversations } = useInbox();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      if (conversationsRef.current.length === 0) {
        setLoading(true);
      }
      void refreshConversations().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [refreshConversations])
  );

  const searchFiltered = conversations.filter((c) => {
    const matchSearch =
      !search.trim() ||
      c.otherUserName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  /** UI cap: future rides always shown; non-future fills remaining slots. Search shows all matches. */
  const filtered = search.trim()
    ? searchFiltered
    : applyInboxVisibilityLimit(searchFiltered, INBOX_VISIBLE_CHAT_MAX);

  const openChat = (conv: InboxConversation) => {
    markConversationAsRead(conv.ride.id, conv.otherUserId, conv.otherUserName);
    navigation.navigate('Chat', {
      ride: conv.ride,
      otherUserName: conv.otherUserName,
      otherUserId: conv.otherUserId ?? '',
      ...(conv.otherUserAvatarUrl ? { otherUserAvatarUrl: conv.otherUserAvatarUrl } : {}),
      ...(conv.otherUserDeactivated === true ||
      ridePeerDeactivated(conv.ride, (conv.otherUserId ?? '').trim())
        ? { otherUserDeactivated: true }
        : {}),
    });
  };

  const renderItem = ({ item }: { item: InboxConversation }) => (
    <TouchableOpacity
      style={[styles.convRow, item.unreadCount > 0 && styles.convRowUnread]}
      onPress={() => openChat(item)}
      activeOpacity={0.7}
    >
      <View style={styles.convRowInner}>
        <View style={styles.avatarWrap}>
          <UserAvatar
            uri={item.otherUserAvatarUrl}
            name={item.otherUserName}
            size={50}
            backgroundColor={COLORS.primary}
            fallbackTextColor={COLORS.white}
          />
        </View>
        <View style={styles.rowCenter}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, item.unreadCount > 0 && styles.nameUnread]} numberOfLines={1}>
              {item.otherUserName}
            </Text>
          </View>
          <Text style={[styles.lastMessage, item.unreadCount > 0 && styles.lastMessageUnread]} numberOfLines={1}>
            {item.lastMessage || 'No messages yet'}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.time, item.unreadCount > 0 && styles.timeUnread]}>
            {formatConversationTime(item.lastMessageAt)}
          </Text>
          {item.unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadCount}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );

  const convSeparator = () => <View style={styles.rowSeparator} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.heroBlock}>
          <Text style={styles.heroEyebrow}>Chats</Text>
          <Text style={styles.heroTitle}>Messages</Text>
          <Text style={styles.heroSubtitle}>People you have talked with about rides.</Text>
        </View>

        <View style={styles.searchCard}>
          <View style={styles.searchIconWrap}>
            <Ionicons name="search" size={18} color={COLORS.primary} />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or message"
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.chatsListWrap}>
          {loading && filtered.length === 0 ? (
            <View style={styles.skeletonBlock}>
              {Array.from({ length: 6 }).map((_, idx) => (
                <View key={`chat-skeleton-${idx}`}>
                  {idx > 0 ? <View style={styles.rowSeparator} /> : null}
                  <View style={styles.skeletonRow}>
                    <SkeletonBlock width={50} height={50} borderRadius={25} />
                    <View style={styles.skeletonTextCol}>
                      <SkeletonBlock width="45%" height={14} borderRadius={7} />
                      <SkeletonBlock width="80%" height={12} borderRadius={6} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <FlatList
              data={filtered}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={convSeparator}
              style={styles.chatsList}
              contentContainerStyle={[
                styles.chatsListContent,
                ...(filtered.length === 0 ? [styles.chatsListContentEmpty] : []),
                { paddingBottom: mainTabScrollBottomPad },
              ]}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <View style={styles.emptyIconWrap}>
                    <Ionicons name="chatbubbles-outline" size={36} color={COLORS.primary} />
                  </View>
                  <Text style={styles.emptyTitle}>No conversations yet</Text>
                  <Text style={styles.emptySubtitle}>
                    When you message someone about a ride, it will show up here.
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  heroBlock: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: COLORS.primary,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  heroSubtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 8,
    lineHeight: 21,
    maxWidth: 340,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 10,
    borderWidth: 0,
  },
  searchIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  chatsListWrap: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: 12,
    fontWeight: '500',
  },
  chatsList: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  chatsListContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  chatsListContentEmpty: {
    justifyContent: 'center',
    minHeight: 280,
  },
  convRow: {
    backgroundColor: COLORS.background,
  },
  convRowUnread: {
    backgroundColor: 'rgba(29, 185, 84, 0.06)',
  },
  convRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginLeft: 20 + 50 + 14,
  },
  avatarWrap: {
    marginRight: 14,
  },
  rowCenter: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  nameUnread: {
    fontWeight: '800',
    color: COLORS.text,
  },
  lastMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  lastMessageUnread: {
    color: COLORS.text,
    fontWeight: '600',
  },
  rowRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  time: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  timeUnread: {
    color: COLORS.text,
    fontWeight: '700',
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.white,
  },
  empty: {
    paddingVertical: 40,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: COLORS.primaryMuted22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 300,
  },
  skeletonBlock: {
    backgroundColor: COLORS.background,
    paddingBottom: 12,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  skeletonTextCol: {
    flex: 1,
    marginLeft: 14,
    gap: 8,
  },
});
