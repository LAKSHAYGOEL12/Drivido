import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import type { PublishStackParamList } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import { getDirectionsAlternatives, type DirectionAlternative } from '../../services/places';

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

export default function PublishRoutePreviewScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const route = useRoute<RoutePreviewRouteProp>();
  const {
    selectedFrom,
    selectedTo,
    pickupLatitude,
    pickupLongitude,
    destinationLatitude,
    destinationLongitude,
    publishRestoreKey,
  } = route.params;

  const hasCoords =
    typeof pickupLatitude === 'number' &&
    typeof pickupLongitude === 'number' &&
    typeof destinationLatitude === 'number' &&
    typeof destinationLongitude === 'number';

  const [routes, setRoutes] = useState<DirectionAlternative[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!hasCoords) return;
      setLoadingRoutes(true);
      const list = await getDirectionsAlternatives(
        { latitude: pickupLatitude!, longitude: pickupLongitude! },
        { latitude: destinationLatitude!, longitude: destinationLongitude! }
      );
      if (!alive) return;
      setRoutes(list);
      setSelectedRouteIndex(0);
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
  const backToPublish = () => {
    const params: Record<string, unknown> = {
      selectedFrom,
      selectedTo,
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude,
      clearRouteFare: true,
    };
    if (publishRestoreKey) params._publishRestoreKey = publishRestoreKey;
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'PublishRide', params }],
      })
    );
  };

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
                    strokeColor={idx === selectedRouteIndex ? '#1976ff' : 'rgba(25,118,255,0.35)'}
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
                strokeColor="#2b7bff"
                strokeWidth={5}
              />
            ) : null}
            {Marker ? (
              <>
                <Marker coordinate={{ latitude: pickupLatitude!, longitude: pickupLongitude! }} title="Pickup" pinColor="#16a34a" />
                <Marker coordinate={{ latitude: destinationLatitude!, longitude: destinationLongitude! }} title="Destination" pinColor="#ef4444" />
              </>
            ) : null}
          </MapView>
        ) : (
          <View style={styles.mapUnavailable}>
            <Text style={styles.mapUnavailableText}>Map unavailable</Text>
          </View>
        )}

        <TouchableOpacity onPress={backToPublish} style={styles.backFab} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={COLORS.secondary} />
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
          <View>
            {routes.map((r, idx) => (
              <TouchableOpacity
                key={`opt_${idx}`}
                style={styles.routeOption}
                onPress={() => setSelectedRouteIndex(idx)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={idx === selectedRouteIndex ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={idx === selectedRouteIndex ? '#1d7df2' : '#60a5fa'}
                />
                <View style={styles.routeTextWrap}>
                  <Text style={styles.routePrimary}>
                    {formatDuration(r.durationSeconds)}{r.summary ? ` - ${r.summary}` : ''}
                  </Text>
                  <Text style={styles.routeSecondary}>{formatDistance(r.distanceMeters)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.loadingRow}>
            <Text style={styles.loadingText}>No alternatives found. Using direct path.</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.nextFab}
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
            navigation.navigate('PublishPrice', {
              selectedFrom,
              selectedTo,
              pickupLatitude,
              pickupLongitude,
              destinationLatitude,
              destinationLongitude,
              selectedDistanceKm,
              selectedDurationSeconds,
              publishRestoreKey,
            });
          }}
        >
          <Ionicons name="arrow-forward" size={24} color={COLORS.white} />
        </TouchableOpacity>
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
    color: '#0b2a57',
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
    color: '#133a70',
    lineHeight: 20,
  },
  routeSecondary: {
    marginTop: 3,
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
    lineHeight: 16,
  },
  nextFab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1d7df2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 5,
  },
});
