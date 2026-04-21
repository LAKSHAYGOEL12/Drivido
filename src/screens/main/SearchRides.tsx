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
import { useMainTabScrollBottomInset } from '../../navigation/useMainTabScrollBottomInset';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
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
  const pax = n === 1 ? '1 passenger' : `${n} passengers`;
  return `${label} · ${pax}`;
}

function firstNameFromDisplay(full: string): string {
  const t = full.trim();
  if (!t) return '';
  const parts = t.split(/\s+/).filter(Boolean);
  return parts[0] ?? t;
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
  const mainTabScrollBottomPad = useMainTabScrollBottomInset();
  const recentUserKey = (user?.id ?? user?.phone ?? '').trim();
  const welcomeName =
    user?.name?.trim() || user?.phone?.trim() || user?.email?.trim() || '';
  const welcomeShort = firstNameFromDisplay(welcomeName);
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
      Alert.alert('Pickup and destination required', 'Add both a pickup and a destination to continue.');
      return;
    }
    if (!date) {
      Alert.alert('Travel date required', 'Choose a date for this trip.');
      return;
    }
    const fromSelectedOnMap = fromLat != null && fromLon != null;
    const toSelectedOnMap = toLat != null && toLon != null;
    if (!fromSelectedOnMap || !toSelectedOnMap) {
      Alert.alert(
        'Confirm locations on the map',
        'Open the location picker and confirm pickup and destination on the map so we can match routes accurately.'
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: mainTabScrollBottomPad }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroBlock}>
          {sessionReady ? (
            <View style={styles.greetingChip}>
              <Text style={styles.greetingChipText}>
                {welcomeShort ? (
                  <>
                    Hi, <Text style={styles.greetingChipName}>{welcomeShort}</Text>
                  </>
                ) : (
                  'Hi there'
                )}
              </Text>
            </View>
          ) : null}
          <Text style={styles.heroEyebrow}>Search</Text>
          <Text style={styles.heroTitle}>Find a ride</Text>
          <Text style={styles.heroSubtitle}>Where are you heading?</Text>
        </View>

        <View style={styles.mainCard}>
          <View style={styles.routeSection}>
            <Text style={[styles.cardSectionLabel, styles.cardSectionLabelRoute]}>Your route</Text>

            <View style={styles.locationCard}>
              <View style={[styles.locationRail, styles.locationRailCompact]}>
                <View style={[styles.greenDot, styles.greenDotCompact]} />
                <View style={[styles.locationRailLine, styles.locationRailLineCompact]} />
                <View style={[styles.redPin, styles.redPinCompact]} />
              </View>
              <View style={[styles.locationFields, styles.locationFieldsCompact]}>
                <View style={styles.routeFieldsRow}>
                  <View style={styles.routeFieldsStack}>
                    <TouchableOpacity
                      style={[
                        styles.fieldCell,
                        styles.fieldCellPickup,
                        styles.fieldCellCompact,
                        styles.fieldCellPickupCompact,
                      ]}
                      onPress={() => handleOpenLocationPicker('from')}
                      activeOpacity={0.65}
                    >
                      <Text style={[styles.fieldCaption, styles.fieldCaptionCompact]}>Pickup</Text>
                      <Text
                        style={[
                          styles.fieldValue,
                          styles.fieldValueCompact,
                          !from.trim() && styles.fieldPlaceholder,
                        ]}
                        numberOfLines={2}
                      >
                        {from.trim() ? from : 'City or address'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.fieldCell, styles.fieldCellCompact]}
                      onPress={() => handleOpenLocationPicker('to')}
                      activeOpacity={0.65}
                    >
                      <Text style={[styles.fieldCaption, styles.fieldCaptionCompact]}>Destination</Text>
                      <Text
                        style={[
                          styles.fieldValue,
                          styles.fieldValueCompact,
                          !to.trim() && styles.fieldPlaceholder,
                        ]}
                        numberOfLines={2}
                      >
                        {to.trim() ? to : 'City or address'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.swapRailColumn, styles.swapRailColumnCompact]}>
                    <TouchableOpacity
                      style={[styles.swapCompact, styles.swapCompactTight]}
                      onPress={handleSwapFromTo}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                      activeOpacity={0.7}
                      accessibilityLabel="Swap pickup and destination"
                    >
                      <Ionicons name="swap-vertical" size={19} color={COLORS.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <Text style={[styles.cardSectionLabel, styles.cardSectionLabelSecond]}>When & who</Text>
          <View style={styles.metaPanel}>
            <TouchableOpacity
              style={styles.metaRow}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.65}
            >
              <View style={styles.metaIconWrap}>
                <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
              </View>
              <View style={styles.metaTextCol}>
                <Text style={styles.metaPrimary} numberOfLines={1}>
                  {date ? dateValueToLabel(date) : 'Pick a date'}
                </Text>
                <Text style={styles.metaHint}>Travel day</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
            <View style={styles.metaDivider} />
            <TouchableOpacity
              style={styles.metaRow}
              onPress={() => setShowPassengersModal(true)}
              activeOpacity={0.65}
            >
              <View style={styles.metaIconWrap}>
                <Ionicons name="people-outline" size={20} color={COLORS.primary} />
              </View>
              <View style={styles.metaTextCol}>
                <Text style={styles.metaPrimary} numberOfLines={1}>
                  {passengersLabel}
                </Text>
                <Text style={styles.metaHint}>Seats</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.searchCta} onPress={handleSearch} activeOpacity={0.88}>
            <Ionicons name="search" size={22} color={COLORS.white} style={styles.searchCtaIcon} />
            <Text style={styles.searchCtaText}>Search rides</Text>
          </TouchableOpacity>
        </View>

        {sessionReady && recents.length > 0 ? (
          <View style={styles.recentsSection}>
            <View style={styles.recentsHeader}>
              <View>
                <Text style={styles.recentsOverline}>History</Text>
                <Text style={styles.recentsTitle}>Recent searches</Text>
              </View>
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => void onClearRecents()}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Text style={styles.clearAll}>Clear</Text>
              </TouchableOpacity>
            </View>
            {recents.map((item) => (
              <View key={item.id} style={styles.recentItem}>
                <TouchableOpacity
                  style={styles.recentItemMain}
                  onPress={() => applyRecentSearch(item)}
                  activeOpacity={0.65}
                >
                  <View style={styles.recentAccent} />
                  <View style={styles.recentIconCircle}>
                    <Ionicons name="navigate-outline" size={16} color={COLORS.primary} />
                  </View>
                  <View style={styles.recentTextCol}>
                    <View style={styles.recentRouteStack}>
                      <Text style={styles.recentRouteTitle} numberOfLines={1} ellipsizeMode="tail">
                        {briefRouteListLabel(item.from)}
                      </Text>
                      <View style={styles.recentArrowRow}>
                        <View style={styles.recentArrowLine} />
                        <Ionicons name="arrow-down" size={12} color={COLORS.textMuted} />
                        <View style={styles.recentArrowLine} />
                      </View>
                      <Text style={styles.recentRouteSubtitle} numberOfLines={1} ellipsizeMode="tail">
                        {briefRouteListLabel(item.to)}
                      </Text>
                    </View>
                    <Text style={styles.recentMeta} numberOfLines={1}>
                      {formatRecentSubline(item.date, item.passengers)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.border} style={styles.recentChevron} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.recentClose}
                  onPress={() => void onRemoveRecent(item.id)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityLabel="Remove from recent searches"
                >
                  <Ionicons name="close-circle-outline" size={22} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <DatePickerModal
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        selectedDate={selectedDateForModal}
        onSelectDate={handleSelectDateFromModal}
        title="Select travel date"
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
    backgroundColor: COLORS.backgroundSecondary,
  },
  scroll: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  heroBlock: {
    marginBottom: 22,
  },
  greetingChip: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryMuted22,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    marginBottom: 14,
  },
  greetingChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  greetingChipName: {
    fontWeight: '800',
    color: COLORS.text,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: COLORS.primary,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  heroSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 6,
    lineHeight: 22,
  },
  mainCard: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },
  cardSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  cardSectionLabelSecond: {
    marginTop: 18,
    marginBottom: 12,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  locationRail: {
    width: 22,
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  greenDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  locationRailLine: {
    flex: 1,
    width: 2,
    marginVertical: 6,
    backgroundColor: COLORS.border,
    borderRadius: 1,
    minHeight: 28,
  },
  redPin: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.error,
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: COLORS.error,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 1,
  },
  locationFields: {
    flex: 1,
    marginLeft: 14,
    minWidth: 0,
  },
  routeFieldsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  routeFieldsStack: {
    flex: 1,
    minWidth: 0,
  },
  fieldCellPickup: {
    marginBottom: 8,
  },
  /** Tighter “Your route” block only — date / passengers / CTA unchanged. */
  routeSection: {
    marginBottom: 0,
  },
  cardSectionLabelRoute: {
    marginBottom: 10,
    fontSize: 10,
    letterSpacing: 0.65,
  },
  locationRailCompact: {
    width: 18,
    paddingTop: 4,
    paddingBottom: 2,
  },
  greenDotCompact: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  locationRailLineCompact: {
    marginVertical: 4,
    minHeight: 22,
  },
  redPinCompact: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  locationFieldsCompact: {
    marginLeft: 10,
  },
  fieldCellCompact: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  fieldCellPickupCompact: {
    marginBottom: 6,
  },
  fieldCaptionCompact: {
    fontSize: 10,
    marginBottom: 2,
    letterSpacing: 0.35,
  },
  fieldValueCompact: {
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: -0.15,
  },
  swapRailColumnCompact: {
    width: 38,
    paddingLeft: 4,
  },
  swapCompactTight: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  swapRailColumn: {
    justifyContent: 'center',
    paddingLeft: 6,
    width: 44,
  },
  swapCompact: {
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primaryRipple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldCell: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
  },
  fieldCaption: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
    lineHeight: 22,
  },
  fieldPlaceholder: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  metaPanel: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  metaIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primaryRipple,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  metaTextCol: {
    flex: 1,
    minWidth: 0,
  },
  metaPrimary: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  metaHint: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  metaDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginLeft: 66,
  },
  searchCta: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: COLORS.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  searchCtaIcon: {
    marginRight: 2,
  },
  searchCtaText: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.2,
  },
  recentsSection: {
    marginTop: 28,
  },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  recentsOverline: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  recentsTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.4,
  },
  clearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  clearAll: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  recentItemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingLeft: 0,
    paddingRight: 6,
    minHeight: 52,
    position: 'relative',
  },
  recentAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: COLORS.primary,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  recentIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
    marginRight: 12,
  },
  recentTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  recentRouteStack: {
    marginBottom: 2,
  },
  recentRouteTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  recentArrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    paddingRight: 24,
  },
  recentArrowLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
  },
  recentRouteSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: -0.15,
  },
  recentMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 8,
  },
  recentChevron: {
    marginRight: 4,
  },
  recentClose: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
    alignSelf: 'center',
  },
});
