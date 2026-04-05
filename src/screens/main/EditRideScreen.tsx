import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import type { RideListItem } from '../../types/api';
import api from '../../services/api';
import { API } from '../../constants/API';
import { COLORS } from '../../constants/colors';
import DatePickerModal from '../../components/common/DatePickerModal';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import { showToast } from '../../utils/toast';
import { bookingIsCancelled } from '../../utils/bookingStatus';
import { formatPublishStyleDateLabel } from '../../utils/rideDisplay';

const MIN_LEAD_MINUTES = 30;
const CLOCK_SIZE = 232;
const CLOCK_CENTER = CLOCK_SIZE / 2;
const HOUR_OUTER_RADIUS = 90;
const HOUR_INNER_RADIUS = 60;
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

function isDateTimeTooSoon(dateValue: string, hour: number, minute: number, minLeadMinutes: number): boolean {
  const [y, m, d] = dateValue.split('-').map(Number);
  if ([y, m, d].some((n) => Number.isNaN(n))) return false;
  const chosen = new Date(y, (m ?? 1) - 1, d ?? 1, hour, minute, 0, 0);
  if (Number.isNaN(chosen.getTime())) return false;
  return chosen.getTime() < Date.now() + minLeadMinutes * 60 * 1000;
}

type EditRideRouteProp =
  | RouteProp<RidesStackParamList, 'EditRide'>
  | RouteProp<SearchStackParamList, 'EditRide'>;

function parseDateTimeParts(ride: RideListItem): { date: string; time: string } {
  if (ride.scheduledAt) {
    const d = new Date(ride.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      return {
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      };
    }
  }
  const date = (ride.scheduledDate ?? ride.rideDate ?? ride.date ?? '').trim();
  const time = (ride.scheduledTime ?? ride.rideTime ?? ride.time ?? '').trim().slice(0, 5);
  return { date, time };
}

