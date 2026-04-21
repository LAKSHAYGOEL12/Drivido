import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Dimensions, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CommonActions, StackActions, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import type { PublishStackParamList } from '../../navigation/types';
import type { MainTabName } from '../../navigation/mainTabOrder';
import { dispatchResetPublishStackToWizardRoot } from '../../navigation/publishStackWizardRoot';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';
import { COLORS } from '../../constants/colors';
import { getDirectionsAlternatives, type DirectionAlternative } from '../../services/places';
import {
  ROUTE_PREVIEW_FETCH_COOLDOWN_MS,
  getPublishRouteDirectionsMemoryCache,
  patchPublishRouteDirectionsMemoryCacheSelectedRoute,
  setPublishRouteDirectionsMemoryCache,
} from '../../utils/publishRouteDirectionsMemoryCache';
import { publishStopsCoordKey } from '../../utils/publishFare';
import { encodePolyline, normalizeEncodedPolyline } from '../../utils/routePolyline';

type RoutePreviewRouteProp = RouteProp<PublishStackParamList, 'PublishRoutePreview'>;

let MapView: React.ComponentType<any> | null = null;
let Marker: React.ComponentType<any> | null = null;
let Polyline: React.ComponentType<any> | null = null;
let PROVIDER_DEFAULT: string | undefined;
try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
  PROVIDER_DEFAULT = maps.PROVIDER_DEFAULT;
} catch {
  MapView = null;
  Marker = null;
  Polyline = null;
}

function fitRegion(lat1: number, lon1: number, lat2: number, lon2: number) {
  const minLat = Math.min(lat1, lat2);
  const maxLat = Math.max(lat1, lat2);
  const minLon = Math.min(lon1, lon2);
  const maxLon = Math.max(lon1, lon2);
  const latDelta = Math.max(0.02, (maxLat - minLat) * 1.8);
  const lonDelta = Math.max(0.02, (maxLon - minLon) * 1.8);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lonDelta,
  };
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

/** Route lines on map — blue only (UI chrome stays theme primary). */
const ROUTE_LINE_SELECTED = COLORS.secondary;
const ROUTE_LINE_UNSELECTED = 'rgba(37, 99, 235, 0.38)';

