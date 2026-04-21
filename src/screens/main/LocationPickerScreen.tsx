import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  CommonActions,
  StackActions,
  useFocusEffect,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Dimensions,
  Platform,
  FlatList,
  Keyboard,
  ScrollView,
  BackHandler,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from '../../utils/themedAlert';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SharedLocationPickerParams } from '../../navigation/types';
import type { MainTabName } from '../../navigation/mainTabOrder';
import { dispatchResetPublishStackToWizardRoot } from '../../navigation/publishStackWizardRoot';
import { useLocation } from '../../contexts/LocationContext';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import { OFFLINE_HEADLINE, OFFLINE_SUBTITLE_RETRY } from '../../constants/offlineMessaging';
import { Ionicons } from '@expo/vector-icons';
import {
  getPlaceSuggestions,
  getPlaceDetails,
  geocodeAddress,
  nearbyPlaces,
  type PlacePrediction,
  type NearbyPlace,
} from '../../services/places';
import {
  loadPlaceRecents,
  upsertPlaceRecent,
  type PlaceRecentEntry,
  type PlaceRecentFieldType,
} from '../../services/place-recent-storage';
import type { RecentPublishedEntry } from '../../services/recent-published-storage';
import { showToast } from '../../utils/toast';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';

type LocationPickerRoute = RouteProp<{ LocationPicker: SharedLocationPickerParams | undefined }, 'LocationPicker'>;

type Props = {
  /** Same screen is registered on multiple stacks; use a loose navigation type and typed params. */
  navigation: NavigationProp<ParamListBase>;
  route: LocationPickerRoute;
};

const DEFAULT_REGION = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

const STREET_DELTA = 0.012;
const NEIGHBORHOOD_DELTA = 0.04;
/** ~45m — skip reverse-geocode when map center barely moved (fewer native geocode calls). */
const PUBLISH_MIN_MOVE_FOR_GEOCODE_DEG = 0.00042;
/** Wait after map stops before reverse-geocode (lets user finish dragging). */
const PUBLISH_REVERSE_GEOCODE_DEBOUNCE_MS = 1750;
/** Ignore region events right after programmatic `animateToRegion` (no extra geocode). */
const PUBLISH_SKIP_GEOCODE_AFTER_ANIM_MS = 950;
/** Treat stops as same place when within this radius (handles tiny coordinate jitter). */
const SAME_STOP_MAX_KM = 0.25;

