import type { RideListItem } from '../types/api';
import { pickPublisherAvatarUrl } from './avatarUrl';

/**
 * **Ride list/detail JSON (camelCase only)** — tell backend to use these keys and no snake_case
 * duplicates on the ride root for the same concepts:
 *
 * | Field | Canonical key |
 * |-------|----------------|
 * | Passenger-visible notes | `description` |
 * | Route duration (seconds) | `estimatedDurationSeconds` |
 * | Driver / publisher avatar URL | `publisherAvatarUrl` |
 * | Authenticated user is the driver | `viewerIsOwner` |
 * | Publisher account active | `publisherAccountActive` |
 * | Vehicle make/model | `vehicleModel` |
 * | Plate / reg (same concept as “vehicle number”) | `licensePlate` only on ride root |
 * | Vehicle color | `vehicleColor` |
 *
 * Ingest still accepts legacy aliases once, then strips them so in-app ride objects stay camelCase-only.
 * If both `licensePlate` and `vehicleNumber` differ, both may remain until backend sends one field.
 */
export const RIDE_API_FIELD_STYLE: 'camelCase' = 'camelCase';

function trimStr(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

function numLoose(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v != null && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Normalize ride-root aliases into camelCase and remove duplicate keys from a shallow copy.
 * Safe for any object merged into `RideListItem` state.
 */
export function applyCanonicalRideApiFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };

  const description =
    trimStr(out.description) ||
    trimStr(out.rideDescription) ||
    trimStr(out.ride_description) ||
    trimStr(out.driverNotes) ||
    trimStr(out.driver_notes) ||
    trimStr(out.notes);
  if (description) out.description = description;
  else delete out.description;
  delete out.rideDescription;
  delete out.ride_description;
  delete out.driverNotes;
  delete out.driver_notes;
  delete out.notes;

  const est = numLoose(out.estimatedDurationSeconds ?? out.estimated_duration_seconds);
  if (est !== undefined && est > 0) out.estimatedDurationSeconds = Math.max(1, Math.floor(est));
  else delete out.estimatedDurationSeconds;
  delete out.estimated_duration_seconds;

  const pubAvatar = pickPublisherAvatarUrl(out);
  if (pubAvatar) out.publisherAvatarUrl = pubAvatar;
  else delete out.publisherAvatarUrl;
  delete out.publisher_avatar_url;
  delete out.driverAvatarUrl;
  delete out.driver_avatar_url;

  const vi = out.viewerIsOwner ?? out.viewer_is_owner;
  if (vi === true || vi === 'true') out.viewerIsOwner = true;
  else if (vi === false || vi === 'false') out.viewerIsOwner = false;
  else delete out.viewerIsOwner;
  delete out.viewer_is_owner;

  const paa = out.publisherAccountActive ?? out.publisher_account_active;
  if (typeof paa === 'boolean') out.publisherAccountActive = paa;
  else if (paa === 'true') out.publisherAccountActive = true;
  else if (paa === 'false') out.publisherAccountActive = false;
  else delete out.publisherAccountActive;
  delete out.publisher_account_active;

  const vehicleModel = trimStr(out.vehicleModel) || trimStr(out.vehicle_model);
  if (vehicleModel) out.vehicleModel = vehicleModel;
  else delete out.vehicleModel;
  delete out.vehicle_model;

  const plateField =
    trimStr(out.licensePlate) ||
    trimStr(out.license_plate) ||
    trimStr(out.vehicleNumber) ||
    trimStr(out.vehicle_number);
  const numOnly =
    trimStr(out.vehicleNumber) ||
    trimStr(out.vehicle_number);
  const licOnly =
    trimStr(out.licensePlate) ||
    trimStr(out.license_plate);
  delete out.license_plate;
  delete out.vehicle_number;
  if (plateField) {
    out.licensePlate = plateField;
    if (numOnly && licOnly && numOnly !== licOnly) {
      out.vehicleNumber = numOnly;
    } else {
      delete out.vehicleNumber;
    }
  } else {
    delete out.licensePlate;
    delete out.vehicleNumber;
  }

  const vehicleColor = trimStr(out.vehicleColor) || trimStr(out.vehicle_color);
  if (vehicleColor) out.vehicleColor = vehicleColor;
  else delete out.vehicleColor;
  delete out.vehicle_color;

  return out;
}

export function withCanonicalRideFields(ride: RideListItem): RideListItem {
  return applyCanonicalRideApiFields(ride as unknown as Record<string, unknown>) as unknown as RideListItem;
}