export default function PublishRoutePreviewScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const route = useRoute<RoutePreviewRouteProp>();
  const insets = useSafeAreaInsets();
  const {
    selectedFrom,
    selectedTo,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    publishRestoreKey,
    publishRecentEditEntry,
    publishWizardReview,
    publishReviewMapReturn,
    publishFabExitTab,
  } = route.params;

  const hasCoords =
    typeof pickupLatitude === 'number' &&
    typeof pickupLongitude === 'number' &&
    typeof destinationLatitude === 'number' &&
    typeof destinationLongitude === 'number';

  /** Republish from Recent edit, or “Choose route on map” from Review only — not the normal wizard preview. */
  const republishMapMode = !!publishRecentEditEntry;
  const reviewMapReturnMode = publishReviewMapReturn === true;
  const mapReturnMode = republishMapMode || reviewMapReturnMode;

  const stopsKey = useMemo(
    () =>
      hasCoords
        ? publishStopsCoordKey(
            pickupLatitude!,
            pickupLongitude!,
            destinationLatitude!,
            destinationLongitude!
          )
        : '',
    [hasCoords, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]
  );

  const [routes, setRoutes] = useState<DirectionAlternative[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  /** After a successful fetch for `stopsKey`, refetch same stops in the background without blocking UI. */
  const lastFetchedStopsKeyRef = useRef<string | null>(null);

  /**
   * First open (or new stops / cache expired): fetch directions. Same stops within cooldown: reuse cache
   * (no API call; Edit & publish keeps the same pickup/destination).
   */
  useFocusEffect(
    useCallback(() => {
      if (!hasCoords || !stopsKey) return undefined;

      const now = Date.now();
      const mem = getPublishRouteDirectionsMemoryCache();
      if (
        mem &&
        mem.stopsKey === stopsKey &&
        now - mem.fetchedAt < ROUTE_PREVIEW_FETCH_COOLDOWN_MS
      ) {
        setRoutes(mem.list);
        const maxI = Math.max(0, mem.list.length - 1);
        const restored = Math.min(Math.max(0, mem.selectedRouteIndex ?? 0), maxI);
        setSelectedRouteIndex(restored);
        setLoadingRoutes(false);
        lastFetchedStopsKeyRef.current = stopsKey;
        return undefined;
      }

      let alive = true;
      const sameStopsAsLastFetch = lastFetchedStopsKeyRef.current === stopsKey;
      if (!sameStopsAsLastFetch) {
        setLoadingRoutes(true);
      }
      void (async () => {
        const list = await getDirectionsAlternatives(
          { latitude: pickupLatitude!, longitude: pickupLongitude! },
          { latitude: destinationLatitude!, longitude: destinationLongitude! }
        );
        if (!alive) return;
        setPublishRouteDirectionsMemoryCache({
          stopsKey,
          fetchedAt: Date.now(),
          list,
          selectedRouteIndex: 0,
        });
        lastFetchedStopsKeyRef.current = stopsKey;
        setRoutes(list);
        setSelectedRouteIndex(0);
        setLoadingRoutes(false);
      })();
      return () => {
        alive = false;
      };
    }, [hasCoords, stopsKey, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude])
  );

  const mapRegion = useMemo(() => {
    if (!hasCoords) {
      return {
        latitude: 20.5937,
        longitude: 78.9629,
        latitudeDelta: 8,
        longitudeDelta: 8,
      };
    }
    if (routes.length > 0) {
      const pts = routes[selectedRouteIndex]?.overviewPolyline ?? [];
      if (pts.length > 0) {
        let minLat = pts[0].latitude;
        let maxLat = pts[0].latitude;
        let minLon = pts[0].longitude;
        let maxLon = pts[0].longitude;
        for (const p of pts) {
          minLat = Math.min(minLat, p.latitude);
          maxLat = Math.max(maxLat, p.latitude);
          minLon = Math.min(minLon, p.longitude);
          maxLon = Math.max(maxLon, p.longitude);
        }
        return {
          latitude: (minLat + maxLat) / 2,
          longitude: (minLon + maxLon) / 2,
          latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.4),
          longitudeDelta: Math.max(0.02, (maxLon - minLon) * 1.4),
        };
      }
    }
    return fitRegion(pickupLatitude!, pickupLongitude!, destinationLatitude!, destinationLongitude!);
  }, [hasCoords, routes, selectedRouteIndex, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]);

  const formatDistance = (m: number): string => `${Math.round(m / 100) / 10} km`;
  const formatDuration = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    if (h <= 0) return `${m} min`;
    return `${h} hr ${m} min`;
  };
  /**
   * Merge chosen route onto the parent screen. Does not call `goBack` (caller handles dismiss).
   * @returns `done` — root pop already removed preview; `goBack` — pop this screen; `noop` — nothing applied
   */
  const applyMapChoiceToForm = useCallback(
    (selectedIdx: number): 'done' | 'goBack' | 'noop' => {
      if (!mapReturnMode || !hasCoords) return 'noop';
      const fallbackDistanceKm = Math.max(
        1,
        Math.round(distanceKm(pickupLatitude!, pickupLongitude!, destinationLatitude!, destinationLongitude!) * 10) / 10
      );
      const selectedDistanceKm =
        routes.length > 0
          ? Math.max(1, Math.round((routes[selectedIdx]?.distanceMeters ?? 0) / 100) / 10)
          : Math.max(1, fallbackDistanceKm);
      const selectedDurationSeconds =
        routes.length > 0 && routes[selectedIdx]?.durationSeconds
          ? Math.max(60, Math.round(routes[selectedIdx].durationSeconds))
          : Math.max(60, Math.round(selectedDistanceKm * 2 * 60));
      const sel = routes.length > 0 ? routes[selectedIdx] : undefined;
      const routePolylineEncoded =
        routes.length > 0 && sel
          ? normalizeEncodedPolyline(sel.overviewPolylineEncoded) ??
            (sel.overviewPolyline?.length
              ? normalizeEncodedPolyline(encodePolyline(sel.overviewPolyline))
              : undefined)
          : undefined;
      const payload: Record<string, unknown> = {
        selectedDistanceKm,
        selectedDurationSeconds,
        routePolylineEncoded: routePolylineEncoded ?? '',
      };
      if (publishRestoreKey) payload.publishRestoreKey = publishRestoreKey;
      if (republishMapMode) {
        payload.clearRouteFare = false;
      }

      const navState = navigation.getState() as { index?: number; routes?: { name?: string; key?: string }[] };
      const routesNav = navState.routes ?? [];
      const stackIdx =
        typeof navState.index === 'number' ? navState.index : Math.max(0, routesNav.length - 1);
      const prev = stackIdx > 0 ? routesNav[stackIdx - 1] : undefined;

      if (republishMapMode) {
        if (prev?.name === 'PublishRecentEdit' && prev.key) {
          navigation.dispatch({
            ...CommonActions.setParams(payload),
            source: prev.key,
          } as never);
          return 'goBack';
        }

        if (rootNavigationRef.isReady() && rootNavigationRef.dispatch) {
          rootNavigationRef.dispatch(
            CommonActions.navigate({
              name: 'Main',
              merge: true,
              params: {
                screen: 'YourRides',
                params: {
                  screen: 'PublishRecentEdit',
                  params: payload,
                  merge: true,
                },
              },
            } as never)
          );
          rootNavigationRef.dispatch(StackActions.pop());
          return 'done';
        }
        return 'goBack';
      }

      if (prev?.name === 'PublishReview' && prev.key) {
        navigation.dispatch({
          ...CommonActions.setParams(payload),
          source: prev.key,
        } as never);
        return 'goBack';
      }

      if (rootNavigationRef.isReady() && rootNavigationRef.dispatch) {
        rootNavigationRef.dispatch(
          CommonActions.navigate({
            name: 'PublishStack',
            merge: true,
            params: {
              screen: 'PublishReview',
              params: payload,
              merge: true,
            },
          } as never)
        );
        rootNavigationRef.dispatch(StackActions.pop());
        return 'done';
      }
      return 'goBack';
    },
    [
      mapReturnMode,
      republishMapMode,
      reviewMapReturnMode,
      hasCoords,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      routes,
      navigation,
      publishRestoreKey,
    ]
  );

  const backToPublish = useCallback(() => {
    if (mapReturnMode && hasCoords) {
      const next = applyMapChoiceToForm(selectedRouteIndex);
      if (next === 'done') return;
      if (next === 'goBack') {
        if (navigation.canGoBack()) navigation.goBack();
        return;
      }
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    const exit = publishFabExitTab as MainTabName | undefined;
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
  }, [navigation, publishFabExitTab, mapReturnMode, hasCoords, applyMapChoiceToForm, selectedRouteIndex]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        backToPublish();
        return true;
      });
      return () => sub.remove();
    }, [backToPublish])
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.mapArea}>
        {MapView && hasCoords ? (
          <MapView
            style={styles.map}
            initialRegion={mapRegion}
            provider={PROVIDER_DEFAULT}
            showsUserLocation={false}
            showsMyLocationButton={false}
          >
            {Polyline && routes.length > 0
              ? routes.map((r, idx) => (
                  <Polyline
                    key={`route_${idx}`}
                    coordinates={r.overviewPolyline}
                    strokeColor={idx === selectedRouteIndex ? ROUTE_LINE_SELECTED : ROUTE_LINE_UNSELECTED}
                    strokeWidth={idx === selectedRouteIndex ? 6 : 3}
                  />
                ))
              : null}
            {Polyline && routes.length === 0 && hasCoords ? (
              <Polyline
                coordinates={[
                  { latitude: pickupLatitude!, longitude: pickupLongitude! },
                  { latitude: destinationLatitude!, longitude: destinationLongitude! },
                ]}
                strokeColor={ROUTE_LINE_SELECTED}
                strokeWidth={5}
              />
            ) : null}
            {Marker ? (
              <>
                <Marker coordinate={{ latitude: pickupLatitude!, longitude: pickupLongitude! }} title="Pickup" pinColor={COLORS.primary} />
                <Marker coordinate={{ latitude: destinationLatitude!, longitude: destinationLongitude! }} title="Destination" pinColor={COLORS.error} />
              </>
            ) : null}
          </MapView>
        ) : (
          <View style={styles.mapUnavailable}>
            <Text style={styles.mapUnavailableText}>Map unavailable</Text>
          </View>
        )}

        <TouchableOpacity onPress={backToPublish} style={styles.backFab} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>What is your route?</Text>
        {loadingRoutes ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadingText}>Calculating routes...</Text>
          </View>
        ) : routes.length > 0 ? (
          <ScrollView
            style={styles.routeScroll}
            contentContainerStyle={[
              styles.routeScrollContent,
              {
                paddingBottom: (mapReturnMode ? 12 : 72) + Math.max(insets.bottom, 12),
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {routes.map((r, idx) => (
              <TouchableOpacity
                key={`opt_${idx}`}
                style={styles.routeOption}
                onPress={() => {
                  setSelectedRouteIndex(idx);
                  patchPublishRouteDirectionsMemoryCacheSelectedRoute(stopsKey, idx);
                }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={idx === selectedRouteIndex ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={idx === selectedRouteIndex ? COLORS.primary : COLORS.textMuted}
                />
                <View style={styles.routeTextWrap}>
                  <Text style={styles.routePrimary}>
                    {formatDuration(r.durationSeconds)}{r.summary ? ` - ${r.summary}` : ''}
                  </Text>
                  <Text style={styles.routeSecondary}>{formatDistance(r.distanceMeters)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.loadingRow}>
            <Text style={styles.loadingText}>No alternatives found. Using direct path.</Text>
          </View>
        )}

        {mapReturnMode ? null : (
          <TouchableOpacity
            style={[styles.nextFab, { bottom: 18 + Math.max(insets.bottom, 0) }]}
            onPress={() => {
              const fallbackDistanceKm =
                hasCoords
                  ? Math.max(1, Math.round(distanceKm(pickupLatitude!, pickupLongitude!, destinationLatitude!, destinationLongitude!) * 10) / 10)
                  : 0;
              const selectedDistanceKm =
                routes.length > 0
                  ? Math.max(1, Math.round((routes[selectedRouteIndex]?.distanceMeters ?? 0) / 100) / 10)
                  : Math.max(1, fallbackDistanceKm);
              const selectedDurationSeconds =
                routes.length > 0 && routes[selectedRouteIndex]?.durationSeconds
                  ? Math.max(60, Math.round(routes[selectedRouteIndex].durationSeconds))
                  : Math.max(60, Math.round(selectedDistanceKm * 2 * 60));
              const sel = routes[selectedRouteIndex];
              const routePolylineEncoded =
                routes.length > 0 && sel
                  ? normalizeEncodedPolyline(sel.overviewPolylineEncoded) ??
                    (sel.overviewPolyline?.length
                      ? normalizeEncodedPolyline(encodePolyline(sel.overviewPolyline))
                      : undefined)
                  : undefined;
              navigation.navigate('PublishSelectDate', {
                selectedFrom,
                selectedTo,
                pickupLatitude,
                pickupLongitude,
                destinationLatitude,
                destinationLongitude,
                selectedDistanceKm,
                selectedDurationSeconds,
                routePolylineEncoded: routePolylineEncoded ?? '',
                publishRestoreKey,
                ...(publishWizardReview ? { publishWizardReview: true } : {}),
                ...(publishFabExitTab ? { publishFabExitTab } : {}),
              });
            }}
          >
            <Ionicons name="arrow-forward" size={24} color={COLORS.white} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.backgroundSecondary },
  mapArea: {
    width: '100%',
    height: Math.min(520, Dimensions.get('window').height * 0.66),
    backgroundColor: COLORS.background,
  },
  map: { flex: 1 },
  mapUnavailable: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mapUnavailableText: { color: COLORS.textSecondary, fontSize: 14 },
  backFab: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  sheet: {
    flex: 1,
    marginTop: -6,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 22,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 14,
    lineHeight: 26,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  routeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
    gap: 10,
  },
  routeTextWrap: { flex: 1 },
  routePrimary: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 20,
  },
  routeSecondary: {
    marginTop: 3,
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
    lineHeight: 16,
  },
  routeScroll: {
    flex: 1,
    minHeight: 0,
  },
  routeScrollContent: {
    flexGrow: 1,
  },
  nextFab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 5,
  },
});
