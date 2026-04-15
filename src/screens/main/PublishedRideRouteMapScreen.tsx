import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { SearchStackParamList, RidesStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { decodePolyline, normalizeEncodedPolyline, type LatLngPoint } from '../../utils/routePolyline';
import { pickRoutePolylineEncodedFromRecord } from '../../utils/ridePublisherCoords';
import { reportMapRouteDisplayEvent } from '../../services/mapRouteDisplayTelemetry';
import { getDirectionsAlternatives } from '../../services/places';

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

function boundsFromCoordinates(points: LatLngPoint[], fallback: () => ReturnType<typeof fitRegion>) {
  if (points.length < 2) return fallback();
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLon = points[0].longitude;
  let maxLon = points[0].longitude;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude);
    maxLon = Math.max(maxLon, p.longitude);
  }
  if (!Number.isFinite(minLat) || minLat === maxLat) return fallback();
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.45),
    longitudeDelta: Math.max(0.02, (maxLon - minLon) * 1.45),
  };
}

const ROUTE_STROKE = COLORS.secondary;

/** In-memory only — avoids repeat Directions billing on the same device for identical endpoints. */
const directionsLineByCoordsKey = new Map<string, LatLngPoint[]>();

function routeCoordsCacheKey(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): string {
  return [aLat, aLon, bLat, bLon].map((n) => Number(n).toFixed(5)).join('|');
}

type TelemetrySent = {
  parseFailed: boolean;
  displayOk: boolean;
  straightFallback: boolean;
};

const emptyTelemetrySent: TelemetrySent = {
  parseFailed: false,
  displayOk: false,
  straightFallback: false,
};

