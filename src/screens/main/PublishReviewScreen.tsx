import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { OFFLINE_HEADLINE, OFFLINE_SUBTITLE_RETRY } from '../../constants/offlineMessaging';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { API } from '../../constants/API';
import { fetchRideDetailRaw } from '../../services/rideDetailCache';
import { emitRideListMergeFromDetail, rideListItemFromDetailApiPayload } from '../../services/rideListFromDetailSync';
import type { CreateRidePayload } from '../../types/api';
import { buildRidePolylinePersistPayload } from '../../utils/publishRoutePolylineApi';
import { normalizeEncodedPolyline } from '../../utils/routePolyline';
import { pickRoutePolylineEncodedFromRecord } from '../../utils/ridePublisherCoords';
import {
  allowedPublishFareRange,
  effectivePublishDistanceKm,
  isPublishStopsComplete,
} from '../../utils/publishFare';
import {
  alertFareOutsideAllowedRange,
  alertPublishFailed,
  alertFareRequiredBeforePublish,
  alertRouteRequiredBeforePrice,
} from '../../utils/publishAlerts';
import { addRecentPublished } from '../../services/recent-published-storage';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';
import { validation, validationErrors } from '../../constants/validation';
import { showToast } from '../../utils/toast';
import type { MainTabName } from '../../navigation/mainTabOrder';
import { dispatchResetPublishStackToWizardRoot } from '../../navigation/publishStackWizardRoot';
import { navigateToPublishRoutePreview } from '../../navigation/navigateToPublishRoutePreview';
import { vehicleListToAuthPatch, vehiclesFromUser } from '../../utils/userVehicle';
import { createUserVehicle, listUserVehicles } from '../../services/userVehicles';
import SelectVehicleBottomSheet, {
  type VehicleFormValues,
} from '../../components/publish/SelectVehicleBottomSheet';
import { Alert } from '../../utils/themedAlert';
import DatePickerModal from '../../components/common/DatePickerModal';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import PublishFareBottomSheet from '../../components/publish/PublishFareBottomSheet';

type ScreenRoute = RouteProp<PublishStackParamList, 'PublishReview'>;

type PublishReviewVehicleOpts = {
  vehicleExtra?: VehicleFormValues;
  /** Right after POST /vehicles; list state may not have flushed yet. */
  rideVehicleId?: string;
};

function formatTime12(hour24: number, minute: number): string {
  const am = hour24 < 12;
  const h12 = hour24 % 12 || 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}

const MIN_LEAD_MINUTES = 30;
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;
const CLOCK_SIZE = 248;
const CLOCK_CENTER = CLOCK_SIZE / 2;
const HOUR_OUTER_RADIUS = CLOCK_SIZE * 0.39;
const HOUR_INNER_RADIUS = CLOCK_SIZE * 0.24;

function isSelectedDateTimeTooSoon(selectedDate: Date, selectedTime: { hour: number; minute: number }, leadMinutes: number): boolean {
  const now = new Date();
  const y = selectedDate.getFullYear();
  const m = selectedDate.getMonth();
  const d = selectedDate.getDate();
  const chosen = new Date(y, m, d, selectedTime.hour, selectedTime.minute, 0, 0);
  return chosen.getTime() < now.getTime() + leadMinutes * 60_000;
}

