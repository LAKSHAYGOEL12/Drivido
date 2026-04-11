import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';

/** Subtle primary wash for “today” and strip backgrounds */
const PRIMARY_TINT = 'rgba(41, 190, 139, 0.14)';
const PRIMARY_TINT_SOFT = 'rgba(41, 190, 139, 0.08)';

type ScreenRoute = RouteProp<PublishStackParamList, 'PublishSelectDate'>;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getCalendarDays(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();
  const result: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) result.push(null);
  for (let d = 1; d <= daysInMonth; d++) result.push(d);
  const total = result.length;
  const remainder = total % 7;
  if (remainder) for (let i = 0; i < 7 - remainder; i++) result.push(null);
  return result;
}

function parseInitialDate(iso?: string): Date {
  if (!iso?.trim()) return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export default function PublishSelectDateScreen(): React.JSX.Element {
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
    initialSelectedDateIso,
  } = route.params;

  const [selectedDate, setSelectedDate] = useState(() => parseInitialDate(initialSelectedDateIso));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = parseInitialDate(initialSelectedDateIso);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const calendarDays = useMemo(
    () => getCalendarDays(calendarMonth.getFullYear(), calendarMonth.getMonth()),
    [calendarMonth]
  );

  const prevMonth = () => {
    setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  };

  const handleSelectDay = (day: number) => {
    const cellDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    setSelectedDate(cellDate);
  };

  const flowParams = {
    selectedFrom,
    selectedTo,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    selectedDistanceKm,
    selectedDurationSeconds,
    publishRestoreKey,
  };

  const onContinue = () => {
    navigation.navigate('PublishSelectTime', {
      ...flowParams,
      selectedDateIso: selectedDate.toISOString(),
    });
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitleRow} numberOfLines={1}>
            <Text style={styles.headerTrip}>Trip</Text>
            <Text style={styles.headerDateSuffix}> date</Text>
          </Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.leadBlock}>
          <Text style={styles.leadEmph}>When are you leaving?</Text>
          <Text style={styles.leadRest}> Pick a day for this ride.</Text>
        </Text>

        <View style={styles.calendarCard}>
          <View style={styles.calendarCardHeader}>
            <TouchableOpacity
              onPress={prevMonth}
              style={styles.calendarNavBtn}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            <View style={styles.calendarMonthCenter}>
              <Text style={styles.calendarMonthTitle}>
                {MONTHS[calendarMonth.getMonth()]}{' '}
                <Text style={styles.calendarYear}>{calendarMonth.getFullYear()}</Text>
              </Text>
              <View style={styles.selectedChip}>
                <Ionicons name="calendar-outline" size={14} color={COLORS.primary} style={styles.selectedChipIcon} />
                <Text style={styles.selectedChipText} numberOfLines={1}>
                  {formatPublishStyleDateLabel(selectedDate)}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={nextMonth}
              style={styles.calendarNavBtn}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayStrip}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekdayCell}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {calendarDays.map((day, i) => {
              if (day === null) return <View key={`e-${i}`} style={styles.calendarDay} />;
              const cellDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
              const cellNorm = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
              const isPast = cellNorm.getTime() < today.getTime();
              const isSelected =
                selectedDate.getFullYear() === cellDate.getFullYear() &&
                selectedDate.getMonth() === cellDate.getMonth() &&
                selectedDate.getDate() === cellDate.getDate();
              const isToday = cellNorm.getTime() === today.getTime();
              const inner = (
                <View
                  style={[
                    styles.calendarDayInner,
                    isSelected && styles.calendarDaySelected,
                    isToday && !isSelected && styles.calendarDayToday,
                    isPast && styles.calendarDayPast,
                  ]}
                >
                  <Text
                    style={[
                      styles.calendarDayText,
                      isSelected && styles.calendarDayTextSelected,
                      isToday && !isSelected && styles.calendarDayTextToday,
                      isPast && styles.calendarDayTextPast,
                    ]}
                  >
                    {day}
                  </Text>
                  {isToday && !isSelected ? <View style={styles.todayDot} /> : null}
                </View>
              );
              if (isPast) {
                return (
                  <View key={day} style={styles.calendarDay}>
                    {inner}
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  key={day}
                  style={styles.calendarDay}
                  onPress={() => handleSelectDay(day)}
                  activeOpacity={0.72}
                >
                  {inner}
                </TouchableOpacity>
              );
            })}
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
  headerTrip: { fontSize: 21, fontWeight: '800', color: COLORS.primary },
  headerDateSuffix: { fontSize: 21, fontWeight: '800', color: COLORS.text },
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
  calendarCard: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingBottom: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.07,
        shadowRadius: 20,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  calendarCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 16,
    paddingBottom: 12,
  },
  calendarNavBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  calendarMonthCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  calendarMonthTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  calendarYear: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: PRIMARY_TINT_SOFT,
    borderWidth: 1,
    borderColor: 'rgba(41, 190, 139, 0.22)',
    maxWidth: '100%',
  },
  selectedChipIcon: { marginRight: 6 },
  selectedChipText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  weekdayStrip: {
    flexDirection: 'row',
    marginHorizontal: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: PRIMARY_TINT_SOFT,
    marginBottom: 6,
  },
  weekdayCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  calendarDay: {
    width: '14.28%',
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayInner: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  calendarDaySelected: {
    backgroundColor: COLORS.primary,
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  calendarDayToday: {
    backgroundColor: PRIMARY_TINT,
  },
  calendarDayPast: { opacity: 0.32 },
  calendarDayText: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  calendarDayTextSelected: { color: COLORS.white, fontWeight: '800' },
  calendarDayTextToday: { color: COLORS.primaryDark, fontWeight: '800' },
  calendarDayTextPast: { color: COLORS.textMuted },
  todayDot: {
    position: 'absolute',
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  nextFab: {
    position: 'absolute',
    right: 18,
    bottom: 28,
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