function centerRegion(lat: number, lng: number, delta = STREET_DELTA) {
  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

function newPlacesSessionToken(): string {
  // Places Autocomplete accepts any opaque token string for session billing.
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePlaceLabel(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hasCoords(v?: { latitude?: number; longitude?: number } | null): v is { latitude: number; longitude: number } {
  return (
    !!v &&
    typeof v.latitude === 'number' &&
    !Number.isNaN(v.latitude) &&
    typeof v.longitude === 'number' &&
    !Number.isNaN(v.longitude)
  );
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 6371 * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function stopsAreSamePlace(args: {
  fromLabel?: string;
  toLabel?: string;
  fromCoords?: { latitude?: number; longitude?: number } | null;
  toCoords?: { latitude?: number; longitude?: number } | null;
}): boolean {
  const fromNorm = normalizePlaceLabel(args.fromLabel);
  const toNorm = normalizePlaceLabel(args.toLabel);
  if (fromNorm.length > 0 && fromNorm === toNorm) return true;
  if (hasCoords(args.fromCoords) && hasCoords(args.toCoords)) {
    return distanceKm(args.fromCoords, args.toCoords) <= SAME_STOP_MAX_KM;
  }
  return false;
}

let MapView: React.ComponentType<any> | null = null;
let Marker: React.ComponentType<any> | null = null;
let PROVIDER_DEFAULT: string | undefined;
try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  PROVIDER_DEFAULT = maps.PROVIDER_DEFAULT;
} catch {
  MapView = null;
  Marker = null;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function findNavigatorWithRouteName(
  navigation: { getParent?: () => unknown; getState?: () => { routeNames?: string[] } },
  routeName: string,
  maxHops = 16
): { getParent?: () => unknown; dispatch?: (a: unknown) => void; getState?: () => { routeNames?: string[] } } | null {
  let walker: unknown = navigation;
  for (let i = 0; i < maxHops && walker; i += 1) {
    const n = walker as { getState?: () => { routeNames?: string[] }; getParent?: () => unknown };
    const names = n.getState?.()?.routeNames;
    if (Array.isArray(names) && names.includes(routeName)) {
      return n as { dispatch?: (a: unknown) => void; getParent?: () => unknown; getState?: () => { routeNames?: string[] } };
    }
    walker = n.getParent?.();
  }
  return null;
}

/**
 * `PublishStack` is mounted at the app root (not inside bottom tabs). When `LocationPicker` is opened
 * from stacks like `RidesStack` (Edit & publish), local `replace('PublishRoutePreview')` is not handled.
 * Prefer the navigator that actually owns `PublishRoutePreview`, else fall back to root ref.
 */
function goToPublishRoutePreview(
  navigation: unknown,
  params: Record<string, unknown>,
  usePush: boolean
): void {
  const publishNav = findNavigatorWithRouteName(
    navigation as { getParent?: () => unknown; getState?: () => { routeNames?: string[] } },
    'PublishRoutePreview'
  );

  const action = usePush
    ? StackActions.push('PublishRoutePreview', params)
    : StackActions.replace('PublishRoutePreview', params);

  if (publishNav?.dispatch) {
    publishNav.dispatch(action);
    return;
  }

  const dismissPickerIfNeeded = (): void => {
    try {
      if (typeof (navigation as { canGoBack?: () => boolean }).canGoBack === 'function') {
        if ((navigation as { canGoBack: () => boolean }).canGoBack()) {
          (navigation as { goBack: () => void }).goBack();
        }
      }
    } catch {
      /** ignore */
    }
  };

  /**
   * From nested stacks (e.g. Your Rides → PublishRecentEdit → LocationPicker), opening root `PublishStack`
   * and then calling `goBack()` here used to reorder transitions so users only saw the picker dismiss and
   * landed back on the republish form. Dismiss the picker first, then open `PublishStack` on the next frame
   * (same `merge` pattern as {@link navigatePublishStackRecentEdit} for a predictable nested target).
   */
  const dispatchViaRoot = (): boolean => {
    if (!rootNavigationRef.isReady() || !rootNavigationRef.dispatch) return false;
    rootNavigationRef.dispatch(
      CommonActions.navigate({
        name: 'PublishStack',
        /** `false` for “replace” semantics: republish / first route preview should own the publish stack. */
        merge: usePush,
        params: {
          screen: 'PublishRoutePreview',
          params,
        },
      } as never)
    );
    return true;
  };

  dismissPickerIfNeeded();

  const tryOpen = (): void => {
    if (dispatchViaRoot()) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (dispatchViaRoot() || tries >= 40) {
        clearInterval(id);
      }
    }, 50);
  };

  requestAnimationFrame(() => {
    tryOpen();
  });
}

export default function LocationPickerScreen({ navigation, route }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const field = route.params?.field ?? 'from';
  const currentFrom = route.params?.currentFrom ?? '';
  const currentTo = route.params?.currentTo ?? '';
  const p = route.params;
  const currentPickupLat = p?.currentPickupLatitude;
  const currentPickupLon = p?.currentPickupLongitude;
  const currentDestLat = p?.currentDestinationLatitude;
  const currentDestLon = p?.currentDestinationLongitude;
  const currentDate = p?.currentDate;
  const currentPassengers = p?.currentPassengers ?? '1';
  const currentFromLat = p?.currentFromLatitude;
  const currentFromLon = p?.currentFromLongitude;
  const currentToLat = p?.currentToLatitude;
  const currentToLon = p?.currentToLongitude;
  const returnScreen = p?.returnScreen ?? 'SearchRides';
  const publishRestoreKey = p?.publishRestoreKey;
  const publishRecentEditEntry = p?.publishRecentEditEntry;
  const publishWizardReview = p?.publishWizardReview === true;
  const publishFabExitTab = p?.publishFabExitTab;
  const mapRef = useRef<any>(null);
  const {
    location,
    requestLocation,
    prefetchLocation,
    isLoading: locationLoading,
    error: locationError,
    canShowUseCurrentLocation,
  } = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const { user } = useAuth();
  const recentUserKey = (user?.id ?? user?.phone ?? '').trim();
  const placeFieldType: PlaceRecentFieldType = field === 'from' ? 'pickup' : 'destination';
  const [recentPlaces, setRecentPlaces] = useState<PlaceRecentEntry[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  const placesSessionTokenRef = useRef<string | null>(null);
  const skipAutocompleteRef = useRef(false);
  const suppressMapExploreRef = useRef(false);

  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [useCurrentLoading, setUseCurrentLoading] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [reverseGeocodeLoading, setReverseGeocodeLoading] = useState(false);
  const [nearbyPlacesList, setNearbyPlacesList] = useState<NearbyPlace[]>([]);
  const [mapExploring, setMapExploring] = useState(false);
  /** false when user dropped pin by tapping map — no name on map marker */
  const [showNameOnSelectedMarker, setShowNameOnSelectedMarker] = useState(true);
  const mapExploreSeq = useRef(0);
  const publishGeocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Publish: map hidden until user types, picks a place, or opens map manually (unless pre-filled from Publish). */
  const [publishMapVisible, setPublishMapVisible] = useState(false);
  const skipPublishGeocodeUntilRef = useRef(0);
  const lastPublishGeocodedRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const isPublishFlow = returnScreen === 'PublishWizard' || returnScreen === 'PublishRecentEdit';
  const publishSearchOnly = isPublishFlow && !publishMapVisible;
  /** Full-screen map + floating controls (Publish). */
  const publishImmersiveMap = isPublishFlow && publishMapVisible;

  /**
   * Publish: hardware/header back. FAB wizard starts on pickup only — no `goBack()` target → leave
   * Publish tab to the screen the user was on before opening the FAB (`publishFabExitTab`).
   */
  const dismissPublishLocationPicker = useCallback(() => {
    /**
     * Safety fallback: destination step should always return to pickup in wizard flows.
     * If stack back state is unavailable for any reason, rebuild pickup as root instead of exiting tabs.
     */
    if (isPublishFlow && field === 'to' && !navigation.canGoBack()) {
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: 'LocationPicker' as const,
              params: {
                field: 'from' as const,
                currentFrom: currentFrom ?? '',
                currentTo: currentTo ?? '',
                currentPickupLatitude: currentPickupLat ?? 0,
                currentPickupLongitude: currentPickupLon ?? 0,
                currentDestinationLatitude: currentDestLat ?? 0,
                currentDestinationLongitude: currentDestLon ?? 0,
                returnScreen,
                ...(publishRestoreKey ? { publishRestoreKey } : {}),
                ...(publishRecentEditEntry ? { publishRecentEditEntry } : {}),
                ...(publishWizardReview ? { publishWizardReview: true } : {}),
                ...(publishFabExitTab ? { publishFabExitTab } : {}),
              },
            },
          ],
        }) as never
      );
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (publishFabExitTab) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'Main',
          params: { screen: publishFabExitTab },
          merge: false,
        } as never)
      );
      return;
    }
    if (isPublishFlow) {
      dispatchResetPublishStackToWizardRoot(navigation);
    }
  }, [
    navigation,
    isPublishFlow,
    field,
    currentFrom,
    currentTo,
    currentPickupLat,
    currentPickupLon,
    currentDestLat,
    currentDestLon,
    returnScreen,
    publishRestoreKey,
    publishRecentEditEntry,
    publishWizardReview,
    publishFabExitTab,
  ]);

  useEffect(() => {
    if (!publishFabExitTab) return undefined;
    return navigation.addListener('beforeRemove', (e) => {
      if (field !== 'from') return;
      if (navigation.canGoBack()) return;
      const actionType = (e.data as { action?: { type?: string } } | undefined)?.action?.type;
      /** Let programmatic stack clears through (e.g. after publish). Everything else is user back / gesture. */
      if (actionType === 'RESET') return;
      e.preventDefault();
      navigation.dispatch(
        CommonActions.navigate({
          name: 'Main',
          params: { screen: publishFabExitTab },
          merge: false,
        } as never)
      );
    });
  }, [navigation, publishFabExitTab, field]);

  /**
   * Android: predictive back + edge gesture often route through `BackHandler` more reliably than
   * `beforeRemove` alone when this screen is the stack root (`canGoBack` false).
   */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      if (!publishFabExitTab) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        dismissPublishLocationPicker();
        return true;
      });
      return () => sub.remove();
    }, [publishFabExitTab, dismissPublishLocationPicker])
  );

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

  const bumpSkipPublishGeocode = useCallback((ms = PUBLISH_SKIP_GEOCODE_AFTER_ANIM_MS) => {
    skipPublishGeocodeUntilRef.current = Date.now() + ms;
  }, []);

  const loadRecentsForField = useCallback(async () => {
    const list = await loadPlaceRecents(placeFieldType, recentUserKey);
    setRecentPlaces(list);
  }, [placeFieldType, recentUserKey]);

  const hasValidCoord = useCallback((lat: unknown, lon: unknown): boolean => {
    if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) {
      return false;
    }
    return lat !== 0 || lon !== 0;
  }, []);

  useEffect(() => {
    if (returnScreen === 'SearchRides' || isPublishFlow) {
      setIsFocused(true);
      void loadRecentsForField();
      placesSessionTokenRef.current = newPlacesSessionToken();
    }
  }, [returnScreen, isPublishFlow, loadRecentsForField]);

  useEffect(() => {
    if (!isPublishFlow) return;
    setSuggestions([]);
    setNearbyPlacesList([]);
    setMapExploring(false);
    suppressMapExploreRef.current = false;
    lastPublishGeocodedRef.current = null;
    if (field === 'from') {
      const lab = (currentFrom ?? '').trim();
      const hasCoords = hasValidCoord(currentPickupLat, currentPickupLon);
      const hadPrefill = lab.length > 0 || hasCoords;
      setSearchQuery(lab);
      setSelectedLabel(lab.length > 0 ? lab : null);
      if (hasCoords) {
        setSelectedCoords({ latitude: currentPickupLat as number, longitude: currentPickupLon as number });
      } else {
        setSelectedCoords(null);
      }
      skipAutocompleteRef.current = hadPrefill;
      setPublishMapVisible(hasCoords);
      if (hasCoords) bumpSkipPublishGeocode();
    } else {
      const lab = (currentTo ?? '').trim();
      const hasCoords = hasValidCoord(currentDestLat, currentDestLon);
      const hadPrefill = lab.length > 0 || hasCoords;
      setSearchQuery(lab);
      setSelectedLabel(lab.length > 0 ? lab : null);
      if (hasCoords) {
        setSelectedCoords({ latitude: currentDestLat as number, longitude: currentDestLon as number });
      } else {
        setSelectedCoords(null);
      }
      skipAutocompleteRef.current = hadPrefill;
      setPublishMapVisible(hasCoords);
      if (hasCoords) bumpSkipPublishGeocode();
    }
  }, [
    returnScreen,
    field,
    currentFrom,
    currentTo,
    currentPickupLat,
    currentPickupLon,
    currentDestLat,
    currentDestLon,
    hasValidCoord,
    bumpSkipPublishGeocode,
    isPublishFlow,
  ]);

  useEffect(() => {
    return () => {
      if (publishGeocodeTimerRef.current) clearTimeout(publishGeocodeTimerRef.current);
    };
  }, []);

  const didAutoCenterUserRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      didAutoCenterUserRef.current = false;
      if (!isPublishFlow) {
        prefetchLocation();
      }
    }, [prefetchLocation, isPublishFlow])
  );

  const mapInitialRegion = useMemo(() => {
    const has = (n: unknown): n is number => typeof n === 'number' && !Number.isNaN(n);
    if (isPublishFlow) {
      if (selectedCoords && has(selectedCoords.latitude) && has(selectedCoords.longitude)) {
        return centerRegion(selectedCoords.latitude, selectedCoords.longitude);
      }
      if (field === 'from' && has(currentPickupLat) && has(currentPickupLon)) {
        return centerRegion(currentPickupLat, currentPickupLon);
      }
      if (field === 'to' && has(currentDestLat) && has(currentDestLon)) {
        return centerRegion(currentDestLat, currentDestLon);
      }
      if (field === 'to' && has(currentPickupLat) && has(currentPickupLon)) {
        return centerRegion(currentPickupLat, currentPickupLon, NEIGHBORHOOD_DELTA);
      }
      return DEFAULT_REGION;
    }
    if (field === 'from' && has(currentFromLat) && has(currentFromLon)) {
      return centerRegion(currentFromLat, currentFromLon);
    }
    if (field === 'to' && has(currentToLat) && has(currentToLon)) {
      return centerRegion(currentToLat, currentToLon);
    }
    if (location) {
      return centerRegion(location.latitude, location.longitude);
    }
    return DEFAULT_REGION;
  }, [
    isPublishFlow,
    returnScreen,
    field,
    currentPickupLat,
    currentPickupLon,
    currentDestLat,
    currentDestLon,
    currentFromLat,
    currentFromLon,
    currentToLat,
    currentToLon,
    location?.latitude,
    location?.longitude,
  ]);

  const animateToUserLocation = useCallback((lat: number, lng: number) => {
    mapRef.current?.animateToRegion?.(centerRegion(lat, lng, STREET_DELTA), 550);
  }, []);

  useEffect(() => {
    if (isPublishFlow || !location) return;
    const t = setTimeout(() => {
      if (!didAutoCenterUserRef.current && mapRef.current) {
        animateToUserLocation(location.latitude, location.longitude);
        didAutoCenterUserRef.current = true;
      }
    }, 380);
    return () => clearTimeout(t);
  }, [isPublishFlow, location?.latitude, location?.longitude, animateToUserLocation]);

  const focusPublishMapOnCoords = useCallback(
    (coords: { latitude: number; longitude: number }) => {
      bumpSkipPublishGeocode();
      const region = { ...coords, latitudeDelta: STREET_DELTA, longitudeDelta: STREET_DELTA };
      const apply = () => mapRef.current?.animateToRegion?.(region, 380);
      apply();
      requestAnimationFrame(apply);
      setTimeout(apply, 120);
      setTimeout(apply, 420);
    },
    [bumpSkipPublishGeocode]
  );

  const onMapReady = useCallback(() => {
    if (isPublishFlow) {
      if (publishMapVisible && selectedCoords) {
        focusPublishMapOnCoords(selectedCoords);
      }
      return;
    }
    if (location && !didAutoCenterUserRef.current) {
      animateToUserLocation(location.latitude, location.longitude);
      didAutoCenterUserRef.current = true;
    }
  }, [
    isPublishFlow,
    publishMapVisible,
    selectedCoords,
    focusPublishMapOnCoords,
    location,
    animateToUserLocation,
  ]);

  const navigateBackWithValue = useCallback(
    (value: string | undefined, coords?: { latitude: number; longitude: number }) => {
      const nextFromLabel = field === 'from' ? value : currentFrom;
      const nextToLabel = field === 'to' ? value : currentTo;
      const fallbackFromCoords =
        returnScreen === 'SearchRides'
          ? { latitude: currentFromLat, longitude: currentFromLon }
          : { latitude: currentPickupLat, longitude: currentPickupLon };
      const fallbackToCoords =
        returnScreen === 'SearchRides'
          ? { latitude: currentToLat, longitude: currentToLon }
          : { latitude: currentDestLat, longitude: currentDestLon };
      const nextFromCoords = field === 'from' ? (coords ?? fallbackFromCoords) : fallbackFromCoords;
      const nextToCoords = field === 'to' ? (coords ?? fallbackToCoords) : fallbackToCoords;
      if (
        (returnScreen === 'PublishWizard' || returnScreen === 'PublishRecentEdit') &&
        stopsAreSamePlace({
          fromLabel: String(nextFromLabel ?? ''),
          toLabel: String(nextToLabel ?? ''),
          fromCoords: nextFromCoords,
          toCoords: nextToCoords,
        })
      ) {
        Alert.alert(
          'Invalid route',
          'Pickup and destination cannot be the same. Choose a different destination.'
        );
        return;
      }

      const params: Record<string, unknown> = {
        selectedFrom: field === 'from' ? value : currentFrom,
        selectedTo: field === 'to' ? value : currentTo,
      };
      if (returnScreen === 'SearchRides') {
        if (currentDate !== undefined) params.preservedDate = currentDate;
        if (currentPassengers !== undefined) params.preservedPassengers = currentPassengers;
        if (coords) {
          if (field === 'from') {
            params.fromLatitude = coords.latitude;
            params.fromLongitude = coords.longitude;
          } else {
            params.toLatitude = coords.latitude;
            params.toLongitude = coords.longitude;
          }
        }
        const state = navigation.getState();
        const previousRoute = state.routes[state.index - 1];
        if (previousRoute?.key) {
          navigation.dispatch({
            ...CommonActions.setParams(params),
            source: previousRoute.key,
          });
          navigation.goBack();
          return;
        }
      }
      if (returnScreen === 'PublishRecentEdit') {
        if (coords) {
          if (field === 'from') {
            params.pickupLatitude = coords.latitude;
            params.pickupLongitude = coords.longitude;
            params.destinationLatitude = currentDestLat;
            params.destinationLongitude = currentDestLon;
          } else {
            params.destinationLatitude = coords.latitude;
            params.destinationLongitude = coords.longitude;
            params.pickupLatitude = currentPickupLat;
            params.pickupLongitude = currentPickupLon;
          }
        } else {
          params.pickupLatitude = currentPickupLat;
          params.pickupLongitude = currentPickupLon;
          params.destinationLatitude = currentDestLat;
          params.destinationLongitude = currentDestLon;
        }
        (params as Record<string, unknown>).clearRouteFare = true;
        /**
         * Edit & republish (`PublishRecentEdit`) is its own form: picking stops should only update that
         * screen and pop the picker — not launch the FAB publish wizard (`PublishRoutePreview` → date → …).
         */
        const statePe = navigation.getState();
        const previousPe = statePe.routes[statePe.index - 1];
        if (previousPe?.key) {
          navigation.dispatch({
            ...CommonActions.setParams(params),
            source: previousPe.key,
          });
          navigation.goBack();
          return;
        }
        dispatchResetPublishStackToWizardRoot(navigation);
        return;
      }
      if (returnScreen === 'PublishWizard') {
        if (coords) {
          if (field === 'from') {
            params.pickupLatitude = coords.latitude;
            params.pickupLongitude = coords.longitude;
            params.destinationLatitude = currentDestLat;
            params.destinationLongitude = currentDestLon;
          } else {
            params.destinationLatitude = coords.latitude;
            params.destinationLongitude = coords.longitude;
            params.pickupLatitude = currentPickupLat;
            params.pickupLongitude = currentPickupLon;
          }
        } else {
          params.pickupLatitude = currentPickupLat;
          params.pickupLongitude = currentPickupLon;
          params.destinationLatitude = currentDestLat;
          params.destinationLongitude = currentDestLon;
        }
        if (publishRestoreKey) {
          (params as Record<string, unknown>)._publishRestoreKey = publishRestoreKey;
        }
        /** Avoid stale merged `selectedDistanceKm` from a previous price confirmation. */
        (params as Record<string, unknown>).clearRouteFare = true;
        const pLat = params.pickupLatitude as number | undefined;
        const pLon = params.pickupLongitude as number | undefined;
        const dLat = params.destinationLatitude as number | undefined;
        const dLon = params.destinationLongitude as number | undefined;
        const hasNumber = (n: unknown): n is number => typeof n === 'number' && !Number.isNaN(n);
        const hasPickup = hasNumber(pLat) && hasNumber(pLon) && (pLat !== 0 || pLon !== 0);
        const hasDestination = hasNumber(dLat) && hasNumber(dLon) && (dLat !== 0 || dLon !== 0);

        /** Opening the picker already had both coords → user is editing one stop; merge and pop picker. */
        const hadBothStopsBefore =
          hasNumber(currentPickupLat) &&
          hasNumber(currentPickupLon) &&
          (currentPickupLat !== 0 || currentPickupLon !== 0) &&
          hasNumber(currentDestLat) &&
          hasNumber(currentDestLon) &&
          (currentDestLat !== 0 || currentDestLon !== 0);

        /**
         * First time both stops are set → route preview → date → time → price.
         * If both were already set before this picker opened, merge and go back so date/time/fare are not reset.
         */
        if (hasPickup && hasDestination && !hadBothStopsBefore) {
          goToPublishRoutePreview(
            navigation,
            {
              selectedFrom: params.selectedFrom,
              selectedTo: params.selectedTo,
              pickupLatitude: pLat,
              pickupLongitude: pLon,
              destinationLatitude: dLat,
              destinationLongitude: dLon,
              publishRestoreKey,
              ...(publishWizardReview ? { publishWizardReview: true } : {}),
              ...(publishFabExitTab ? { publishFabExitTab } : {}),
            },
            publishWizardReview
          );
          return;
        }

        /**
         * FAB “New ride” wizard: first confirm pickup only → open destination picker next (not the full
         * pickup wizard).
         */
        if (publishWizardReview && field === 'from' && hasPickup && !hasDestination) {
          const stateW = navigation.getState();
          const previousW = stateW.routes[stateW.index - 1];
          if (previousW?.key) {
            navigation.dispatch({
              ...CommonActions.setParams(params),
              source: previousW.key,
            });
          }
          /** Must `push` — `navigate` to the same route name reuses index 0, so back has no stack and Android exits. */
          navigation.dispatch(
            StackActions.push('LocationPicker', {
              field: 'to',
              currentFrom: String(params.selectedFrom ?? ''),
              currentTo: String(params.selectedTo ?? ''),
              currentPickupLatitude: pLat,
              currentPickupLongitude: pLon,
              currentDestinationLatitude: 0,
              currentDestinationLongitude: 0,
              returnScreen: 'PublishWizard',
              ...(publishRestoreKey ? { publishRestoreKey } : {}),
              publishWizardReview: true,
              ...(publishFabExitTab ? { publishFabExitTab } : {}),
            } as never)
          );
          return;
        }

        /** Only one stop, or both stops after editing an existing pair → merge into Publish and pop picker. */
        const state = navigation.getState();
        const previousRoute = state.routes[state.index - 1];
        if (previousRoute?.key) {
          navigation.dispatch({
            ...CommonActions.setParams(params),
            source: previousRoute.key,
          });
          navigation.goBack();
          return;
        }
        dispatchResetPublishStackToWizardRoot(navigation);
        return;
      }
      (navigation as any).navigate(returnScreen, params);
    },
    [
      navigation,
      field,
      currentFrom,
      currentTo,
      currentPickupLat,
      currentPickupLon,
      currentDestLat,
      currentDestLon,
      currentFromLat,
      currentFromLon,
      currentToLat,
      currentToLon,
      currentDate,
      currentPassengers,
      returnScreen,
      publishRestoreKey,
      publishRecentEditEntry,
      publishWizardReview,
      publishFabExitTab,
    ]
  );

  const handleUseCurrentLocation = useCallback(async () => {
    if (netOnline === false) {
      showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
      return;
    }
    /** Publish pickup: center map on GPS, reverse-geocode label, fine-tune on map — same as picking a recent. */
    if (isPublishFlow && field === 'from') {
      setUseCurrentLoading(true);
      try {
        const coords = await requestLocation();
        if (!coords) {
          Alert.alert(
            'Location',
            locationError || 'Could not get your location. Check permissions and try again.'
          );
          return;
        }
        Keyboard.dismiss();
        setSuggestions([]);
        skipAutocompleteRef.current = true;
        suppressMapExploreRef.current = true;
        placesSessionTokenRef.current = null;

        let label: string;
        try {
          const Location = await import('expo-location');
          const results = await Location.reverseGeocodeAsync({
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
          if (results?.length > 0) {
            const addr = results[0];
            const parts = [addr.street, addr.streetNumber, addr.city, addr.region, addr.country].filter(Boolean);
            label =
              parts.length > 0 ? parts.join(', ') : `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
          } else {
            label = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
          }
        } catch {
          label = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
        }

        setPublishMapVisible(true);
        setSelectedCoords(coords);
        setSelectedLabel(label);
        setSearchQuery(label);
        setShowNameOnSelectedMarker(true);
        lastPublishGeocodedRef.current = { latitude: coords.latitude, longitude: coords.longitude };
        focusPublishMapOnCoords(coords);
        void upsertPlaceRecent(
          {
            placeId: `gps_${coords.latitude.toFixed(5)}_${coords.longitude.toFixed(5)}`,
            title: label.split(',')[0]?.trim() || 'Current location',
            formattedAddress: label,
            latitude: coords.latitude,
            longitude: coords.longitude,
            fieldType: placeFieldType,
            lastUsedAt: Date.now(),
          },
          recentUserKey
        )
          .then(setRecentPlaces)
          .catch(() => {});
        void nearbyPlaces(coords.latitude, coords.longitude, 1400)
          .then(setNearbyPlacesList)
          .catch(() => setNearbyPlacesList([]));
      } finally {
        setUseCurrentLoading(false);
      }
      return;
    }

    setUseCurrentLoading(true);
    try {
      const coords = await requestLocation();
      if (!coords) {
        Alert.alert('Location', locationError || 'Could not get your location. Check permissions and try again.');
        return;
      }
      try {
        const Location = await import('expo-location');
        const results = await Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude });
        let label: string;
        if (results?.length > 0) {
          const addr = results[0];
          const parts = [addr.street, addr.streetNumber, addr.city, addr.region, addr.country].filter(Boolean);
          label = parts.length > 0 ? parts.join(', ') : `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
        } else {
          label = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
        }
        if (returnScreen === 'SearchRides') {
          skipAutocompleteRef.current = true;
          suppressMapExploreRef.current = true;
          placesSessionTokenRef.current = null;
          navigateBackWithValue(label, coords);
          return;
        }
        navigateBackWithValue(label, coords);
      } catch {
        const fallbackLabel = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
        if (returnScreen === 'SearchRides') {
          skipAutocompleteRef.current = true;
          suppressMapExploreRef.current = true;
          placesSessionTokenRef.current = null;
          navigateBackWithValue(fallbackLabel, coords);
          return;
        }
        navigateBackWithValue(fallbackLabel, coords);
      }
    } finally {
      setUseCurrentLoading(false);
    }
  }, [
    requestLocation,
    locationError,
    navigateBackWithValue,
    returnScreen,
    isPublishFlow,
    field,
    focusPublishMapOnCoords,
    placeFieldType,
    recentUserKey,
    netOnline,
  ]);

  const handleDone = () => {
    const label = selectedLabel || searchQuery || undefined;
    if (isPublishFlow || returnScreen === 'SearchRides') {
      if (isPublishFlow && !publishMapVisible) {
        Alert.alert(
          'Set location',
          field === 'from'
            ? 'Search for a place, pick a recent search, or tap Use current location to open the map and adjust the pin, then tap Done.'
            : 'Pick a place from search results or recent searches first. The map opens on that spot so you can fine-tune the pin, then tap Done.'
        );
        return;
      }
      if (!selectedCoords) {
        Alert.alert(
          'Set location',
          returnScreen === 'SearchRides'
            ? 'Please select a place from the list (or use "Use current location").'
            : 'Move the map until the pin is on your spot. Wait a moment for the address to update, then tap Done.'
        );
        return;
      }
      navigateBackWithValue(label, selectedCoords);
    } else {
      navigateBackWithValue(label);
    }
  };

  // Debounced place suggestions
  useEffect(() => {
    if (offline) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }
    const q = searchQuery.trim();
    if (!isFocused) return;

    // If user tapped an existing recent item, avoid triggering autocomplete again.
    if (skipAutocompleteRef.current) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    // Requirement: do not hit Places Autocomplete unless user types >= 3 chars.
    if (q.length < 3) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    const token =
      placesSessionTokenRef.current ?? (placesSessionTokenRef.current = newPlacesSessionToken());

    setSuggestionsLoading(true);
    const t = setTimeout(() => {
      getPlaceSuggestions(q, { sessionToken: token })
        .then(setSuggestions)
        .finally(() => setSuggestionsLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery, isFocused, offline]);

  /** After user pauses typing: move map to area + show nearby POIs (does not change selection until user taps). */
  useEffect(() => {
    if (offline) {
      setNearbyPlacesList([]);
      setMapExploring(false);
      return;
    }
    const q = searchQuery.trim();
    if (suppressMapExploreRef.current) {
      // Selection handlers (recent/google/current location/map tap) toggle this to avoid extra Place API calls.
      suppressMapExploreRef.current = false;
      setNearbyPlacesList([]);
      setMapExploring(false);
      return;
    }
    if (isPublishFlow) {
      setNearbyPlacesList([]);
      setMapExploring(false);
      return;
    }
    if (q.length < 3) {
      setNearbyPlacesList([]);
      setMapExploring(false);
      return;
    }
    const seq = ++mapExploreSeq.current;
    const timer = setTimeout(async () => {
      if (mapExploreSeq.current !== seq) return;
      setMapExploring(true);
      try {
        // Per requirement: do not fetch Place Details until user selects a Google suggestion.
        // Using free-text geocode here for lightweight map movement.
        const coords = await geocodeAddress(q);
        if (mapExploreSeq.current !== seq) return;
        if (coords) {
          mapRef.current?.animateToRegion?.(
            {
              latitude: coords.latitude,
              longitude: coords.longitude,
              latitudeDelta: 0.026,
              longitudeDelta: 0.026,
            },
            480
          );
          const nearby = await nearbyPlaces(coords.latitude, coords.longitude, 1400);
          if (mapExploreSeq.current !== seq) return;
          setNearbyPlacesList(nearby);
        } else {
          setNearbyPlacesList([]);
        }
      } finally {
        if (mapExploreSeq.current === seq) setMapExploring(false);
      }
    }, 720);
    return () => {
      clearTimeout(timer);
      mapExploreSeq.current += 1;
    };
  }, [searchQuery, isPublishFlow, publishMapVisible, offline]);

  const handleSelectSuggestion = useCallback(
    async (item: PlacePrediction) => {
      if (offline) {
        showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
        return;
      }
      Keyboard.dismiss();
      setSuggestions([]);
      setNearbyPlacesList([]);
      if (isPublishFlow || returnScreen === 'SearchRides') {
        // User selected a Google suggestion: do not re-trigger autocomplete / map exploration.
        const sessionToken = placesSessionTokenRef.current ?? undefined;
        skipAutocompleteRef.current = true;
        suppressMapExploreRef.current = true;
        placesSessionTokenRef.current = null;

        setSuggestionsLoading(true);
        try {
          const details = await getPlaceDetails(item.placeId, { sessionToken });
          const backLabel = details?.formattedAddress || item.description;

          let coords: { latitude: number; longitude: number } | null = null;
          if (details) {
            coords = { latitude: details.latitude, longitude: details.longitude };
            setSelectedLabel(backLabel);
            setSearchQuery(backLabel);
          } else {
            // Fallback: still only after selection (so Place Details wasn't available).
            const fallbackCoords = await geocodeAddress(item.description);
            coords = fallbackCoords;
            setSelectedLabel(item.description);
            setSearchQuery(item.description);
          }

          if (!coords) {
            setSelectedCoords(null);
            Alert.alert(
              'Location',
              returnScreen === 'SearchRides' || isPublishFlow
                ? 'Could not get coordinates for this place. Try another suggestion.'
                : 'Could not get coordinates for this place. Tap on the map to set the exact location, then tap Done.'
            );
            return;
          }

          setSelectedCoords(coords);
          setShowNameOnSelectedMarker(true);

          // Save selected Google suggestion into recent searches (for this field).
          const updated = await upsertPlaceRecent(
            {
              placeId: item.placeId,
              title: details?.name || item.description,
              formattedAddress: backLabel,
              latitude: coords.latitude,
              longitude: coords.longitude,
              fieldType: placeFieldType,
            },
            recentUserKey
          );
          setRecentPlaces(updated);

          if (returnScreen === 'SearchRides') {
            navigateBackWithValue(backLabel, coords);
            return;
          }
          if (isPublishFlow) {
            setPublishMapVisible(true);
            setSuggestions([]);
            lastPublishGeocodedRef.current = { latitude: coords.latitude, longitude: coords.longitude };
            focusPublishMapOnCoords(coords);
            void nearbyPlaces(coords.latitude, coords.longitude, 1400)
              .then(setNearbyPlacesList)
              .catch(() => setNearbyPlacesList([]));
            return;
          }

          mapRef.current?.animateToRegion?.(
            {
              ...coords,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            },
            400
          );
        } catch {
          setSelectedLabel(item.description);
          setSearchQuery(item.description);
          setSelectedCoords(null);
          Alert.alert(
            'Location',
            returnScreen === 'SearchRides' || isPublishFlow
              ? 'Could not select this place right now. Try another suggestion.'
              : 'Tap on the map to set the exact location for this place, then tap Done.'
          );
        } finally {
          setSuggestionsLoading(false);
        }
      } else {
        navigateBackWithValue(item.description);
      }
    },
    [returnScreen, isPublishFlow, focusPublishMapOnCoords, navigateBackWithValue, placeFieldType, recentUserKey, offline]
  );

  const handleSelectRecent = useCallback(
    async (item: PlaceRecentEntry) => {
      if (offline) {
        showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
        return;
      }
      Keyboard.dismiss();
      setSuggestions([]);
      setNearbyPlacesList([]);

      skipAutocompleteRef.current = true;
      suppressMapExploreRef.current = true;
      placesSessionTokenRef.current = null;

      if (isPublishFlow || returnScreen === 'SearchRides') {
        const coords = { latitude: item.latitude, longitude: item.longitude };
        const backLabel = item.formattedAddress || item.title;

        const updated = await upsertPlaceRecent(
          {
            placeId: item.placeId,
            title: item.title,
            formattedAddress: item.formattedAddress,
            latitude: item.latitude,
            longitude: item.longitude,
            fieldType: item.fieldType,
            lastUsedAt: Date.now(),
          },
          recentUserKey
        );
        setRecentPlaces(updated);

        if (returnScreen === 'SearchRides') {
          navigateBackWithValue(backLabel, coords);
          return;
        }
        setPublishMapVisible(true);
        setSelectedCoords(coords);
        setSelectedLabel(backLabel);
        setSearchQuery(backLabel);
        lastPublishGeocodedRef.current = { latitude: coords.latitude, longitude: coords.longitude };
        focusPublishMapOnCoords(coords);
        void nearbyPlaces(coords.latitude, coords.longitude, 1400)
          .then(setNearbyPlacesList)
          .catch(() => setNearbyPlacesList([]));
        return;
      }

      navigateBackWithValue(item.formattedAddress || item.title, {
        latitude: item.latitude,
        longitude: item.longitude,
      });
    },
    [navigateBackWithValue, recentUserKey, returnScreen, isPublishFlow, focusPublishMapOnCoords, offline]
  );

  const handleMapPress = useCallback(
    async (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      skipAutocompleteRef.current = true;
      suppressMapExploreRef.current = true;
      placesSessionTokenRef.current = null;

      const { latitude, longitude } = e.nativeEvent.coordinate;
      setNearbyPlacesList([]);
      mapExploreSeq.current += 1;
      setShowNameOnSelectedMarker(false);
      setSelectedCoords({ latitude, longitude });
      setReverseGeocodeLoading(true);
      try {
        const Location = await import('expo-location');
        const results = await Location.reverseGeocodeAsync({ latitude, longitude });
        let label: string;
        if (results?.length > 0) {
          const addr = results[0];
          const parts = [addr.street, addr.streetNumber, addr.city, addr.region, addr.country].filter(Boolean);
          label = parts.length > 0 ? parts.join(', ') : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        } else {
          label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        }
        setSelectedLabel(label);
        setSearchQuery(label);
      } catch {
        const label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        setSelectedLabel(label);
        setSearchQuery(label);
      } finally {
        setReverseGeocodeLoading(false);
      }
    },
    [navigateBackWithValue, returnScreen]
  );

  const reverseGeocodeLatLng = useCallback(async (latitude: number, longitude: number) => {
    try {
      const Location = await import('expo-location');
      const results = await Location.reverseGeocodeAsync({ latitude, longitude });
      let label: string;
      if (results?.length > 0) {
        const addr = results[0];
        const parts = [addr.street, addr.streetNumber, addr.city, addr.region, addr.country].filter(Boolean);
        label = parts.length > 0 ? parts.join(', ') : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      } else {
        label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      }
      setSelectedLabel(label);
      setSearchQuery(label);
      skipAutocompleteRef.current = true;
    } catch {
      const label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      setSelectedLabel(label);
      setSearchQuery(label);
    }
  }, []);

  const handlePublishRegionChangeComplete = useCallback(
    (region: { latitude: number; longitude: number }) => {
      if (!isPublishFlow || !publishMapVisible) return;
      const lat = region.latitude;
      const lng = region.longitude;
      setSelectedCoords({ latitude: lat, longitude: lng });

      if (offline) {
        if (publishGeocodeTimerRef.current) clearTimeout(publishGeocodeTimerRef.current);
        publishGeocodeTimerRef.current = null;
        setReverseGeocodeLoading(false);
        setNearbyPlacesList([]);
        return;
      }

      if (Date.now() < skipPublishGeocodeUntilRef.current) {
        return;
      }

      const prev = lastPublishGeocodedRef.current;
      if (
        prev &&
        Math.abs(prev.latitude - lat) < PUBLISH_MIN_MOVE_FOR_GEOCODE_DEG &&
        Math.abs(prev.longitude - lng) < PUBLISH_MIN_MOVE_FOR_GEOCODE_DEG
      ) {
        return;
      }

      if (publishGeocodeTimerRef.current) clearTimeout(publishGeocodeTimerRef.current);
      publishGeocodeTimerRef.current = setTimeout(() => {
        publishGeocodeTimerRef.current = null;
        setReverseGeocodeLoading(true);
        void (async () => {
          try {
            await reverseGeocodeLatLng(lat, lng);
            lastPublishGeocodedRef.current = { latitude: lat, longitude: lng };
          } finally {
            setReverseGeocodeLoading(false);
          }
          try {
            const n = await nearbyPlaces(lat, lng, 1400);
            setNearbyPlacesList(n);
          } catch {
            setNearbyPlacesList([]);
          }
        })();
      }, PUBLISH_REVERSE_GEOCODE_DEBOUNCE_MS);
    },
    [isPublishFlow, publishMapVisible, reverseGeocodeLatLng, offline]
  );

  const handlePublishMapPress = useCallback(
    (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      if (!isPublishFlow) return;
      if (offline) {
        showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
        return;
      }
      const { latitude, longitude } = e.nativeEvent.coordinate;
      bumpSkipPublishGeocode();
      mapRef.current?.animateToRegion?.(centerRegion(latitude, longitude, STREET_DELTA), 350);
    },
    [isPublishFlow, bumpSkipPublishGeocode, offline]
  );

  const selectNearbyPlace = useCallback(
    async (p: NearbyPlace) => {
      if (offline) {
        showToast({ title: OFFLINE_HEADLINE, message: OFFLINE_SUBTITLE_RETRY, variant: 'info' });
        return;
      }
      skipAutocompleteRef.current = true;
      suppressMapExploreRef.current = true;
      placesSessionTokenRef.current = null;

      Keyboard.dismiss();
      setNearbyPlacesList([]);
      mapExploreSeq.current += 1;
      const coords = { latitude: p.latitude, longitude: p.longitude };
      bumpSkipPublishGeocode();
      setShowNameOnSelectedMarker(true);
      setSelectedCoords(coords);
      setSelectedLabel(p.name);
      setSearchQuery(p.name);
      mapRef.current?.animateToRegion?.(
        { ...coords, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        350
      );
      setReverseGeocodeLoading(true);
      try {
        const Location = await import('expo-location');
        const results = await Location.reverseGeocodeAsync(coords);
        if (results?.length > 0) {
          const addr = results[0];
          const parts = [addr.street, addr.streetNumber, addr.city, addr.region, addr.country].filter(Boolean);
          if (parts.length > 0) {
            const label = parts.join(', ');
            suppressMapExploreRef.current = true;
            setSelectedLabel(label);
            setSearchQuery(label);
          }
        }
      } catch {
        /* keep POI name */
      } finally {
        setReverseGeocodeLoading(false);
      }
      lastPublishGeocodedRef.current = coords;
    },
    [bumpSkipPublishGeocode, offline]
  );

  const clearPublishSelection = () => {
    setSelectedLabel(null);
    setSearchQuery('');
    setSuggestions([]);
    setNearbyPlacesList([]);
    setShowNameOnSelectedMarker(true);
    mapExploreSeq.current += 1;
    skipAutocompleteRef.current = false;
    suppressMapExploreRef.current = false;
    lastPublishGeocodedRef.current = null;
    if (publishGeocodeTimerRef.current) clearTimeout(publishGeocodeTimerRef.current);
    setPublishMapVisible(false);
    Keyboard.dismiss();
  };

  const mapLayer = publishImmersiveMap ? (
    <View style={[StyleSheet.absoluteFillObject, styles.publishMapLayer]} pointerEvents="box-none">
      {reverseGeocodeLoading && (
        <View style={styles.mapOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.mapOverlayText}>Updating address…</Text>
          <Text style={styles.mapOverlaySubtext}>Waits until you finish moving the map</Text>
        </View>
      )}
      {MapView ? (
        <>
          <MapView
            key={`publish-map-${field}`}
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={mapInitialRegion}
            showsUserLocation={false}
            showsMyLocationButton={false}
            mapType="standard"
            provider={PROVIDER_DEFAULT}
            onMapReady={onMapReady}
            onPress={handlePublishMapPress}
            onRegionChangeComplete={handlePublishRegionChangeComplete}
          >
            {Marker &&
              nearbyPlacesList.map((p) => {
                if (
                  selectedCoords &&
                  Math.abs(selectedCoords.latitude - p.latitude) < 1e-5 &&
                  Math.abs(selectedCoords.longitude - p.longitude) < 1e-5
                ) {
                  return null;
                }
                return (
                  <Marker
                    key={p.placeId}
                    coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                    title={p.name}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                    onPress={() => selectNearbyPlace(p)}
                  >
                    <View style={styles.nearbyMapDot} />
                  </Marker>
                );
              })}
          </MapView>
          <View style={styles.centerPinOverlay} pointerEvents="none">
            <Ionicons name="location-sharp" size={46} color={COLORS.error} style={styles.centerPinIcon} />
          </View>
          {Platform.OS === 'android' && (
            <View style={styles.mapHint}>
              <Text style={styles.mapHintText}>
                Map black? Don't use Expo Go. Run: npm run android:build
              </Text>
            </View>
          )}
        </>
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.mapPlaceholder]}>
          <Text style={styles.mapPlaceholderText}>Map unavailable (dev client required)</Text>
        </View>
      )}
    </View>
  ) : null;

  return (
    <SafeAreaView
      style={[
        styles.container,
        returnScreen === 'SearchRides' || publishSearchOnly ? styles.containerSearchRides : null,
        publishImmersiveMap && styles.containerPublishMap,
      ]}
      edges={publishImmersiveMap ? [] : ['top']}
    >
      {mapLayer}

      {publishImmersiveMap ? (
        <View
          style={[styles.publishTopChrome, { paddingTop: insets.top + 6 }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            onPress={dismissPublishLocationPicker}
            style={styles.publishTopIconBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.publishTopTitleBlock}>
            <Text style={styles.publishTopMainTitle} numberOfLines={1}>
              {field === 'from' ? 'Add pickup' : 'Add destination'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleDone}
            style={styles.publishTopDonePill}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.publishTopDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isPublishFlow && !publishImmersiveMap ? (
        <View style={styles.header}>
          <TouchableOpacity
            onPress={dismissPublishLocationPicker}
            style={styles.headerBackBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleCenter}>
            <Text style={styles.headerPublishFlowTitle} numberOfLines={1}>
              {field === 'from' ? 'Add pickup' : 'Add destination'}
            </Text>
          </View>
          <TouchableOpacity onPress={handleDone} style={styles.doneBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isPublishFlow && selectedLabel && !publishImmersiveMap ? (
        <View style={styles.selectedBar}>
          <Text style={styles.selectedLabel} numberOfLines={2}>
            {selectedLabel}
          </Text>
          <TouchableOpacity onPress={clearPublishSelection} style={styles.changeBtn} hitSlop={8}>
            <Text style={styles.changeBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View
        style={[
          styles.searchSection,
          publishSearchOnly && styles.searchSectionFlex,
          publishImmersiveMap && styles.searchSectionOnMap,
          publishImmersiveMap && {
            top: insets.top + 52,
            maxHeight: isFocused ? SCREEN_HEIGHT * 0.44 : undefined,
          },
        ]}
      >
        <View style={[styles.searchInputRow, publishImmersiveMap && styles.searchInputRowOnMap]}>
          {returnScreen === 'SearchRides' ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.searchBackButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ) : null}
          <TextInput
            style={[
              styles.searchInput,
              (returnScreen === 'SearchRides' || publishSearchOnly || publishImmersiveMap) &&
                styles.searchInputEmbedded,
              offline && styles.searchInputOffline,
            ]}
            placeholder={field === 'to' ? 'Search destination' : 'Search for a place or address'}
            placeholderTextColor={COLORS.textMuted}
            value={searchQuery}
            editable={!offline}
            onChangeText={(v) => {
                if (offline) return;
                // User started typing again (not selecting a recent item).
                skipAutocompleteRef.current = false;
                suppressMapExploreRef.current = false;
                if (!placesSessionTokenRef.current) placesSessionTokenRef.current = newPlacesSessionToken();
                setSearchQuery(v);
              }}
              onFocus={() => {
                setIsFocused(true);
                // New autocomplete session for this typing flow.
                placesSessionTokenRef.current = newPlacesSessionToken();
                void loadRecentsForField();
                setSuggestions([]);
              }}
              onBlur={() => {
                // Allow taps on suggestions to register before hiding dropdown.
                setTimeout(() => setIsFocused(false), 150);
              }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.trim().length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => {
                setSearchQuery('');
                setSelectedCoords(null);
                setShowNameOnSelectedMarker(true);
                setSuggestions([]);
                setNearbyPlacesList([]);
                setSelectedLabel(null);
              }}
              activeOpacity={0.6}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {offline ? (
          <View style={styles.locationOfflineBanner} accessibilityRole="alert">
            <Ionicons name="cloud-offline-outline" size={16} color={COLORS.textSecondary} />
            <View style={styles.locationOfflineBannerTextCol}>
              <Text style={styles.locationOfflineBannerTitle}>{OFFLINE_HEADLINE}</Text>
              <Text style={styles.locationOfflineBannerSub}>{OFFLINE_SUBTITLE_RETRY}</Text>
            </View>
          </View>
        ) : null}

          {canShowUseCurrentLocation &&
            (returnScreen === 'SearchRides' || (isPublishFlow && field === 'from')) && (
              <TouchableOpacity
                style={styles.useCurrentLocationRow}
                onPress={handleUseCurrentLocation}
                disabled={offline || locationLoading || useCurrentLoading}
                activeOpacity={0.7}
              >
                {locationLoading || useCurrentLoading ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <View style={styles.greenDot} />
                )}
                <Text style={styles.useCurrentLocationText}>
                  {useCurrentLoading ? 'Getting location…' : 'Use current location'}
                </Text>
              </TouchableOpacity>
            )}

          {!offline && isFocused && searchQuery.trim().length < 3 && recentPlaces.length > 0 && (
            <View
              style={[
                styles.suggestionsList,
                isPublishFlow && !publishImmersiveMap && styles.suggestionsListPublish,
                publishImmersiveMap && styles.suggestionsListOnMap,
              ]}
            >
              <View style={styles.listSectionHeader}>
                <Text style={styles.sectionHeaderText}>Recent Searches</Text>
              </View>
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={recentPlaces}
                keyExtractor={(item) => item.placeId}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.recentSuggestionItem}
                    onPress={() => void handleSelectRecent(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.recentRowLeft}>
                      <Ionicons
                        name={placeFieldType === 'pickup' ? 'ellipse' : 'location-outline'}
                        size={14}
                        color={COLORS.primary}
                      />
                    </View>
                    <View style={styles.recentRowCenter}>
                      <Text style={styles.recentSuggestionTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.recentSuggestionAddress} numberOfLines={1}>
                        {item.formattedAddress}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
                style={styles.suggestionsFlatList}
              />
            </View>
          )}

          {!offline && isFocused && searchQuery.trim().length >= 3 && suggestions.length > 0 && (
            <View
              style={[
                styles.suggestionsList,
                isPublishFlow && !publishImmersiveMap && styles.suggestionsListPublish,
                publishImmersiveMap && styles.suggestionsListOnMap,
              ]}
            >
              <View style={styles.listSectionHeader}>
                <Text style={styles.sectionHeaderText}>Search Results</Text>
              </View>
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={suggestions}
                keyExtractor={(item) => item.placeId}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.suggestionItem}
                    onPress={() => void handleSelectSuggestion(item)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="location-outline" size={14} color={COLORS.textSecondary} />
                    <View style={styles.suggestionRowCenter}>
                      <Text style={styles.suggestionText} numberOfLines={2}>
                        {item.description}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
                style={styles.suggestionsFlatList}
              />
            </View>
          )}

          {!offline &&
            isFocused &&
            suggestionsLoading &&
            suggestions.length === 0 &&
            searchQuery.trim().length >= 3 && (
              <View
                style={[
                  styles.suggestionsList,
                  isPublishFlow && !publishImmersiveMap && styles.suggestionsListPublish,
                  publishImmersiveMap && styles.suggestionsListOnMap,
                ]}
              >
                <View style={styles.listSectionHeader}>
                  <Text style={styles.sectionHeaderText}>Search Results</Text>
                </View>
                <View style={styles.suggestionsLoadingInner}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.suggestionsLoadingText}>Searching…</Text>
                </View>
              </View>
            )}
          {!offline &&
            isPublishFlow &&
            publishMapVisible &&
            !publishImmersiveMap &&
            nearbyPlacesList.length > 0 && (
            <View style={styles.nearbySection}>
              <Text style={styles.nearbySectionTitle}>Center the pin, or pick a nearby place</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.nearbyChipsRow}
              >
                {nearbyPlacesList.map((p) => (
                  <TouchableOpacity
                    key={p.placeId}
                    style={styles.nearbyChip}
                    onPress={() => selectNearbyPlace(p)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.nearbyChipText} numberOfLines={1}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          {!offline &&
            isPublishFlow &&
            publishMapVisible &&
            !publishImmersiveMap &&
            mapExploring &&
            nearbyPlacesList.length === 0 &&
            searchQuery.trim().length >= 3 && (
            <View style={styles.exploringRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.exploringText}>Finding area on map…</Text>
            </View>
          )}
        </View>

      {publishImmersiveMap ? (
        <View
          style={[styles.publishBottomChrome, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}
          pointerEvents="box-none"
        >
          {selectedLabel ? (
            <View style={styles.publishAddressCard}>
              <Ionicons name="location-outline" size={20} color={COLORS.primary} style={styles.publishAddressCardIcon} />
              <Text style={styles.publishAddressCardText} numberOfLines={2}>
                {selectedLabel}
              </Text>
              <TouchableOpacity onPress={clearPublishSelection} style={styles.publishAddressClear} hitSlop={8}>
                <Text style={styles.changeBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {!offline && nearbyPlacesList.length > 0 ? (
            <View style={styles.nearbySectionBottom}>
              <Text style={styles.nearbySectionTitleBottom}>Nearby</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.nearbyChipsRow}
              >
                {nearbyPlacesList.map((p) => (
                  <TouchableOpacity
                    key={p.placeId}
                    style={styles.nearbyChip}
                    onPress={() => selectNearbyPlace(p)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.nearbyChipText} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}
          {!offline && mapExploring && nearbyPlacesList.length === 0 && searchQuery.trim().length >= 3 ? (
            <View style={styles.exploringRowBottom}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.exploringText}>Finding area on map…</Text>
            </View>
          ) : null}
          <Text style={styles.publishMapMicroHint}>
            Drag the map to fine-tune. The address updates after you stop.
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
  },
  containerSearchRides: {
    backgroundColor: '#fff',
  },
  containerPublishMap: {
    backgroundColor: '#e8eef2',
  },
  publishMapLayer: {
    zIndex: 0,
    backgroundColor: '#dfe8ec',
  },
  publishTopChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
      },
      android: { elevation: 3 },
    }),
  },
  publishTopIconBtn: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  publishTopTitleBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  publishTopMainTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.35,
    color: COLORS.text,
    textAlign: 'center',
  },
  publishTopDonePill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
  },
  publishTopDoneText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  publishBottomChrome: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
      },
      android: { elevation: 8 },
    }),
  },
  publishAddressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: COLORS.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  publishAddressCardIcon: {
    flexShrink: 0,
  },
  publishAddressCardText: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 20,
  },
  publishAddressClear: {
    flexShrink: 0,
    paddingVertical: 4,
    paddingLeft: 8,
  },
  nearbySectionBottom: {
    marginBottom: 6,
  },
  nearbySectionTitleBottom: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  exploringRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  publishMapMicroHint: {
    fontSize: 11,
    lineHeight: 15,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 8,
  },
  searchSectionOnMap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 35,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 6,
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  searchInputRowOnMap: {
    backgroundColor: '#fff',
    borderColor: 'rgba(226,232,240,0.95)',
    borderRadius: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
    }),
  },
  suggestionsListOnMap: {
    maxHeight: SCREEN_HEIGHT * 0.32,
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 5,
      },
      android: { elevation: 3 },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerBackBtn: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  headerTitleCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  headerPublishFlowTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.35,
    color: COLORS.text,
    textAlign: 'center',
  },
  doneBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  doneText: {
    fontSize: 17,
    color: COLORS.primary,
    fontWeight: '600',
  },
  selectedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  selectedLabel: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
    marginRight: 12,
  },
  changeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  changeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  searchSection: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  searchSectionFlex: {
    flex: 1,
  },
  publishMapHintBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(41, 190, 139, 0.1)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  publishMapHintBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  searchBackButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    flex: 1,
    textAlignVertical: 'center',
  },
  searchInputEmbedded: {
    borderWidth: 0,
    borderRadius: 0,
    paddingLeft: 8,
  },
  searchInputOffline: {
    opacity: 0.55,
  },
  locationOfflineBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  locationOfflineBannerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  locationOfflineBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  locationOfflineBannerSub: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  clearButton: {
    padding: 8,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionsList: {
    maxHeight: 180,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.85)',
    overflow: 'hidden',
  },
  suggestionsListPublish: {
    flex: 1,
    maxHeight: 480,
    minHeight: 120,
  },
  suggestionsFlatList: {
    flexGrow: 0,
  },
  listSectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    backgroundColor: 'rgba(248,250,252,0.72)',
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  recentSuggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  recentRowLeft: {
    width: 18,
    alignItems: 'center',
  },
  recentRowCenter: {
    flex: 1,
    minWidth: 0,
  },
  recentSuggestionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  recentSuggestionAddress: {
    marginTop: 2,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  suggestionRowCenter: {
    flex: 1,
    minWidth: 0,
  },
  suggestionText: {
    fontSize: 15,
    color: COLORS.text,
  },
  suggestionsLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  nearbySection: {
    marginTop: 12,
    marginHorizontal: -4,
  },
  nearbySectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  nearbyChipsRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingRight: 16,
  },
  nearbyChip: {
    maxWidth: 200,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  nearbyChipText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  exploringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  exploringText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  suggestionsLoadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  suggestionsLoadingInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  useCurrentLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 10,
    gap: 12,
  },
  useCurrentLocationText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  greenDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: '#fff',
  },
  mapWrapper: {
    flex: 1,
    width: SCREEN_WIDTH,
    minHeight: 280,
    position: 'relative',
    flexDirection: 'column',
  },
  mapArea: {
    flex: 1,
    position: 'relative',
    minHeight: 220,
  },
  centerPinOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** Pin tip ~at map center: icon sits above center. */
  centerPinIcon: {
    marginBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.28,
    shadowRadius: 3,
    elevation: 5,
  },
  map: {
    width: '100%',
    height: '100%',
    flex: 1,
  },
  mapOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  mapOverlayText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  mapOverlaySubtext: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.borderLight,
  },
  mapPlaceholderText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  mapHint: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  mapHintText: {
    fontSize: 11,
    color: '#fff',
  },
  /** Small dot for nearby POIs (smaller than default green pin) */
  nearbyMapDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    borderWidth: 1.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 3,
  },
});
