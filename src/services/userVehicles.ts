import { API } from '../constants/API';
import api from './api';
import {
  normalizeVehiclesFromListPayload,
  parseVehicleFromMutationResponse,
  type UserProfileVehicle,
} from '../utils/userVehicle';

function path(p: string): string {
  return p.startsWith('/') ? p : `/${p}`;
}

export type CreateUserVehicleBody = {
  vehicleModel: string;
  licensePlate: string;
  vehicleColor?: string;
};

export async function listUserVehicles(): Promise<UserProfileVehicle[]> {
  const p = path(API.endpoints.user.vehicles.list);
  const raw = await api.get<unknown>(p);
  return normalizeVehiclesFromListPayload(raw);
}

export async function createUserVehicle(body: CreateUserVehicleBody): Promise<UserProfileVehicle | null> {
  const p = path(API.endpoints.user.vehicles.create);
  const payload: Record<string, string> = {
    vehicleModel: body.vehicleModel.trim(),
    licensePlate: body.licensePlate.trim(),
  };
  if (body.vehicleColor?.trim()) payload.vehicleColor = body.vehicleColor.trim();
  const raw = await api.post<unknown>(p, payload);
  return parseVehicleFromMutationResponse(raw);
}

export async function updateUserVehicle(
  vehicleId: string,
  body: CreateUserVehicleBody
): Promise<UserProfileVehicle | null> {
  const p = path(API.endpoints.user.vehicles.update(vehicleId));
  const payload: Record<string, string> = {
    vehicleModel: body.vehicleModel.trim(),
    licensePlate: body.licensePlate.trim(),
  };
  if (body.vehicleColor?.trim()) payload.vehicleColor = body.vehicleColor.trim();
  const raw = await api.patch<unknown>(p, payload);
  return parseVehicleFromMutationResponse(raw);
}

export async function deleteUserVehicle(vehicleId: string): Promise<void> {
  const p = path(API.endpoints.user.vehicles.delete(vehicleId));
  await api.delete<unknown>(p);
}
