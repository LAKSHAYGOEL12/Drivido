import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { COLORS } from '../../constants/colors';

/**
 * Drivido's single, production-standard time picker — used everywhere the user picks a time
 * (publish wizard, review-screen modal, edit-ride modal, reuse-route edit modal, …). One
 * shared implementation means the dial, AM/PM toggle, drag/tap behavior, and 30-minute
 * lead-time guard look and feel identical across the app.
 *
 * Design language (mirrors Material 3 / iOS):
 * - Single 1–12 hour ring + AM / PM segmented toggle (no confusing 13–23 inner ring).
 * - One hand renders at a time (hour OR minute) — no crossed lines on the dial.
 * - Selected number sits inside a primary-colored disc on the hand's tip with white text.
 * - 60 minute ticks around the rim, every 5th stronger, plus a small primary pivot dot.
 * - Drag-to-set on top of tap-to-set via a single `PanResponder`.
 * - Auto-advances hour → minute on release (tap or drag).
 *
 * Validation:
 * - When `minLeadMinutes > 0` AND the chosen `selectedDate` is today, the picker blocks
 *   any commit that lands within `minLeadMinutes` of "now" and shows a small inline toast.
 *   Drag-through values are not blocked — only the final release / explicit commit.
 */

const DEFAULT_CLOCK_SIZE = 252;
const NUMBER_RADIUS_RATIO = 96 / 252;
const TICK_RING_INSET = 14;

const HAND_LINE_W = 2.5;
const HAND_DISC_SIZE = 36;
const PIVOT_SIZE = 10;

const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;
/** Display hours read clockwise from the top: 12, 1, 2, … 11. */
const DISPLAY_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

const DEFAULT_MIN_LEAD_MINUTES = 30;
const DEFAULT_LEAD_MESSAGE = 'Choose a time at least 30 minutes from now.';

export type TimePickerClockValue = { hour24: number; minute: number };

export type TimePickerClockProps = {
  /** Currently selected hour, in 24-hour format (0..23). Controlled by the parent. */
  hour24: number;
  /** Currently selected minute (component snaps to the nearest 5-minute slot). */
  minute: number;
  /**
   * The calendar date the user is picking the time FOR. Required so the picker can run the
   * "must be at least N minutes from now" guard whenever that date happens to be today.
   */
  selectedDate: Date;
  /** Fired whenever the dial / AM-PM toggle changes either hour or minute. */
  onChange: (next: TimePickerClockValue) => void;
  /** Set to 0 to disable the too-soon guard entirely. Defaults to 30. */
  minLeadMinutes?: number;
  /** Message used in the inline toast when a too-soon time is committed. */
  leadTooSoonMessage?: string;
  /** Optional override for the dial diameter (default 252pt). */
  clockSize?: number;
  /** Optional override for the toast banner text — falls back to {@link leadTooSoonMessage}. */
  toastMessage?: string;
};

/** 24-hour → 12-hour display (1..12) + AM/PM. */
function hour24ToDisplay(h: number): { hour12: number; isPm: boolean } {
  const isPm = h >= 12;
  const m = h % 12;
  return { hour12: m === 0 ? 12 : m, isPm };
}

/** 12-hour display (1..12) + AM/PM → 24-hour. */
function displayToHour24(hour12: number, isPm: boolean): number {
  const base = hour12 === 12 ? 0 : hour12;
  return isPm ? base + 12 : base;
}

/** Polar → cartesian helper (0° = up / 12-o-clock, clockwise). */
function polar(centerX: number, centerY: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: centerX + radius * Math.cos(rad), y: centerY + radius * Math.sin(rad) };
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
  if (minLeadMinutes <= 0) return false;
  if (!isSelectedDateToday(selectedDate)) return false;
  const now = new Date();
  const y = selectedDate.getFullYear();
  const m = selectedDate.getMonth();
  const d = selectedDate.getDate();
  const chosen = new Date(y, m, d, selectedTime.hour, selectedTime.minute, 0, 0);
  return chosen.getTime() < now.getTime() + minLeadMinutes * 60 * 1000;
}

