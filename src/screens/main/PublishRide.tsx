import React, { useState, useMemo, useCallback, useLayoutEffect, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Switch,
  Modal,
  Platform,
  Pressable,
  ActivityIndicator,
  BackHandler,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from '../../utils/themedAlert';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { findMainTabNavigator } from '../../navigation/findMainTabNavigator';
import { mainTabScrollBottomInset } from '../../navigation/tabBarMetrics';
import { COLORS } from '../../constants/colors';
import { OFFLINE_HEADLINE, OFFLINE_SUBTITLE_RETRY } from '../../constants/offlineMessaging';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation } from '../../contexts/LocationContext';
import api from '../../services/api';
import { fetchRideDetailRaw } from '../../services/rideDetailCache';
import { emitRideListMergeFromDetail, rideListItemFromDetailApiPayload } from '../../services/rideListFromDetailSync';
import { API } from '../../constants/API';
import type { CreateRidePayload } from '../../types/api';
import {
  stashPublishRideDraft,
  getPublishRideDraft,
  schedulePublishDraftCleanup,
} from '../../navigation/publishStackDraft';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import {
  alertDepartureTimeInPast,
  alertFareOutsideAllowedRange,
  alertFareRequiredBeforePublish,
  alertMissingPickupDestination,
  alertNeedMapLocations,
  alertPublishFailed,
  alertRouteRequiredBeforePrice,
} from '../../utils/publishAlerts';
import {
  allowedPublishFareRange,
  effectivePublishDistanceKm,
  isPublishStopsComplete,
  publishStopsCoordKey,
  recommendedFareRange,
  straightLineKmBetweenStops,
} from '../../utils/publishFare';
import { buildRidePolylinePersistPayload } from '../../utils/publishRoutePolylineApi';
import { normalizeEncodedPolyline } from '../../utils/routePolyline';
import {
  pickRoutePolylineEncodedFromRecord,
  routeParamsIncludePolylineField,
} from '../../utils/ridePublisherCoords';
import SelectVehicleBottomSheet, {
  type VehicleFormValues,
} from '../../components/publish/SelectVehicleBottomSheet';
import PublishFareBottomSheet from '../../components/publish/PublishFareBottomSheet';
import { vehicleListToAuthPatch, vehiclesFromUser } from '../../utils/userVehicle';
import { createUserVehicle, listUserVehicles } from '../../services/userVehicles';
import {
  loadRecentPublished,
  addRecentPublished,
  removeRecentPublished,
  clearRecentPublished,
  type RecentPublishedEntry,
} from '../../services/recent-published-storage';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';
import { validation, validationErrors } from '../../constants/validation';
import { briefRouteListLabel } from '../../utils/routeListBriefLabel';
import { showToast } from '../../utils/toast';

const MAX_PASSENGERS = 6;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CLOCK_SIZE = 232;
const CLOCK_CENTER = CLOCK_SIZE / 2;
const HOUR_OUTER_RADIUS = 90;
const HOUR_INNER_RADIUS = 60;
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;
const MIN_LEAD_MINUTES = 30;

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

function formatTimeLabel(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function formatPublishedMetaLine(e: RecentPublishedEntry): string {
  const [y, m, d] = e.dateYmd.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  const label = formatPublishStyleDateLabel(dt);
  const time = formatTimeLabel(e.hour, e.minute);
  const pax = e.seats === 1 ? '1 seat' : `${e.seats} seats`;
  const fare = e.rate.trim() ? `₹${e.rate}` : '—';
  const mode = e.instantBooking ? 'Instant' : 'Request';
  return `${label} · ${time} · ${pax} · ${fare} · ${mode}`;
}

function getMinTimeForToday(): { hour: number; minute: number } {
  const now = new Date();
  let hour = now.getHours();
  let minute = now.getMinutes();
  minute = Math.ceil(minute / 15) * 15;
  if (minute >= 60) {
    minute = 0;
    hour += 1;
  }
  if (hour >= 24) hour = 23;
  return { hour, minute };
}

/** Current time + 1 hour, rounded up to next 5 minutes (default time so user can still pick current or any future time). */
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
  return selectedDate.getFullYear() === t.getFullYear() &&
    selectedDate.getMonth() === t.getMonth() &&
    selectedDate.getDate() === t.getDate();
}

