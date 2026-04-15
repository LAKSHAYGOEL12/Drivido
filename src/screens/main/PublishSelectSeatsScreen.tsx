import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { isPublishStopsComplete } from '../../utils/publishFare';
import { alertRouteRequiredPriceScreen } from '../../utils/publishAlerts';

const MAX_OFFERED = 6;

type ScreenRoute = RouteProp<PublishStackParamList, 'PublishSelectSeats'>;

function clampSeats(n: number): number {
  return Math.max(1, Math.min(MAX_OFFERED, Math.floor(n) || 1));
}

export default function PublishSelectSeatsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<ScreenRoute>();
  const p = route.params;
  const seed = useMemo(() => clampSeats(p.initialSeats ?? 1), [p.initialSeats]);
  const [seats, setSeats] = useState(seed);

  const stopsOk = useMemo(() => isPublishStopsComplete(p), [p]);

  useLayoutEffect(() => {
    if (!stopsOk) {
      navigation.goBack();
      setTimeout(() => {
        alertRouteRequiredPriceScreen();
      }, 0);
    }
  }, [stopsOk, navigation]);

  const onContinue = () => {
    if (!isPublishStopsComplete(p)) {
      alertRouteRequiredPriceScreen();
      navigation.goBack();
      return;
    }
    const offeredSeats = clampSeats(seats);
    const fallbackSeconds = Math.max(60, Math.round(p.selectedDistanceKm * 2 * 60));
    const selectedDurationSeconds =
      typeof p.selectedDurationSeconds === 'number' && !Number.isNaN(p.selectedDurationSeconds)
        ? p.selectedDurationSeconds
        : fallbackSeconds;

    const rideParams = {
      selectedFrom: p.selectedFrom,
      selectedTo: p.selectedTo,
      pickupLatitude: p.pickupLatitude,
      pickupLongitude: p.pickupLongitude,
      destinationLatitude: p.destinationLatitude,
      destinationLongitude: p.destinationLongitude,
      ...(p.selectedDateIso ? { selectedDateIso: p.selectedDateIso } : {}),
      ...(typeof p.selectedTimeHour === 'number' ? { selectedTimeHour: p.selectedTimeHour } : {}),
      ...(typeof p.selectedTimeMinute === 'number' ? { selectedTimeMinute: p.selectedTimeMinute } : {}),
      selectedRate: p.selectedRate,
      initialPricePerSeat: p.initialPricePerSeat,
      selectedDistanceKm: p.selectedDistanceKm,
      selectedDurationSeconds,
      routePolylineEncoded: p.routePolylineEncoded ?? '',
      offeredSeats,
      ...(p.publishRestoreKey ? { _publishRestoreKey: p.publishRestoreKey } : {}),
    };

    if (p.publishRecentEditEntry) {
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: 'PublishRecentEdit',
              params: {
                entry: p.publishRecentEditEntry,
                selectedFrom: p.selectedFrom,
                selectedTo: p.selectedTo,
                pickupLatitude: p.pickupLatitude,
                pickupLongitude: p.pickupLongitude,
                destinationLatitude: p.destinationLatitude,
                destinationLongitude: p.destinationLongitude,
                selectedRate: p.selectedRate,
                initialPricePerSeat: p.initialPricePerSeat,
                selectedDistanceKm: p.selectedDistanceKm,
                selectedDurationSeconds,
                routePolylineEncoded: p.routePolylineEncoded ?? '',
                ...(p.selectedDateIso ? { selectedDateIso: p.selectedDateIso } : {}),
                ...(typeof p.selectedTimeHour === 'number' ? { selectedTimeHour: p.selectedTimeHour } : {}),
                ...(typeof p.selectedTimeMinute === 'number' ? { selectedTimeMinute: p.selectedTimeMinute } : {}),
                offeredSeats,
              },
            },
          ],
        })
      );
      return;
    }

    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'PublishRide', params: rideParams }],
      })
    );
  };

  if (!stopsOk) {
    return <View style={styles.blockedFill} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitleRow} numberOfLines={1}>
            <Text style={styles.headerTrip}>Trip</Text>
            <Text style={styles.headerDateSuffix}> seats</Text>
          </Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.body}>
        <Text style={styles.cardTitle}>Seats offered</Text>
        <Text style={styles.cardSubtitle}>Up to {MAX_OFFERED} passengers per ride.</Text>
        <View style={styles.seatsCard}>
          <View style={styles.counterBlock}>
            <TouchableOpacity
              style={[styles.counterBtn, seats <= 1 && styles.counterBtnDisabled]}
              onPress={() => setSeats((s) => Math.max(1, s - 1))}
              disabled={seats <= 1}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Decrease seats"
            >
              <Ionicons name="remove" size={28} color={COLORS.primary} />
            </TouchableOpacity>
            <View style={styles.counterCenter}>
              <Text style={styles.counterValue}>{seats}</Text>
            </View>
            <TouchableOpacity
              style={[styles.counterBtn, seats >= MAX_OFFERED && styles.counterBtnDisabled]}
              onPress={() => setSeats((s) => Math.min(MAX_OFFERED, s + 1))}
              disabled={seats >= MAX_OFFERED}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Increase seats"
            >
              <Ionicons name="add" size={28} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.nextFab, { bottom: Math.max(20, insets.bottom + 14) }]}
        onPress={onContinue}
        activeOpacity={0.85}
      >
        <Ionicons name="arrow-forward" size={24} color={COLORS.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const PRIMARY_TINT_SOFT = 'rgba(41, 190, 139, 0.08)';

const styles = StyleSheet.create({
  blockedFill: { flex: 1, backgroundColor: COLORS.backgroundSecondary },
  container: { flex: 1, backgroundColor: COLORS.backgroundSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitleRow: { textAlign: 'center' },
  headerTrip: { fontSize: 21, fontWeight: '800', color: COLORS.primary },
  headerDateSuffix: { fontSize: 21, fontWeight: '800', color: COLORS.text },
  headerRight: { width: 44 },
  body: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 96,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 14,
    lineHeight: 20,
  },
  seatsCard: {
    backgroundColor: COLORS.background,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 20,
    paddingHorizontal: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 22,
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  counterBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 100,
  },
  counterBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PRIMARY_TINT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(41, 190, 139, 0.22)',
  },
  counterBtnDisabled: { opacity: 0.38 },
  counterCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  counterValue: {
    fontSize: 44,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -1,
    lineHeight: 48,
  },
  nextFab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 5,
  },
});
