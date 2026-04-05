import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { API } from '../../constants/API';
import type { CreateRidePayload } from '../../types/api';
import DatePickerModal from '../../components/common/DatePickerModal';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import SelectVehicleBottomSheet, {
  type VehicleFormValues,
} from '../../components/publish/SelectVehicleBottomSheet';
import { vehicleListToAuthPatch, vehiclesFromUser } from '../../utils/userVehicle';
import { createUserVehicle, listUserVehicles } from '../../services/userVehicles';
import {
  addRecentPublished,
  loadRecentPublished,
  type RecentPublishedEntry,
} from '../../services/recent-published-storage';
import {
  alertDepartureTimeInPast,
  alertFareRequiredBeforePublish,
  alertMissingPickupDestination,
  alertNeedMapLocations,
  alertPublishFailed,
  alertRouteRequiredBeforePrice,
} from '../../utils/publishAlerts';
import {
  effectivePublishDistanceKm,
  isPublishStopsComplete,
  publishStopsCoordKey,
  recommendedFareRange,
  straightLineKmBetweenStops,
} from '../../utils/publishFare';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';

const MIN_LEAD_MINUTES = 30;
const CLOCK_SIZE = 232;
const CLOCK_CENTER = CLOCK_SIZE / 2;
const HOUR_OUTER_RADIUS = 90;
const HOUR_INNER_RADIUS = 60;
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

type Props = NativeStackScreenProps<PublishStackParamList, 'PublishRecentEdit'>;

