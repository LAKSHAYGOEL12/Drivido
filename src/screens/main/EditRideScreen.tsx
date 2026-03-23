import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  const [saving, setSaving] = useState(false);

  const majorFieldLocked = hasBookings;


  const dateObj = useMemo(() => {
    const [y, m, d] = dateValue.split('-').map(Number);
    if ([y, m, d].some((n) => Number.isNaN(n))) return null;
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }, [dateValue]);

  const timeLabel = `${String(timeHour).padStart(2, '0')}:${String(timeMinute).padStart(2, '0')}`;
  const PRICE_STEP = 5;

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
      (navigation as { setParams: (params: Record<string, unknown>) => void }).setParams({
        selectedFrom: undefined,
        selectedTo: undefined,
        preservedDate: undefined,
        preservedPassengers: undefined,
      });
    }, [route.params, navigation])
  );

  const handleUpdateRide = async () => {
    if (!pickupLocation.trim() || !dropLocation.trim()) {
      Alert.alert('Missing fields', 'Pickup and destination are required.');
      return;
    }
    if (!totalSeats.trim() || Number(totalSeats) <= 0 || Number.isNaN(Number(totalSeats))) {
      Alert.alert('Invalid seats', 'Please enter a valid seat count.');
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
              <Text style={styles.pickMainText} numberOfLines={1}>{pickupLocation || 'Current Location'}</Text>
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
              <Text style={styles.pickMainText} numberOfLines={1}>{dropLocation || 'Where to?'}</Text>
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
              <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} />
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={styles.fieldValue}>{dateValue || 'Select date'}</Text>
              <Text style={styles.fieldLabel}>DEPARTURE DATE</Text>
            </View>
            <Ionicons name={majorFieldLocked ? 'lock-closed-outline' : 'chevron-forward'} size={22} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={[styles.fieldRow, majorFieldLocked && styles.fieldRowDisabled]}
            onPress={() => !majorFieldLocked && setShowTimeModal(true)}
            activeOpacity={majorFieldLocked ? 1 : 0.75}
          >
            <View style={styles.fieldLeft}>
              <View style={styles.timeIconCircle}>
                <Ionicons name="time-outline" size={20} color="#6366f1" />
              </View>
            </View>
            <View style={styles.fieldInputWrap}>
              <Text style={[styles.fieldValue, styles.timeValue]}>{timeLabel}</Text>
              <Text style={styles.fieldLabel}>PREFERRED TIME</Text>
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
                <Ionicons name="wallet-outline" size={20} color="#6366f1" />
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

      <Modal visible={showTimeModal} transparent animationType="slide" onRequestClose={() => setShowTimeModal(false)}>
        <TouchableOpacity style={styles.bottomOverlay} activeOpacity={1} onPress={() => setShowTimeModal(false)}>
          <View style={styles.bottomSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.bottomTitle}>Set time</Text>
            <View style={styles.timeRow}>
              <View style={styles.timeStepper}>
                <TouchableOpacity onPress={() => setTimeHour((h) => (h + 23) % 24)} style={styles.timeStepBtn}>
                  <Ionicons name="remove" size={22} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.timeStepValue}>{String(timeHour).padStart(2, '0')}</Text>
                <TouchableOpacity onPress={() => setTimeHour((h) => (h + 1) % 24)} style={styles.timeStepBtn}>
                  <Ionicons name="add" size={22} color={COLORS.text} />
                </TouchableOpacity>
              </View>
              <Text style={styles.timeColon}>:</Text>
              <View style={styles.timeStepper}>
                <TouchableOpacity onPress={() => setTimeMinute((m) => (m + 55) % 60)} style={styles.timeStepBtn}>
                  <Ionicons name="remove" size={22} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.timeStepValue}>{String(timeMinute).padStart(2, '0')}</Text>
                <TouchableOpacity onPress={() => setTimeMinute((m) => (m + 5) % 60)} style={styles.timeStepBtn}>
                  <Ionicons name="add" size={22} color={COLORS.text} />
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity
              style={styles.bottomDoneBtn}
              onPress={() => {
                setTimeValue(`${String(timeHour).padStart(2, '0')}:${String(timeMinute).padStart(2, '0')}`);
                setShowTimeModal(false);
              }}
            >
              <Text style={styles.bottomDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInputWrap: {
    flex: 1,
    marginLeft: 10,
  },
  fieldValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  fieldLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  timeIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fareIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeValue: {
    color: '#4338ca',
  },
  fareValue: {
    color: '#4338ca',
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
