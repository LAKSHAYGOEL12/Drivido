import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { alertDepartureTimeInPast } from '../../utils/publishAlerts';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';
import TimePickerClock, { type TimePickerClockValue } from '../../components/time/TimePickerClock';

type ScreenRoute = RouteProp<PublishStackParamList, 'PublishSelectTime'>;

const MIN_LEAD_MINUTES = 30;

const PRIMARY_TINT = 'rgba(41, 190, 139, 0.14)';
const CHIP_BORDER = 'rgba(41, 190, 139, 0.22)';

function formatTimeLabel(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function getDefaultTimeOneHourAhead(): { hour: number; minute: number } {
  const now = new Date();
  let hour = now.getHours() + 1;
  let minute = now.getMinutes();
  minute = Math.ceil(minute / 5) * 5;
  if (minute >= 60) {
    minute = 0;
    hour += 1;
  }
  if (hour >= 24) hour = 23;
  return { hour, minute };
}

function isSelectedDateToday(selectedDate: Date): boolean {
  const t = new Date();
  return (
    selectedDate.getFullYear() === t.getFullYear() &&
    selectedDate.getMonth() === t.getMonth() &&
    selectedDate.getDate() === t.getDate()
  );
}

function isSelectedDateTimeTooSoon(
  selectedDate: Date,
  selectedTime: { hour: number; minute: number },
  minLeadMinutes: number
): boolean {
  const now = new Date();
  const y = selectedDate.getFullYear();
  const m = selectedDate.getMonth();
  const d = selectedDate.getDate();
  const chosen = new Date(y, m, d, selectedTime.hour, selectedTime.minute, 0, 0);
  return chosen.getTime() < now.getTime() + minLeadMinutes * 60 * 1000;
}

function parseSelectedDate(iso: string): Date {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function initialClockFromRoute(
  selectedDate: Date,
  initialTimeHour?: number,
  initialTimeMinute?: number
): { hour: number; minute: number } {
  if (
    typeof initialTimeHour === 'number' &&
    typeof initialTimeMinute === 'number' &&
    !Number.isNaN(initialTimeHour) &&
    !Number.isNaN(initialTimeMinute)
  ) {
    const h = Math.max(0, Math.min(23, Math.floor(initialTimeHour)));
    const m = Math.round(initialTimeMinute / 5) * 5;
    const minute = ((m % 60) + 60) % 60;
    return { hour: h, minute };
  }
  if (isSelectedDateToday(selectedDate)) {
    return getDefaultTimeOneHourAhead();
  }
  return { hour: 9, minute: 0 };
}

export default function PublishSelectTimeScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const onBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onBack();
        return true;
      });
      return () => sub.remove();
    }, [onBack])
  );

  const route = useRoute<ScreenRoute>();
  const {
    selectedFrom,
    selectedTo,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    selectedDistanceKm,
    selectedDurationSeconds,
    routePolylineEncoded,
    publishRestoreKey,
    publishRecentEditEntry,
    publishWizardReview,
    publishFabExitTab,
    selectedDateIso,
    initialTimeHour,
    initialTimeMinute,
  } = route.params;

  const selectedDate = useMemo(() => parseSelectedDate(selectedDateIso), [selectedDateIso]);

  const seed = useMemo(
    () => initialClockFromRoute(selectedDate, initialTimeHour, initialTimeMinute),
    [selectedDate, initialTimeHour, initialTimeMinute]
  );

  const [clockHour24, setClockHour24] = useState(seed.hour);
  const [clockMinute, setClockMinute] = useState(seed.minute);

  /**
   * Mirror seed → state when the underlying selected date changes (e.g. user goes back to
   * change date). Keeps the dial sensible without remounting the screen.
   */
  const lastSeedKeyRef = useRef<string>('');
  useEffect(() => {
    const key = `${selectedDate.toDateString()}|${initialTimeHour}|${initialTimeMinute}`;
    if (lastSeedKeyRef.current === key) return;
    lastSeedKeyRef.current = key;
    setClockHour24(seed.hour);
    setClockMinute(seed.minute);
  }, [seed, selectedDate, initialTimeHour, initialTimeMinute]);

  const handleClockChange = useCallback((next: TimePickerClockValue) => {
    setClockHour24(next.hour24);
    setClockMinute(next.minute);
  }, []);

  const onContinue = () => {
    const candidate = { hour: clockHour24, minute: clockMinute };
    if (isSelectedDateTimeTooSoon(selectedDate, candidate, MIN_LEAD_MINUTES)) {
      alertDepartureTimeInPast();
      return;
    }
    if (typeof selectedDistanceKm !== 'number' || Number.isNaN(selectedDistanceKm) || selectedDistanceKm <= 0) {
      navigation.goBack();
      return;
    }
    navigation.navigate('PublishPrice', {
      selectedFrom,
      selectedTo,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      selectedDistanceKm,
      selectedDurationSeconds,
      routePolylineEncoded: routePolylineEncoded ?? '',
      publishRestoreKey,
      selectedDateIso,
      selectedTimeHour: clockHour24,
      selectedTimeMinute: clockMinute,
      ...(publishRecentEditEntry ? { publishRecentEditEntry } : {}),
      ...(publishWizardReview ? { publishWizardReview: true } : {}),
      ...(publishFabExitTab ? { publishFabExitTab } : {}),
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitleRow} numberOfLines={1}>
            <Text style={styles.headerDeparture}>Departure</Text>
            <Text style={styles.headerTimeSuffix}> time</Text>
          </Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.leadBlock}>
          <Text style={styles.leadEmph}>Set your departure time.</Text>
        </Text>

        <View style={styles.timeCard}>
          <View style={styles.dateHero}>
            <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
            <Text style={styles.dateHeroText} numberOfLines={1}>
              {formatPublishStyleDateLabel(selectedDate)}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Select time</Text>

          <TimePickerClock
            hour24={clockHour24}
            minute={clockMinute}
            selectedDate={selectedDate}
            onChange={handleClockChange}
            minLeadMinutes={MIN_LEAD_MINUTES}
          />

          <View style={styles.timePreviewRow}>
            <Text style={styles.timePreviewLabel}>Selected</Text>
            <Text style={styles.timePreviewValue}>{formatTimeLabel(clockHour24, clockMinute)}</Text>
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.nextFab} onPress={onContinue} activeOpacity={0.85}>
        <Ionicons name="arrow-forward" size={24} color={COLORS.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  headerDeparture: { fontSize: 21, fontWeight: '800', color: COLORS.primary },
  headerTimeSuffix: { fontSize: 21, fontWeight: '800', color: COLORS.text },
  headerRight: { width: 44 },
  scroll: { paddingHorizontal: 18, paddingBottom: 100 },
  leadBlock: {
    marginBottom: 18,
    lineHeight: 26,
  },
  leadEmph: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  timeCard: {
    backgroundColor: COLORS.background,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 22,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  dateHero: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: PRIMARY_TINT,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    gap: 10,
    marginBottom: 16,
  },
  dateHeroText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  sectionTitle: {
    alignSelf: 'stretch',
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  timePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  timePreviewLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timePreviewValue: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  nextFab: {
    position: 'absolute',
    right: 18,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
});
