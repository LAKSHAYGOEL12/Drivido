import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { alertDepartureTimeInPast } from '../../utils/publishAlerts';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';

type ScreenRoute = RouteProp<PublishStackParamList, 'PublishSelectTime'>;

const MIN_LEAD_MINUTES = 30;

const CLOCK_SIZE = 232;
const CLOCK_CENTER = CLOCK_SIZE / 2;
const HOUR_OUTER_RADIUS = 90;
const HOUR_INNER_RADIUS = 60;
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

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
    publishRestoreKey,
    selectedDateIso,
    initialTimeHour,
    initialTimeMinute,
  } = route.params;

  const selectedDate = useMemo(() => parseSelectedDate(selectedDateIso), [selectedDateIso]);

  const seed = useMemo(
    () => initialClockFromRoute(selectedDate, initialTimeHour, initialTimeMinute),
    [selectedDate, initialTimeHour, initialTimeMinute]
  );

  const [clockMode, setClockMode] = useState<'hour' | 'minute'>('hour');
  const [clockHour24, setClockHour24] = useState(seed.hour);
  const [clockMinute, setClockMinute] = useState(seed.minute);
  const [timeModalToast, setTimeModalToast] = useState('');
  const timeModalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToastTimer = useCallback(() => {
    if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    timeModalToastTimerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearToastTimer();
    };
  }, [clearToastTimer]);

  const handleClockPress = useCallback(
    (locationX: number, locationY: number) => {
      const dx = locationX - CLOCK_CENTER;
      const dy = locationY - CLOCK_CENTER;
      const radius = Math.sqrt(dx * dx + dy * dy);
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (angleDeg < 0) angleDeg += 360;
      if (clockMode === 'hour') {
        const dialHour = Math.round(angleDeg / 30) % 12;
        const isInnerRing = radius < (HOUR_OUTER_RADIUS + HOUR_INNER_RADIUS) / 2;
        const nextHour24 = isInnerRing ? dialHour + 12 : dialHour;
        setClockHour24(nextHour24);
        setClockMode('minute');
      } else {
        const index = Math.round(angleDeg / 30) % 12;
        const minute = MINUTE_OPTIONS[index];
        const candidate = { hour: clockHour24, minute };
        if (isSelectedDateTimeTooSoon(selectedDate, candidate, MIN_LEAD_MINUTES)) {
          clearToastTimer();
          setTimeModalToast('Choose a time at least 30 minutes from now.');
          timeModalToastTimerRef.current = setTimeout(() => setTimeModalToast(''), 1800);
          return;
        }
        setClockMinute(minute);
      }
    },
    [clockMode, clockHour24, selectedDate, clearToastTimer]
  );

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
      publishRestoreKey,
      selectedDateIso,
      selectedTimeHour: clockHour24,
      selectedTimeMinute: clockMinute,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
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
          <Text style={styles.leadRest}> Tap the clock to choose hour, then minutes — same picker as on the publish form (5-minute steps).</Text>
        </Text>

        <View style={styles.timeCard}>
          <View style={styles.dateHero}>
            <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
            <Text style={styles.dateHeroText} numberOfLines={1}>
              {formatPublishStyleDateLabel(selectedDate)}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Select time</Text>

          {timeModalToast ? (
            <View style={styles.toastBanner}>
              <Text style={styles.toastBannerText}>{timeModalToast}</Text>
            </View>
          ) : null}

          <View style={styles.clockTimeSelectRow}>
            <TouchableOpacity
              style={[styles.clockTimeBox, clockMode === 'hour' && styles.clockTimeBoxActive]}
              onPress={() => setClockMode('hour')}
              activeOpacity={0.85}
            >
              <Text style={[styles.clockTimeBoxText, clockMode === 'hour' && styles.clockTimeBoxTextActive]}>
                {clockHour24.toString().padStart(2, '0')}
              </Text>
            </TouchableOpacity>
            <Text style={styles.clockTimeColon}>:</Text>
            <TouchableOpacity
              style={[styles.clockTimeBox, clockMode === 'minute' && styles.clockTimeBoxActive]}
              onPress={() => setClockMode('minute')}
              activeOpacity={0.85}
            >
              <Text style={[styles.clockTimeBoxText, clockMode === 'minute' && styles.clockTimeBoxTextActive]}>
                {clockMinute.toString().padStart(2, '0')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.clockFaceOuter}>
            <Pressable
              style={styles.clockFaceWrap}
              onPress={(e) => {
                const { locationX, locationY } = e.nativeEvent;
                handleClockPress(locationX, locationY);
              }}
            >
              <View style={[styles.clockFace, { width: CLOCK_SIZE, height: CLOCK_SIZE }]} pointerEvents="none">
                {clockMode === 'hour' &&
                  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => {
                    const angleDeg = h * 30 - 90;
                    const rad = (angleDeg * Math.PI) / 180;
                    const x = CLOCK_CENTER + HOUR_OUTER_RADIUS * Math.cos(rad) - 8;
                    const y = CLOCK_CENTER + HOUR_OUTER_RADIUS * Math.sin(rad) - 9;
                    return (
                      <Text key={`outer_${h}`} style={[styles.clockHourLabel, { left: x, top: y }]} pointerEvents="none">
                        {h}
                      </Text>
                    );
                  })}
                {clockMode === 'hour' &&
                  [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((h) => {
                    const angleDeg = (h % 12) * 30 - 90;
                    const rad = (angleDeg * Math.PI) / 180;
                    const x = CLOCK_CENTER + HOUR_INNER_RADIUS * Math.cos(rad) - 8;
                    const y = CLOCK_CENTER + HOUR_INNER_RADIUS * Math.sin(rad) - 9;
                    return (
                      <Text
                        key={`inner_${h}`}
                        style={[styles.clockHourLabel, styles.clockHourLabelInner, { left: x, top: y }]}
                        pointerEvents="none"
                      >
                        {h}
                      </Text>
                    );
                  })}
                {clockMode === 'minute' &&
                  MINUTE_OPTIONS.map((min, idx) => {
                    const angleDeg = idx * 30 - 90;
                    const rad = (angleDeg * Math.PI) / 180;
                    const x = CLOCK_CENTER + HOUR_OUTER_RADIUS * Math.cos(rad) - 10;
                    const y = CLOCK_CENTER + HOUR_OUTER_RADIUS * Math.sin(rad) - 10;
                    return (
                      <Text key={min} style={[styles.clockMinuteLabel, { left: x, top: y }]} pointerEvents="none">
                        {min.toString().padStart(2, '0')}
                      </Text>
                    );
                  })}
                <View
                  style={[
                    styles.clockHandWrap,
                    {
                      left: CLOCK_CENTER - 15,
                      top: CLOCK_CENTER - 15,
                      transform: [{ rotate: `${(clockHour24 % 12) * 30 + (clockMinute / 60) * 30 - 90}deg` }],
                    },
                  ]}
                >
                  <View style={styles.clockHourHand} />
                </View>
                <View
                  style={[
                    styles.clockHandWrapMinute,
                    {
                      left: CLOCK_CENTER - 21,
                      top: CLOCK_CENTER - 21,
                      transform: [{ rotate: `${clockMinute * 6 - 90}deg` }],
                    },
                  ]}
                >
                  <View style={styles.clockMinuteHand} />
                </View>
              </View>
            </Pressable>
          </View>

          <Text style={styles.clockHint}>
            {clockMode === 'hour'
              ? 'Tap the clock to pick hour (outer ring 0–11, inner ring 12–23)'
              : 'Tap the clock to pick minutes (0–55 in 5 min steps)'}
          </Text>

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
  leadRest: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
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
  toastBanner: {
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    marginBottom: 12,
  },
  toastBannerText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  clockTimeSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  clockTimeBox: {
    minWidth: 88,
    height: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockTimeBoxActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  clockTimeBoxText: {
    fontSize: 40,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 44,
  },
  clockTimeBoxTextActive: {
    color: COLORS.primary,
  },
  clockTimeColon: {
    fontSize: 40,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 44,
    marginHorizontal: 2,
  },
  clockFaceOuter: {
    alignItems: 'center',
    width: '100%',
  },
  clockFaceWrap: {
    width: CLOCK_SIZE,
    height: CLOCK_SIZE,
    marginVertical: 8,
  },
  clockFace: {
    borderRadius: CLOCK_SIZE / 2,
    borderWidth: 3,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
    position: 'relative',
    overflow: 'visible',
  },
  clockHourLabel: {
    position: 'absolute',
    width: 20,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  clockHourLabelInner: {
    fontSize: 13,
    width: 20,
    color: COLORS.textSecondary,
  },
  clockMinuteLabel: {
    position: 'absolute',
    width: 24,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  clockHandWrap: {
    position: 'absolute',
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  clockHandWrapMinute: {
    position: 'absolute',
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  clockHourHand: {
    width: 4,
    height: 30,
    backgroundColor: COLORS.text,
    borderRadius: 2,
  },
  clockMinuteHand: {
    width: 2.5,
    height: 42,
    backgroundColor: COLORS.primary,
    borderRadius: 1.5,
  },
  clockHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'center',
    paddingHorizontal: 8,
    lineHeight: 17,
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
