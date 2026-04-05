/**
 * Vehicles from GET /api/auth/me `user.vehicles` (max 2) plus legacy flat profile fields.
 */

export const MAX_USER_VEHICLES = 2;

export type UserProfileVehicle = {
  id: string;
  vehicleModel: string;
  licensePlate: string;
  vehicleColor?: string;
  createdAt?: string;
};

/** UI / publish selection — same shape as API vehicle. */
export type UserVehicleEntry = UserProfileVehicle;

function normPlate(p: string): string {
  return p.replace(/\s+/g, '').toUpperCase();
}

/**
 * Mongo/JSON ids: plain string, number, or `{ $oid: "..." }` from extended JSON.
 */
export function vehicleIdString(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.$oid === 'string') return o.$oid.trim();
  }
  return '';
}

/** Parse one vehicle object from API (camelCase or snake_case). */
export function parseVehicleRecord(item: unknown): UserProfileVehicle | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const id = vehicleIdString(o.id) || vehicleIdString(o._id);
  const vehicleModel = String(o.vehicleModel ?? o.vehicle_model ?? '').trim();
  const licensePlate = String(o.licensePlate ?? o.license_plate ?? '').trim();
  if (!id || !vehicleModel || !licensePlate) return null;
  const vehicleColor = String(o.vehicleColor ?? o.vehicle_color ?? '').trim();
  const createdAt = String(o.createdAt ?? o.created_at ?? '').trim();
  return {
    id,
    vehicleModel,
    licensePlate,
    ...(vehicleColor ? { vehicleColor } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

/** Read `vehicles` array from a user/auth record. */
export function normalizeVehiclesFromRecord(rec: Record<string, unknown>): UserProfileVehicle[] {
  const raw = rec.vehicles ?? rec.userVehicles ?? rec.user_vehicles;
  if (!Array.isArray(raw)) return [];
  const out: UserProfileVehicle[] = [];
  for (const item of raw) {
    const v = parseVehicleRecord(item);
    if (v) out.push(v);
  }
  return out.slice(0, MAX_USER_VEHICLES);
}

/** Parse GET /user/vehicles or wrapped list bodies. */
export function normalizeVehiclesFromListPayload(raw: unknown): UserProfileVehicle[] {
  if (Array.isArray(raw)) {
    const out: UserProfileVehicle[] = [];
    for (const item of raw) {
      const v = parseVehicleRecord(item);
      if (v) out.push(v);
    }
    return out.slice(0, MAX_USER_VEHICLES);
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const arr = r.vehicles ?? r.data;
    if (Array.isArray(arr)) return normalizeVehiclesFromListPayload(arr);
  }
  return [];
}

/** Parse POST/PATCH vehicle response (raw vehicle or `{ vehicle }` / `{ data }`). */
export function parseVehicleFromMutationResponse(raw: unknown): UserProfileVehicle | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const inner =
    r.vehicle && typeof r.vehicle === 'object'
      ? r.vehicle
      : r.data && typeof r.data === 'object'
        ? r.data
        : r;
  return parseVehicleRecord(inner);
}

/**
 * Vehicles for UI: prefer `user.vehicles` from API; else legacy flat `vehicleModel` / `licensePlate`.
 */
export function vehiclesFromUser(
  user: {
    vehicles?: UserProfileVehicle[];
    vehicleModel?: string;
    vehicleName?: string;
    licensePlate?: string;
    vehicleColor?: string;
  } | null | undefined
): UserVehicleEntry[] {
  if (!user) return [];
  /** When `vehicles` is an array from the API (even empty), it is the source of truth — ignore stale flat fields. */
  if (Array.isArray(user.vehicles)) {
    if (user.vehicles.length === 0) return [];
    return user.vehicles.slice(0, MAX_USER_VEHICLES).map((v) => ({
      id: v.id,
      vehicleModel: v.vehicleModel,
      licensePlate: v.licensePlate,
      ...(v.vehicleColor?.trim() ? { vehicleColor: v.vehicleColor.trim() } : {}),
      ...(v.createdAt ? { createdAt: v.createdAt } : {}),
    }));
  }
  const model = (user.vehicleModel ?? user.vehicleName ?? '').trim();
  const plate = (user.licensePlate ?? '').trim();
  if (model && plate) {
    return [
      {
        id: 'legacy-profile',
        vehicleModel: model,
        licensePlate: plate,
        ...(user.vehicleColor?.trim() ? { vehicleColor: user.vehicleColor.trim() } : {}),
      },
    ];
  }
  return [];
}

export function userHasVehicleProfileInfo(
  user: Parameters<typeof vehiclesFromUser>[0]
): boolean {
  return vehiclesFromUser(user).length > 0;
}

/** Map full vehicle list into auth `patchUser` fields (primary vehicle mirrors first slot). */
export function vehicleListToAuthPatch(list: UserProfileVehicle[]): {
  vehicles: UserProfileVehicle[];
  vehicleModel?: string;
  licensePlate?: string;
  vehicleColor?: string;
} {
  const primary = list[0];
  return {
    vehicles: list.slice(0, MAX_USER_VEHICLES),
    ...(primary
      ? {
          vehicleModel: primary.vehicleModel,
          licensePlate: primary.licensePlate,
          ...(primary.vehicleColor?.trim() ? { vehicleColor: primary.vehicleColor.trim() } : {}),
        }
      : {}),
  };
}
