import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Dimensions,
  Platform,
  FlatList,
  Keyboard,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SearchStackParamList } from '../../navigation/types';
import { useLocation } from '../../contexts/LocationContext';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
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

type Props = NativeStackScreenProps<SearchStackParamList, 'LocationPicker'>;

const DEFAULT_REGION = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

const STREET_DELTA = 0.012;
const NEIGHBORHOOD_DELTA = 0.04;

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

/** True if typed query matches any saved place (title or address) — used to defer showing the map on Publish. */
function queryMatchesAnyRecent(query: string, recents: PlaceRecentEntry[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return recents.some((r) => {
    const t = r.title.trim().toLowerCase();
    const a = r.formattedAddress.trim().toLowerCase();
    return t.includes(q) || a.includes(q) || q.includes(t) || q.includes(a);
  });
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function LocationPickerScreen({ navigation, route }: Props): React.JSX.Element {
  const field = route.params?.field ?? 'from';
  const currentFrom = route.params?.currentFrom ?? '';
  const currentTo = route.params?.currentTo ?? '';
  const currentPickupLat = (route.params as { currentPickupLatitude?: number })?.currentPickupLatitude;
  const currentPickupLon = (route.params as { currentPickupLongitude?: number })?.currentPickupLongitude;
  const currentDestLat = (route.params as { currentDestinationLatitude?: number })?.currentDestinationLatitude;
  const currentDestLon = (route.params as { currentDestinationLongitude?: number })?.currentDestinationLongitude;
  const currentDate = (route.params as { currentDate?: string })?.currentDate;
  const currentPassengers = (route.params as { currentPassengers?: string })?.currentPassengers ?? '1';
  const currentFromLat = (route.params as { currentFromLatitude?: number })?.currentFromLatitude;
  const currentFromLon = (route.params as { currentFromLongitude?: number })?.currentFromLongitude;
  const currentToLat = (route.params as { currentToLatitude?: number })?.currentToLatitude;
  const currentToLon = (route.params as { currentToLongitude?: number })?.currentToLongitude;
  const returnScreen = (route.params as { returnScreen?: 'SearchRides' | 'PublishRide' })?.returnScreen ?? 'SearchRides';
  const publishRestoreKey = (route.params as { publishRestoreKey?: string })?.publishRestoreKey;
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
  /** Publish: show map only after free text doesn’t match recents (same flow as Search search-first). */
  const [publishMapVisible, setPublishMapVisible] = useState(false);

  const loadRecentsForField = useCallback(async () => {
    const list = await loadPlaceRecents(placeFieldType, recentUserKey);
    setRecentPlaces(list);
  }, [placeFieldType, recentUserKey]);

  useEffect(() => {
    // Search + Publish: search + recents first; map hidden for Publish until needed.
    if (returnScreen === 'SearchRides' || returnScreen === 'PublishRide') {
      setIsFocused(true);
      void loadRecentsForField();
      placesSessionTokenRef.current = newPlacesSessionToken();
    }
    if (returnScreen === 'PublishRide') {
      setPublishMapVisible(false);
      setSearchQuery('');
      setSelectedLabel(null);
      setSelectedCoords(null);
      setSuggestions([]);
      setNearbyPlacesList([]);
      setMapExploring(false);
      skipAutocompleteRef.current = false;
      suppressMapExploreRef.current = false;
    }
  }, [returnScreen, field, loadRecentsForField]);

  /** Publish: reveal map when user types ≥3 chars and nothing in recents matches (debounced). */
  useEffect(() => {
    if (returnScreen !== 'PublishRide') return;
    const q = searchQuery.trim();
    if (q.length < 3) {
      setPublishMapVisible(false);
      return;
    }
    if (queryMatchesAnyRecent(q, recentPlaces)) {
      setPublishMapVisible(false);
      return;
    }
    const id = setTimeout(() => setPublishMapVisible(true), 420);
    return () => clearTimeout(id);
  }, [searchQuery, recentPlaces, returnScreen]);

  const openPublishMapManually = useCallback(() => {
    setPublishMapVisible(true);
    setIsFocused(false);
    Keyboard.dismiss();
  }, []);

  const didAutoCenterUserRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      didAutoCenterUserRef.current = false;
      prefetchLocation();
    }, [prefetchLocation])
  );

  const mapInitialRegion = useMemo(() => {
    const has = (n: unknown): n is number => typeof n === 'number' && !Number.isNaN(n);
    if (returnScreen === 'PublishRide') {
      if (field === 'from' && has(currentPickupLat) && has(currentPickupLon)) {
        return centerRegion(currentPickupLat, currentPickupLon);
      }
      if (field === 'to' && has(currentDestLat) && has(currentDestLon)) {
        return centerRegion(currentDestLat, currentDestLon);
      }
      if (field === 'to' && has(currentPickupLat) && has(currentPickupLon)) {
        return centerRegion(currentPickupLat, currentPickupLon, NEIGHBORHOOD_DELTA);
      }
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
    if (!location) return;
    const t = setTimeout(() => {
      if (!didAutoCenterUserRef.current && mapRef.current) {
        animateToUserLocation(location.latitude, location.longitude);
        didAutoCenterUserRef.current = true;
      }
    }, 380);
    return () => clearTimeout(t);
  }, [location?.latitude, location?.longitude, animateToUserLocation]);

  const onMapReady = useCallback(() => {
    if (location && !didAutoCenterUserRef.current) {
      animateToUserLocation(location.latitude, location.longitude);
      didAutoCenterUserRef.current = true;
    }
  }, [location, animateToUserLocation]);

  const navigateBackWithValue = useCallback(
    (value: string | undefined, coords?: { latitude: number; longitude: number }) => {
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
      if (returnScreen === 'PublishRide') {
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

        /** Both points set → route selection (km) → price screen → back to Publish (same as before). */
        if (hasPickup && hasDestination) {
          navigation.replace(
            'PublishRoutePreview' as never,
            {
              selectedFrom: params.selectedFrom,
              selectedTo: params.selectedTo,
              pickupLatitude: pLat,
              pickupLongitude: pLon,
              destinationLatitude: dLat,
              destinationLongitude: dLon,
              publishRestoreKey,
            } as never
          );
          return;
        }

        /** Only pickup or only destination so far → merge into Publish and pop picker. */
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
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'PublishRide' as const, params }],
          })
        );
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
    ]
  );

  const handleUseCurrentLocation = useCallback(async () => {
    setUseCurrentLoading(true);
    try {
      const coords = await requestLocation();
      if (!coords) {
        Alert.alert('Location', locationError || 'Could not get your location. Check permissions and try again.');
        return;
      }
      mapRef.current?.animateToRegion?.(centerRegion(coords.latitude, coords.longitude, STREET_DELTA), 500);
      didAutoCenterUserRef.current = true;
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
        if (returnScreen === 'SearchRides' || returnScreen === 'PublishRide') {
          skipAutocompleteRef.current = true;
          suppressMapExploreRef.current = true;
          placesSessionTokenRef.current = null;
          navigateBackWithValue(label, coords);
          return;
        }
        navigateBackWithValue(label, coords);
      } catch {
        if (returnScreen === 'SearchRides' || returnScreen === 'PublishRide') {
          skipAutocompleteRef.current = true;
          suppressMapExploreRef.current = true;
          placesSessionTokenRef.current = null;
          navigateBackWithValue(
            `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`,
            coords
          );
          return;
        }
        navigateBackWithValue(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`, coords);
      }
    } finally {
      setUseCurrentLoading(false);
    }
  }, [requestLocation, locationError, navigateBackWithValue, returnScreen]);

  const handleDone = () => {
    const label = selectedLabel || searchQuery || undefined;
    if (returnScreen === 'PublishRide' || returnScreen === 'SearchRides') {
      if (!selectedCoords) {
        Alert.alert(
          'Set location',
          returnScreen === 'SearchRides'
            ? 'Please select a place from the list (or use "Use current location").'
            : publishMapVisible
              ? 'Tap on the map to set the exact location, or use "Use current location", then tap Done.'
              : 'Choose a recent place, a search result, or tap "Choose on map".'
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
  }, [searchQuery, isFocused]);

  /** After user pauses typing: move map to area + show nearby POIs (does not change selection until user taps). */
  useEffect(() => {
    const q = searchQuery.trim();
    if (suppressMapExploreRef.current) {
      // Selection handlers (recent/google/current location/map tap) toggle this to avoid extra Place API calls.
      suppressMapExploreRef.current = false;
      setNearbyPlacesList([]);
      setMapExploring(false);
      return;
    }
    if (returnScreen === 'PublishRide' && !publishMapVisible) {
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
  }, [searchQuery, returnScreen, publishMapVisible]);

  const handleSelectSuggestion = useCallback(
    async (item: PlacePrediction) => {
      Keyboard.dismiss();
      setSuggestions([]);
      setNearbyPlacesList([]);
      if (returnScreen === 'PublishRide' || returnScreen === 'SearchRides') {
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
              returnScreen === 'SearchRides' || returnScreen === 'PublishRide'
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

          if (returnScreen === 'SearchRides' || returnScreen === 'PublishRide') {
            navigateBackWithValue(backLabel, coords);
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
            returnScreen === 'SearchRides' || returnScreen === 'PublishRide'
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
    [returnScreen]
  );

  const handleSelectRecent = useCallback(
    async (item: PlaceRecentEntry) => {
      Keyboard.dismiss();
      setSuggestions([]);
      setNearbyPlacesList([]);

      skipAutocompleteRef.current = true;
      suppressMapExploreRef.current = true;
      placesSessionTokenRef.current = null;

      if (returnScreen === 'PublishRide' || returnScreen === 'SearchRides') {
        const coords = { latitude: item.latitude, longitude: item.longitude };
        const backLabel = item.formattedAddress || item.title;

        // Move reused recents to the top and then immediately return on SearchRides.
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

        navigateBackWithValue(backLabel, coords);
        return;
      }

      navigateBackWithValue(item.formattedAddress || item.title, {
        latitude: item.latitude,
        longitude: item.longitude,
      });
    },
    [navigateBackWithValue, recentUserKey, returnScreen]
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

  const selectNearbyPlace = useCallback(
    async (p: NearbyPlace) => {
      skipAutocompleteRef.current = true;
      suppressMapExploreRef.current = true;
      placesSessionTokenRef.current = null;

      Keyboard.dismiss();
      setNearbyPlacesList([]);
      mapExploreSeq.current += 1;
      const coords = { latitude: p.latitude, longitude: p.longitude };
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
    },
    []
  );

  const publishSearchOnly = returnScreen === 'PublishRide' && !publishMapVisible;

  return (
    <SafeAreaView
      style={[
        styles.container,
        returnScreen === 'SearchRides' || publishSearchOnly ? styles.containerSearchRides : null,
      ]}
      edges={['top']}
    >
      {returnScreen === 'PublishRide' && publishMapVisible ? (
        <View style={styles.header}>
          <TouchableOpacity onPress={handleDone} style={styles.doneBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.doneText}>← Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {returnScreen === 'PublishRide' && publishMapVisible && selectedLabel ? (
        <View style={styles.selectedBar}>
          <Text style={styles.selectedLabel} numberOfLines={1}>{selectedLabel}</Text>
          <TouchableOpacity
            onPress={() => {
              setSelectedLabel(null);
              setSelectedCoords(null);
              setSearchQuery('');
              setSuggestions([]);
              setNearbyPlacesList([]);
              setShowNameOnSelectedMarker(true);
              setPublishMapVisible(false);
              mapExploreSeq.current += 1;
              Keyboard.dismiss();
            }}
            style={styles.changeBtn}
            hitSlop={8}
          >
            <Text style={styles.changeBtnText}>Change</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.searchSection, publishSearchOnly && styles.searchSectionFlex]}>
          <View style={styles.searchInputRow}>
            {returnScreen === 'SearchRides' || publishSearchOnly ? (
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
                (returnScreen === 'SearchRides' || publishSearchOnly) && styles.searchInputEmbedded,
              ]}
              placeholder={field === 'to' ? 'Search destination' : 'Search for a place or address'}
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={(v) => {
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
          </View>

          {canShowUseCurrentLocation && (
            <TouchableOpacity
              style={styles.useCurrentLocationRow}
              onPress={handleUseCurrentLocation}
              disabled={locationLoading || useCurrentLoading}
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

          {publishSearchOnly && (
            <TouchableOpacity
              style={styles.chooseMapRow}
              onPress={openPublishMapManually}
              activeOpacity={0.7}
            >
              <Ionicons name="map-outline" size={22} color={COLORS.primary} />
              <Text style={styles.chooseMapText}>Choose on map</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}

          {isFocused && searchQuery.trim().length < 3 && recentPlaces.length > 0 && (
            <View style={[styles.suggestionsList, publishSearchOnly && styles.suggestionsListPublish]}>
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

          {isFocused && searchQuery.trim().length >= 3 && suggestions.length > 0 && (
            <View style={styles.suggestionsList}>
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

          {isFocused &&
            suggestionsLoading &&
            suggestions.length === 0 &&
            searchQuery.trim().length >= 3 && (
              <View style={styles.suggestionsList}>
                <View style={styles.listSectionHeader}>
                  <Text style={styles.sectionHeaderText}>Search Results</Text>
                </View>
                <View style={styles.suggestionsLoadingInner}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.suggestionsLoadingText}>Searching…</Text>
                </View>
              </View>
            )}
          {returnScreen === 'PublishRide' && publishMapVisible && nearbyPlacesList.length > 0 && (
            <View style={styles.nearbySection}>
              <Text style={styles.nearbySectionTitle}>Tap a place on the map or below</Text>
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
          {returnScreen === 'PublishRide' &&
            publishMapVisible &&
            mapExploring &&
            nearbyPlacesList.length === 0 &&
            searchQuery.trim().length >= 3 && (
            <View style={styles.exploringRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.exploringText}>Finding area on map…</Text>
            </View>
          )}
        </View>
      )}

      {returnScreen === 'PublishRide' && publishMapVisible ? (
      <View style={styles.mapWrapper}>
        {reverseGeocodeLoading && (
          <View style={styles.mapOverlay}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.mapOverlayText}>Getting address…</Text>
          </View>
        )}
        {MapView ? (
          <>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={mapInitialRegion}
              showsUserLocation={!!location}
              showsMyLocationButton
              mapType="standard"
              provider={PROVIDER_DEFAULT}
              onMapReady={onMapReady}
              onPress={handleMapPress}
            >
              {Marker && selectedCoords && (
                <Marker
                  coordinate={selectedCoords}
                  title={showNameOnSelectedMarker ? (selectedLabel || 'Selected') : undefined}
                  description={undefined}
                  pinColor={COLORS.error}
                />
              )}
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
            {Platform.OS === 'android' && (
              <View style={styles.mapHint}>
                <Text style={styles.mapHintText}>
                  Map black? Don't use Expo Go. Run: npm run android:build
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.mapPlaceholder}>
            <Text style={styles.mapPlaceholderText}>Map unavailable (dev client required)</Text>
          </View>
        )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  doneBtn: {
    paddingVertical: 8,
    paddingRight: 16,
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
  chooseMapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  chooseMapText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 8,
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
  },
  searchInputEmbedded: {
    borderWidth: 0,
    borderRadius: 0,
    paddingLeft: 8,
  },
  suggestionsList: {
    maxHeight: 180,
    marginTop: 8,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.backgroundSecondary,
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
    minHeight: 300,
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
    color: COLORS.textSecondary,
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
