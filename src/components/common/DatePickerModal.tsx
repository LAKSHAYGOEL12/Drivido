import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

export type DatePickerModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Currently selected date (e.g. from form); can be null. */
  selectedDate: Date | null;
  /** Called when user taps a day. Modal typically closes after. */
  onSelectDate: (date: Date) => void;
  /** Modal title. Default matches Publish Ride. */
  title?: string;
};

/**
 * Full-screen calendar modal, same UI as the date picker on Publish Ride.
 * Slide-up sheet with month nav, weekday row, and day grid (past dimmed, today outlined, selected filled).
 */
export default function DatePickerModal({
  visible,
  onClose,
  selectedDate,
  onSelectDate,
  title = 'When are you going? Select date.',
}: DatePickerModalProps): React.JSX.Element {
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());

  useEffect(() => {
    if (visible) {
      if (selectedDate) {
        setCalendarMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()));
      } else {
        setCalendarMonth(new Date());
      }
    }
  }, [visible]);

  const calendarDays = getCalendarDays(calendarMonth.getFullYear(), calendarMonth.getMonth());
  const prevMonth = () => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1));
  const nextMonth = () => setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1));

  const handleSelectDate = (day: number) => {
    const d = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    onSelectDate(d);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.dateModalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.dateModalContent} onStartShouldSetResponder={() => true}>
          <Text style={styles.dateModalHeading}>{title}</Text>
          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={prevMonth} style={styles.calendarNav}>
              <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.calendarMonthTitle}>
              {MONTHS[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
            </Text>
            <TouchableOpacity onPress={nextMonth} style={styles.calendarNav}>
              <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekdayCell}>{w}</Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {calendarDays.map((day, i) => {
              if (day === null) return <View key={`e-${i}`} style={styles.calendarDay} />;
              const cellDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const cellNorm = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
              const isPast = cellNorm.getTime() < today.getTime();
              const isSelected =
                selectedDate != null &&
                selectedDate.getFullYear() === cellDate.getFullYear() &&
                selectedDate.getMonth() === cellDate.getMonth() &&
                selectedDate.getDate() === cellDate.getDate();
              const isToday = cellNorm.getTime() === today.getTime();
              const content = (
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
                </View>
              );
              if (isPast) {
                return (
                  <View key={day} style={styles.calendarDay}>
                    {content}
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  key={day}
                  style={styles.calendarDay}
                  onPress={() => handleSelectDate(day)}
                >
                  {content}
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={styles.dateModalClose} onPress={onClose}>
            <Text style={styles.dateModalCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dateModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dateModalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    paddingTop: 24,
  },
  dateModalHeading: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  calendarNav: {
    padding: 8,
  },
  calendarMonthTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDay: {
    width: '14.28%',
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDaySelected: {
    backgroundColor: COLORS.primary,
  },
  calendarDayToday: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  calendarDayPast: {
    opacity: 0.4,
  },
  calendarDayText: {
    fontSize: 15,
    color: COLORS.text,
  },
  calendarDayTextSelected: {
    color: COLORS.text,
    fontWeight: '700',
  },
  calendarDayTextToday: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  calendarDayTextPast: {
    color: COLORS.textMuted,
  },
  dateModalClose: {
    marginTop: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dateModalCloseText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
});
