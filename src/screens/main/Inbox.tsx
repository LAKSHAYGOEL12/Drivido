import React, { useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useInbox, type InboxConversation } from '../../contexts/InboxContext';
import { COLORS } from '../../constants/colors';
import { applyInboxVisibilityLimit, INBOX_VISIBLE_CHAT_MAX } from '../../utils/inboxList';

function formatConversationTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) {
    const h = date.getHours();
    const m = date.getMinutes();
    const am = h < 12;
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  return `${diffDays} days ago`;
}

export default function Inbox(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<InboxStackParamList>>();
  const { conversations, markAllAsRead, markConversationAsRead, refreshConversations } = useInbox();
  const [search, setSearch] = useState('');

  useFocusEffect(
    React.useCallback(() => {
      markAllAsRead();
      void refreshConversations();
    }, [markAllAsRead, refreshConversations])
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
      otherUserId: conv.otherUserId,
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
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.otherUserName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: COLORS.textMuted }]} />
        </View>
        <View style={styles.rowCenter}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{item.otherUserName}</Text>
          </View>
          <Text style={styles.lastMessage} numberOfLines={1}>
            {item.lastMessage || 'No messages yet'}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.time}>{formatConversationTime(item.lastMessageAt)}</Text>
          {item.unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadCount}>{item.unreadCount}</Text>
            </View>
          ) : item.isLastMessageFromMe ? (
            <View style={styles.tickWrap}>
              {item.messageStatus === 'read' ? (
                <Ionicons name="checkmark-done" size={18} color={COLORS.primary} />
              ) : (
                <Ionicons name="checkmark" size={18} color={COLORS.textMuted} />
              )}
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
          <Text style={styles.title}>Inbox</Text>
          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.headerIcon} onPress={() => {}}>
              <Ionicons name="shield" size={22} color={COLORS.error} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIcon} onPress={() => {}}>
              <Ionicons name="notifications-outline" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={20} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search messages..."
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>RECENT CONVERSATIONS</Text>
        </View>

        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No conversations</Text>
            </View>
          }
        />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIcon: {
    padding: 4,
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
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
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
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
  },
  statusDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.background,
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
  rowRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  time: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
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
  tickWrap: {
    marginTop: 2,
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
});