export default function PublishedRideRouteMapScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const route = useRoute<PublishedMapRouteProp>();
  const insets = useSafeAreaInsets();
  const {
    pickupLabel,
    destinationLabel,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    rideId,
  } = route.params;

  const routePolylineEncodedParam = pickRoutePolylineEncodedFromRecord(
    route.params as Record<string, unknown>
  );

  const hasCoords =
    typeof pickupLatitude === 'number' &&
    typeof pickupLongitude === 'number' &&
    typeof destinationLatitude === 'number' &&
    typeof destinationLongitude === 'number';

  const routeTelemetryKey = [
    rideId ?? '',
    routePolylineEncodedParam ?? '',
    String(pickupLatitude),
    String(pickupLongitude),
    String(destinationLatitude),
    String(destinationLongitude),
  ].join('|');

  const telemetrySentRef = useRef<TelemetrySent>({ ...emptyTelemetrySent });
  const lastTelemetryKeyRef = useRef('');
  useEffect(() => {
    if (lastTelemetryKeyRef.current !== routeTelemetryKey) {
      lastTelemetryKeyRef.current = routeTelemetryKey;
      telemetrySentRef.current = { ...emptyTelemetrySent };
    }
  }, [routeTelemetryKey]);

  const storedRouteResult = useMemo(() => {
    const encoded = normalizeEncodedPolyline(routePolylineEncodedParam);
    if (!encoded) {
      return { line: [] as LatLngPoint[], parseFailed: false };
    }
    try {
      const pts = decodePolyline(encoded);
      if (pts.length > 1) {
        return { line: pts, parseFailed: false };
      }
      return { line: [], parseFailed: true };
    } catch {
      return { line: [], parseFailed: true };
    }
  }, [routePolylineEncodedParam]);

  const selectedRoutePolyline = storedRouteResult.line;
  const hasStoredPath = selectedRoutePolyline.length > 1;

  const coordsCacheKey = useMemo(
    () =>
      hasCoords
        ? routeCoordsCacheKey(
            pickupLatitude,
            pickupLongitude,
            destinationLatitude,
            destinationLongitude
          )
        : '',
    [hasCoords, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude]
  );

  const [clientLine, setClientLine] = useState<LatLngPoint[]>([]);
  const [clientResolved, setClientResolved] = useState(false);

  useEffect(() => {
    if (!hasCoords || hasStoredPath) {
      setClientLine([]);
      setClientResolved(true);
      return;
    }

    setClientResolved(false);
    setClientLine([]);

    const cached = directionsLineByCoordsKey.get(coordsCacheKey);
    if (cached && cached.length > 1) {
      setClientLine(cached);
      setClientResolved(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const alts = await getDirectionsAlternatives(
          { latitude: pickupLatitude, longitude: pickupLongitude },
          { latitude: destinationLatitude, longitude: destinationLongitude },
          { alternatives: false }
        );
        const pts = alts[0]?.overviewPolyline ?? [];
        if (cancelled) return;
        if (pts.length > 1) {
          directionsLineByCoordsKey.set(coordsCacheKey, pts);
          setClientLine(pts);
        } else {
          setClientLine([]);
        }
      } catch {
        if (!cancelled) setClientLine([]);
      } finally {
        if (!cancelled) setClientResolved(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasCoords,
    hasStoredPath,
    coordsCacheKey,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
  ]);

  const displayPolyline = useMemo((): LatLngPoint[] => {
    if (hasStoredPath && selectedRoutePolyline.length > 1) return selectedRoutePolyline;
    if (!hasStoredPath && clientLine.length > 1) return clientLine;
    return [];
  }, [hasStoredPath, selectedRoutePolyline, clientLine]);

  const showRoutePolyline = displayPolyline.length > 1;
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!hasCoords || !storedRouteResult.parseFailed) return;
    if (telemetrySentRef.current.parseFailed) return;
    telemetrySentRef.current.parseFailed = true;
    reportMapRouteDisplayEvent({ event: 'polyline_parse_failed', rideId });
  }, [hasCoords, storedRouteResult.parseFailed, rideId]);

  useEffect(() => {
    if (!hasCoords || !showRoutePolyline) return;
    if (telemetrySentRef.current.displayOk) return;
    telemetrySentRef.current.displayOk = true;
    const polylineSource: 'stored' | 'directions_fallback' = hasStoredPath ? 'stored' : 'directions_fallback';
    reportMapRouteDisplayEvent({ event: 'polyline_display_ok', rideId, polylineSource });
  }, [hasCoords, showRoutePolyline, rideId, hasStoredPath]);

  useEffect(() => {
    if (!hasCoords || hasStoredPath) return;
    if (!clientResolved) return;
    if (clientLine.length > 1) return;
    if (telemetrySentRef.current.straightFallback) return;
    telemetrySentRef.current.straightFallback = true;
    reportMapRouteDisplayEvent({ event: 'polyline_render_fallback', rideId, polylineSource: 'none' });
  }, [hasCoords, hasStoredPath, clientResolved, clientLine, rideId]);

  useEffect(() => {
    if (!showRoutePolyline || !mapRef.current?.fitToCoordinates) return;
    const t = setTimeout(() => {
      try {
        mapRef.current.fitToCoordinates(displayPolyline, {
          edgePadding: { top: 72, right: 28, bottom: 200, left: 28 },
          animated: true,
        });
      } catch {
        /* fitToCoordinates can throw on some map states */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [showRoutePolyline, displayPolyline]);

  const mapRegion = useMemo(() => {
    if (!hasCoords) {
      return {
        latitude: 20.5937,
        longitude: 78.9629,
        latitudeDelta: 8,
        longitudeDelta: 8,
      };
    }
    if (showRoutePolyline) {
      return boundsFromCoordinates(displayPolyline, () =>
        fitRegion(pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude)
      );
    }
    return fitRegion(pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude);
  }, [
    hasCoords,
    showRoutePolyline,
    displayPolyline,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={14}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          Route
        </Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.mapArea}>
        {MapView && hasCoords ? (
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={mapRegion}
            provider={PROVIDER_DEFAULT}
            showsUserLocation={false}
            showsMyLocationButton={false}
          >
            {Polyline && showRoutePolyline ? (
              <Polyline coordinates={displayPolyline} strokeColor={ROUTE_STROKE} strokeWidth={4} />
            ) : null}
            {Marker ? (
              <>
                <Marker
                  coordinate={{ latitude: pickupLatitude, longitude: pickupLongitude }}
                  title="From"
                  pinColor="#16a34a"
                />
                <Marker
                  coordinate={{ latitude: destinationLatitude, longitude: destinationLongitude }}
                  title="To"
                  pinColor="#ef4444"
                />
              </>
            ) : null}
          </MapView>
        ) : (
          <View style={styles.mapEmpty}>
            <Text style={styles.mapEmptyText}>Map unavailable</Text>
          </View>
        )}
        {!hasStoredPath && hasCoords && !clientResolved ? (
          <View style={styles.mapLoadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={COLORS.primary} />
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, 10) + 14 },
        ]}
      >
        <View style={styles.footerCard}>
          <View style={styles.routeRow}>
            <View style={styles.pickupBubble}>
              <View style={styles.pickupDot} />
            </View>
            <View style={styles.routeCopy}>
              <Text style={styles.routeKind}>Pickup</Text>
              <Text style={styles.stopLabel} numberOfLines={2}>
                {pickupLabel.trim() || '—'}
              </Text>
            </View>
          </View>

          <View style={styles.routeRule} />

          <View style={styles.routeRow}>
            <View style={styles.dropBubble}>
              <Ionicons name="location" size={17} color={COLORS.primary} />
            </View>
            <View style={styles.routeCopy}>
              <Text style={styles.routeKind}>Drop-off</Text>
              <Text style={styles.stopLabel} numberOfLines={2}>
                {destinationLabel.trim() || '—'}
              </Text>
            </View>
          </View>

        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  headerRight: {
    width: 40,
  },
  mapArea: {
    flex: 1,
    backgroundColor: '#e2e8f0',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,250,252,0.35)',
  },
  mapEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapEmptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  footer: {
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.background,
  },
  footerCard: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  pickupBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: COLORS.success,
  },
  dropBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(41, 190, 139, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  routeKind: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  routeRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 10,
    marginLeft: 47,
  },
  stopLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 20,
  },
});
