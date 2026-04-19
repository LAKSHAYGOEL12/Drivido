import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
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
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.rowMain}
        onPress={() => openChat(item)}
        activeOpacity={0.7}
      >
        <View style={styles.avatarWrap}>
          <UserAvatar
            uri={item.otherUserAvatarUrl}
            name={item.otherUserName}
            size={52}
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
              <Text style={styles.unreadCount}>{item.unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Messages</Text>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={20} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or message"
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Recent conversations</Text>
        </View>

        {loading && filtered.length === 0 ? (
          <View style={styles.skeletonWrap}>
            {Array.from({ length: 6 }).map((_, idx) => (
              <View key={`chat-skeleton-${idx}`} style={styles.skeletonRow}>
                <SkeletonBlock width={52} height={52} borderRadius={26} />
                <View style={styles.skeletonTextCol}>
                  <SkeletonBlock width="45%" height={14} borderRadius={7} />
                  <SkeletonBlock width="80%" height={12} borderRadius={6} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            data={filtered}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.listContent, { paddingBottom: mainTabScrollBottomPad }]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No conversations yet</Text>
              </View>
            }
          />
        )}
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    gap: 10,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    paddingVertical: 10,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.2,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
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
  },
  nameUnread: {
    fontWeight: '800',
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  tagSupport: {
    backgroundColor: '#dbeafe',
  },
  tagText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  tagTextSupport: {
    color: COLORS.info,
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
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textMuted,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 28,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  skeletonWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 14,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeletonTextCol: {
    flex: 1,
    marginLeft: 14,
    gap: 8,
  },
});