function formatTimeLabel(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
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

function stateFromEntry(e: RecentPublishedEntry) {
  const [y, mo, da] = e.dateYmd.split('-').map(Number);
  const today = new Date();
  const today_y = today.getFullYear();
  const today_m = today.getMonth() + 1;
  const today_d = today.getDate();
  /** If entry date is in the past, use today instead. */
  let nextDate = new Date(y, (mo || 1) - 1, da || 1);
  if (y < today_y || (y === today_y && mo < today_m) || (y === today_y && mo === today_m && da < today_d)) {
    nextDate = new Date(today_y, today_m - 1, today_d);
  }
  return {
    pickup: e.pickup,
    destination: e.destination,
    pickupLatitude: e.pickupLatitude,
    pickupLongitude: e.pickupLongitude,
    destinationLatitude: e.destinationLatitude,
    destinationLongitude: e.destinationLongitude,
    selectedDate: nextDate,
    selectedTime: { hour: e.hour, minute: e.minute },
    timeLabel: formatTimeLabel(e.hour, e.minute),
    seats: e.seats,
    rate: e.rate,
    instantBooking: e.instantBooking,
  };
}

export default function PublishRecentEditScreen({ navigation }: Props): React.JSX.Element {
  const route = useRoute<Props['route']>();
  const { user, patchUser, refreshUser, isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const recentUserKey = useMemo(() => (user?.id ?? user?.phone ?? '').trim(), [user?.id, user?.phone]);

  const baseEntry = route.params?.entry;
  const initial = useMemo(() => (baseEntry ? stateFromEntry(baseEntry) : null), [baseEntry]);

  const [pickup, setPickup] = useState(initial?.pickup ?? '');
  const [destination, setDestination] = useState(initial?.destination ?? '');
  const [pickupLatitude, setPickupLatitude] = useState(initial?.pickupLatitude ?? 0);
  const [pickupLongitude, setPickupLongitude] = useState(initial?.pickupLongitude ?? 0);
  const [destinationLatitude, setDestinationLatitude] = useState(initial?.destinationLatitude ?? 0);
  const [destinationLongitude, setDestinationLongitude] = useState(initial?.destinationLongitude ?? 0);
  const [selectedDate, setSelectedDate] = useState(() => initial?.selectedDate ?? new Date());
  const [selectedTime, setSelectedTime] = useState(() => initial?.selectedTime ?? { hour: 9, minute: 0 });
  const [timeLabel, setTimeLabel] = useState(() => initial?.timeLabel ?? '09:00');
  const [seats, setSeats] = useState(initial?.seats ?? 1);
  const [rate, setRate] = useState(initial?.rate ?? '');
  const [instantBooking, setInstantBooking] = useState(initial?.instantBooking ?? false);

  const [publishLoading, setPublishLoading] = useState(false);
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [addVehicleBusy, setAddVehicleBusy] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [showDateModal, setShowDateModal] = useState(false);
  const [showPassengersModal, setShowPassengersModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [clockMode, setClockMode] = useState<'hour' | 'minute'>('hour');
  const [clockHour24, setClockHour24] = useState(9);
  const [clockMinute, setClockMinute] = useState(30);
  const [timeModalToast, setTimeModalToast] = useState('');
  const timeModalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState(0);
  const [selectedRouteDistanceKm, setSelectedRouteDistanceKm] = useState<number | null>(null);
  const lastRouteFareCoordsKeyRef = useRef<string | null>(null);

  const dateValueDisplay = useMemo(
    () => formatPublishStyleDateLabel(selectedDate),
    [selectedDate]
  );

  useEffect(() => {
    if (!baseEntry) {
      navigation.goBack();
    }
  }, [baseEntry, navigation]);

  useFocusEffect(
    useCallback(() => {
      const p = route.params;
      if (!p) return;
      if (p.selectedFrom !== undefined) setPickup(String(p.selectedFrom ?? ''));
      if (p.selectedTo !== undefined) setDestination(String(p.selectedTo ?? ''));
      if (p.selectedDateIso) {
        const d = new Date(p.selectedDateIso);
        if (!Number.isNaN(d.getTime())) setSelectedDate(d);
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
      }
      if (p.pickupLatitude !== undefined) setPickupLatitude(p.pickupLatitude);
      if (p.pickupLongitude !== undefined) setPickupLongitude(p.pickupLongitude);
      if (p.destinationLatitude !== undefined) setDestinationLatitude(p.destinationLatitude);
      if (p.destinationLongitude !== undefined) setDestinationLongitude(p.destinationLongitude);
      if (p.selectedRate !== undefined) setRate(String(p.selectedRate ?? ''));
      if (p.clearRouteFare) {
        setSelectedRouteDistanceKm(null);
        setRouteDurationSeconds(0);
        lastRouteFareCoordsKeyRef.current = null;
      } else {
        if (
          p.selectedDurationSeconds !== undefined &&
          typeof p.selectedDurationSeconds === 'number'
        ) {
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
      }
    }, [route.params])
  );

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
      lastRouteFareCoordsKeyRef.current = null;
    }
  }, [pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]);

  useEffect(() => {
    return () => {
      if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    };
  }, []);

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
    const paramKm =
      typeof route.params?.selectedDistanceKm === 'number' &&
      !Number.isNaN(route.params.selectedDistanceKm)
        ? route.params.selectedDistanceKm
        : undefined;
    const storedKm =
      selectedRouteDistanceKm ??
      (typeof paramKm === 'number' && paramKm > 0 ? paramKm : undefined);
    const canEstimate = straight != null || (storedKm != null && storedKm > 0);
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

  useEffect(() => {
    if (!sessionReady || !user) return;
    if (vehiclesFromUser(user).length === 0) setAddVehicleOpen(true);
  }, [sessionReady, user]);

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

  const openLocationPicker = (field: 'from' | 'to') => {
    navigation.navigate('LocationPicker', {
      field,
      currentFrom: pickup,
      currentTo: destination,
      currentPickupLatitude: pickupLatitude,
      currentPickupLongitude: pickupLongitude,
      currentDestinationLatitude: destinationLatitude,
      currentDestinationLongitude: destinationLongitude,
      returnScreen: 'PublishRecentEdit',
    });
  };

  const proceedPublish = useCallback(
    async (vehicleExtra?: VehicleFormValues, rideOpts?: { vehicleId?: string }) => {
      if (publishLoading || !baseEntry) return;
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
        const body: CreateRidePayload = {
          pickupLocationName: pickup.trim(),
          pickupLatitude,
          pickupLongitude,
          destinationLocationName: destination.trim(),
          destinationLatitude,
          destinationLongitude,
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
        };
        await api.post(API.endpoints.rides.create, body);
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
            instantBooking,
          },
          recentUserKey
        ).then(() => loadRecentPublished(recentUserKey));
        const tabNav = navigation.getParent();
        if (tabNav) (tabNav as { navigate: (name: string) => void }).navigate('YourRides');
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
      publishLoading,
      baseEntry,
      user?.name,
      user?.phone,
      user?.vehicleModel,
      user?.vehicleName,
      user?.licensePlate,
      user?.vehicleColor,
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
      navigation,
      recentUserKey,
      routeDurationSeconds,
      mergedVehicles,
      selectedVehicleId,
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
  }, []);

  const handlePublish = useCallback(async () => {
    if (publishLoading) return;
    if (isTimeInPast || isTimeTooSoon) {
      alertDepartureTimeInPast();
      return;
    }
    if (!pickup.trim() || !destination.trim()) {
      alertMissingPickupDestination();
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
    if (mergedVehicles.length === 0) {
      setAddVehicleOpen(true);
      return;
    }
    await proceedPublish();
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
    mergedVehicles.length,
    proceedPublish,
  ]);

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
          if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
          setTimeModalToast('Choose a time at least 30 minutes from now.');
          timeModalToastTimerRef.current = setTimeout(() => setTimeModalToast(''), 1800);
          return;
        }
        setClockMinute(minute);
      }
    },
    [clockMode, clockHour24, selectedDate]
  );

  const openTimeModal = () => {
    setClockHour24(selectedTime.hour);
    setClockMinute(Math.round(selectedTime.minute / 5) * 5 % 60);
    setClockMode('hour');
    setShowTimeModal(true);
  };

  const openPublishPrice = () => {
    if (!canSetFare) {
      alertRouteRequiredBeforePrice();
      return;
    }
    if (!baseEntry) return;
    const p = route.params as { selectedDistanceKm?: number } | undefined;
    const paramKm =
      typeof p?.selectedDistanceKm === 'number' && !Number.isNaN(p.selectedDistanceKm)
        ? p.selectedDistanceKm
        : undefined;
    const storedKm =
      selectedRouteDistanceKm ?? (typeof paramKm === 'number' && paramKm > 0 ? paramKm : undefined);
    const straightKm = straightLineKmBetweenStops({
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
    });
    const distKm = effectivePublishDistanceKm({
      selectedDistanceKm: storedKm,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      preferStoredRouteDistance: storedKm != null,
    });
    const durationSec =
      routeDurationSeconds > 0
        ? routeDurationSeconds
        : Math.max(60, Math.round((straightKm ?? distKm) * 2 * 60));
    const parsedExistingRate = parseInt(rate.trim(), 10);
    const initialPricePerSeat =
      !Number.isNaN(parsedExistingRate) && parsedExistingRate > 0 ? parsedExistingRate : undefined;
    navigation.navigate({
      name: 'PublishPrice',
      params: {
        selectedFrom: pickup,
        selectedTo: destination,
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude,
        selectedDateIso: selectedDate.toISOString(),
        selectedTimeHour: selectedTime.hour,
        selectedTimeMinute: selectedTime.minute,
        selectedDistanceKm: distKm,
        selectedDurationSeconds: durationSec,
        publishRecentEditEntry: baseEntry,
        ...(initialPricePerSeat !== undefined ? { initialPricePerSeat } : {}),
      },
      merge: false,
    });
  };

  const swapStops = () => {
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
  };

  if (!baseEntry || !initial) {
    return <View style={styles.safe} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Edit & publish</Text>
          <Text style={styles.headerSubtitle}>Review and publish your trip</Text>
        </View>
        <View style={styles.headerRightChip}>
          <Text style={styles.headerRightChipText}>New ride</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.pickRow}>
            <TouchableOpacity
              style={styles.pickRowMain}
              onPress={() => openLocationPicker('from')}
              activeOpacity={0.75}
            >
              <View style={styles.pickIconCol}>
                <View style={styles.greenDot} />
                <View style={styles.dottedLine} />
              </View>
              <View style={styles.pickTextWrap}>
                <Text style={styles.pickMainText} numberOfLines={1}>
                  {pickup.trim() ? pickup : 'Where from?'}
                </Text>
                <Text style={styles.pickSubText}>PICKUP</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={swapStops} style={styles.swapBtn} hitSlop={10} accessibilityLabel="Swap pickup and destination">
              <Ionicons name="swap-vertical" size={20} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.pickRow} onPress={() => openLocationPicker('to')} activeOpacity={0.75}>
            <View style={styles.pickIconCol}>
              <View style={styles.redPin} />
            </View>
            <View style={styles.pickTextWrap}>
              <Text style={styles.pickMainText} numberOfLines={1}>
                {destination.trim() ? destination : 'Add destination'}
              </Text>
              <Text style={styles.pickSubText}>DESTINATION</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity style={styles.fieldRow} onPress={() => setShowDateModal(true)} activeOpacity={0.75}>
            <View style={styles.fieldLeft}>
              <Ionicons name="calendar-outline" size={24} color={COLORS.textSecondary} />
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={styles.fieldValue}>{dateValueDisplay}</Text>
              <Text style={styles.fieldLabel}>DATE</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity style={styles.fieldRow} onPress={openTimeModal} activeOpacity={0.75}>
            <View style={styles.fieldLeft}>
              <View style={styles.timeIconCircle}>
                <Ionicons name="time-outline" size={22} color="#6366f1" />
              </View>
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={[styles.fieldValue, styles.timeValue]}>{timeLabel}</Text>
              <Text style={styles.fieldLabel}>TIME</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={[styles.fieldRow, !canSetFare && styles.fieldRowDisabled]}
            onPress={() => {
              if (!canSetFare) {
                alertRouteRequiredBeforePrice();
                return;
              }
              openPublishPrice();
            }}
            activeOpacity={canSetFare ? 0.75 : 1}
          >
            <View style={styles.fieldLeft}>
              <View style={styles.fareIconCircle}>
                <Ionicons name="wallet-outline" size={22} color="#6366f1" />
              </View>
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={[styles.fieldValue, styles.fareValue]}>{estimatedFareLabel}</Text>
              <Text style={styles.fieldLabel}>FARE PER SEAT</Text>
            </View>
            {canSetFare ? (
              <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
            ) : (
              <Ionicons name="lock-closed-outline" size={20} color={COLORS.textMuted} />
            )}
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => setAddVehicleOpen(true)}
            activeOpacity={0.75}
          >
            <View style={styles.fieldLeft}>
              <Ionicons name="car-sport-outline" size={22} color="#6b7280" />
            </View>
            <View style={styles.fieldInputWrap}>
              <Text
                style={[styles.fieldValue, mergedVehicles.length === 0 && styles.fieldValuePlaceholder]}
                numberOfLines={2}
              >
                {mergedVehicles.length === 0
                  ? 'Add vehicle to publish'
                  : (() => {
                      const v =
                        mergedVehicles.find((x) => x.id === selectedVehicleId) ?? mergedVehicles[0];
                      return v ? `${v.vehicleModel} · ${v.licensePlate}` : '';
                    })()}
              </Text>
              <Text style={styles.fieldLabel}>VEHICLE</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => setShowPassengersModal(true)}
            activeOpacity={0.75}
          >
            <View style={styles.fieldLeft}>
              <Ionicons name="people-outline" size={22} color="#6b7280" />
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={styles.fieldValue}>
                {seats} passenger{seats === 1 ? '' : 's'}
              </Text>
              <Text style={styles.fieldLabel}>SEATING SPACE</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Booking</Text>
          </View>
          <Text style={styles.sectionHint}>Choose how passengers confirm their seat.</Text>
          <View style={styles.bookingToggleRow}>
            <View style={styles.bookingToggleText}>
              <Text style={styles.bookingToggleTitle}>Instant booking</Text>
              <Text style={styles.bookingToggleDesc}>Confirm bookings without approving each request</Text>
            </View>
            <Switch
              value={instantBooking}
              onValueChange={setInstantBooking}
              trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
              thumbColor={instantBooking ? COLORS.primary : COLORS.background}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.updateButton, publishLoading && styles.updateButtonDisabled]}
          onPress={() => void handlePublish()}
          activeOpacity={0.8}
          disabled={publishLoading}
        >
          {publishLoading ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <View style={styles.updateInner}>
              <Ionicons name="rocket-outline" size={18} color={COLORS.white} />
              <Text style={styles.updateText}>Publish ride</Text>
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>

      <DatePickerModal
        visible={showDateModal}
        onClose={() => setShowDateModal(false)}
        selectedDate={selectedDate}
        onSelectDate={(d) => {
          setSelectedDate(d);
          setShowDateModal(false);
        }}
      />

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
        onDone={(n) => setSeats(n)}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  headerBack: { paddingTop: 4, paddingRight: 2 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 19, fontWeight: '800', color: COLORS.text },
  headerSubtitle: { marginTop: 2, fontSize: 12, color: COLORS.textSecondary },
  headerRightChip: {
    alignSelf: 'center',
    marginTop: 2,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headerRightChipText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  card: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
    lineHeight: 16,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    marginTop: 6,
    paddingVertical: 4,
  },
  pickRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  pickIconCol: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  greenDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
    marginTop: 2,
  },
  dottedLine: {
    width: 2,
    minHeight: 14,
    marginVertical: 4,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    borderStyle: 'dashed',
  },
  redPin: {
    width: 10,
    height: 14,
    borderRadius: 6,
    backgroundColor: COLORS.error,
    marginTop: 2,
  },
  pickTextWrap: {
    flex: 1,
    marginLeft: 10,
    minWidth: 0,
  },
  pickMainText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  pickSubText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  swapBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(41,190,139,0.12)',
    marginRight: 4,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  fieldRowDisabled: {
    opacity: 0.55,
  },
  fieldLeft: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInputWrap: {
    flex: 1,
    marginLeft: 14,
  },
  fieldValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  fieldValuePlaceholder: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  timeIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fareIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
  bookingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 12,
  },
  bookingToggleText: { flex: 1, minWidth: 0 },
  bookingToggleTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  bookingToggleDesc: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  updateButton: {
    marginTop: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateButtonDisabled: { opacity: 0.65 },
  updateInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  updateText: { color: COLORS.white, fontSize: 15, fontWeight: '800' },
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
  dateModalHeading: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
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
});