export default function EditRideScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<EditRideRouteProp>();
  const ride = route.params.ride;
  const anyRide = ride as RideListItem & {
    notes?: string;
    description?: string;
    contactInfo?: string;
    contact?: string;
  };

  const hasBookings = useMemo(() => {
    const activeFromArray = Array.isArray(ride.bookings)
      ? ride.bookings.filter((b) => !bookingIsCancelled(b.status)).length
      : 0;
    const activeFromBookedSeats =
      typeof ride.bookedSeats === 'number' && !Number.isNaN(ride.bookedSeats)
        ? Math.max(0, Math.floor(ride.bookedSeats))
        : 0;
    return activeFromArray > 0 || activeFromBookedSeats > 0;
  }, [ride.bookings, ride.bookedSeats]);

  const dt = parseDateTimeParts(ride);
  const [pickupLocation, setPickupLocation] = useState((ride.pickupLocationName ?? ride.from ?? '').trim());
  const [dropLocation, setDropLocation] = useState((ride.destinationLocationName ?? ride.to ?? '').trim());
  const [dateValue, setDateValue] = useState(dt.date);
  const [timeValue, setTimeValue] = useState(dt.time);
  const [price, setPrice] = useState((ride.price ?? '').trim());
  const [totalSeats, setTotalSeats] = useState(
    ride.seats != null && !Number.isNaN(Number(ride.seats)) ? String(Math.max(1, Math.floor(Number(ride.seats)))) : ''
  );
  const [notes, setNotes] = useState((anyRide.notes ?? '').trim());
  const [description, setDescription] = useState((anyRide.description ?? '').trim());
  const [contactInfo, setContactInfo] = useState((anyRide.contactInfo ?? anyRide.contact ?? '').trim());
  const [showDateModal, setShowDateModal] = useState(false);
  const [showSeatsModal, setShowSeatsModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [priceDraft, setPriceDraft] = useState(() => {
    const n = parseInt(String(ride.price ?? '').trim(), 10);
    return Number.isNaN(n) ? 100 : Math.max(1, n);
  });
  const [showTimeModal, setShowTimeModal] = useState(false);
  const initialTime = useMemo(() => {
    const [hh, mm] = timeValue.split(':').map(Number);
    return {
      hour: !Number.isNaN(hh) ? Math.min(23, Math.max(0, hh)) : 9,
      minute: !Number.isNaN(mm) ? Math.min(59, Math.max(0, mm)) : 30,
    };
  }, []);
  const [timeHour, setTimeHour] = useState(initialTime.hour);
  const [timeMinute, setTimeMinute] = useState(initialTime.minute);
  const [clockMode, setClockMode] = useState<'hour' | 'minute'>('hour');
  const [timeModalToast, setTimeModalToast] = useState('');
  const timeModalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  const majorFieldLocked = hasBookings;


  const dateObj = useMemo(() => {
    const [y, m, d] = dateValue.split('-').map(Number);
    if ([y, m, d].some((n) => Number.isNaN(n))) return null;
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }, [dateValue]);

  /** Same wording as Publish ride (Today/Tomorrow/weekday + month + day). */
  const dateDisplayLabel = useMemo(() => {
    const t = dateValue.trim();
    if (!t) return '';
    const [y, m, d] = t.split('-').map(Number);
    if ([y, m, d].some((n) => Number.isNaN(n)) || m < 1 || m > 12 || d < 1 || d > 31) {
      return t;
    }
    return formatPublishStyleDateLabel(new Date(y, m - 1, d));
  }, [dateValue]);

  const timeLabel = `${String(timeHour).padStart(2, '0')}:${String(timeMinute).padStart(2, '0')}`;
  const PRICE_STEP = 5;

  const openTimeModal = () => {
    const parts = timeValue.split(':').map(Number);
    const hh = parts[0];
    const mm = parts[1];
    const h = !Number.isNaN(hh) ? Math.min(23, Math.max(0, Math.floor(hh))) : 9;
    const rawM = !Number.isNaN(mm) ? mm : 0;
    const m = Math.round(rawM / 5) * 5 % 60;
    setTimeHour(h);
    setTimeMinute(m);
    setClockMode('hour');
    setShowTimeModal(true);
  };

  const handleClockPress = (locationX: number, locationY: number) => {
    const dx = locationX - CLOCK_CENTER;
    const dy = locationY - CLOCK_CENTER;
    const radius = Math.sqrt(dx * dx + dy * dy);
    let angleDeg = (Math.atan2(dy, dx) * 180 / Math.PI) + 90;
    if (angleDeg < 0) angleDeg += 360;

    if (clockMode === 'hour') {
      const dialHour = Math.round(angleDeg / 30) % 12;
      const isInnerRing = radius < (HOUR_OUTER_RADIUS + HOUR_INNER_RADIUS) / 2;
      const nextHour24 = isInnerRing ? dialHour + 12 : dialHour;
      setTimeHour(nextHour24);
      setClockMode('minute');
      return;
    }

    const index = Math.round(angleDeg / 30) % 12;
    const minute = MINUTE_OPTIONS[index];
    if (isDateTimeTooSoon(dateValue, timeHour, minute, MIN_LEAD_MINUTES)) {
      showTimeValidationToast();
      return;
    }
    setTimeMinute(minute);
  };

  const openLocationPicker = (field: 'from' | 'to') => {
    if (majorFieldLocked) return;
    (navigation as { navigate: (screen: string, params: Record<string, unknown>) => void }).navigate('LocationPicker', {
      field,
      currentFrom: pickupLocation,
      currentTo: dropLocation,
      currentDate: dateValue,
      currentPassengers: totalSeats,
      currentFromLatitude: ride.pickupLatitude,
      currentFromLongitude: ride.pickupLongitude,
      currentToLatitude: ride.destinationLatitude,
      currentToLongitude: ride.destinationLongitude,
      returnScreen: 'SearchRides',
    });
  };

  useFocusEffect(
    React.useCallback(() => {
      const p = route.params as (RidesStackParamList['EditRide'] & {
        selectedFrom?: string;
        selectedTo?: string;
      }) | (SearchStackParamList['EditRide'] & { selectedFrom?: string; selectedTo?: string });
      if (!p) return;
      let touched = false;
      if (typeof p.selectedFrom === 'string') {
        setPickupLocation(p.selectedFrom);
        touched = true;
      }
      if (typeof p.selectedTo === 'string') {
        setDropLocation(p.selectedTo);
        touched = true;
      }
      if (!touched) return;
      (navigation as unknown as { setParams: (params: Record<string, unknown>) => void }).setParams({
        selectedFrom: undefined,
        selectedTo: undefined,
        preservedDate: undefined,
        preservedPassengers: undefined,
      });
    }, [route.params, navigation])
  );

  const showTimeValidationToast = () => {
    if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    setTimeModalToast('Choose a time at least 30 minutes from now.');
    timeModalToastTimerRef.current = setTimeout(() => setTimeModalToast(''), 1800);
  };

  const cancelTimeModal = () => {
    if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    setTimeModalToast('');
    setShowTimeModal(false);
  };

  const applyTimeAndClose = () => {
    if (isDateTimeTooSoon(dateValue, timeHour, timeMinute, MIN_LEAD_MINUTES)) {
      showTimeValidationToast();
      return;
    }
    setTimeValue(`${String(timeHour).padStart(2, '0')}:${String(timeMinute).padStart(2, '0')}`);
    setShowTimeModal(false);
  };

  useEffect(() => {
    return () => {
      if (timeModalToastTimerRef.current) clearTimeout(timeModalToastTimerRef.current);
    };
  }, []);

  const handleUpdateRide = async () => {
    if (!pickupLocation.trim() || !dropLocation.trim()) {
      Alert.alert('Missing fields', 'Pickup and destination are required.');
      return;
    }
    if (!totalSeats.trim() || Number(totalSeats) <= 0 || Number.isNaN(Number(totalSeats))) {
      Alert.alert('Invalid seats', 'Please enter a valid seat count.');
      return;
    }
    if (isDateTimeTooSoon(dateValue, timeHour, timeMinute, MIN_LEAD_MINUTES)) {
      showToast({
        title: 'Check departure time',
        message: 'Choose a time at least 30 minutes from now.',
        variant: 'info',
      });
      return;
    }
    const payload: Record<string, unknown> = {
      pickupLocationName: pickupLocation.trim(),
      destinationLocationName: dropLocation.trim(),
      price: price.trim(),
      seats: Math.max(1, Math.floor(Number(totalSeats))),
      notes: notes.trim(),
      description: description.trim(),
      contactInfo: contactInfo.trim(),
    };
    if (dateValue.trim() && timeValue.trim()) {
      const scheduledAt = new Date(`${dateValue.trim()}T${timeValue.trim()}:00`);
      if (!Number.isNaN(scheduledAt.getTime())) payload.scheduledAt = scheduledAt.toISOString();
    }
    setSaving(true);
    try {
      await api.patch(API.endpoints.rides.detail(ride.id), payload);
      showToast({
        title: 'Updated',
        message: 'Ride details updated',
        variant: 'success',
      });
      navigation.goBack();
    } catch (e: unknown) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Failed to update ride.';
      Alert.alert('Error', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Edit ride</Text>
            <Text style={styles.headerSubtitle}>Update your trip details</Text>
          </View>
          <View style={styles.headerRightChip}>
            <Text style={styles.headerRightChipText}>{hasBookings ? 'Limited edit' : 'Editable'}</Text>
          </View>
        </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {hasBookings ? (
          <View style={styles.banner}>
            <Ionicons name="information-circle-outline" size={18} color={COLORS.warning} />
            <Text style={styles.bannerText}>
              Passengers have already booked this ride. Only limited details can be updated.
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Ride details</Text>
            {majorFieldLocked ? (
              <View style={styles.lockPill}>
                <Ionicons name="lock-closed-outline" size={12} color={COLORS.textMuted} />
                <Text style={styles.lockPillText}>Locked</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.sectionHint}>
            {majorFieldLocked
              ? 'Pickup, drop, schedule, price and seats are read-only after bookings.'
              : 'These details are visible to all passengers.'}
          </Text>

          <TouchableOpacity
            style={[styles.pickRow, majorFieldLocked && styles.pickRowLocked]}
            onPress={() => openLocationPicker('from')}
            activeOpacity={majorFieldLocked ? 1 : 0.75}
          >
            <View style={styles.pickIconCol}>
              <View style={styles.greenDot} />
              <View style={styles.dottedLine} />
            </View>
            <View style={styles.pickTextWrap}>
              <Text style={styles.pickMainText} numberOfLines={1}>{pickupLocation || 'Where from?'}</Text>
              <Text style={styles.pickSubText}>PICKUP</Text>
            </View>
            <Ionicons name={majorFieldLocked ? 'lock-closed-outline' : 'chevron-forward'} size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pickRow, majorFieldLocked && styles.pickRowLocked]}
            onPress={() => openLocationPicker('to')}
            activeOpacity={majorFieldLocked ? 1 : 0.75}
          >
            <View style={styles.pickIconCol}>
              <View style={styles.redPin} />
            </View>
            <View style={styles.pickTextWrap}>
              <Text style={styles.pickMainText} numberOfLines={1}>{dropLocation || 'Add destination'}</Text>
              <Text style={styles.pickSubText}>DESTINATION</Text>
            </View>
            <Ionicons name={majorFieldLocked ? 'lock-closed-outline' : 'chevron-forward'} size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={[styles.fieldRow, majorFieldLocked && styles.fieldRowDisabled]}
            onPress={() => !majorFieldLocked && setShowDateModal(true)}
            activeOpacity={majorFieldLocked ? 1 : 0.75}
          >
            <View style={styles.fieldLeft}>
              <Ionicons name="calendar-outline" size={24} color={COLORS.textSecondary} />
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={styles.fieldValue}>{dateDisplayLabel || 'Select date'}</Text>
              <Text style={styles.fieldLabel}>DATE</Text>
            </View>
            <Ionicons name={majorFieldLocked ? 'lock-closed-outline' : 'chevron-forward'} size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={[styles.fieldRow, majorFieldLocked && styles.fieldRowDisabled]}
            onPress={() => !majorFieldLocked && openTimeModal()}
            activeOpacity={majorFieldLocked ? 1 : 0.75}
          >
            <View style={styles.fieldLeft}>
              <View style={styles.timeIconCircle}>
                <Ionicons name="time-outline" size={22} color="#6366f1" />
              </View>
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={[styles.fieldValue, styles.timeValue]}>{timeLabel}</Text>
              <Text style={styles.fieldLabel}>TIME</Text>
            </View>
            <Ionicons name={majorFieldLocked ? 'lock-closed-outline' : 'chevron-forward'} size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={[styles.fieldRow, majorFieldLocked && styles.fieldRowDisabled]}
            onPress={() => !majorFieldLocked && setShowPriceModal(true)}
            activeOpacity={majorFieldLocked ? 1 : 0.75}
          >
            <View style={styles.fieldLeft}>
              <View style={styles.fareIconCircle}>
                <Ionicons name="wallet-outline" size={22} color="#6366f1" />
              </View>
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={[styles.fieldValue, styles.fareValue]}>{price ? `₹${price}` : 'Set fare'}</Text>
              <Text style={styles.fieldLabel}>ESTIMATED FARE</Text>
            </View>
            <Ionicons name={majorFieldLocked ? 'lock-closed-outline' : 'chevron-forward'} size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={[styles.fieldRow, majorFieldLocked && styles.fieldRowDisabled]}
            onPress={() => !majorFieldLocked && setShowSeatsModal(true)}
            activeOpacity={majorFieldLocked ? 1 : 0.75}
          >
            <View style={styles.fieldLeft}>
              <Ionicons name="people-outline" size={22} color="#6b7280" />
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={styles.fieldValue}>{totalSeats ? `${totalSeats} passenger${totalSeats === '1' ? '' : 's'}` : 'Set seats'}</Text>
              <Text style={styles.fieldLabel}>SEATING SPACE</Text>
            </View>
            <Ionicons name={majorFieldLocked ? 'lock-closed-outline' : 'chevron-forward'} size={22} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Editable details</Text>
            <View style={styles.editablePill}>
              <Ionicons name="create-outline" size={12} color={COLORS.primary} />
              <Text style={styles.editablePillText}>Always editable</Text>
            </View>
          </View>
          <Text style={styles.sectionHint}>Use these for passenger instructions and contact updates.</Text>

          <Text style={styles.label}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            style={[styles.input, styles.multilineInput]}
            placeholder="Notes"
            placeholderTextColor={COLORS.textMuted}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            style={[styles.input, styles.multilineInput]}
            placeholder="Description"
            placeholderTextColor={COLORS.textMuted}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>Contact info</Text>
          <TextInput
            value={contactInfo}
            onChangeText={setContactInfo}
            style={styles.input}
            placeholder="Contact info"
            placeholderTextColor={COLORS.textMuted}
          />
        </View>

        <TouchableOpacity
          style={[styles.updateButton, saving && styles.updateButtonDisabled]}
          onPress={handleUpdateRide}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <View style={styles.updateInner}>
              <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.white} />
              <Text style={styles.updateText}>Update ride</Text>
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>

      <DatePickerModal
        visible={showDateModal}
        onClose={() => setShowDateModal(false)}
        selectedDate={dateObj}
        onSelectDate={(d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          setDateValue(`${y}-${m}-${day}`);
          setShowDateModal(false);
        }}
      />

      <PassengersPickerModal
        visible={showSeatsModal}
        onClose={() => setShowSeatsModal(false)}
        value={Math.min(4, Math.max(1, parseInt(totalSeats, 10) || 1))}
        onDone={(n) => setTotalSeats(String(n))}
      />

      <Modal visible={showPriceModal} transparent animationType="slide" onRequestClose={() => setShowPriceModal(false)}>
        <TouchableOpacity
          style={styles.bottomOverlay}
          activeOpacity={1}
          onPress={() => {
            setPrice(String(priceDraft));
            setShowPriceModal(false);
          }}
        >
          <View style={styles.bottomSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.bottomTitle}>Set fare</Text>
            <View style={styles.priceStepper}>
              <TouchableOpacity
                style={[styles.priceStepBtn, priceDraft <= 1 && styles.priceStepBtnDisabled]}
                onPress={() => setPriceDraft((p) => Math.max(1, p - PRICE_STEP))}
                disabled={priceDraft <= 1}
                activeOpacity={0.75}
              >
                <Ionicons name="remove" size={24} color={priceDraft <= 1 ? COLORS.textMuted : COLORS.text} />
              </TouchableOpacity>
              <View style={styles.priceValueWrap}>
                <Text style={styles.priceValue}>₹{priceDraft}</Text>
                <Text style={styles.priceStepHint}>per seat</Text>
              </View>
              <TouchableOpacity
                style={styles.priceStepBtn}
                onPress={() => setPriceDraft((p) => p + PRICE_STEP)}
                activeOpacity={0.75}
              >
                <Ionicons name="add" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.bottomDoneBtn}
              onPress={() => {
                setPrice(String(priceDraft));
                setShowPriceModal(false);
              }}
            >
              <Text style={styles.bottomDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showTimeModal} transparent animationType="slide" onRequestClose={cancelTimeModal}>
        <View style={styles.bottomOverlay}>
          {timeModalToast ? (
            <View style={styles.timeModalToastWrap} pointerEvents="none">
              <Ionicons name="alert-circle" size={22} color={COLORS.error} style={styles.timeModalToastIcon} />
              <View style={styles.timeModalToastTextCol}>
                <Text style={styles.timeModalToastTitle}>Check departure time</Text>
                <Text style={styles.timeModalToastText}>{timeModalToast}</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.bottomSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.bottomTitle}>Set time</Text>
            <View style={styles.clockTimeSelectRow}>
              <TouchableOpacity
                style={[styles.clockTimeBox, clockMode === 'hour' && styles.clockTimeBoxActive]}
                onPress={() => setClockMode('hour')}
                activeOpacity={0.85}
              >
                <Text style={[styles.clockTimeBoxText, clockMode === 'hour' && styles.clockTimeBoxTextActive]}>
                  {String(timeHour).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
              <Text style={styles.clockTimeColon}>:</Text>
              <TouchableOpacity
                style={[styles.clockTimeBox, clockMode === 'minute' && styles.clockTimeBoxActive]}
                onPress={() => setClockMode('minute')}
                activeOpacity={0.85}
              >
                <Text style={[styles.clockTimeBoxText, clockMode === 'minute' && styles.clockTimeBoxTextActive]}>
                  {String(timeMinute).padStart(2, '0')}
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
                      transform: [{ rotate: `${(timeHour % 12) * 30 + (timeMinute / 60) * 30 - 90}deg` }],
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
                      transform: [{ rotate: `${timeMinute * 6 - 90}deg` }],
                    },
                  ]}
                >
                  <View style={styles.clockMinuteHand} />
                </View>
              </View>
            </Pressable>

            <View style={styles.timeModalActionsRow}>
              <TouchableOpacity style={styles.timeModalCancelBtn} onPress={cancelTimeModal} activeOpacity={0.85}>
                <Text style={styles.timeModalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.timeModalDoneBtn} onPress={applyTimeAndClose} activeOpacity={0.85}>
                <Text style={styles.timeModalDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fff7ed',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
    padding: 11,
    marginBottom: 12,
  },
  bannerText: { flex: 1, color: '#7c2d12', fontSize: 13, lineHeight: 18, fontWeight: '500' },
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
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lockPillText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '700' },
  editablePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editablePillText: { fontSize: 11, color: '#047857', fontWeight: '700' },
  fieldBlock: { marginTop: 6 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    marginTop: 6,
    paddingVertical: 4,
  },
  pickRowLocked: {
    opacity: 0.75,
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
    opacity: 0.75,
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
  label: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 6, marginTop: 8, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
  },
  multilineInput: {
    minHeight: 82,
  },
  inputLocked: {
    color: COLORS.textMuted,
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    opacity: 0.9,
  },
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
  bottomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  timeModalToastWrap: {
    position: 'absolute',
    top: 88,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff1f2',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.error,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  timeModalToastIcon: {
    marginTop: 2,
    marginRight: 12,
  },
  timeModalToastTextCol: {
    flex: 1,
    minWidth: 0,
  },
  timeModalToastTitle: {
    color: '#991b1b',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  timeModalToastText: {
    color: '#7f1d1d',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  bottomSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
  },
  bottomTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  bottomInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
  },
  priceStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 4,
  },
  priceStepBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceStepBtnDisabled: {
    opacity: 0.45,
  },
  priceValueWrap: {
    minWidth: 120,
    alignItems: 'center',
  },
  priceValue: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.text,
  },
  priceStepHint: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  bottomDoneBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 10,
  },
  bottomDoneText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  timeModalActionsRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 14,
    paddingHorizontal: 4,
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
    justifyContent: 'center',
    marginTop: 4,
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
    marginVertical: 6,
    alignSelf: 'center',
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
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 4,
  },
  timeStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundSecondary,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  timeStepBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeStepValue: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  timeColon: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
});