function isSelectedDateTimeInPast(selectedDate: Date, selectedTime: { hour: number; minute: number }): boolean {
  const now = new Date();
  const y = selectedDate.getFullYear();
  const m = selectedDate.getMonth();
  const d = selectedDate.getDate();
  const chosen = new Date(y, m, d, selectedTime.hour, selectedTime.minute, 0, 0);
  return chosen.getTime() < now.getTime();
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

function isSamePickupAndDestination(args: {
  pickup: string;
  destination: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
}): boolean {
  const p = args.pickup.trim().toLowerCase().replace(/\s+/g, ' ');
  const d = args.destination.trim().toLowerCase().replace(/\s+/g, ' ');
  if (p.length > 0 && p === d) return true;
  const eps = 1e-4; // ~11m
  return (
    Math.abs(args.pickupLatitude - args.destinationLatitude) < eps &&
    Math.abs(args.pickupLongitude - args.destinationLongitude) < eps
  );
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getAvailableTimeSlots(selectedDate: Date): { hour: number; minute: number }[] {
  const slots: { hour: number; minute: number }[] = [];
  const min = isSelectedDateToday(selectedDate) ? getMinTimeForToday() : { hour: 0, minute: 0 };
  for (let h = 0; h < 24; h++) {
    for (let m of [0, 15, 30, 45]) {
      if (h < min.hour || (h === min.hour && m < min.minute)) continue;
      slots.push({ hour: h, minute: m });
    }
  }
  return slots;
}

export default function PublishRide(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const publishScrollBottomPad = mainTabScrollBottomInset(insets.bottom);
  const { user, patchUser, refreshUser, isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const recentUserKey = useMemo(() => (user?.id ?? user?.phone ?? '').trim(), [user?.id, user?.phone]);
  const [publishedRecents, setPublishedRecents] = useState<RecentPublishedEntry[]>([]);
  const { prefetchLocation } = useLocation();
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupLatitude, setPickupLatitude] = useState(0);
  const [pickupLongitude, setPickupLongitude] = useState(0);
  const [destinationLatitude, setDestinationLatitude] = useState(0);
  const [destinationLongitude, setDestinationLongitude] = useState(0);
  const [publishLoading, setPublishLoading] = useState(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [addVehicleBusy, setAddVehicleBusy] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [dateLabel, setDateLabel] = useState(() => formatPublishStyleDateLabel(new Date()));
  const [selectedTime, setSelectedTime] = useState(() => getDefaultTimeOneHourAhead());
  const [timeLabel, setTimeLabel] = useState(() => {
    const t = getDefaultTimeOneHourAhead();
    return formatTimeLabel(t.hour, t.minute);
  });
  const [seats, setSeats] = useState(1);
  const [rate, setRate] = useState('');
  const [instantBooking, setInstantBooking] = useState(false);
  const [rideDescription, setRideDescription] = useState('');
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showPassengersModal, setShowPassengersModal] = useState(false);
  const [showFareBottomSheet, setShowFareBottomSheet] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [clockMode, setClockMode] = useState<'hour' | 'minute'>('hour');
  const [clockHour24, setClockHour24] = useState(9);
  const [clockMinute, setClockMinute] = useState(30);
  const [timeModalToast, setTimeModalToast] = useState('');
  const timeModalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Selected route travel time (seconds) from PublishPrice / route preview — sent with POST /rides. */
  const [routeDurationSeconds, setRouteDurationSeconds] = useState(0);
  /** Encoded polyline selected by driver in route preview. */
  const [routePolylineEncoded, setRoutePolylineEncoded] = useState<string | null>(null);
  /** Directions / price flow distance (km). Cleared when pickup–destination coords change. */
  const [selectedRouteDistanceKm, setSelectedRouteDistanceKm] = useState<number | null>(null);
  /** Coords key when `selectedRouteDistanceKm` was applied — drop stale fare if coords change. */
  const lastRouteFareCoordsKeyRef = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  /** Matches Find tab `_tabResetToken` — tab bar tap must clear form; `navigate` does not remount this screen. */
  const publishTabResetHandledRef = useRef(0);
  const [netOnline, setNetOnline] = useState<boolean | null>(null);
  const offline = netOnline === false;

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setNetOnline(s.isConnected === true && s.isInternetReachable !== false);
    });
    void NetInfo.fetch().then((s) => {
      setNetOnline(s.isConnected === true && s.isInternetReachable !== false);
    });
    return () => unsub();
  }, []);

  const showOfflineHint = useCallback(() => {
    showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
  }, []);

  const calendarDays = useMemo(
    () => getCalendarDays(calendarMonth.getFullYear(), calendarMonth.getMonth()),
    [calendarMonth]
  );

  const canSetFare = useMemo(
    () =>
      isPublishStopsComplete({
        selectedFrom: pickup,
        selectedTo: destination,
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude,
      }),
    [pickup, destination, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]
  );

  const fareSheetDistanceKm = useMemo(() => {
    const p = route.params as { selectedDistanceKm?: number } | undefined;
    const paramKm =
      typeof p?.selectedDistanceKm === 'number' && !Number.isNaN(p.selectedDistanceKm)
        ? p.selectedDistanceKm
        : undefined;
    const storedKm =
      selectedRouteDistanceKm ??
      (typeof paramKm === 'number' && paramKm > 0 ? paramKm : undefined);
    return effectivePublishDistanceKm({
      selectedDistanceKm: storedKm,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      preferStoredRouteDistance: storedKm != null,
    });
  }, [
    route.params,
    selectedRouteDistanceKm,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
  ]);

  const fareSheetInitialAmount = useMemo(() => {
    const n = parseInt(rate.trim(), 10);
    if (!Number.isNaN(n) && n > 0) return n;
    const { minRecommended } = allowedPublishFareRange(fareSheetDistanceKm);
    return minRecommended;
  }, [rate, fareSheetDistanceKm]);

  const estimatedFareLabel = useMemo(() => {
    const r = rate.trim();
    if (r) return `₹${r}`;
    if (!canSetFare) return 'Add pickup & destination';
    const straight = straightLineKmBetweenStops({
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
    });
    const p = route.params as { selectedDistanceKm?: number } | undefined;
    const paramKm =
      typeof p?.selectedDistanceKm === 'number' && !Number.isNaN(p.selectedDistanceKm)
        ? p.selectedDistanceKm
        : undefined;
    const storedKm =
      selectedRouteDistanceKm ??
      (typeof paramKm === 'number' && paramKm > 0 ? paramKm : undefined);
    const canEstimate =
      straight != null || (storedKm != null && storedKm > 0);
    if (!canEstimate) return 'Enter fare';
    const kmForEstimate = effectivePublishDistanceKm({
      selectedDistanceKm: storedKm,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      preferStoredRouteDistance: storedKm != null,
    });
    const { minRecommended, maxRecommended } = recommendedFareRange(kmForEstimate);
    return `₹${minRecommended}–₹${maxRecommended}`;
  }, [
    rate,
    canSetFare,
    selectedRouteDistanceKm,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    route.params,
  ]);

  const handleSelectDate = (day: number) => {
    const d = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    setSelectedDate(d);
    setDateLabel(formatPublishStyleDateLabel(d));
    setShowDateModal(false);
  };

  const prevMonth = () => {
    setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1));
  };
  const nextMonth = () => {
    setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1));
  };

  const openTimeModal = () => {
    setClockHour24(selectedTime.hour);
    setClockMinute(Math.round(selectedTime.minute / 5) * 5 % 60);
    setClockMode('hour');
    setShowTimeModal(true);
  };

  const applyClockTime = useCallback((hour: number, minute: number) => {
    setSelectedTime({ hour, minute });
    setTimeLabel(formatTimeLabel(hour, minute));
  }, []);

  const cancelTimeModal = useCallback(() => {
    if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    setTimeModalToast('');
    setShowTimeModal(false);
  }, []);

  const confirmTimeModal = useCallback(() => {
    const candidate = { hour: clockHour24, minute: clockMinute };
    if (isSelectedDateTimeTooSoon(selectedDate, candidate, MIN_LEAD_MINUTES)) {
      if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
      setTimeModalToast('Choose a time at least 30 minutes from now.');
      timeModalToastTimerRef.current = setTimeout(() => setTimeModalToast(''), 1800);
      return;
    }
    applyClockTime(clockHour24, clockMinute);
    setShowTimeModal(false);
  }, [applyClockTime, clockHour24, clockMinute, selectedDate]);

  const handleClockPress = useCallback((locationX: number, locationY: number) => {
    const dx = locationX - CLOCK_CENTER;
    const dy = locationY - CLOCK_CENTER;
    const radius = Math.sqrt(dx * dx + dy * dy);
    let angleDeg = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
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
        if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
        setTimeModalToast('Choose a time at least 30 minutes from now.');
        timeModalToastTimerRef.current = setTimeout(() => setTimeModalToast(''), 1800);
        return;
      }
      setClockMinute(minute);
    }
  }, [clockMode, clockHour24, selectedDate]);

  useEffect(() => {
    return () => {
      if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    };
  }, []);

  const isTimeInPast = isSelectedDateTimeInPast(selectedDate, selectedTime);
  const isTimeTooSoon = isSelectedDateTimeTooSoon(selectedDate, selectedTime, MIN_LEAD_MINUTES);

  const mergedVehicles = useMemo(() => vehiclesFromUser(user), [user]);

  useEffect(() => {
    if (mergedVehicles.length === 0) {
      setSelectedVehicleId(null);
      return;
    }
    setSelectedVehicleId((prev) => {
      if (prev && mergedVehicles.some((v) => v.id === prev)) return prev;
      return mergedVehicles[0].id;
    });
  }, [mergedVehicles]);

  // Prefetch location when user lands on Publish (no prompt; uses cache when possible)
  useFocusEffect(
    React.useCallback(() => {
      prefetchLocation();
    }, [prefetchLocation])
  );

  useFocusEffect(
    useCallback(() => {
      if (!sessionReady) {
        setPublishedRecents([]);
        return;
      }
      let cancelled = false;
      void loadRecentPublished(recentUserKey).then((list) => {
        if (!cancelled) setPublishedRecents(list);
      });
      return () => {
        cancelled = true;
      };
    }, [sessionReady, recentUserKey])
  );

  const syncVehiclesFromApi = useCallback(async () => {
    await refreshUser();
    try {
      const list = await listUserVehicles();
      patchUser(vehicleListToAuthPatch(list));
      return list;
    } catch {
      return [];
    }
  }, [refreshUser, patchUser]);

  useFocusEffect(
    useCallback(() => {
      if (sessionReady) void syncVehiclesFromApi();
    }, [sessionReady, syncVehiclesFromApi])
  );

  /** After location pick we reset the stack; restore date/time/seats from draft + new coords from params. */
  const publishRestoreKey = (route.params as { _publishRestoreKey?: string } | undefined)
    ?._publishRestoreKey;
  const priceReturnForLayout = (route.params || {}) as {
    selectedDurationSeconds?: number;
    selectedDistanceKm?: number;
    routePolylineEncoded?: string;
  };
  const prDurSec =
    typeof priceReturnForLayout.selectedDurationSeconds === 'number' &&
    !Number.isNaN(priceReturnForLayout.selectedDurationSeconds)
      ? priceReturnForLayout.selectedDurationSeconds
      : -1;
  const prDistKm =
    typeof priceReturnForLayout.selectedDistanceKm === 'number' &&
    !Number.isNaN(priceReturnForLayout.selectedDistanceKm)
      ? priceReturnForLayout.selectedDistanceKm
      : -1;

  useLayoutEffect(() => {
    if (!publishRestoreKey) return;
    const d = getPublishRideDraft(publishRestoreKey);
    const p = (route.params || {}) as {
      selectedFrom?: string;
      selectedTo?: string;
      pickupLatitude?: number;
      pickupLongitude?: number;
      destinationLatitude?: number;
      destinationLongitude?: number;
      selectedRate?: string;
      selectedDurationSeconds?: number;
      selectedDistanceKm?: number;
      routePolylineEncoded?: string;
      /** From PublishPrice after PublishSelectDate / PublishSelectTime — must override draft date/time. */
      selectedDateIso?: string;
      selectedTimeHour?: number;
      selectedTimeMinute?: number;
      offeredSeats?: number;
    };

    const paramsCoordsOk =
      typeof p.pickupLatitude === 'number' &&
      !Number.isNaN(p.pickupLatitude) &&
      typeof p.pickupLongitude === 'number' &&
      !Number.isNaN(p.pickupLongitude) &&
      typeof p.destinationLatitude === 'number' &&
      !Number.isNaN(p.destinationLatitude) &&
      typeof p.destinationLongitude === 'number' &&
      !Number.isNaN(p.destinationLongitude);

    if (!d) {
      if (!paramsCoordsOk) return;
      setPickup(String(p.selectedFrom ?? ''));
      setDestination(String(p.selectedTo ?? ''));
      setPickupLatitude(p.pickupLatitude!);
      setPickupLongitude(p.pickupLongitude!);
      setDestinationLatitude(p.destinationLatitude!);
      setDestinationLongitude(p.destinationLongitude!);
      if (p.selectedDateIso) {
        const dt = new Date(p.selectedDateIso);
        if (!Number.isNaN(dt.getTime())) {
          setSelectedDate(dt);
          setDateLabel(formatPublishStyleDateLabel(dt));
          setCalendarMonth(new Date(dt.getFullYear(), dt.getMonth(), 1));
        }
      }
      if (
        typeof p.selectedTimeHour === 'number' &&
        typeof p.selectedTimeMinute === 'number' &&
        !Number.isNaN(p.selectedTimeHour) &&
        !Number.isNaN(p.selectedTimeMinute)
      ) {
        const h = Math.max(0, Math.min(23, Math.floor(p.selectedTimeHour)));
        const m = Math.max(0, Math.min(59, Math.floor(p.selectedTimeMinute)));
        setSelectedTime({ hour: h, minute: m });
        setTimeLabel(formatTimeLabel(h, m));
        setClockHour24(h);
        setClockMinute(Math.round(m / 5) * 5 % 60);
      }
      if (typeof p.selectedRate === 'string') setRate(p.selectedRate);
      if (typeof p.offeredSeats === 'number' && !Number.isNaN(p.offeredSeats)) {
        setSeats(Math.max(1, Math.min(6, Math.floor(p.offeredSeats))));
      } else {
        setSeats(1);
      }
      if (typeof p.selectedDurationSeconds === 'number' && !Number.isNaN(p.selectedDurationSeconds)) {
        setRouteDurationSeconds(Math.max(0, Math.floor(p.selectedDurationSeconds)));
      }
      if (routeParamsIncludePolylineField(p as Record<string, unknown>)) {
        const poly = pickRoutePolylineEncodedFromRecord(p as Record<string, unknown>);
        setRoutePolylineEncoded(poly ?? null);
      }
      if (typeof p.selectedDistanceKm === 'number' && !Number.isNaN(p.selectedDistanceKm)) {
        const pk = publishStopsCoordKey(
          p.pickupLatitude!,
          p.pickupLongitude!,
          p.destinationLatitude!,
          p.destinationLongitude!
        );
        setSelectedRouteDistanceKm(Math.max(1, p.selectedDistanceKm));
        lastRouteFareCoordsKeyRef.current = pk;
      }
      schedulePublishDraftCleanup(publishRestoreKey);
      return;
    }

    setPickup(String(p.selectedFrom ?? d.pickup ?? ''));
    setDestination(String(p.selectedTo ?? d.destination ?? ''));
    const plat =
      typeof p.pickupLatitude === 'number' ? p.pickupLatitude : d.pickupLatitude;
    const plon =
      typeof p.pickupLongitude === 'number' ? p.pickupLongitude : d.pickupLongitude;
    const dlat =
      typeof p.destinationLatitude === 'number' ? p.destinationLatitude : d.destinationLatitude;
    const dlon =
      typeof p.destinationLongitude === 'number' ? p.destinationLongitude : d.destinationLongitude;
    setPickupLatitude(plat);
    setPickupLongitude(plon);
    setDestinationLatitude(dlat);
    setDestinationLongitude(dlon);
    if (p.selectedDateIso) {
      const dt = new Date(p.selectedDateIso);
      if (!Number.isNaN(dt.getTime())) {
        setSelectedDate(dt);
        setDateLabel(formatPublishStyleDateLabel(dt));
        setCalendarMonth(new Date(dt.getFullYear(), dt.getMonth(), 1));
      }
    } else {
      try {
        setSelectedDate(new Date(d.selectedDateIso));
      } catch {
        setSelectedDate(new Date());
      }
      setDateLabel(d.dateLabel);
      try {
        setCalendarMonth(new Date(d.calendarMonthIso));
      } catch {
        setCalendarMonth(new Date());
      }
    }
    if (
      typeof p.selectedTimeHour === 'number' &&
      typeof p.selectedTimeMinute === 'number' &&
      !Number.isNaN(p.selectedTimeHour) &&
      !Number.isNaN(p.selectedTimeMinute)
    ) {
      const h = Math.max(0, Math.min(23, Math.floor(p.selectedTimeHour)));
      const m = Math.max(0, Math.min(59, Math.floor(p.selectedTimeMinute)));
      setSelectedTime({ hour: h, minute: m });
      setTimeLabel(formatTimeLabel(h, m));
      setClockHour24(h);
      setClockMinute(Math.round(m / 5) * 5 % 60);
    } else {
      setSelectedTime(d.selectedTime);
      setTimeLabel(d.timeLabel);
      const draftHour24 =
        typeof (d as { clockHour24?: unknown }).clockHour24 === 'number'
          ? Math.max(0, Math.min(23, Math.floor((d as { clockHour24: number }).clockHour24)))
          : (() => {
              const h12 =
                typeof (d as { clockHour12?: unknown }).clockHour12 === 'number'
                  ? Math.max(
                      1,
                      Math.min(12, Math.floor((d as unknown as { clockHour12: number }).clockHour12))
                    )
                  : 12;
              const am =
                typeof (d as { clockAM?: unknown }).clockAM === 'boolean'
                  ? Boolean((d as unknown as { clockAM: boolean }).clockAM)
                  : true;
              return h12 === 12 ? (am ? 0 : 12) : am ? h12 : h12 + 12;
            })();
      setClockHour24(draftHour24);
      setClockMinute(d.clockMinute);
    }
    if (typeof p.offeredSeats === 'number' && !Number.isNaN(p.offeredSeats)) {
      setSeats(Math.max(1, Math.min(6, Math.floor(p.offeredSeats))));
    } else {
      setSeats(d.seats || 1);
    }
    setRate(typeof p.selectedRate === 'string' ? p.selectedRate : d.rate);
    setInstantBooking(d.instantBooking);
    setRideDescription(typeof d.rideDescription === 'string' ? d.rideDescription : '');
    schedulePublishDraftCleanup(publishRestoreKey);

    if (typeof p.selectedDurationSeconds === 'number' && !Number.isNaN(p.selectedDurationSeconds)) {
      setRouteDurationSeconds(Math.max(0, Math.floor(p.selectedDurationSeconds)));
    }
    if (routeParamsIncludePolylineField(p as Record<string, unknown>)) {
      const poly = pickRoutePolylineEncodedFromRecord(p as Record<string, unknown>);
      setRoutePolylineEncoded(poly ?? null);
    }
    if (
      typeof p.selectedDistanceKm === 'number' &&
      !Number.isNaN(p.selectedDistanceKm) &&
      typeof plat === 'number' &&
      typeof plon === 'number' &&
      typeof dlat === 'number' &&
      typeof dlon === 'number'
    ) {
      const pk = publishStopsCoordKey(plat, plon, dlat, dlon);
      setSelectedRouteDistanceKm(Math.max(1, p.selectedDistanceKm));
      lastRouteFareCoordsKeyRef.current = pk;
    }
    // Don't call setParams(all undefined) — RN dispatches SET_PARAMS with {} and no navigator handles it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft restore + price return; route.params ensures merge payloads apply
  }, [publishRestoreKey, navigation, prDurSec, prDistKm, route.params]);

  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const goSearch = () => {
        const token = Date.now();
        const nestedNav = {
          name: 'SearchStack' as const,
          params: {
            screen: 'SearchRides' as const,
            params: { _tabResetToken: token },
          },
          merge: false as const,
        };
        const parentNav = navigation.getParent() as { navigate?: (c: typeof nestedNav) => void } | undefined;
        if (parentNav?.navigate) {
          parentNav.navigate(nestedNav);
          return;
        }
        const mainTabs = findMainTabNavigator(navigation);
        if (mainTabs?.dispatch) {
          mainTabs.dispatch(
            CommonActions.navigate({
              name: 'SearchStack',
              params: {
                screen: 'SearchRides',
                params: { _tabResetToken: token },
              },
            } as never)
          );
        }
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goSearch();
        return true;
      });
      return () => sub.remove();
    }, [navigation])
  );

  useFocusEffect(
    React.useCallback(() => {
      const p = route.params as {
        selectedFrom?: string;
        selectedTo?: string;
        pickupLatitude?: number;
        pickupLongitude?: number;
        destinationLatitude?: number;
        destinationLongitude?: number;
        selectedDateIso?: string;
        selectedTimeHour?: number;
        selectedTimeMinute?: number;
        selectedRate?: string;
        selectedDurationSeconds?: number;
        selectedDistanceKm?: number;
        routePolylineEncoded?: string;
        clearRouteFare?: boolean;
        _publishRestoreKey?: string;
        offeredSeats?: number;
      } | undefined;
      if (!p) return;
      if (p.selectedFrom !== undefined) setPickup(p.selectedFrom ?? '');
      if (p.selectedTo !== undefined) setDestination(p.selectedTo ?? '');
      if (p.pickupLatitude !== undefined) setPickupLatitude(p.pickupLatitude);
      if (p.pickupLongitude !== undefined) setPickupLongitude(p.pickupLongitude);
      if (p.destinationLatitude !== undefined) setDestinationLatitude(p.destinationLatitude);
      if (p.destinationLongitude !== undefined) setDestinationLongitude(p.destinationLongitude);
      if (p.selectedDateIso) {
        const d = new Date(p.selectedDateIso);
        if (!Number.isNaN(d.getTime())) {
          setSelectedDate(d);
          setDateLabel(formatPublishStyleDateLabel(d));
        }
      }
      if (
        typeof p.selectedTimeHour === 'number' &&
        typeof p.selectedTimeMinute === 'number' &&
        !Number.isNaN(p.selectedTimeHour) &&
        !Number.isNaN(p.selectedTimeMinute)
      ) {
        const h = Math.max(0, Math.min(23, Math.floor(p.selectedTimeHour)));
        const m = Math.max(0, Math.min(59, Math.floor(p.selectedTimeMinute)));
        setSelectedTime({ hour: h, minute: m });
        setTimeLabel(formatTimeLabel(h, m));
        setClockHour24(h);
        setClockMinute(Math.round(m / 5) * 5 % 60);
      }
      if (p.selectedRate !== undefined) setRate(String(p.selectedRate));
      if (typeof p.offeredSeats === 'number' && !Number.isNaN(p.offeredSeats)) {
        setSeats(Math.max(1, Math.min(6, Math.floor(p.offeredSeats))));
      }
      if (p.clearRouteFare) {
        setSelectedRouteDistanceKm(null);
        setRouteDurationSeconds(0);
        setRoutePolylineEncoded(null);
        lastRouteFareCoordsKeyRef.current = null;
      } else {
        if (p.selectedDurationSeconds !== undefined && typeof p.selectedDurationSeconds === 'number') {
          setRouteDurationSeconds(Math.max(0, Math.floor(p.selectedDurationSeconds)));
        }
        if (
          p.selectedDistanceKm !== undefined &&
          typeof p.selectedDistanceKm === 'number' &&
          typeof p.pickupLatitude === 'number' &&
          typeof p.pickupLongitude === 'number' &&
          typeof p.destinationLatitude === 'number' &&
          typeof p.destinationLongitude === 'number'
        ) {
          const pk = publishStopsCoordKey(
            p.pickupLatitude,
            p.pickupLongitude,
            p.destinationLatitude,
            p.destinationLongitude
          );
          setSelectedRouteDistanceKm(Math.max(1, p.selectedDistanceKm));
          lastRouteFareCoordsKeyRef.current = pk;
        }
        if (routeParamsIncludePolylineField(p as Record<string, unknown>)) {
          const poly = pickRoutePolylineEncodedFromRecord(p as Record<string, unknown>);
          setRoutePolylineEncoded(poly ?? null);
        }
      }
      // Only react to navigation param updates — local swap uses `useEffect` below to clear stale route fare.
    }, [route.params])
  );

  /** Drop stored route km/duration if user swaps points or edits coords without a new Directions result. */
  useEffect(() => {
    const pk = publishStopsCoordKey(
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude
    );
    const refPk = lastRouteFareCoordsKeyRef.current;
    if (refPk !== null && refPk !== pk) {
      setSelectedRouteDistanceKm(null);
      setRouteDurationSeconds(0);
      setRoutePolylineEncoded(null);
      lastRouteFareCoordsKeyRef.current = null;
    }
  }, [pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]);

  const openLocationPicker = (field: 'from' | 'to') => {
    if (offline) {
      showOfflineHint();
      return;
    }
    const publishRestoreKey = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    stashPublishRideDraft(publishRestoreKey, {
      pickup,
      destination,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      selectedDateIso: selectedDate.toISOString(),
      dateLabel,
      selectedTime,
      timeLabel,
      seats,
      rate,
      instantBooking,
      rideDescription,
      ladiesOnly: false,
      calendarMonthIso: calendarMonth.toISOString(),
      clockHour24,
      clockMinute,
    });
    navigation.navigate('LocationPicker', {
      field,
      currentFrom: pickup,
      currentTo: destination,
      currentPickupLatitude: pickupLatitude,
      currentPickupLongitude: pickupLongitude,
      currentDestinationLatitude: destinationLatitude,
      currentDestinationLongitude: destinationLongitude,
      returnScreen: 'PublishRide',
      publishRestoreKey,
    });
  };

  const resetFormToDefault = useCallback(() => {
    setPickup('');
    setDestination('');
    setPickupLatitude(0);
    setPickupLongitude(0);
    setDestinationLatitude(0);
    setDestinationLongitude(0);
    const today = new Date();
    setSelectedDate(today);
    setDateLabel(formatPublishStyleDateLabel(today));
    const defaultTime = getDefaultTimeOneHourAhead();
    setSelectedTime(defaultTime);
    setTimeLabel(formatTimeLabel(defaultTime.hour, defaultTime.minute));
    setSeats(1);
    setRate('');
    setInstantBooking(false);
    setRideDescription('');
    setCalendarMonth(today);
    setClockHour24(defaultTime.hour);
    setClockMinute(Math.round(defaultTime.minute / 5) * 5 % 60);
    setRouteDurationSeconds(0);
    setSelectedRouteDistanceKm(null);
    setRoutePolylineEncoded(null);
    lastRouteFareCoordsKeyRef.current = null;
  }, []);

  useEffect(() => {
    const p = route.params as Record<string, unknown> | undefined;
    if (p == null) return;
    const token = p._publishTabResetToken;
    if (typeof token !== 'number' || Number.isNaN(token)) return;
    if (token === publishTabResetHandledRef.current) return;

    /**
     * Tab bar sends `_publishTabResetToken` alone to clear the form. After Set price, navigators sometimes
     * merge that token with the return payload — running `resetFormToDefault` here would wipe the restored
     * pickup, fare, etc. Only clear when params look like a deliberate tab reset, not a price/route return.
     */
    const hasPublishFlowPayload =
      typeof p._publishRestoreKey === 'string' ||
      (typeof p.selectedRate === 'string' && String(p.selectedRate).trim() !== '') ||
      (typeof p.selectedFrom === 'string' && String(p.selectedFrom).trim() !== '') ||
      (typeof p.selectedDistanceKm === 'number' && !Number.isNaN(p.selectedDistanceKm));

    publishTabResetHandledRef.current = token;
    if (hasPublishFlowPayload) return;

    resetFormToDefault();
  }, [route.params, resetFormToDefault]);

  const onRemovePublishedRecent = useCallback(
    async (id: string) => {
      await removeRecentPublished(id, recentUserKey);
      setPublishedRecents(await loadRecentPublished(recentUserKey));
    },
    [recentUserKey]
  );

  const onClearPublishedRecents = useCallback(async () => {
    await clearRecentPublished(recentUserKey);
    setPublishedRecents([]);
  }, [recentUserKey]);

  const proceedPublish = useCallback(
    async (vehicleExtra?: VehicleFormValues, rideOpts?: { vehicleId?: string }) => {
      if (publishLoading) return;
      if (netOnline === false) {
        showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
        return;
      }
      const fromList =
        mergedVehicles.find((x) => x.id === selectedVehicleId) ?? mergedVehicles[0];
      const resolved: VehicleFormValues | undefined = vehicleExtra
        ? vehicleExtra
        : fromList
          ? {
              vehicleModel: fromList.vehicleModel,
              licensePlate: fromList.licensePlate,
              vehicleColor: fromList.vehicleColor ?? '',
            }
          : undefined;
      const vm = (resolved?.vehicleModel ?? user?.vehicleModel ?? user?.vehicleName ?? '').trim();
      const lp = (resolved?.licensePlate ?? user?.licensePlate ?? '').trim();
      if (!vm || !lp) {
        Alert.alert('Vehicle required', 'Add your vehicle name and license plate to your profile to publish rides.');
        return;
      }
      if (!validation.rideDescription(rideDescription)) {
        Alert.alert('Ride description', validationErrors.rideDescription);
        return;
      }
      const parsedFare = parseInt(rate.trim(), 10);
      if (Number.isNaN(parsedFare) || parsedFare <= 0) {
        alertFareRequiredBeforePublish();
        return;
      }
      const rpKm = route.params as { selectedDistanceKm?: number } | undefined;
      const rawKm = rpKm?.selectedDistanceKm;
      const paramKmPub =
        typeof rawKm === 'number' && !Number.isNaN(rawKm) ? rawKm : undefined;
      const storedKmPub =
        selectedRouteDistanceKm ??
        (typeof paramKmPub === 'number' && paramKmPub > 0 ? paramKmPub : undefined);
      const distKmPub = effectivePublishDistanceKm({
        selectedDistanceKm: storedKmPub,
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude,
        preferStoredRouteDistance: storedKmPub != null,
      });
      const { minAllowed: minFareAllowed, maxAllowed: maxFareAllowed } = allowedPublishFareRange(distKmPub);
      if (parsedFare < minFareAllowed || parsedFare > maxFareAllowed) {
        alertFareOutsideAllowedRange(minFareAllowed, maxFareAllowed);
        return;
      }
      const vc = (resolved?.vehicleColor ?? user?.vehicleColor ?? '').trim();
      const stableVehicleId =
        rideOpts?.vehicleId ??
        (fromList && fromList.id !== 'legacy-profile' ? fromList.id : undefined);
      setPublishLoading(true);
      try {
        const scheduledAt = new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          selectedTime.hour,
          selectedTime.minute,
          0,
          0
        ).toISOString();
        const username = (user?.name?.trim() || user?.phone || '').trim() || 'User';
        const descriptionTrimmed = rideDescription.trim();
        const pr = (route.params || {}) as Record<string, unknown>;
        const encodedFromNav = pickRoutePolylineEncodedFromRecord(pr);
        const encodedForPost =
          normalizeEncodedPolyline(typeof routePolylineEncoded === 'string' ? routePolylineEncoded : undefined) ??
          encodedFromNav;
        const polyPayload = await buildRidePolylinePersistPayload({
          existingEncoded: encodedForPost ?? null,
          pickupLocationName: pickup.trim(),
          destinationLocationName: destination.trim(),
          pickupLatitude,
          pickupLongitude,
          destinationLatitude,
          destinationLongitude,
        });
        const body: CreateRidePayload = {
          pickupLocationName: pickup.trim(),
          pickupLatitude: pickupLatitude,
          pickupLongitude: pickupLongitude,
          destinationLocationName: destination.trim(),
          destinationLatitude: destinationLatitude,
          destinationLongitude: destinationLongitude,
          scheduledAt,
          seats,
          username,
          price: rate.trim(),
          bookingMode: instantBooking ? 'instant' : 'request',
          instantBooking,
          vehicleModel: vm,
          licensePlate: lp,
          ...(vc ? { vehicleColor: vc } : {}),
          ...(stableVehicleId ? { vehicleId: stableVehicleId } : {}),
          ...(routeDurationSeconds > 0 ? { estimatedDurationSeconds: routeDurationSeconds } : {}),
          ...polyPayload,
          ...(descriptionTrimmed
            ? {
                description: descriptionTrimmed,
                rideDescription: descriptionTrimmed,
                ride_description: descriptionTrimmed,
              }
            : {}),
        };
        if (__DEV__) {
          console.log('[PublishRide] username:', username);
          console.log('[PublishRide] POST /api/rides body:', JSON.stringify(body, null, 2));
        }
        const createdRideRes = await api.post<unknown>(API.endpoints.rides.create, body);
        const createdRideId = (() => {
          if (!createdRideRes || typeof createdRideRes !== 'object') return '';
          const payload = createdRideRes as Record<string, unknown>;
          const nestedRide =
            payload.ride && typeof payload.ride === 'object'
              ? (payload.ride as Record<string, unknown>)
              : undefined;
          return String(payload.id ?? payload._id ?? payload.rideId ?? nestedRide?.id ?? nestedRide?._id ?? '').trim();
        })();
        const viewerId = (user?.id ?? '').trim();
        if (createdRideId && viewerId) {
          void fetchRideDetailRaw(createdRideId, { force: true, viewerUserId: viewerId })
            .then((raw) => {
              const item = rideListItemFromDetailApiPayload(raw);
              if (item?.id) emitRideListMergeFromDetail(item, { insertIfMissing: true });
            })
            .catch(() => {});
        }
        const y = selectedDate.getFullYear();
        const mo = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const da = String(selectedDate.getDate()).padStart(2, '0');
        const dateYmd = `${y}-${mo}-${da}`;
        void addRecentPublished(
          {
            pickup: pickup.trim(),
            destination: destination.trim(),
            pickupLatitude,
            pickupLongitude,
            destinationLatitude,
            destinationLongitude,
            dateYmd,
            hour: selectedTime.hour,
            minute: selectedTime.minute,
            seats,
            rate: rate.trim(),
            rideDescription: descriptionTrimmed,
            instantBooking,
            rideId: createdRideId || undefined,
          },
          recentUserKey
        ).then(setPublishedRecents);
        resetFormToDefault();
        const tabNav = navigation.getParent();
        if (tabNav) (tabNav as any).navigate('YourRides');
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Failed to publish ride.';
        alertPublishFailed(message);
      } finally {
        setPublishLoading(false);
      }
    },
    [
      resetFormToDefault,
      publishLoading,
      pickup,
      destination,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      selectedDate,
      selectedTime,
      seats,
      rate,
      instantBooking,
      user?.id,
      user?.name,
      user?.phone,
      user?.vehicleModel,
      user?.vehicleName,
      user?.licensePlate,
      user?.vehicleColor,
      navigation,
      routeDurationSeconds,
      routePolylineEncoded,
      recentUserKey,
      mergedVehicles,
      selectedVehicleId,
      rideDescription,
      route.params,
      selectedRouteDistanceKm,
      netOnline,
    ]
  );

  const handleAddVehicleAndPublish = useCallback(
    async (v: VehicleFormValues) => {
      setAddVehicleBusy(true);
      try {
        const created = await createUserVehicle({
          vehicleModel: v.vehicleModel,
          licensePlate: v.licensePlate,
          vehicleColor: v.vehicleColor || undefined,
        });
        const list = await syncVehiclesFromApi();
        const plateNorm = v.licensePlate.replace(/\s+/g, '').toUpperCase();
        const pickId =
          created?.id ??
          list.find((x) => x.licensePlate.replace(/\s+/g, '').toUpperCase() === plateNorm)?.id;
        if (pickId) setSelectedVehicleId(pickId);
        setAddVehicleOpen(false);
        await proceedPublish(v, { vehicleId: pickId });
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Could not save vehicle to your profile.';
        Alert.alert('Error', message);
      } finally {
        setAddVehicleBusy(false);
      }
    },
    [syncVehiclesFromApi, proceedPublish]
  );

  const handleSaveNewVehicle = useCallback(
    async (v: VehicleFormValues) => {
      setAddVehicleBusy(true);
      try {
        const created = await createUserVehicle({
          vehicleModel: v.vehicleModel,
          licensePlate: v.licensePlate,
          vehicleColor: v.vehicleColor || undefined,
        });
        const list = await syncVehiclesFromApi();
        const plateNorm = v.licensePlate.replace(/\s+/g, '').toUpperCase();
        const pickId =
          created?.id ??
          list.find((x) => x.licensePlate.replace(/\s+/g, '').toUpperCase() === plateNorm)?.id;
        if (pickId) setSelectedVehicleId(pickId);
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Could not save vehicle to your profile.';
        Alert.alert('Error', message);
      } finally {
        setAddVehicleBusy(false);
      }
    },
    [syncVehiclesFromApi]
  );

  const handleConfirmVehicleSelection = useCallback(() => {
    setAddVehicleOpen(false);
    void proceedPublish();
  }, [proceedPublish]);

  const handlePublish = useCallback(async () => {
    if (publishLoading) return;
    if (offline) {
      showOfflineHint();
      return;
    }
    if (isTimeInPast || isTimeTooSoon) {
      alertDepartureTimeInPast();
      return;
    }
    if (!pickup.trim() || !destination.trim()) {
      alertMissingPickupDestination();
      return;
    }
    if (
      isSamePickupAndDestination({
        pickup,
        destination,
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude,
      })
    ) {
      Alert.alert(
        'Invalid route',
        'Pickup and destination cannot be the same. Choose a different destination.'
      );
      return;
    }
    const validLat = (v: number) => typeof v === 'number' && !Number.isNaN(v) && v >= -90 && v <= 90;
    const validLon = (v: number) => typeof v === 'number' && !Number.isNaN(v) && v >= -180 && v <= 180;
    const pickupSet =
      (pickupLatitude !== 0 || pickupLongitude !== 0) && validLat(pickupLatitude) && validLon(pickupLongitude);
    const destinationSet =
      (destinationLatitude !== 0 || destinationLongitude !== 0) &&
      validLat(destinationLatitude) &&
      validLon(destinationLongitude);
    if (!pickupSet || !destinationSet) {
      alertNeedMapLocations();
      return;
    }
    if (!rate.trim()) {
      alertFareRequiredBeforePublish();
      return;
    }
    setAddVehicleOpen(true);
  }, [
    publishLoading,
    isTimeInPast,
    isTimeTooSoon,
    pickup,
    destination,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    rate,
    offline,
    showOfflineHint,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <ScrollView
            ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: publishScrollBottomPad }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
        <Text style={styles.publishHeading}>Publish a ride</Text>
        <Text style={styles.publishSubheading}>
          Set route, schedule, and fare. Passengers can request seats once the ride is live.
        </Text>
        {offline ? (
          <View style={styles.publishOfflineBanner} accessibilityRole="alert">
            <Ionicons name="cloud-offline-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.publishOfflineBannerText}>{OFFLINE_HEADLINE}</Text>
          </View>
        ) : null}

        <View style={styles.singleCard}>
          <Text style={[styles.cardSectionLabel, styles.cardSectionLabelFirst]}>Route</Text>
          <TouchableOpacity
            style={[styles.fieldRow, offline && styles.fieldRowOfflineMuted]}
            onPress={() => openLocationPicker('from')}
            activeOpacity={0.75}
          >
            <View style={styles.fieldLeft}>
              <View style={styles.greenDot} />
              <View style={styles.dottedLine} />
            </View>
            <View style={styles.fieldInputWrap}>
              <Text
                style={[styles.fieldValue, !pickup.trim() && styles.fieldValuePlaceholder]}
                numberOfLines={1}
              >
                {pickup.trim() ? pickup : 'Select pickup location'}
              </Text>
              <Text style={[styles.fieldLabel, styles.pickupLabel]}>Pickup</Text>
            </View>
            <TouchableOpacity
              style={styles.swapBtn}
              onPress={() => {
                if (offline) {
                  showOfflineHint();
                  return;
                }
                const p = pickup;
                const d = destination;
                const pLat = pickupLatitude;
                const pLon = pickupLongitude;
                const dLat = destinationLatitude;
                const dLon = destinationLongitude;
                setPickup(d);
                setDestination(p);
                setPickupLatitude(dLat);
                setPickupLongitude(dLon);
                setDestinationLatitude(pLat);
                setDestinationLongitude(pLon);
              }}
            >
              <Ionicons name="swap-vertical" size={21} color={COLORS.primary} />
            </TouchableOpacity>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.fieldRow, offline && styles.fieldRowOfflineMuted]}
            onPress={() => openLocationPicker('to')}
            activeOpacity={0.75}
          >
            <View style={styles.fieldLeft}><View style={styles.redPin} /></View>
            <View style={styles.fieldInputWrap}>
              <Text
                style={[styles.fieldValue, !destination.trim() && styles.fieldValuePlaceholder]}
                numberOfLines={1}
              >
                {destination.trim() ? destination : 'Select destination'}
              </Text>
              <Text style={[styles.fieldLabel, styles.destinationLabel]}>Destination</Text>
            </View>
            <Ionicons name="chevron-forward" size={21} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity style={styles.fieldRow} onPress={() => { setCalendarMonth(selectedDate); setShowDateModal(true); }} activeOpacity={0.75}>
            <View style={styles.fieldLeft}><Ionicons name="calendar-outline" size={23} color={COLORS.textSecondary} /></View>
            <View style={styles.fieldInputWrap}>
              <Text style={styles.fieldValue}>{dateLabel}</Text>
              <Text style={styles.fieldLabel}>Date</Text>
            </View>
            <Ionicons name="chevron-forward" size={21} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity style={styles.fieldRow} onPress={openTimeModal} activeOpacity={0.75}>
            <View style={styles.fieldLeft}>
              <View style={styles.timeIconCircle}>
                <Ionicons name="time-outline" size={21} color="#6366f1" />
              </View>
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={[styles.fieldValue, styles.timeValue]}>{timeLabel}</Text>
              <Text style={styles.fieldLabel}>Time</Text>
            </View>
            <Ionicons name="chevron-forward" size={21} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <Text style={styles.cardSectionLabel}>Pricing</Text>
          <TouchableOpacity
            style={[styles.fieldRow, !canSetFare && styles.fieldRowDisabled]}
            onPress={() => {
              if (offline) {
                showOfflineHint();
                return;
              }
              if (!canSetFare) {
                alertRouteRequiredBeforePrice();
                return;
              }
              setShowFareBottomSheet(true);
            }}
            activeOpacity={canSetFare ? 0.75 : 1}
          >
            <View style={styles.fieldLeft}>
              <View style={styles.fareIconCircle}>
                <Ionicons name="wallet-outline" size={21} color="#6366f1" />
              </View>
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={[styles.fieldValue, styles.fareValue]}>{estimatedFareLabel}</Text>
              <Text style={styles.fieldLabel}>Fare per seat</Text>
            </View>
            {canSetFare ? (
              <Ionicons name="chevron-forward" size={21} color={COLORS.textMuted} />
            ) : (
              <Ionicons name="lock-closed-outline" size={19} color={COLORS.textMuted} />
            )}
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <Text style={styles.cardSectionLabel}>Seats</Text>
          <TouchableOpacity style={styles.fieldRow} onPress={() => setShowPassengersModal(true)} activeOpacity={0.75}>
            <View style={styles.fieldLeft}><Ionicons name="people-outline" size={23} color="#6b7280" /></View>
            <View style={styles.fieldInputWrap}>
              <Text style={styles.fieldValue}>{seats} seat{seats !== 1 ? 's' : ''} offered</Text>
              <Text style={styles.fieldLabel}>Passengers</Text>
            </View>
            <Ionicons name="chevron-forward" size={21} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.cardSectionLabel, styles.instantBookingSectionLabel]}>Booking</Text>
          <View style={[styles.instantBookingRow, instantBooking && styles.instantBookingRowOn]}>
            <View
              style={[
                styles.instantBookingIconWrap,
                instantBooking && styles.instantBookingIconWrapOn,
              ]}
            >
              <Ionicons
                name="flash"
                size={18}
                color={instantBooking ? COLORS.primary : COLORS.textMuted}
              />
            </View>
            <View style={styles.instantBookingBody}>
              <Text style={[styles.instantBookingTitle, instantBooking && styles.instantBookingTitleOn]}>
                Instant booking
              </Text>
              <Text style={[styles.instantBookingDesc, instantBooking && styles.instantBookingDescOn]}>
                Bookings are confirmed without you approving each one
              </Text>
            </View>
            <View style={styles.instantBookingSwitchWrap}>
              <Switch
                value={instantBooking}
                onValueChange={setInstantBooking}
                trackColor={{
                  false: '#d1d5db',
                  true: COLORS.primaryLight,
                }}
                thumbColor={instantBooking ? COLORS.primary : '#e5e7eb'}
              />
            </View>
          </View>
        </View>

        <View style={[styles.section, styles.sectionRideDetailsAfterBooking]}>
          <Text style={styles.cardSectionLabel}>Ride details</Text>
          <Text style={styles.rideDescriptionHint}>Optional. Add any details passengers should know before booking.</Text>
          <View style={styles.rideDescriptionCard}>
            <TextInput
              value={rideDescription}
              onChangeText={setRideDescription}
              style={styles.rideDescriptionInput}
              placeholder="E.g. luggage space, exact pickup point, route notes, or preferences."
              placeholderTextColor={COLORS.textMuted}
              multiline
              textAlignVertical="top"
              maxLength={500}
            />
            <Text style={styles.rideDescriptionCounter}>
              {rideDescription.length}/500
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.publishButton, publishLoading && styles.publishButtonDisabled]}
          onPress={handlePublish}
          activeOpacity={0.85}
          disabled={publishLoading}
        >
          {publishLoading ? (
            <ActivityIndicator size="small" color={COLORS.text} style={styles.publishButtonSpinner} />
          ) : (
            <Text style={styles.publishButtonText}>Publish ride</Text>
          )}
          {!publishLoading && <Ionicons name="rocket-outline" size={22} color={COLORS.text} />}
        </TouchableOpacity>

        {sessionReady && publishedRecents.length > 0 ? (
          <View style={styles.pubRecentsSection}>
            <View style={styles.pubRecentsHeader}>
              <Text style={styles.pubRecentsTitle}>RECENT PUBLISHED</Text>
              <TouchableOpacity onPress={() => void onClearPublishedRecents()} hitSlop={8}>
                <Text style={styles.pubRecentsClearAll}>Clear all</Text>
              </TouchableOpacity>
            </View>
            {publishedRecents.map((item) => (
              <View key={item.id} style={styles.pubRecentItem}>
                <TouchableOpacity
                  style={styles.pubRecentItemMain}
                  onPress={() => navigation.navigate('PublishRecentEdit', { entry: item })}
                  activeOpacity={0.72}
                >
                  <View style={styles.pubRecentIconCircle}>
                    <Ionicons name="rocket-outline" size={14} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.pubRecentTextCol}>
                    <View style={styles.pubRecentRouteStack}>
                      <View style={styles.pubRecentRouteLineRow}>
                        <View style={styles.pubRecentLineIcon}>
                          <Ionicons name="ellipse" size={6} color={COLORS.primary} />
                        </View>
                        <Text style={styles.pubRecentRouteTitle} numberOfLines={1} ellipsizeMode="tail">
                          {briefRouteListLabel(item.pickup)}
                        </Text>
                      </View>
                      <View style={[styles.pubRecentRouteLineRow, styles.pubRecentRouteLineRowSecond]}>
                        <View style={styles.pubRecentLineIcon}>
                          <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
                        </View>
                        <Text style={styles.pubRecentRouteSubtitle} numberOfLines={1} ellipsizeMode="tail">
                          {briefRouteListLabel(item.destination)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.pubRecentMeta} numberOfLines={2} ellipsizeMode="tail">
                      {formatPublishedMetaLine(item)}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pubRecentClose}
                  onPress={() => void onRemovePublishedRecent(item.id)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel="Remove from recent published"
                >
                  <Ionicons name="close" size={17} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showDateModal} transparent animationType="slide">
        <TouchableOpacity
          style={styles.dateModalOverlay}
          activeOpacity={1}
          onPress={() => setShowDateModal(false)}
        >
          <View style={styles.dateModalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.dateModalHeading}>When are you going? Select date.</Text>
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
                  selectedDate.getFullYear() === cellDate.getFullYear() &&
                  selectedDate.getMonth() === cellDate.getMonth() &&
                  selectedDate.getDate() === cellDate.getDate();
                const isToday = cellNorm.getTime() === today.getTime();
                const content = (
                  <View style={[
                    styles.calendarDayInner,
                    isSelected && styles.calendarDaySelected,
                    isToday && !isSelected && styles.calendarDayToday,
                    isPast && styles.calendarDayPast,
                  ]}>
                    <Text style={[
                      styles.calendarDayText,
                      isSelected && styles.calendarDayTextSelected,
                      isToday && !isSelected && styles.calendarDayTextToday,
                      isPast && styles.calendarDayTextPast,
                    ]}>{day}</Text>
                  </View>
                );
                if (isPast) {
                  return <View key={day} style={styles.calendarDay}>{content}</View>;
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
            <TouchableOpacity style={styles.dateModalClose} onPress={() => setShowDateModal(false)}>
              <Text style={styles.dateModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showTimeModal} transparent animationType="fade" onRequestClose={cancelTimeModal}>
        <View style={styles.timeModalOverlay}>
          {timeModalToast ? (
            <View style={styles.timeModalToastWrap} pointerEvents="none">
              <Text style={styles.timeModalToastText}>{timeModalToast}</Text>
            </View>
          ) : null}
          <View style={styles.timeModalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.dateModalHeading}>Select time</Text>
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
                {clockMode === 'minute' && MINUTE_OPTIONS.map((min, idx) => {
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
            <Text style={styles.clockHint}>
              {clockMode === 'hour'
                ? 'Tap clock to pick hour'
                : 'Tap clock to pick minutes (0–55 in 5 min steps)'}
            </Text>
            <View style={styles.timeModalActionsRow}>
              <TouchableOpacity style={styles.timeModalCancelBtn} onPress={cancelTimeModal} activeOpacity={0.85}>
                <Text style={styles.timeModalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.timeModalDoneBtn} onPress={confirmTimeModal} activeOpacity={0.85}>
                <Text style={styles.timeModalDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <PassengersPickerModal
        visible={showPassengersModal}
        onClose={() => setShowPassengersModal(false)}
        value={seats}
        onDone={(n) => setSeats(Math.max(1, Math.min(MAX_PASSENGERS, n)))}
      />

      <SelectVehicleBottomSheet
        visible={addVehicleOpen}
        onClose={() => {
          if (!addVehicleBusy && !publishLoading) setAddVehicleOpen(false);
        }}
        vehicles={mergedVehicles}
        selectedVehicleId={selectedVehicleId}
        onSelectedVehicleIdChange={setSelectedVehicleId}
        onAddAndPublish={handleAddVehicleAndPublish}
        onSaveNewVehicle={handleSaveNewVehicle}
        onConfirmSelection={handleConfirmVehicleSelection}
        busy={addVehicleBusy || publishLoading}
      />

      <PublishFareBottomSheet
        visible={showFareBottomSheet}
        onClose={() => setShowFareBottomSheet(false)}
        distanceKm={fareSheetDistanceKm}
        initialAmount={fareSheetInitialAmount}
        onConfirm={(amount) => {
          setRate(String(amount));
          setShowFareBottomSheet(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  publishHeading: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  publishSubheading: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textSecondary,
    marginBottom: 19,
    maxWidth: 340,
  },
  cardSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    marginTop: 11,
    marginBottom: 4,
    marginLeft: 2,
  },
  cardSectionLabelFirst: {
    marginTop: 0,
  },
  section: {
    marginTop: 21,
  },
  /** Space between Instant booking and Ride details. */
  sectionRideDetailsAfterBooking: {
    marginTop: 12,
  },
  rideDescriptionHint: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginLeft: 2,
  },
  rideDescriptionCard: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  rideDescriptionInput: {
    minHeight: 100,
    fontSize: 16,
    lineHeight: 22,
    color: COLORS.text,
    paddingVertical: 4,
  },
  rideDescriptionCounter: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  singleCard: {
    marginTop: 0,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 13,
    paddingVertical: 11,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLine: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
    marginRight: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 9,
  },
  fieldRowDisabled: {
    opacity: 0.55,
  },
  fieldLeft: {
    width: 30,
    alignItems: 'center',
  },
  greenDot: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
  },
  dottedLine: {
    width: 2,
    flex: 1,
    minHeight: 12,
    marginVertical: 2,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    borderStyle: 'dashed',
  },
  redPin: {
    width: 11,
    height: 15,
    backgroundColor: COLORS.error,
    borderRadius: 5.5,
  },
  fieldInputWrap: { flex: 1, marginLeft: 12 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.15,
    marginBottom: 3,
  },
  pickupLabel: {
    color: '#16a34a',
  },
  destinationLabel: {
    color: '#ef4444',
  },
  fieldValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '700',
  },
  fieldValuePlaceholder: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  timeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fareIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeValue: {
    color: '#6366f1',
  },
  fareValue: {
    color: '#6366f1',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb',
    marginLeft: 44,
    marginVertical: 0,
  },
  swapBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(41,190,139,0.12)',
  },
  rowCards: {
    flexDirection: 'row',
    gap: 12,
  },
  smallCard: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
  },
  smallCardLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 8,
    marginBottom: 2,
  },
  smallCardValue: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  smallCardTimePast: {
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  smallCardValuePast: {
    color: COLORS.error,
  },
  timePastHint: {
    fontSize: 10,
    color: COLORS.error,
    marginTop: 4,
    fontWeight: '500',
  },
  seatsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  seatsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  seatsLabel: {
    fontSize: 10,
    color: COLORS.primaryLight,
    letterSpacing: 0.5,
  },
  seatsValue: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.white,
  },
  seatsCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  counterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnDisabled: {
    opacity: 0.5,
  },
  counterBtnText: {
    fontSize: 20,
    color: COLORS.white,
    fontWeight: '600',
  },
  counterValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
    minWidth: 24,
    textAlign: 'center',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  rateCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
  },
  rateDollar: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.primary,
    marginRight: 4,
  },
  rateInputWrap: { flex: 1 },
  rateLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  rateInput: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    padding: 0,
  },
  recommended: {
    flex: 1,
  },
  recommendedLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  recommendedText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  recommendedHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  instantBookingSectionLabel: {
    marginBottom: 2,
  },
  instantBookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f4f4f5',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderLeftWidth: 3,
    borderLeftColor: '#d4d4d8',
  },
  instantBookingRowOn: {
    backgroundColor: 'rgba(41, 190, 139, 0.14)',
    borderColor: 'rgba(41, 190, 139, 0.38)',
    borderLeftColor: COLORS.primary,
  },
  instantBookingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e4e4e7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instantBookingIconWrapOn: {
    backgroundColor: 'rgba(41, 190, 139, 0.22)',
  },
  instantBookingBody: {
    flex: 1,
    minWidth: 0,
  },
  instantBookingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3f3f46',
    letterSpacing: -0.2,
  },
  instantBookingTitleOn: {
    color: COLORS.text,
  },
  instantBookingDesc: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 3,
  },
  instantBookingDescOn: {
    fontWeight: '600',
    color: '#3f7668',
  },
  instantBookingSwitchWrap: {
    flexShrink: 0,
    justifyContent: 'center',
    transform: [{ scale: 0.92 }],
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 17,
    borderRadius: 14,
    marginTop: 28,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
    }),
  },
  publishButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  publishButtonSpinner: {
    marginRight: 4,
  },
  publishButtonDisabled: {
    backgroundColor: COLORS.border,
    opacity: 0.9,
  },
  publishButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  pubRecentsSection: {
    marginTop: 28,
    paddingBottom: 8,
  },
  pubRecentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pubRecentsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
  },
  pubRecentsClearAll: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  pubRecentItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    marginBottom: 9,
    overflow: 'hidden',
  },
  pubRecentItemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 5,
    minHeight: 48,
  },
  pubRecentIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  pubRecentTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  pubRecentRouteStack: {
    marginBottom: 2,
  },
  pubRecentRouteLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 20,
  },
  pubRecentRouteLineRowSecond: {
    marginTop: 4,
  },
  pubRecentLineIcon: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pubRecentRouteTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  pubRecentRouteSubtitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    letterSpacing: -0.1,
  },
  pubRecentMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 5,
    lineHeight: 16,
  },
  pubRecentClose: {
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  footer: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
  footerLink: {
    color: COLORS.info,
    textDecorationLine: 'underline',
  },
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
  timeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeModalToastWrap: {
    position: 'absolute',
    top: 88,
    left: 20,
    right: 20,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  timeModalToastText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  timeModalContent: {
    width: 340,
    maxWidth: '90%',
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeModalActionsRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 20,
    gap: 12,
  },
  timeModalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
  },
  timeModalCancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  timeModalDoneBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  timeModalDoneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  clockTimeSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  clockTimeBox: {
    minWidth: 96,
    height: 68,
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
    fontSize: 44,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 48,
  },
  clockTimeBoxTextActive: {
    color: COLORS.primary,
  },
  clockTimeColon: {
    fontSize: 44,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 48,
    marginHorizontal: 2,
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
  clockMinuteDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    opacity: 0.6,
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
    marginTop: 6,
    marginBottom: 4,
  },
  timeHourMinuteRow: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 8,
    gap: 24,
    alignItems: 'stretch',
  },
  timeStepperBlock: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  timeStepperLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  timeStepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  timeStepperBtn: {
    padding: 6,
  },
  timeStepperValue: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    minWidth: 32,
    textAlign: 'center',
  },
  publishOfflineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginBottom: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  publishOfflineBannerText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  fieldRowOfflineMuted: {
    opacity: 0.55,
  },
});
