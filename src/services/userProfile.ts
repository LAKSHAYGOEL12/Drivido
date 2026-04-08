import { API } from '../constants/API';
import api from './api';
import { normalizeRidePreferenceIds } from '../constants/ridePreferences';
import { clampPhoneNationalInput } from '../constants/validation';

function userUpdatePath(): string {
  const p = API.endpoints.user.update;
  return p.startsWith('/') ? p : `/${p}`;
}

/**
 * PATCH `/api/user/update` — extend if backend adds fields.
 * Sends camelCase; many backends also accept snake_case.
 */
export async function updateUserProfileFields(body: {
  dateOfBirth: string;
  gender: string;
  phone: string;
}): Promise<void> {
  await api.patch(userUpdatePath(), {
    dateOfBirth: body.dateOfBirth,
    gender: body.gender,
    phone: body.phone,
  });
}

export type UserVehicleProfilePayload = {
  vehicleModel: string;
  licensePlate: string;
  vehicleColor?: string;
};

/** Persist vehicle info on the user profile (required before publishing rides). */
export async function patchUserVehicleProfile(body: UserVehicleProfilePayload): Promise<void> {
  const payload: Record<string, string> = {
    vehicleModel: body.vehicleModel.trim(),
    licensePlate: body.licensePlate.trim(),
  };
  if (body.vehicleColor?.trim()) payload.vehicleColor = body.vehicleColor.trim();
  await api.patch(userUpdatePath(), payload);
}

/** Clear legacy flat vehicle fields on `/user/update` (no `/user/vehicles/:id`). */
export async function clearLegacyUserVehicleProfile(): Promise<void> {
  await api.patch(userUpdatePath(), {
    vehicleModel: '',
    licensePlate: '',
    vehicleColor: '',
  });
}

const DEFAULT_DIAL = '+91';

/** PATCH `/user/update` with phone only (10-digit national after normalization). */
export async function patchUserPhoneOnly(phoneInput: string): Promise<void> {
  const national = clampPhoneNationalInput(phoneInput);
  if (national.length !== 10) {
    throw new Error('INVALID_PHONE');
  }
  await api.patch(userUpdatePath(), { phone: `${DEFAULT_DIAL}${national}` });
}

/** PATCH `/user/update` — public profile description (backend may read `bio` and/or `description`). */
export async function patchUserProfileBio(bio: string): Promise<void> {
  const t = bio.trim();
  await api.patch(userUpdatePath(), { bio: t, description: t });
}

/** PATCH `/user/update` — driver comfort tags (backend source of truth: `ridePreferences` on User). */
export async function patchUserRidePreferences(ids: string[]): Promise<void> {
  const ridePreferences = normalizeRidePreferenceIds(ids);
  await api.patch(userUpdatePath(), { ridePreferences });
}
