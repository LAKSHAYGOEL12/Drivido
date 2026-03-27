import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useCallback } from 'react';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { formatRidePriceParts } from '../../utils/rideDisplay';
import { bookingPickupDrop } from '../../utils/bookingRoutePreview';
import { bookingPassengerDisplayName } from '../../utils/displayNames';

type BookPassengerRouteProp =
  | RouteProp<RidesStackParamList, 'BookPassengerDetail'>
  | RouteProp<SearchStackParamList, 'BookPassengerDetail'>;

function findMainTabNavigator(navigation: any) {
  let current = navigation?.getParent?.() as any | undefined;
  for (let i = 0; i < 5 && current; i += 1) {
    const names: string[] | undefined = current?.getState?.()?.routeNames;
    if (names?.includes('SearchStack') && names?.includes('YourRides')) return current;
    current = current.getParent?.();
  }
  return null;
}

export default function BookPassengerDetailScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<BookPassengerRouteProp>();
  const { ride, booking } = route.params;

  useFocusEffect(
    useCallback(() => {
      const tabsNav = findMainTabNavigator(navigation as any);
      tabsNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
      return () => {
        setTimeout(() => {
          try {
            const tabState = tabsNav?.getState?.();
            const activeTabRoute = tabState?.routes?.[tabState?.index ?? 0];
            const nestedState = activeTabRoute?.state;
            const nestedName = nestedState?.routes?.[nestedState?.index ?? 0]?.name;
            const hiddenNestedNames = new Set([
              'RideDetail',
              'RideDetailScreen',
              'BookPassengerDetail',
              'Chat',
              'OwnerProfileModal',
              'OwnerRatingsModal',
            ]);
            if (!nestedName || !hiddenNestedNames.has(nestedName)) {
              tabsNav?.setOptions?.({ tabBarStyle: undefined });
            }
          } catch {
            // ignore
          }
        }, 180);
      };
    }, [navigation])
  );

  const passengerName = bookingPassengerDisplayName(booking);
  const passengerId = booking.userId ?? '';
  const { pickup, drop } = bookingPickupDrop(ride, booking);
  const priceParts = formatRidePriceParts(ride);
  const initial = passengerName.charAt(0).toUpperCase() || '?';

  const openChat = () => {
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('Chat', {
      ride,
      otherUserName: passengerName,
      otherUserId: passengerId || undefined,
    });
  };

  const openCall = () => {
    Alert.alert('Call', 'Phone number is not available for this rider yet.');
  };

  const openPassengerRatings = () => {
    const targetUserId = passengerId.trim();
    if (!targetUserId) {
      Alert.alert('Ratings', 'Passenger ratings are not available yet.');
      return;
    }
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('OwnerRatingsModal', {
      userId: targetUserId,
      displayName: passengerName,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Passenger</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.profileRow} activeOpacity={0.75} onPress={openPassengerRatings}>
          <View style={styles.avatarWrap}>
            <View style={[styles.avatar, { backgroundColor: COLORS.primary }]}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={14} color={COLORS.white} />
            </View>
          </View>
          <View style={styles.profileTextCol}>
            <Text style={styles.profileName}>{passengerName}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={16} color={COLORS.warning} />
              <Text style={styles.ratingText}>View ratings</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
        </TouchableOpacity>

        <View style={styles.trustBlock}>
          <View style={styles.trustRow}>
            <Ionicons name="shield-checkmark" size={22} color={COLORS.primary} />
            <View style={styles.trustTextCol}>
              <Text style={styles.trustTitle}>Verified profile</Text>
              <Text style={styles.trustSub}>ID, email and phone verified when available</Text>
            </View>
          </View>
          <View style={[styles.trustRow, styles.trustRowSecond]}>
            <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} />
            <View style={styles.trustTextCol}>
              <Text style={styles.trustTitle}>Booking history</Text>
              <Text style={styles.trustSub}>Cancellation rate shown here when available</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.routeCard}>
          <View style={styles.routeCardInner}>
            <View style={styles.routeCardLeft}>
              <Text style={styles.routeSeatBold}>
                {booking.seats} seat{booking.seats !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.routePathText}>
                {pickup} → {drop}
              </Text>
            </View>
            <View style={styles.routeCardRight}>
              {priceParts ? (
                <View style={styles.pricePartsWrap}>
                  <Text style={styles.priceRupee}>{priceParts.rupee}</Text>
                  <Text style={styles.priceInteger}>{priceParts.integerPart}</Text>
                </View>
              ) : (
                <Text style={styles.priceInteger}>—</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.actionRow} onPress={openChat} activeOpacity={0.7}>
          <Ionicons name="chatbubble-outline" size={22} color={COLORS.text} />
          <Text style={styles.actionRowText}>Message on Drivido</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={openCall} activeOpacity={0.7}>
          <Ionicons name="call-outline" size={22} color={COLORS.text} />
          <Text style={styles.actionRowText}>Call</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBack: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSpacer: {
    width: 32,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.white,
  },
  verifiedBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  profileTextCol: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  ratingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  trustBlock: {
    marginBottom: 8,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  trustRowSecond: {
    marginTop: 16,
  },
  trustTextCol: {
    flex: 1,
  },
  trustTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  trustSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 20,
  },
  routeCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  routeCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    minHeight: 88,
  },
  routeCardLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  routeSeatBold: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
  },
  routePathText: {
    fontSize: 15,
    fontWeight: '400',
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  routeCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  pricePartsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  priceRupee: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 2,
    marginRight: 1,
  },
  priceInteger: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.6,
    lineHeight: 28,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  actionRowText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
});
