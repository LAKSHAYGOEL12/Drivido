import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { SearchStackParamList, RidesStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { getDirectionsAlternatives, type DirectionAlternative } from '../../services/places';

type PublishedMapRouteProp =
  | RouteProp<SearchStackParamList, 'PublishedRideRouteMap'>
  | RouteProp<RidesStackParamList, 'PublishedRideRouteMap'>;

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

/** Distinct strokes so every alternative is visible on the map. */
const ROUTE_STROKE_COLORS = ['#1d7df2', '#64748b', '#d97706', '#7c3aed', '#0d9488'];

function boundsFromRoutes(routes: DirectionAlternative[], fallback: () => ReturnType<typeof fitRegion>) {
  if (routes.length === 0) return fallback();
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const r of routes) {
    for (const p of r.overviewPolyline) {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLon = Math.min(minLon, p.longitude);
      maxLon = Math.max(maxLon, p.longitude);
    }
  }
  if (!Number.isFinite(minLat) || minLat === maxLat) return fallback();
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.45),
    longitudeDelta: Math.max(0.02, (maxLon - minLon) * 1.45),
  };
}

export default function PublishedRideRouteMapScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<PublishedMapRouteProp>();
  const {
    pickupLabel,
    destinationLabel,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
  } = route.params;

  const hasCoords =
    typeof pickupLatitude === 'number' &&
    typeof pickupLongitude === 'number' &&
    typeof destinationLatitude === 'number' &&
    typeof destinationLongitude === 'number';

  const [directionRoutes, setDirectionRoutes] = useState<DirectionAlternative[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!hasCoords) return;
      setLoadingRoutes(true);
      const origin = { latitude: pickupLatitude, longitude: pickupLongitude };
      const dest = { latitude: destinationLatitude, longitude: destinationLongitude };
      const list = await getDirectionsAlternatives(origin, dest, { alternatives: true });
      if (!alive) return;
      setDirectionRoutes(list);
      setLoadingRoutes(false);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [hasCoords, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]);

  const mapRegion = useMemo(() => {
    if (!hasCoords) {
      return {
        latitude: 20.5937,
        longitude: 78.9629,
        latitudeDelta: 8,
        longitudeDelta: 8,
      };
    }
    return boundsFromRoutes(directionRoutes, () =>
      fitRegion(pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude)
    );
  }, [hasCoords, directionRoutes, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]);

  const formatDistance = (m: number): string => `${Math.round(m / 100) / 10} km`;
  const formatDuration = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    if (h <= 0) return `${m} min`;
    return `${h} hr ${m} min`;
  };

  const mapHeight = Math.max(280, Dimensions.get('window').height * 0.42);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          Driving routes
        </Text>
        <View style={styles.topBarSpacer} />
      </View>

      <View style={[styles.mapWrap, { height: mapHeight }]}>
        {MapView && hasCoords ? (
          <MapView
            style={styles.map}
            initialRegion={mapRegion}
            provider={PROVIDER_DEFAULT}
            showsUserLocation={false}
            showsMyLocationButton={false}
          >
            {Polyline &&
              directionRoutes.map((r, idx) =>
                r.overviewPolyline.length > 0 ? (
                  <Polyline
                    key={`rt_${idx}`}
                    coordinates={r.overviewPolyline}
                    strokeColor={ROUTE_STROKE_COLORS[idx % ROUTE_STROKE_COLORS.length]}
                    strokeWidth={idx === 0 ? 5 : 4}
                  />
                ) : null
              )}
            {Polyline && directionRoutes.length === 0 && !loadingRoutes && hasCoords ? (
              <Polyline
                coordinates={[
                  { latitude: pickupLatitude, longitude: pickupLongitude },
                  { latitude: destinationLatitude, longitude: destinationLongitude },
                ]}
                strokeColor={COLORS.primary}
                strokeWidth={4}
              />
            ) : null}
            {Marker ? (
              <>
                <Marker
                  coordinate={{ latitude: pickupLatitude, longitude: pickupLongitude }}
                  title="Pickup"
                  pinColor="#16a34a"
                />
                <Marker
                  coordinate={{ latitude: destinationLatitude, longitude: destinationLongitude }}
                  title="Drop-off"
                  pinColor="#ef4444"
                />
              </>
            ) : null}
          </MapView>
        ) : (
          <View style={styles.mapUnavailable}>
            <Text style={styles.mapUnavailableText}>Map unavailable</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sheetHint}>
          Lines show the driving routes Google returned for this pickup and destination (up to several
          alternatives). Times and paths can change with live traffic.
        </Text>

        <View style={styles.stopsCard}>
          <View style={styles.stopRow}>
            <View style={styles.stopDot} />
            <Text style={styles.stopText} numberOfLines={3}>
              {pickupLabel}
            </Text>
          </View>
          <View style={styles.stopLine} />
          <View style={styles.stopRow}>
            <Ionicons name="location" size={18} color={COLORS.primary} />
            <Text style={styles.stopText} numberOfLines={3}>
              {destinationLabel}
            </Text>
          </View>
        </View>

        {loadingRoutes ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading routes…</Text>
          </View>
        ) : directionRoutes.length > 0 ? (
          <View style={styles.routesList}>
            <Text style={styles.routeSummaryLabel}>Route options</Text>
            {directionRoutes.map((r, idx) => (
              <View
                key={`row_${idx}`}
                style={[styles.routeOptionRow, idx > 0 && styles.routeOptionRowBorder]}
              >
                <View
                  style={[
                    styles.routeSwatch,
                    { backgroundColor: ROUTE_STROKE_COLORS[idx % ROUTE_STROKE_COLORS.length] },
                  ]}
                />
                <View style={styles.routeOptionText}>
                  <Text style={styles.routePrimary}>
                    {formatDuration(r.durationSeconds)}
                    {r.summary ? ` · ${r.summary}` : ''}
                  </Text>
                  <Text style={styles.routeSecondary}>{formatDistance(r.distanceMeters)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : hasCoords ? (
          <Text style={styles.fallbackNote}>
            No driving routes returned. The line on the map is a straight path between the two stops.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    padding: 8,
  },
  topTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  topBarSpacer: {
    width: 40,
  },
  mapWrap: {
    width: '100%',
    backgroundColor: '#e8eef2',
  },
  map: { flex: 1 },
  mapUnavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapUnavailableText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
  },
  sheetHint: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
    marginBottom: 14,
  },
  stopsCard: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stopDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginTop: 4,
    backgroundColor: COLORS.background,
  },
  stopLine: {
    width: 2,
    height: 14,
    marginLeft: 5,
    marginVertical: 4,
    backgroundColor: COLORS.border,
  },
  stopText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 21,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  routesList: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.background,
    paddingVertical: 4,
    marginBottom: 8,
  },
  routeSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  routeOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  routeOptionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  routeSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeOptionText: {
    flex: 1,
  },
  routePrimary: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  routeSecondary: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  fallbackNote: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 19,
  },
});