export default function PublishReviewScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const route = useRoute<ScreenRoute>();
  const insets = useSafeAreaInsets();
  const p = route.params;
  const { user, refreshUser, patchUser } = useAuth();
  const recentUserKey = useMemo(() => (user?.id ?? user?.phone ?? '').trim(), [user?.id, user?.phone]);
  const mergedVehicles = useMemo(() => vehiclesFromUser(user), [user]);

  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [addVehicleBusy, setAddVehicleBusy] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const [instantBooking, setInstantBooking] = useState(p.instantBooking ?? false);
  const [rideDescription, setRideDescription] = useState('');
  const [rateText, setRateText] = useState(String(p.selectedRate ?? '').trim());
  const [offeredSeats, setOfferedSeats] = useState(Math.max(1, Math.min(6, Math.floor(p.offeredSeats) || 1)));
  const [selectedDate, setSelectedDate] = useState(() => {
    if (!p.selectedDateIso) return new Date();
    const d = new Date(p.selectedDateIso);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  });
  const [selectedTimeHour, setSelectedTimeHour] = useState(
    typeof p.selectedTimeHour === 'number' ? p.selectedTimeHour : 9
  );
  const [selectedTimeMinute, setSelectedTimeMinute] = useState(
    typeof p.selectedTimeMinute === 'number' ? Math.round(p.selectedTimeMinute / 5) * 5 % 60 : 0
  );
  const [showDateModal, setShowDateModal] = useState(false);
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [showFareBottomSheet, setShowFareBottomSheet] = useState(false);
  const [showPassengersModal, setShowPassengersModal] = useState(false);
  const [clockMode, setClockMode] = useState<'hour' | 'minute'>('hour');
  const [clockHour24, setClockHour24] = useState(selectedTimeHour);
  const [clockMinute, setClockMinute] = useState((Math.round(selectedTimeMinute / 5) * 5) % 60);
  const [timeModalToast, setTimeModalToast] = useState('');
  const timeModalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [netOnline, setNetOnline] = useState<boolean | null>(null);

  React.useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setNetOnline(s.isConnected === true && s.isInternetReachable !== false);
    });
    void NetInfo.fetch().then((s) => {
      setNetOnline(s.isConnected === true && s.isInternetReachable !== false);
    });
    return () => unsub();
  }, []);

  React.useEffect(() => {
    return () => {
      if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    };
  }, []);

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

  const offline = netOnline === false;

  /** Review is final confirmation — stops are fixed; fare matches the route you already built. */
  const routeEndpointsLocked = true;

  const dateLabel = formatPublishStyleDateLabel(selectedDate);
  const timeLabel = formatTime12(selectedTimeHour, selectedTimeMinute);

  const fareInt = parseInt(rateText.trim(), 10);
  const seats = offeredSeats;
  /** Same clearance pattern as Edit & publish — scroll clears the fixed footer. */
  const publishScrollBottomPad = 120 + Math.max(insets.bottom, 10);

  const distanceKmEff = useMemo(
    () =>
      effectivePublishDistanceKm({
        selectedDistanceKm: p.selectedDistanceKm,
        pickupLatitude: p.pickupLatitude,
        pickupLongitude: p.pickupLongitude,
        destinationLatitude: p.destinationLatitude,
        destinationLongitude: p.destinationLongitude,
        preferStoredRouteDistance: true,
      }),
    [
      p.selectedDistanceKm,
      p.pickupLatitude,
      p.pickupLongitude,
      p.destinationLatitude,
      p.destinationLongitude,
    ]
  );
  const fareRange = useMemo(() => allowedPublishFareRange(distanceKmEff), [distanceKmEff]);

  const onPublish = useCallback(async (opts?: PublishReviewVehicleOpts) => {
    if (submitting) return;
    if (offline) {
      showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
      return;
    }
    if (!isPublishStopsComplete(p)) {
      showToast({ title: 'Route incomplete', message: 'Go back and pick pickup and destination.', variant: 'info' });
      return;
    }
    if (Number.isNaN(fareInt) || fareInt <= 0) {
      alertFareRequiredBeforePublish();
      return;
    }
    if (!validation.rideDescription(rideDescription)) {
      Alert.alert('Ride description', validationErrors.rideDescription);
      return;
    }

    const fromList =
      opts?.vehicleExtra != null
        ? undefined
        : mergedVehicles.find((x) => x.id === selectedVehicleId) ?? mergedVehicles[0];
    const resolved: VehicleFormValues | undefined = opts?.vehicleExtra
      ? opts.vehicleExtra
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
      setAddVehicleOpen(true);
      showToast({
        title: 'Vehicle required',
        message: 'Add or select a vehicle to publish this ride.',
        variant: 'info',
      });
      return;
    }

    const { minAllowed: minFareAllowed, maxAllowed: maxFareAllowed } = fareRange;
    if (fareInt < minFareAllowed || fareInt > maxFareAllowed) {
      alertFareOutsideAllowedRange(minFareAllowed, maxFareAllowed);
      return;
    }

    const vc = (resolved?.vehicleColor ?? user?.vehicleColor ?? '').trim();
    const stableVehicleId =
      opts?.rideVehicleId ??
      (fromList && fromList.id !== 'legacy-profile' ? fromList.id : undefined);
    const descriptionTrimmed = rideDescription.trim();

    setSubmitting(true);
    try {
      await refreshUser();
      const scheduledAt = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        selectedTimeHour,
        selectedTimeMinute,
        0,
        0
      ).toISOString();
      const username = (user?.name?.trim() || user?.phone || '').trim() || 'User';
      const pr = p as Record<string, unknown>;
      const encodedFromNav = pickRoutePolylineEncodedFromRecord(pr);
      const encodedForPost =
        normalizeEncodedPolyline(typeof p.routePolylineEncoded === 'string' ? p.routePolylineEncoded : undefined) ??
        encodedFromNav;
      const polyPayload = await buildRidePolylinePersistPayload({
        existingEncoded: encodedForPost ?? null,
        pickupLocationName: String(p.selectedFrom ?? '').trim(),
        destinationLocationName: String(p.selectedTo ?? '').trim(),
        pickupLatitude: p.pickupLatitude!,
        pickupLongitude: p.pickupLongitude!,
        destinationLatitude: p.destinationLatitude!,
        destinationLongitude: p.destinationLongitude!,
      });
      const durationSec =
        typeof p.selectedDurationSeconds === 'number' && !Number.isNaN(p.selectedDurationSeconds)
          ? Math.max(0, Math.floor(p.selectedDurationSeconds))
          : 0;

      const body: CreateRidePayload = {
        pickupLocationName: String(p.selectedFrom ?? '').trim(),
        pickupLatitude: p.pickupLatitude!,
        pickupLongitude: p.pickupLongitude!,
        destinationLocationName: String(p.selectedTo ?? '').trim(),
        destinationLatitude: p.destinationLatitude!,
        destinationLongitude: p.destinationLongitude!,
        scheduledAt,
        seats,
        username,
        price: rateText.trim(),
        bookingMode: instantBooking ? 'instant' : 'request',
        instantBooking,
        vehicleModel: vm,
        licensePlate: lp,
        ...(vc ? { vehicleColor: vc } : {}),
        ...(stableVehicleId ? { vehicleId: stableVehicleId } : {}),
        ...(durationSec > 0 ? { estimatedDurationSeconds: durationSec } : {}),
        ...polyPayload,
        ...(descriptionTrimmed
          ? {
              description: descriptionTrimmed,
              rideDescription: descriptionTrimmed,
              ride_description: descriptionTrimmed,
            }
          : {}),
      };

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
          pickup: String(p.selectedFrom ?? '').trim(),
          destination: String(p.selectedTo ?? '').trim(),
          pickupLatitude: p.pickupLatitude!,
          pickupLongitude: p.pickupLongitude!,
          destinationLatitude: p.destinationLatitude!,
          destinationLongitude: p.destinationLongitude!,
          dateYmd,
          hour: selectedTimeHour,
          minute: selectedTimeMinute,
          seats,
          rate: rateText.trim(),
          rideDescription: descriptionTrimmed,
          instantBooking,
          rideId: createdRideId || undefined,
        },
        recentUserKey
      );

      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: 'Main',
              params: {
                screen: 'YourRides',
                params: {
                  screen: 'YourRidesList',
                  params: { _afterBookRefresh: Date.now() },
                },
              },
            },
          ],
        } as never)
      );
    } catch (e: unknown) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Failed to publish ride.';
      alertPublishFailed(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    offline,
    p,
    fareInt,
    seats,
    instantBooking,
    rateText,
    rideDescription,
    user,
    mergedVehicles,
    navigation,
    recentUserKey,
    distanceKmEff,
    fareRange,
    selectedDate,
    selectedTimeHour,
    selectedTimeMinute,
    refreshUser,
    selectedVehicleId,
  ]);

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
        await onPublish({ vehicleExtra: v, rideVehicleId: pickId });
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
    [syncVehiclesFromApi, onPublish]
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

  const dismissReview = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    const exit = p.publishFabExitTab as MainTabName | undefined;
    if (exit) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'Main',
          params: { screen: exit },
          merge: false,
        } as never)
      );
      return;
    }
    dispatchResetPublishStackToWizardRoot(navigation);
  }, [navigation, p.publishFabExitTab]);

  useFocusEffect(
    useCallback(() => {
      void syncVehiclesFromApi();
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        dismissReview();
        return true;
      });
      return () => sub.remove();
    }, [syncVehiclesFromApi, dismissReview])
  );

  const pickupLabel = String(p.selectedFrom ?? '').trim();
  const destinationLabel = String(p.selectedTo ?? '').trim();
  const vehicle =
    mergedVehicles.find((v) => v.id === selectedVehicleId) ?? mergedVehicles[0] ?? undefined;
  const vehicleModel = (vehicle?.vehicleModel ?? user?.vehicleModel ?? user?.vehicleName ?? '').trim();
  const vehiclePlate = (vehicle?.licensePlate ?? user?.licensePlate ?? '').trim();

  const openVehicleSheet = useCallback(() => {
    setAddVehicleOpen(true);
  }, []);

  const openLocationPicker = useCallback(
    (_field: 'from' | 'to') => {
      if (routeEndpointsLocked) {
        showToast({
          title: 'Trip is set',
          message: 'To change pickup or destination, go back and edit your trip from the previous steps.',
          variant: 'info',
        });
        return;
      }
      navigation.navigate('LocationPicker', {
        field: _field,
        currentFrom: p.selectedFrom ?? '',
        currentTo: p.selectedTo ?? '',
        currentPickupLatitude: p.pickupLatitude ?? 0,
        currentPickupLongitude: p.pickupLongitude ?? 0,
        currentDestinationLatitude: p.destinationLatitude ?? 0,
        currentDestinationLongitude: p.destinationLongitude ?? 0,
        returnScreen: 'PublishWizard',
        ...(p.publishRestoreKey ? { publishRestoreKey: p.publishRestoreKey } : {}),
        ...(p.publishRecentEditEntry ? { publishRecentEditEntry: p.publishRecentEditEntry } : {}),
        publishWizardReview: true,
        ...(p.publishFabExitTab ? { publishFabExitTab: p.publishFabExitTab } : {}),
      });
    },
    [navigation, p, routeEndpointsLocked]
  );

  const openRoutePreviewMap = useCallback(() => {
    if (offline) {
      showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
      return;
    }
    if (!isPublishStopsComplete(p)) {
      alertRouteRequiredBeforePrice();
      return;
    }
    navigateToPublishRoutePreview(navigation, {
      selectedFrom: String(p.selectedFrom ?? '').trim(),
      selectedTo: String(p.selectedTo ?? '').trim(),
      pickupLatitude: p.pickupLatitude,
      pickupLongitude: p.pickupLongitude,
      destinationLatitude: p.destinationLatitude,
      destinationLongitude: p.destinationLongitude,
      ...(p.publishRestoreKey ? { publishRestoreKey: p.publishRestoreKey } : {}),
      publishWizardReview: true,
      publishReviewMapReturn: true,
      ...(p.publishFabExitTab ? { publishFabExitTab: p.publishFabExitTab } : {}),
    });
  }, [navigation, p, offline]);

  const openFareBottomSheet = useCallback(() => {
    setShowFareBottomSheet(true);
  }, []);

  const applyClockTime = useCallback((hour24: number, minute: number) => {
    const hh = Math.max(0, Math.min(23, Math.floor(hour24)));
    const mm = Math.max(0, Math.min(59, Math.floor(minute)));
    setSelectedTimeHour(hh);
    setSelectedTimeMinute(mm);
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

  const openTimeModal = useCallback(() => {
    setClockHour24(selectedTimeHour);
    setClockMinute((Math.round(selectedTimeMinute / 5) * 5) % 60);
    setClockMode('hour');
    setTimeModalToast('');
    setShowTimeModal(true);
  }, [selectedTimeHour, selectedTimeMinute]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.rootShell}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: publishScrollBottomPad }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={dismissReview} style={styles.headerBackBtn} hitSlop={12}>
                <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
              </TouchableOpacity>
              <View style={styles.headerTextWrap}>
                <Text style={styles.headerTitle}>Review your ride</Text>
                <Text style={styles.headerSubtitle}>Publish ride</Text>
              </View>
              <View style={styles.headerRightSpacer} />
            </View>

            <View style={styles.rideDetailsCard}>
              {offline ? (
                <View style={styles.publishOfflineBanner} accessibilityRole="alert">
                  <Ionicons name="cloud-offline-outline" size={16} color={COLORS.textSecondary} />
                  <Text style={styles.publishOfflineBannerText}>{OFFLINE_HEADLINE}</Text>
                </View>
              ) : null}

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Ride details</Text>
                <View style={styles.lockedPill}>
                  <Ionicons name="lock-closed-outline" size={12} color={COLORS.primaryDark} />
                  <Text style={styles.lockedPillText}>Route set</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.pickRow, styles.pickRowEndpointLocked]}
                onPress={() => openLocationPicker('from')}
                activeOpacity={0.75}
              >
                <View style={styles.pickRowMain}>
                  <View style={styles.pickIconCol}>
                    <View style={styles.greenDot} />
                    <View style={styles.dottedLine} />
                  </View>
                  <View style={styles.pickTextWrap}>
                    <Text style={styles.pickMainText} numberOfLines={1}>
                      {pickupLabel || 'Where from?'}
                    </Text>
                    <Text style={styles.pickSubText}>PICKUP</Text>
                  </View>
                  <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pickRow, styles.pickRowEndpointLocked]}
                onPress={() => openLocationPicker('to')}
                activeOpacity={0.75}
              >
                <View style={styles.pickRowMain}>
                  <View style={styles.pickIconCol}>
                    <View style={styles.redPin} />
                  </View>
                  <View style={styles.pickTextWrap}>
                    <Text style={styles.pickMainText} numberOfLines={1}>
                      {destinationLabel || 'Add destination'}
                    </Text>
                    <Text style={styles.pickSubText}>DESTINATION</Text>
                  </View>
                  <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />
                </View>
              </TouchableOpacity>

              {isPublishStopsComplete(p) ? (
                <TouchableOpacity style={styles.routePreviewLink} onPress={openRoutePreviewMap} activeOpacity={0.75}>
                  <Ionicons name="map-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.routePreviewLinkText}>Choose route on map</Text>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              ) : null}

              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.fieldRow} onPress={() => setShowDateModal(true)} activeOpacity={0.75}>
                <View style={styles.fieldLeft}>
                  <Ionicons name="calendar-outline" size={24} color={COLORS.textSecondary} />
                </View>
                <View style={styles.fieldInputWrap}>
                  <Text style={styles.fieldValue}>{dateLabel}</Text>
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
              <TouchableOpacity style={styles.fieldRow} onPress={openFareBottomSheet} activeOpacity={0.75}>
                <View style={styles.fieldLeft}>
                  <View style={styles.fareIconCircle}>
                    <Ionicons name="wallet-outline" size={22} color="#6366f1" />
                  </View>
                </View>
                <View style={styles.fieldInputWrap}>
                  <Text style={[styles.fieldValue, styles.fareValue]}>
                    {Number.isFinite(fareInt) && fareInt > 0 ? `₹${fareInt}` : 'Set fare'}
                  </Text>
                  <Text style={styles.fieldLabel}>FARE PER SEAT</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>

              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.fieldRow} onPress={() => setShowPassengersModal(true)} activeOpacity={0.75}>
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

              <View style={styles.rowDivider} />
              <TouchableOpacity style={styles.fieldRow} onPress={openVehicleSheet} activeOpacity={0.75}>
                <View style={styles.fieldLeft}>
                  <Ionicons name="car-sport-outline" size={22} color="#6b7280" />
                </View>
                <View style={styles.fieldInputWrap}>
                  <Text style={styles.fieldValue} numberOfLines={1}>
                    {vehicleModel || 'Add vehicle to publish'}
                  </Text>
                  <Text style={styles.fieldLabel}>{vehiclePlate || 'VEHICLE'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.bookingSection}>
              <Text style={styles.bookingSectionLabel}>Booking</Text>
              <View style={[styles.instantBookingCard, instantBooking && styles.instantBookingCardOn]}>
                <View style={[styles.instantBookingIconCircle, instantBooking && styles.instantBookingIconCircleOn]}>
                  <Ionicons
                    name="flash"
                    size={20}
                    color={instantBooking ? COLORS.primaryDark : '#64748B'}
                  />
                </View>
                <View style={styles.bookingToggleText}>
                  <Text style={styles.bookingToggleTitle}>Instant booking</Text>
                  <Text style={styles.bookingToggleDesc}>
                    Bookings are confirmed without you approving each one.
                  </Text>
                </View>
                <View style={styles.instantBookingSwitchZone}>
                  <View style={styles.instantBookingCardRightRule} />
                  <View style={styles.instantBookingSwitchWrap}>
                    <Switch
                      value={instantBooking}
                      onValueChange={setInstantBooking}
                      trackColor={{ false: '#e5e7eb', true: COLORS.primaryLight }}
                      thumbColor={instantBooking ? COLORS.primary : COLORS.white}
                      style={Platform.OS === 'android' ? styles.instantBookingSwitchAndroid : undefined}
                    />
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Ride description</Text>
              <Text style={styles.sectionHint}>Optional - shown to passengers on ride detail.</Text>
              <TextInput
                value={rideDescription}
                onChangeText={setRideDescription}
                style={styles.rideDescriptionInput}
                placeholder="Luggage, music, exact pickup spot, tolls..."
                placeholderTextColor={COLORS.textMuted}
                multiline
                textAlignVertical="top"
                maxLength={500}
              />
              <Text style={styles.rideDescriptionCounter}>{rideDescription.length}/500</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

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
                <Text style={styles.timeModalHeading}>Select time</Text>
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
                  {clockMode === 'hour' ? 'Tap clock to pick hour' : 'Tap clock to pick minutes (0–55 in 5 min steps)'}
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

          <PublishFareBottomSheet
            visible={showFareBottomSheet}
            onClose={() => setShowFareBottomSheet(false)}
            distanceKm={distanceKmEff}
            initialAmount={Number.isFinite(fareInt) && fareInt > 0 ? fareInt : fareRange.minAllowed}
            onConfirm={(amount) => {
              setRateText(String(amount));
              setShowFareBottomSheet(false);
            }}
          />

          <PassengersPickerModal
            visible={showPassengersModal}
            onClose={() => setShowPassengersModal(false)}
            value={seats}
            onDone={(n) => setOfferedSeats(n)}
          />

          <SelectVehicleBottomSheet
            visible={addVehicleOpen}
            onClose={() => {
              if (!addVehicleBusy && !submitting) setAddVehicleOpen(false);
            }}
            vehicles={mergedVehicles}
            selectedVehicleId={selectedVehicleId}
            onSelectedVehicleIdChange={setSelectedVehicleId}
            onAddAndPublish={handleAddVehicleAndPublish}
            onSaveNewVehicle={handleSaveNewVehicle}
            onConfirmSelection={handleConfirmVehicleSelection}
            busy={addVehicleBusy || submitting}
          />

          <View style={[styles.publishFooter, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TouchableOpacity
              style={[styles.publishRideButton, (submitting || offline) && styles.publishRideButtonDisabled]}
              onPress={() => void onPublish()}
              disabled={submitting || offline}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Publish ride"
            >
              {submitting ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <View style={styles.publishRideInner}>
                  <Ionicons name="rocket-outline" size={18} color={COLORS.white} />
                  <Text style={styles.publishRideText}>Publish ride</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.backgroundSecondary },
  /** Column: scroll (flex) + footer — same layout as Edit & publish. */
  rootShell: { flex: 1 },
  keyboardAvoiding: { flex: 1 },
  scroll: { flex: 1, backgroundColor: COLORS.backgroundSecondary },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  headerBackBtn: { paddingTop: 4, paddingRight: 2 },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, letterSpacing: -0.4 },
  headerSubtitle: { marginTop: 4, fontSize: 13, fontWeight: '500', color: COLORS.textMuted },
  headerRightSpacer: { width: 44 },
  card: {
    backgroundColor: COLORS.white,
    borderWidth: 0,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  /** Primary trip summary — hero card. */
  rideDetailsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
      },
      android: { elevation: 4 },
    }),
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  lockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: COLORS.primaryMuted22,
    borderWidth: 0,
  },
  lockedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primaryDark,
    letterSpacing: 0.2,
  },
  publishOfflineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
  },
  publishOfflineBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
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
  pickRowEndpointLocked: {
    opacity: 0.95,
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
  pickTextWrap: { flex: 1, marginLeft: 10, minWidth: 0 },
  pickMainText: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  pickSubText: { marginTop: 2, fontSize: 11, fontWeight: '700', color: COLORS.textMuted },
  routePreviewLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  routePreviewLinkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  fieldLeft: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInputWrap: { flex: 1, marginLeft: 14, minWidth: 0 },
  fieldValue: { fontSize: 16, fontWeight: '700', color: COLORS.text },
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
  timeValue: { color: '#6366f1' },
  fareValue: { color: '#6366f1' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  sectionHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 4, marginBottom: 8, lineHeight: 16 },
  bookingSection: {
    marginBottom: 12,
  },
  bookingSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 8,
    marginLeft: 2,
    letterSpacing: -0.2,
  },
  instantBookingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f4f6f8',
    borderRadius: 18,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e8ecf1',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 1 },
    }),
  },
  instantBookingCardOn: {
    backgroundColor: COLORS.instantBookingOnSurface,
    borderColor: COLORS.instantBookingOnSurface,
    /** Keep insets identical to base card so toggling never shifts layout. */
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
  },
  instantBookingIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e8ecf1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instantBookingIconCircleOn: {
    backgroundColor: COLORS.primaryMuted22,
  },
  bookingToggleText: { flex: 1, minWidth: 0, paddingRight: 2 },
  bookingToggleTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  bookingToggleDesc: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '400',
    color: '#94a3b8',
    lineHeight: 17,
  },
  /** Switch + faint vertical rule just before the control (reference: far right, before corner). */
  instantBookingSwitchZone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
    width: 64,
    justifyContent: 'flex-end',
  },
  instantBookingSwitchWrap: {
    width: 52,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /** Counters Material Switch default insets so the row does not “jump” when toggled. */
  instantBookingSwitchAndroid: {
    marginVertical: -4,
    marginHorizontal: -3,
  },
  instantBookingCardRightRule: {
    width: StyleSheet.hairlineWidth,
    height: 36,
    borderRadius: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(148, 163, 184, 0.32)',
  },
  rideDescriptionInput: {
    minHeight: 86,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
    marginTop: 6,
  },
  rideDescriptionCounter: { fontSize: 11, color: COLORS.textMuted, textAlign: 'right', marginTop: 4 },
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
  timeModalHeading: {
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
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  clockHourLabelInner: {
    fontSize: 13,
    width: 20,
    color: COLORS.textSecondary,
  },
  clockMinuteLabel: {
    position: 'absolute',
    width: 24,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  clockHandWrap: {
    position: 'absolute',
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  clockHourHand: {
    width: 4,
    height: 30,
    backgroundColor: COLORS.text,
    borderRadius: 2,
  },
  clockHandWrapMinute: {
    position: 'absolute',
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'flex-start',
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
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
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
    backgroundColor: COLORS.primary,
    borderRadius: 12,
  },
  timeModalDoneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  publishFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  publishRideButton: {
    marginTop: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishRideButtonDisabled: { opacity: 0.65 },
  publishRideInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  publishRideText: { color: COLORS.white, fontSize: 15, fontWeight: '800' },
});
