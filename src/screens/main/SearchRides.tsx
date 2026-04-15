import React, { useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  BackHandler,
  Platform,
  ScrollView,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation } from '../../contexts/LocationContext';
import { COLORS } from '../../constants/colors';
import DatePickerModal from '../../components/common/DatePickerModal';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import {
  clearRecentSearches,
  loadRecentSearches,
  removeRecentSearch,
  type RecentSearchEntry,
} from '../../services/recent-search-storage';
import { briefRouteListLabel } from '../../utils/routeListBriefLabel';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayDateValue(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Check if date string (YYYY-MM-DD) is in the future; if past, return today. */
function resolveDateForRecent(dateStr: string): string {
  const today = todayDateValue();
  const [ey, em, ed] = dateStr.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  if (ey > ty || (ey === ty && em > tm) || (ey === ty && em === tm && ed >= td)) {
    return dateStr;
  }
  return today;
}

function formatDateLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dNorm = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (dNorm.getTime() === today.getTime()) return `Today, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (dNorm.getTime() === tomorrow.getTime()) return `Tomorrow, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function dateValueToLabel(value: string | null): string {
  if (!value) return 'Select date';
  const [y, m, d] = value.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return value;
  const date = new Date(y, m - 1, d);
  return formatDateLabel(date);
}

function formatRecentSubline(dateStr: string, passengersStr: string): string {
  const label = dateValueToLabel(dateStr);
  const n = Math.min(6, Math.max(1, parseInt(passengersStr, 10) || 1));
  const pax = n === 1 ? '1 pax' : `${n} pax`;
  return `${label} • ${pax}`;
}

function isSamePickupAndDestination(args: {
  from: string;
  to: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
}): boolean {
  const normalize = (v: string) =>
    v
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ');
  const toTokens = (v: string): string[] =>
    normalize(v)
      .split(' ')
      .filter((t) => t.length > 1);
  const fromNorm = normalize(args.from);
  const toNorm = normalize(args.to);
  if (fromNorm.length > 0 && fromNorm === toNorm) return true;
  const fromTokens = toTokens(args.from);
  const toTokensArr = toTokens(args.to);
  if (fromTokens.length >= 2 && toTokensArr.length >= 2) {
    const fromSet = new Set(fromTokens);
    const toSet = new Set(toTokensArr);
    let overlap = 0;
    fromSet.forEach((t) => {
      if (toSet.has(t)) overlap += 1;
    });
    const minSize = Math.min(fromSet.size, toSet.size);
    // Treat strong token overlap as same place (e.g. "modinagar sonda road" formatting variants).
    if (overlap >= 2 && overlap / Math.max(1, minSize) >= 0.66) return true;
  }
  const hasFromCoords =
    typeof args.fromLat === 'number' &&
    !Number.isNaN(args.fromLat) &&
    typeof args.fromLon === 'number' &&
    !Number.isNaN(args.fromLon);
  const hasToCoords =
    typeof args.toLat === 'number' &&
    !Number.isNaN(args.toLat) &&
    typeof args.toLon === 'number' &&
    !Number.isNaN(args.toLon);
  if (hasFromCoords && hasToCoords) {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const aLat = args.fromLat as number;
    const aLon = args.fromLon as number;
    const bLat = args.toLat as number;
    const bLon = args.toLon as number;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const km = 6371 * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
    // <=250m is operationally same stop for search.
    return km <= 0.25;
  }
  return false;
}

function searchRidesFormHasUserInput(args: {
  from: string;
  to: string;
  date: string | null;
  passengers: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
}): boolean {
  if (args.from.trim() || args.to.trim()) return true;
  if (args.date != null && String(args.date).trim() !== '') return true;
  const pax = Math.min(6, Math.max(1, parseInt(args.passengers, 10) || 1));
  if (pax !== 1) return true;
  if (
    typeof args.fromLat === 'number' &&
    Number.isFinite(args.fromLat) &&
    typeof args.fromLon === 'number' &&
    Number.isFinite(args.fromLon)
  ) {
    return true;
  }
  if (
    typeof args.toLat === 'number' &&
    Number.isFinite(args.toLat) &&
    typeof args.toLon === 'number' &&
    Number.isFinite(args.toLon)
  ) {
    return true;
  }
  return false;
}

export default function SearchRides(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user, isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const recentUserKey = (user?.id ?? user?.phone ?? '').trim();
  const { error: locationError } = useLocation();
  const welcomeName =
    user?.name?.trim() || user?.phone?.trim() || user?.email?.trim() || '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fromLat, setFromLat] = useState<number | undefined>(undefined);
  const [fromLon, setFromLon] = useState<number | undefined>(undefined);
  const [toLat, setToLat] = useState<number | undefined>(undefined);
  const [toLon, setToLon] = useState<number | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPassengersModal, setShowPassengersModal] = useState(false);
  const [passengers, setPassengers] = useState('1');
  const [recents, setRecents] = useState<RecentSearchEntry[]>([]);
  const tabResetHandledRef = useRef<number | null>(null);

  const passengersCount = Math.min(6, Math.max(1, parseInt(passengers, 10) || 1));
  const passengersLabel =
    passengersCount === 1 ? '1 passenger' : `${passengersCount} passengers`;

  const selectedDateForModal = date
    ? (() => {
        const [y, m, d] = date.split('-').map(Number);
        return new Date(y, m - 1, d);
      })()
    : null;

  const handleSelectDateFromModal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayStr = String(d.getDate()).padStart(2, '0');
    setDate(`${y}-${m}-${dayStr}`);
    setShowDatePicker(false);
  };

  useFocusEffect(
    useCallback(() => {
      if (!sessionReady) {
        setRecents([]);
        return;
      }
      void loadRecentSearches(recentUserKey).then(setRecents);
    }, [recentUserKey, sessionReady])
  );

  useFocusEffect(
    React.useCallback(() => {
      const params = route.params as {
        _tabResetToken?: number;
        selectedFrom?: string;
        selectedTo?: string;
        preservedDate?: string;
        preservedPassengers?: string;
        fromLatitude?: number;
        fromLongitude?: number;
        toLatitude?: number;
        toLongitude?: number;
      } | undefined;

      const token = params?._tabResetToken;
      if (typeof token === 'number' && token !== tabResetHandledRef.current) {
        tabResetHandledRef.current = token;
        setFrom('');
        setTo('');
        setFromLat(undefined);
        setFromLon(undefined);
        setToLat(undefined);
        setToLon(undefined);
        setDate(null);
        setPassengers('1');
        setShowDatePicker(false);
        setShowPassengersModal(false);
        return;
      }

      const selectedFrom = params?.selectedFrom;
      const selectedTo = params?.selectedTo;
      const preservedDate = params?.preservedDate;
      const preservedPassengers = params?.preservedPassengers;
      const fromLatitude = params?.fromLatitude;
      const fromLongitude = params?.fromLongitude;
      const toLatitude = params?.toLatitude;
      const toLongitude = params?.toLongitude;
      if (
        selectedFrom !== undefined ||
        selectedTo !== undefined ||
        preservedDate !== undefined ||
        preservedPassengers !== undefined ||
        fromLatitude !== undefined ||
        fromLongitude !== undefined ||
        toLatitude !== undefined ||
        toLongitude !== undefined
      ) {
        if (selectedFrom !== undefined) setFrom(String(selectedFrom ?? ''));
        if (selectedTo !== undefined) setTo(String(selectedTo ?? ''));
        if (preservedDate !== undefined) setDate(preservedDate ?? null);
        if (preservedPassengers !== undefined) {
          const n = parseInt(String(preservedPassengers), 10);
          setPassengers(Number.isNaN(n) ? '1' : String(Math.min(4, Math.max(1, n))));
        }
        if (fromLatitude !== undefined) setFromLat(fromLatitude);
        if (fromLongitude !== undefined) setFromLon(fromLongitude);
        if (toLatitude !== undefined) setToLat(toLatitude);
        if (toLongitude !== undefined) setToLon(toLongitude);
      }
    }, [route.params])
  );

  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const onBack = () => {
        if (
          searchRidesFormHasUserInput({
            from,
            to,
            date,
            passengers,
            fromLat: fromLat,
            fromLon: fromLon,
            toLat: toLat,
            toLon: toLon,
          })
        ) {
          setFrom('');
          setTo('');
          setFromLat(undefined);
          setFromLon(undefined);
          setToLat(undefined);
          setToLon(undefined);
          setDate(null);
          setPassengers('1');
          setShowDatePicker(false);
          setShowPassengersModal(false);
          return true;
        }
        BackHandler.exitApp();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [from, to, date, passengers, fromLat, fromLon, toLat, toLon])
  );

  const handleSwapFromTo = () => {
    setFrom(to);
    setTo(from);
    setFromLat(toLat);
    setFromLon(toLon);
    setToLat(fromLat);
    setToLon(fromLon);
  };

  const handleOpenLocationPicker = (field: 'from' | 'to') => {
    navigation.navigate('LocationPicker', {
      field,
      currentFrom: from,
      currentTo: to,
      currentDate: date ?? undefined,
      currentPassengers: passengers,
      currentFromLatitude: fromLat,
      currentFromLongitude: fromLon,
      currentToLatitude: toLat,
      currentToLongitude: toLon,
      returnScreen: 'SearchRides',
    });
  };

  const handleSearch = () => {
    const fromTrim = from.trim();
    const toTrim = to.trim();
    if (!fromTrim || !toTrim) {
      Alert.alert('Missing locations', 'Please enter pickup and destination.');
      return;
    }
    if (!date) {
      Alert.alert('Select date', 'Please select a date for your trip.');
      return;
    }
    const fromSelectedOnMap = fromLat != null && fromLon != null;
    const toSelectedOnMap = toLat != null && toLon != null;
    if (!fromSelectedOnMap || !toSelectedOnMap) {
      Alert.alert(
        'Select from map',
        'Choose pickup and destination from the location picker so we can match routes correctly.'
      );
      return;
    }
    const sameRoute = isSamePickupAndDestination({
      from: fromTrim,
      to: toTrim,
      fromLat,
      fromLon,
      toLat,
      toLon,
    });
    navigation.navigate('SearchResults', {
      from: fromTrim,
      to: toTrim,
      date,
      sameRouteWarning: sameRoute,
      passengers,
      ...(fromLat != null && fromLon != null && { fromLatitude: fromLat, fromLongitude: fromLon }),
      ...(toLat != null && toLon != null && { toLatitude: toLat, toLongitude: toLon }),
    });
  };

  const applyRecentSearch = (e: RecentSearchEntry) => {
    const sameRoute = isSamePickupAndDestination({
      from: e.from,
      to: e.to,
      fromLat: e.fromLatitude,
      fromLon: e.fromLongitude,
      toLat: e.toLatitude,
      toLon: e.toLongitude,
    });
    setFrom(e.from);
    setTo(e.to);
    const resolvedDate = resolveDateForRecent(e.date);
    setDate(resolvedDate);
    setPassengers(e.passengers);
    setFromLat(e.fromLatitude);
    setFromLon(e.fromLongitude);
    setToLat(e.toLatitude);
    setToLon(e.toLongitude);
    navigation.navigate('SearchResults', {
      from: e.from.trim(),
      to: e.to.trim(),
      date: resolvedDate,
      sameRouteWarning: sameRoute,
      passengers: e.passengers,
      ...(e.fromLatitude != null &&
        e.fromLongitude != null && {
          fromLatitude: e.fromLatitude,
          fromLongitude: e.fromLongitude,
        }),
      ...(e.toLatitude != null &&
        e.toLongitude != null && {
          toLatitude: e.toLatitude,
          toLongitude: e.toLongitude,
        }),
    });
  };

  const onRemoveRecent = async (id: string) => {
    await removeRecentSearch(id, recentUserKey);
    setRecents(await loadRecentSearches(recentUserKey));
  };

  const onClearRecents = async () => {
    await clearRecentSearches(recentUserKey);
    setRecents([]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {sessionReady ? (
          <Text style={styles.welcomeLine}>
            {welcomeName ? (
              <>
                Welcome,{' '}
                <Text style={styles.welcomeName}>{welcomeName}</Text>
              </>
            ) : (
              'Welcome back'
            )}
          </Text>
        ) : null}
        <Text style={styles.heroTitle}>Find a ride</Text>
        <Text style={styles.heroSubtitle}>Set pickup, destination & date</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.iconCol}>
              <View style={styles.greenDot} />
              <View style={styles.dottedLine} />
            </View>
            <TouchableOpacity
              style={styles.inputWrap}
              onPress={() => handleOpenLocationPicker('from')}
              activeOpacity={0.7}
            >
              <Text style={[styles.pickupText, !from && styles.placeholder]} numberOfLines={1}>
                {from || 'Add pickup'}
              </Text>
              <Text style={styles.label}>Pickup</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.swapButton}
              onPress={handleSwapFromTo}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Ionicons name="swap-vertical" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.row}
            onPress={() => handleOpenLocationPicker('to')}
            activeOpacity={0.7}
          >
            <View style={styles.iconCol}>
              <View style={styles.redPin} />
            </View>
            <View style={styles.inputWrap}>
              <Text style={[styles.pickupText, !to && styles.placeholder]} numberOfLines={1}>
                {to || 'Add destination'}
              </Text>
              <Text style={styles.label}>Destination</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.cardDivider} />

          <TouchableOpacity
            style={styles.row}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <View style={styles.iconCol}>
              <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} />
            </View>
            <View style={styles.inputWrap}>
              <Text style={[styles.pickupText, !date && styles.placeholder]} numberOfLines={1}>
                {dateValueToLabel(date)}
              </Text>
              <Text style={styles.label}>Date</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.row}
            onPress={() => setShowPassengersModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.iconCol}>
              <Ionicons name="people-outline" size={22} color={COLORS.textSecondary} />
            </View>
            <View style={styles.inputWrap}>
              <Text style={styles.pickupText} numberOfLines={1}>
                {passengersLabel}
              </Text>
              <Text style={styles.label}>Passengers</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleSearch}
            activeOpacity={0.85}
          >
            <Text style={styles.searchButtonText}>Search</Text>
          </TouchableOpacity>
        </View>

        {sessionReady && recents.length > 0 ? (
          <View style={styles.recentsSection}>
            <View style={styles.recentsHeader}>
              <Text style={styles.recentsTitle}>RECENT SEARCHES</Text>
              <TouchableOpacity onPress={() => void onClearRecents()} hitSlop={8}>
                <Text style={styles.clearAll}>Clear all</Text>
              </TouchableOpacity>
            </View>
            {recents.map((item) => (
              <View key={item.id} style={styles.recentItem}>
                <TouchableOpacity
                  style={styles.recentItemMain}
                  onPress={() => applyRecentSearch(item)}
                  activeOpacity={0.72}
                >
                  <View style={styles.recentIconCircle}>
                    <Ionicons name="time-outline" size={14} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.recentTextCol}>
                    <View style={styles.recentRouteStack}>
                      <View style={styles.recentRouteLineRow}>
                        <View style={styles.recentLineIcon}>
                          <Ionicons name="ellipse" size={6} color={COLORS.primary} />
                        </View>
                        <Text style={styles.recentRouteTitle} numberOfLines={1} ellipsizeMode="tail">
                          {briefRouteListLabel(item.from)}
                        </Text>
                      </View>
                      <View style={[styles.recentRouteLineRow, styles.recentRouteLineRowSecond]}>
                        <View style={styles.recentLineIcon}>
                          <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
                        </View>
                        <Text style={styles.recentRouteSubtitle} numberOfLines={1} ellipsizeMode="tail">
                          {briefRouteListLabel(item.to)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.recentMeta} numberOfLines={1}>
                      {formatRecentSubline(item.date, item.passengers)}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.recentClose}
                  onPress={() => void onRemoveRecent(item.id)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel="Remove from recent searches"
                >
                  <Ionicons name="close" size={17} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {locationError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{locationError}</Text>
          </View>
        ) : null}
      </ScrollView>

      <DatePickerModal
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        selectedDate={selectedDateForModal}
        onSelectDate={handleSelectDateFromModal}
        title="When are you going? Select date."
      />

      <PassengersPickerModal
        visible={showPassengersModal}
        onClose={() => setShowPassengersModal(false)}
        value={passengersCount}
        onDone={(n) => setPassengers(String(n))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scroll: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
  },
  welcomeLine: {
    fontSize: 20,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  welcomeName: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.6,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 20,
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 10,
    marginLeft: 46,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
  },
  swapButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  iconCol: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  greenDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: '#fff',
  },
  dottedLine: {
    width: 2,
    flex: 1,
    minHeight: 22,
    marginVertical: 4,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    borderStyle: 'dashed',
  },
  redPin: {
    width: 12,
    height: 16,
    backgroundColor: COLORS.error,
    borderRadius: 6,
  },
  inputWrap: {
    flex: 1,
    marginLeft: 14,
  },
  pickupText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
  },
  label: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 3,
    fontWeight: '500',
  },
  placeholder: {
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  searchButton: {
    marginTop: 18,
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
  },
  recentsSection: {
    marginTop: 24,
  },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  recentsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
  },
  clearAll: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    marginBottom: 9,
    overflow: 'hidden',
  },
  recentItemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 5,
    minHeight: 48,
  },
  recentIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  recentTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  recentRouteStack: {
    marginBottom: 2,
  },
  recentRouteLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 20,
  },
  recentRouteLineRowSecond: {
    marginTop: 4,
  },
  recentLineIcon: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentRouteTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  recentRouteSubtitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    letterSpacing: -0.1,
  },
  recentMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
    fontWeight: '500',
  },
  recentClose: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  errorBanner: {
    marginTop: 16,
    marginHorizontal: 0,
    backgroundColor: 'rgba(239,68,68,0.92)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    zIndex: 10,
  },
  errorText: {
    fontSize: 13,
    color: '#fff',
  },
});
