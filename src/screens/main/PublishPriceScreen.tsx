import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { alertRouteRequiredPriceScreen } from '../../utils/publishAlerts';
import {
  effectivePublishDistanceKm,
  isPublishStopsComplete,
  recommendedFareRange,
} from '../../utils/publishFare';

type PriceRouteProp = RouteProp<PublishStackParamList, 'PublishPrice'>;

const MAX_PRICE = 99999;

function clampPrice(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 1;
  return Math.min(MAX_PRICE, Math.max(1, Math.round(n)));
}

export default function PublishPriceScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const route = useRoute<PriceRouteProp>();
  const {
    selectedFrom,
    selectedTo,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    selectedDateIso,
    selectedTimeHour,
    selectedTimeMinute,
    selectedDistanceKm,
    selectedDurationSeconds: durationFromRoute,
    publishRestoreKey,
    initialPricePerSeat,
  } = route.params;

  const distanceKmForReco = useMemo(
    () =>
      effectivePublishDistanceKm({
        selectedDistanceKm,
        pickupLatitude,
        pickupLongitude,
        destinationLatitude,
        destinationLongitude,
        preferStoredRouteDistance:
          typeof selectedDistanceKm === 'number' && !Number.isNaN(selectedDistanceKm) && selectedDistanceKm > 0,
      }),
    [
      selectedDistanceKm,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
    ]
  );

  const { minRecommended, maxRecommended } = recommendedFareRange(distanceKmForReco);
  const seedPrice =
    typeof initialPricePerSeat === 'number' &&
    !Number.isNaN(initialPricePerSeat) &&
    initialPricePerSeat > 0
      ? clampPrice(initialPricePerSeat)
      : minRecommended;
  const [price, setPrice] = useState(seedPrice);
  /** Local text while typing so the field can be cleared/edited freely */
  const [inputText, setInputText] = useState(() => String(seedPrice));
  /** Latest input for onBlur (avoids stale closure). */
  const inputTextRef = useRef(inputText);
  inputTextRef.current = inputText;
  const inputDigits = inputText.replace(/\D/g, '');
  const inputAmount = inputDigits === '' ? NaN : parseInt(inputDigits, 10);
  const isPriceInvalid = !Number.isFinite(inputAmount) || inputAmount <= 0;

  const stopsAllowed = useMemo(() => isPublishStopsComplete(route.params), [route.params]);

  useLayoutEffect(() => {
    if (!stopsAllowed) {
      navigation.goBack();
      setTimeout(() => {
        alertRouteRequiredPriceScreen();
      }, 0);
    }
  }, [stopsAllowed, navigation]);

  /** Only reset to suggested range when route distance changes — not when reopening with same distance + saved fare. */
  const prevDistanceKmRef = useRef(distanceKmForReco);
  useEffect(() => {
    if (!stopsAllowed) return;
    if (prevDistanceKmRef.current !== distanceKmForReco) {
      prevDistanceKmRef.current = distanceKmForReco;
      setPrice(minRecommended);
      setInputText(String(minRecommended));
    }
  }, [distanceKmForReco, minRecommended, stopsAllowed]);

  const isBelowRecommended = price < minRecommended;
  const isAboveRecommended = price > maxRecommended;
  const isWithinRecommended = !isBelowRecommended && !isAboveRecommended;
  const statusColor = isBelowRecommended
    ? '#b45309'
    : isAboveRecommended
      ? '#dc2626'
      : '#15803d';
  const statusBg = isBelowRecommended
    ? '#fffbeb'
    : isAboveRecommended
      ? '#fef2f2'
      : '#f0fdf4';
  const statusIcon = isBelowRecommended
    ? 'trending-down'
    : isAboveRecommended
      ? 'alert-circle'
      : 'checkmark-circle';
  const helperText = isBelowRecommended
    ? 'Lower fares mean lower earnings for this trip.'
    : isAboveRecommended
      ? 'Very high prices may get fewer bookings.'
      : 'You’re in the sweet spot for this route distance.';

  const pickupDisplay = selectedFrom?.trim() || 'Pickup not set';
  const destDisplay = selectedTo?.trim() || 'Destination not set';

  const onContinue = () => {
    if (isPriceInvalid) return;
    if (!isPublishStopsComplete(route.params)) {
      alertRouteRequiredPriceScreen();
      navigation.goBack();
      return;
    }
    const digits = inputText.replace(/\D/g, '');
    const finalPrice = clampPrice(digits === '' ? price : parseInt(digits, 10));
    setPrice(finalPrice);
    setInputText(String(finalPrice));
    const fallbackSeconds = Math.max(60, Math.round(distanceKmForReco * 2 * 60));
    const params: Record<string, unknown> = {
      selectedFrom,
      selectedTo,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      ...(selectedDateIso ? { selectedDateIso } : {}),
      ...(typeof selectedTimeHour === 'number' ? { selectedTimeHour } : {}),
      ...(typeof selectedTimeMinute === 'number' ? { selectedTimeMinute } : {}),
      selectedRate: String(finalPrice),
      initialPricePerSeat: finalPrice,
      selectedDistanceKm: distanceKmForReco,
      selectedDurationSeconds:
        typeof durationFromRoute === 'number' && !Number.isNaN(durationFromRoute)
          ? durationFromRoute
          : fallbackSeconds,
    };
    if (publishRestoreKey) params._publishRestoreKey = publishRestoreKey;
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'PublishRide', params }],
      })
    );
  };

  if (!stopsAllowed) {
    return <View style={styles.blockedFill} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.headerBlock}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
              <Ionicons name="chevron-back" size={26} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.headerMain}>
            <Text style={styles.headerEyebrow}>Per seat</Text>
            <Text style={styles.headerTitle}>Set your price</Text>
            <Text style={styles.headerLead}>
              What passengers pay for one seat on this ride.
            </Text>

            <View style={styles.routeCard}>
              <View style={styles.routeStop}>
                <View style={styles.routeBulletPickup} />
                <View style={styles.routeStopText}>
                  <Text style={styles.routeLabel}>Pickup</Text>
                  <Text style={styles.routeValue} numberOfLines={2} ellipsizeMode="tail">
                    {pickupDisplay}
                  </Text>
                </View>
              </View>
              <View style={styles.routeConnector} />
              <View style={styles.routeStop}>
                <View style={styles.routeBulletDest} />
                <View style={styles.routeStopText}>
                  <Text style={styles.routeLabel}>Destination</Text>
                  <Text style={styles.routeValue} numberOfLines={2} ellipsizeMode="tail">
                    {destDisplay}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.distanceCard}>
            <Ionicons name="navigate-outline" size={20} color={COLORS.secondary} />
            <Text style={styles.distanceCardText}>
              {distanceKmForReco.toFixed(distanceKmForReco < 10 ? 1 : 0)} km · suggested from distance
            </Text>
          </View>

          <View style={styles.priceCard}>
            <Text style={styles.priceCardLabel}>Enter amount (₹)</Text>
            <View style={[styles.inputRow, isPriceInvalid && styles.inputRowInvalid]}>
              <Text style={styles.rupeePrefix}>₹</Text>
              <TextInput
                style={styles.priceInput}
                value={inputText}
                onChangeText={(t) => {
                  const digits = t.replace(/\D/g, '').slice(0, 6);
                  setInputText(digits);
                  if (digits === '') return;
                  setPrice(clampPrice(parseInt(digits, 10)));
                }}
                onBlur={() => {
                  const digits = inputTextRef.current.replace(/\D/g, '');
                  if (digits !== '') {
                    const n = clampPrice(parseInt(digits, 10));
                    setPrice(n);
                    setInputText(String(n));
                  }
                }}
                keyboardType={Platform.OS === 'android' ? 'numeric' : 'number-pad'}
                maxLength={6}
                placeholder="0"
                placeholderTextColor={COLORS.textMuted}
                selectionColor={COLORS.primary}
                editable
                selectTextOnFocus={false}
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                underlineColorAndroid="transparent"
                importantForAutofill="no"
              />
            </View>
            <Text style={styles.manualHint}>Enter the amount passengers pay for one seat.</Text>
          </View>

          <View style={styles.recoCard}>
            <View style={styles.recoCardHeader}>
              <Ionicons name="sparkles" size={18} color={COLORS.success} />
              <Text style={styles.recoCardTitle}>Recommended range</Text>
            </View>
            <Text style={styles.recoAmount}>
              ₹{minRecommended} — ₹{maxRecommended}
            </Text>
            <Text style={styles.recoCaption}>Based on route length and typical fares in your area.</Text>
          </View>

          <View style={[styles.statusCard, { backgroundColor: statusBg }]}>
            <Ionicons name={statusIcon} size={22} color={statusColor} />
            <View style={styles.statusTextWrap}>
              <Text style={[styles.statusTitle, { color: statusColor }]}>
                {isWithinRecommended
                  ? 'Great choice'
                  : isBelowRecommended
                    ? 'Below suggested range'
                    : 'Above suggested range'}
              </Text>
              <Text style={styles.statusBody}>{helperText}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.continueBtn, isPriceInvalid && styles.continueBtnDisabled]}
            onPress={onContinue}
            activeOpacity={isPriceInvalid ? 1 : 0.9}
            disabled={isPriceInvalid}
          >
            <Text style={styles.continueBtnText}>Continue</Text>
            <Ionicons name="arrow-forward" size={22} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  blockedFill: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  flex: {
    flex: 1,
  },
  headerBlock: {
    paddingBottom: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  headerMain: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  headerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  headerLead: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '400',
    color: COLORS.textSecondary,
    lineHeight: 22,
    maxWidth: 340,
  },
  routeCard: {
    marginTop: 18,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  routeStop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  routeBulletPickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
    marginTop: 5,
  },
  routeBulletDest: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.error,
    marginTop: 5,
  },
  routeStopText: {
    flex: 1,
    minWidth: 0,
  },
  routeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  routeValue: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
    lineHeight: 21,
  },
  routeConnector: {
    width: 2,
    height: 14,
    marginLeft: 4,
    marginVertical: 6,
    borderRadius: 1,
    backgroundColor: COLORS.border,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  distanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  distanceCardText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1e40af',
  },
  priceCard: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  priceCardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
    paddingBottom: 4,
  },
  inputRowInvalid: {
    borderBottomColor: COLORS.error,
  },
  rupeePrefix: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.text,
    marginRight: 4,
    paddingBottom: 2,
  },
  priceInput: {
    flex: 1,
    fontSize: 42,
    fontWeight: '800',
    color: COLORS.text,
    paddingVertical: 0,
    minHeight: 52,
  },
  manualHint: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  recoCard: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)',
  },
  recoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  recoCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
  },
  recoAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#14532d',
    letterSpacing: -0.3,
  },
  recoCaption: {
    marginTop: 6,
    fontSize: 13,
    color: '#15803d',
    fontWeight: '500',
    lineHeight: 18,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 14,
    padding: 14,
  },
  statusTextWrap: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  statusBody: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.backgroundSecondary,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  continueBtnDisabled: {
    opacity: 0.5,
  },
  continueBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 0.3,
  },
});
