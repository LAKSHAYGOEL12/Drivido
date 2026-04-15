import { API } from '../constants/API';
import api, { hasAuthAccessToken } from './api';

export type MapRouteDisplayTelemetryEvent =
  | 'polyline_parse_failed'
  | 'polyline_render_fallback'
  | 'polyline_display_ok';

/** How the route line was obtained when `event` is `polyline_display_ok`. */
export type MapRoutePolylineSource = 'stored' | 'directions_fallback';

function isLikelyMongoObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id.trim());
}

/**
 * Fire-and-forget: POST /api/telemetry/map-route-display (204 expected).
 * Skips when not signed in. Omits rideId unless it looks like a Mongo ObjectId (backend contract).
 * Optional `polylineSource` is sent for analytics (e.g. with `polyline_display_ok`).
 */
export function reportMapRouteDisplayEvent(opts: {
  event: MapRouteDisplayTelemetryEvent;
  rideId?: string;
  polylineSource?: MapRoutePolylineSource | 'none';
}): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log('[mapRouteDisplayTelemetry]', {
      event: opts.event,
      rideId: opts.rideId?.trim(),
      polylineSource: opts.polylineSource,
    });
  }

  if (!hasAuthAccessToken()) return;

  const body: Record<string, string> = { event: opts.event };
  const rid = opts.rideId?.trim();
  if (rid && isLikelyMongoObjectId(rid)) {
    body.rideId = rid;
  }
  if (opts.polylineSource) {
    body.polylineSource = opts.polylineSource;
  }

  void api.post<unknown>(API.endpoints.telemetry.mapRouteDisplay, body, { timeout: 8000 }).catch(() => {
    /* intentionally ignored */
  });
}
