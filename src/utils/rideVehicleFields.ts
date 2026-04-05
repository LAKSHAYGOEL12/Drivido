import type { RideListItem } from '../types/api';
import { vehicleIdString } from './userVehicle';

type VehicleFieldPick = Partial<
  Pick<RideListItem, 'vehicleModel' | 'licensePlate' | 'vehicleNumber' | 'vehicleColor'>
>;

/** One object level: camelCase or snake_case. */
function pickVehicleFieldsFromFlatRecord(r: Record<string, unknown>): VehicleFieldPick {
  const s = (v: unknown) => (v == null ? '' : String(v).trim());
  const vehicleModel = s(r.vehicleModel ?? r.vehicle_model);
  const licensePlateRaw = s(r.licensePlate ?? r.license_plate);
  const vehicleNumberRaw = s(r.vehicleNumber ?? r.vehicle_number);
  const vehicleColor = s(r.vehicleColor ?? r.vehicle_color);
  const plateLine = licensePlateRaw || vehicleNumberRaw;
  const out: VehicleFieldPick = {};
  if (vehicleModel) out.vehicleModel = vehicleModel;
  if (plateLine) out.licensePlate = plateLine;
  if (vehicleColor) out.vehicleColor = vehicleColor;
  if (vehicleNumberRaw && vehicleNumberRaw !== plateLine) out.vehicleNumber = vehicleNumberRaw;
  return out;
}

const NESTED_VEHICLE_KEYS = [
  'vehicle',
  'driverVehicle',
  'driver_vehicle',
  'rideVehicle',
  'ride_vehicle',
  'selectedVehicle',
  'selected_vehicle',
] as const;

/** When ride has `vehicleId`, pick the matching row from embedded vehicle lists (passenger detail). */
function findVehicleRowByIdInRideRecord(
  r: Record<string, unknown>,
  rideVid: string
): Record<string, unknown> | null {
  const tryArrays: unknown[] = [];
  const pub = r.publisher ?? r.driver ?? r.owner;
  if (pub && typeof pub === 'object' && !Array.isArray(pub)) {
    const p = pub as Record<string, unknown>;
    for (const k of ['vehicles', 'userVehicles', 'user_vehicles'] as const) {
      const a = p[k];
      if (Array.isArray(a)) tryArrays.push(a);
    }
  }
  for (const k of [
    'publisherVehicles',
    'publisher_vehicles',
    'driverVehicles',
    'driver_vehicles',
  ] as const) {
    const a = r[k];
    if (Array.isArray(a)) tryArrays.push(a);
  }
  for (const arr of tryArrays) {
    for (const item of arr as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (vehicleIdString(row.id ?? row._id) === rideVid) return row;
    }
  }
  return null;
}

/**
 * Vehicle snapshot fields may arrive on the ride root, under `vehicle`, on `publisher`/`driver`, etc.
 * Ride-root fields apply first; if `vehicleId` is set, a matching row in `publisher.vehicles` (etc.)
 * overrides stale root snapshot so the selected vehicle matches what the owner published.
 */
export function normalizeVehicleFieldsFromApiRecord(r: Record<string, unknown>): VehicleFieldPick {
  let merged: VehicleFieldPick = {};
  for (const k of NESTED_VEHICLE_KEYS) {
    const v = r[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      merged = { ...merged, ...pickVehicleFieldsFromFlatRecord(v as Record<string, unknown>) };
    }
  }
  const pub = r.publisher ?? r.driver ?? r.owner;
  if (pub && typeof pub === 'object' && !Array.isArray(pub)) {
    const p = pub as Record<string, unknown>;
    merged = { ...merged, ...pickVehicleFieldsFromFlatRecord(p) };
    const pv = p.vehicle ?? p.driverVehicle ?? p.driver_vehicle;
    if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
      merged = { ...merged, ...pickVehicleFieldsFromFlatRecord(pv as Record<string, unknown>) };
    }
  }
  merged = { ...merged, ...pickVehicleFieldsFromFlatRecord(r) };
  const rideVid = vehicleIdString(r.vehicleId ?? r.vehicle_id);
  if (rideVid) {
    const row = findVehicleRowByIdInRideRecord(r, rideVid);
    if (row) merged = { ...merged, ...pickVehicleFieldsFromFlatRecord(row) };
  }
  return merged;
}

/** Apply API aliases onto a ride object for state (merges with existing camelCase). */
export function mergeVehicleFieldsIntoRide(ride: RideListItem): RideListItem {
  const raw = ride as unknown as Record<string, unknown>;
  const extra = normalizeVehicleFieldsFromApiRecord(raw);
  const vehicleId = vehicleIdString(raw.vehicleId ?? raw.vehicle_id) || undefined;
  const hasExtra = Object.keys(extra).length > 0;
  if (!hasExtra && !vehicleId) return ride;
  return { ...ride, ...extra, ...(vehicleId ? { vehicleId } : {}) };
}