export default function TimePickerClock({
  hour24,
  minute,
  selectedDate,
  onChange,
  minLeadMinutes = DEFAULT_MIN_LEAD_MINUTES,
  leadTooSoonMessage = DEFAULT_LEAD_MESSAGE,
  clockSize = DEFAULT_CLOCK_SIZE,
  toastMessage,
}: TimePickerClockProps): React.JSX.Element {
  const [clockMode, setClockMode] = useState<'hour' | 'minute'>('hour');
  const [internalToast, setInternalToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Refs mirror the latest controlled values so the {@link PanResponder} closure stays current. */
  const clockModeRef = useRef(clockMode);
  const hour24Ref = useRef(hour24);
  const minuteRef = useRef(minute);
  const selectedDateRef = useRef(selectedDate);
  const minLeadMinutesRef = useRef(minLeadMinutes);

  useEffect(() => {
    clockModeRef.current = clockMode;
  }, [clockMode]);
  useEffect(() => {
    hour24Ref.current = hour24;
  }, [hour24]);
  useEffect(() => {
    minuteRef.current = minute;
  }, [minute]);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
  useEffect(() => {
    minLeadMinutesRef.current = minLeadMinutes;
  }, [minLeadMinutes]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showLeadToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setInternalToast(leadTooSoonMessage);
    toastTimerRef.current = setTimeout(() => setInternalToast(''), 1800);
  }, [leadTooSoonMessage]);

  const CLOCK_CENTER = clockSize / 2;
  const NUMBER_RADIUS = clockSize * NUMBER_RADIUS_RATIO;
  const HAND_TIP_RADIUS = NUMBER_RADIUS;
  const RIM_TICK_RADIUS = clockSize / 2 - TICK_RING_INSET;

  /**
   * Convert a tap/drag at (locationX, locationY) inside the dial into the new selection.
   * `commitMinute` = true blocks too-soon minutes (release events); during a drag we let
   * users sweep past unreachable times without bouncing.
   */
  const applyClockGesture = useCallback(
    (locationX: number, locationY: number, commitMinute: boolean) => {
      const dx = locationX - CLOCK_CENTER;
      const dy = locationY - CLOCK_CENTER;
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (angleDeg < 0) angleDeg += 360;

      const mode = clockModeRef.current;
      if (mode === 'hour') {
        const position = Math.round(angleDeg / 30) % 12;
        const displayHour = DISPLAY_HOURS[position];
        const { isPm } = hour24ToDisplay(hour24Ref.current);
        const nextHour24 = displayToHour24(displayHour, isPm);
        if (nextHour24 === hour24Ref.current) return;
        onChange({ hour24: nextHour24, minute: minuteRef.current });
      } else {
        const index = Math.round(angleDeg / 30) % 12;
        const nextMinute = MINUTE_OPTIONS[index];
        const candidate = { hour: hour24Ref.current, minute: nextMinute };
        if (
          commitMinute &&
          isSelectedDateTimeTooSoon(selectedDateRef.current, candidate, minLeadMinutesRef.current)
        ) {
          showLeadToast();
          return;
        }
        if (nextMinute === minuteRef.current) return;
        onChange({ hour24: hour24Ref.current, minute: nextMinute });
      }
    },
    [CLOCK_CENTER, onChange, showLeadToast]
  );

  /** Auto-advance hour → minute on tap/drag release (Material standard cadence). */
  const handleTapRelease = useCallback(() => {
    if (clockModeRef.current === 'hour') {
      setClockMode('minute');
    }
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          applyClockGesture(e.nativeEvent.locationX, e.nativeEvent.locationY, false);
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          applyClockGesture(e.nativeEvent.locationX, e.nativeEvent.locationY, false);
        },
        onPanResponderRelease: (e: GestureResponderEvent) => {
          applyClockGesture(e.nativeEvent.locationX, e.nativeEvent.locationY, true);
          handleTapRelease();
        },
        onPanResponderTerminate: () => {
          /* lost responder mid-drag — last move already updated the value */
        },
      }),
    [applyClockGesture, handleTapRelease]
  );

  const display = useMemo(() => hour24ToDisplay(hour24), [hour24]);
  const displayHour = display.hour12;
  const isPm = display.isPm;

  const handAngleDeg = useMemo(() => {
    if (clockMode === 'hour') {
      return (displayHour % 12) * 30;
    }
    return minute * 6;
  }, [clockMode, displayHour, minute]);

  const handTip = useMemo(
    () => polar(CLOCK_CENTER, CLOCK_CENTER, HAND_TIP_RADIUS, handAngleDeg),
    [CLOCK_CENTER, HAND_TIP_RADIUS, handAngleDeg]
  );

  const handDiscLabel =
    clockMode === 'hour' ? String(displayHour) : minute.toString().padStart(2, '0');

  const setAmPm = useCallback(
    (nextIsPm: boolean) => {
      if (nextIsPm === isPm) return;
      const nextHour24 = displayToHour24(displayHour, nextIsPm);
      const candidate = { hour: nextHour24, minute };
      if (isSelectedDateTimeTooSoon(selectedDate, candidate, minLeadMinutes)) {
        showLeadToast();
        return;
      }
      onChange({ hour24: nextHour24, minute });
    },
    [isPm, displayHour, minute, selectedDate, minLeadMinutes, onChange, showLeadToast]
  );

  const visibleToast = toastMessage || internalToast;

  return (
    <View style={styles.root}>
      {visibleToast ? (
        <View style={styles.toastBanner}>
          <Text style={styles.toastBannerText}>{visibleToast}</Text>
        </View>
      ) : null}

      {/* Digital readout — boxes are tappable mode switches; AM/PM is a vertical segmented control. */}
      <View style={styles.timeSelectRow}>
        <TouchableOpacity
          style={[styles.timeBox, clockMode === 'hour' && styles.timeBoxActive]}
          onPress={() => setClockMode('hour')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ selected: clockMode === 'hour' }}
          accessibilityLabel="Pick hour"
        >
          <Text
            style={[styles.timeBoxText, clockMode === 'hour' && styles.timeBoxTextActive]}
          >
            {displayHour.toString().padStart(2, '0')}
          </Text>
        </TouchableOpacity>
        <Text style={styles.timeColon}>:</Text>
        <TouchableOpacity
          style={[styles.timeBox, clockMode === 'minute' && styles.timeBoxActive]}
          onPress={() => setClockMode('minute')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ selected: clockMode === 'minute' }}
          accessibilityLabel="Pick minute"
        >
          <Text
            style={[styles.timeBoxText, clockMode === 'minute' && styles.timeBoxTextActive]}
          >
            {minute.toString().padStart(2, '0')}
          </Text>
        </TouchableOpacity>

        <View style={styles.amPmStack}>
          <TouchableOpacity
            style={[styles.amPmBtn, !isPm && styles.amPmBtnActive, styles.amPmBtnTop]}
            onPress={() => setAmPm(false)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: !isPm }}
            accessibilityLabel="Set to AM"
          >
            <Text style={[styles.amPmText, !isPm && styles.amPmTextActive]}>AM</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.amPmBtn, isPm && styles.amPmBtnActive, styles.amPmBtnBot]}
            onPress={() => setAmPm(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: isPm }}
            accessibilityLabel="Set to PM"
          >
            <Text style={[styles.amPmText, isPm && styles.amPmTextActive]}>PM</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Dial — single tap-and-drag surface (PanResponder handles both gestures). */}
      <View style={styles.faceOuter}>
        <View
          style={[styles.faceWrap, { width: clockSize, height: clockSize }]}
          {...panResponder.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={clockMode === 'hour' ? 'Pick hour' : 'Pick minute'}
          accessibilityHint="Tap a number or drag the hand to pick a value"
        >
          <View
            style={[styles.face, { width: clockSize, height: clockSize, borderRadius: clockSize / 2 }]}
            pointerEvents="none"
          >
            {/* 60 minute ticks — every 5th is stronger to give the rim a real-clock feel. */}
            {Array.from({ length: 60 }).map((_, i) => {
              const angle = i * 6;
              const isMajor = i % 5 === 0;
              const tickLen = isMajor ? 6 : 3;
              const tickW = isMajor ? 2 : 1;
              const innerR = RIM_TICK_RADIUS - tickLen;
              const { x: tx, y: ty } = polar(
                CLOCK_CENTER,
                CLOCK_CENTER,
                innerR + tickLen / 2,
                angle
              );
              return (
                <View
                  key={`tick-${i}`}
                  style={[
                    styles.tick,
                    isMajor ? styles.tickMajor : styles.tickMinor,
                    {
                      width: tickW,
                      height: tickLen,
                      left: tx - tickW / 2,
                      top: ty - tickLen / 2,
                      transform: [{ rotate: `${angle}deg` }],
                    },
                  ]}
                />
              );
            })}

            {clockMode === 'hour' &&
              DISPLAY_HOURS.map((hour, idx) => {
                const angle = idx * 30;
                const { x, y } = polar(CLOCK_CENTER, CLOCK_CENTER, NUMBER_RADIUS, angle);
                const isSelected = hour === displayHour;
                return (
                  <View
                    key={`hour-${hour}`}
                    style={[styles.numberCell, { left: x - 18, top: y - 18 }]}
                  >
                    <Text
                      style={[styles.numberLabel, isSelected && styles.numberLabelSelected]}
                    >
                      {hour}
                    </Text>
                  </View>
                );
              })}

            {clockMode === 'minute' &&
              MINUTE_OPTIONS.map((min, idx) => {
                const angle = idx * 30;
                const { x, y } = polar(CLOCK_CENTER, CLOCK_CENTER, NUMBER_RADIUS, angle);
                const isSelected = min === minute;
                return (
                  <View
                    key={`min-${min}`}
                    style={[styles.numberCell, { left: x - 20, top: y - 18 }]}
                  >
                    <Text
                      style={[styles.numberLabel, isSelected && styles.numberLabelSelected]}
                    >
                      {min.toString().padStart(2, '0')}
                    </Text>
                  </View>
                );
              })}

            <View
              style={[
                styles.handLine,
                {
                  left: CLOCK_CENTER - HAND_LINE_W / 2,
                  top: CLOCK_CENTER - HAND_TIP_RADIUS,
                  width: HAND_LINE_W,
                  height: HAND_TIP_RADIUS,
                  transform: [{ rotate: `${handAngleDeg}deg` }],
                },
              ]}
            />

            <View
              style={[
                styles.handDisc,
                {
                  left: handTip.x - HAND_DISC_SIZE / 2,
                  top: handTip.y - HAND_DISC_SIZE / 2,
                },
              ]}
            >
              <Text style={styles.handDiscText}>{handDiscLabel}</Text>
            </View>

            <View
              style={[
                styles.pivot,
                {
                  left: CLOCK_CENTER - PIVOT_SIZE / 2,
                  top: CLOCK_CENTER - PIVOT_SIZE / 2,
                },
              ]}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    alignSelf: 'stretch',
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

  /** Digital readout + AM/PM stack ─────────────────── */
  timeSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    gap: 4,
  },
  timeBox: {
    width: 78,
    height: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBoxActive: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  timeBoxText: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 42,
    fontVariant: ['tabular-nums'],
  },
  timeBoxTextActive: {
    color: COLORS.primary,
  },
  timeColon: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 42,
    marginHorizontal: 1,
  },
  amPmStack: {
    marginLeft: 6,
    height: 64,
    width: 48,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
  },
  amPmBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  amPmBtnTop: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  amPmBtnBot: {},
  amPmBtnActive: {
    backgroundColor: 'rgba(34,197,94,0.16)',
  },
  amPmText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  amPmTextActive: {
    color: COLORS.primary,
  },

  /** Clock dial ────────────────────────────────────── */
  faceOuter: {
    alignItems: 'center',
    width: '100%',
  },
  faceWrap: {
    marginVertical: 8,
  },
  face: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    position: 'relative',
    overflow: 'visible',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  tick: {
    position: 'absolute',
    borderRadius: 1,
  },
  tickMajor: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  tickMinor: {
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
  },
  numberCell: {
    position: 'absolute',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  numberLabelSelected: {
    color: COLORS.white,
  },

  /** Active hand — line, disc, pivot ───────────────── */
  handLine: {
    position: 'absolute',
    transformOrigin: 'center bottom',
    backgroundColor: COLORS.primary,
    borderRadius: HAND_LINE_W / 2,
  },
  handDisc: {
    position: 'absolute',
    width: HAND_DISC_SIZE,
    height: HAND_DISC_SIZE,
    borderRadius: HAND_DISC_SIZE / 2,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  handDiscText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.white,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  pivot: {
    position: 'absolute',
    width: PIVOT_SIZE,
    height: PIVOT_SIZE,
    borderRadius: PIVOT_SIZE / 2,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
});

/**
 * Re-export the snapshot of allowed minute slots so callers can clamp incoming values to the
 * same 5-minute grid this component selects on.
 */
export { MINUTE_OPTIONS };
