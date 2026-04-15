import { DeviceEventEmitter } from 'react-native';
import type { RideListItem } from '../types/api';
import { normalizeRideListItemFromApi } from './fetchPassengerBookedRides';

/** Emitted when ride detail has a fresher snapshot than the list (e.g. after approve/reject). */
export const RIDE_LIST_MERGE_FROM_DETAIL = 'rideListMergeFromDetail' as const;

export type RideListMergeFromDetailPayload = {
  ride: RideListItem;
  /** When true, prepend the row if no list entry matches this id (e.g. POST /rides before GET /my-rides lists it). */
  insertIfMissing?: boolean;
};

/** Normalize GET /rides/:id (and wrapped) JSON into a list row — same unwrap as Your Rides merge helpers. */
export function rideListItemFromDetailApiPayload(res: unknown): RideListItem | null {
  if (!res || typeof res !== 'object') return null;
  const root = res as Record<string, unknown>;
  const candidate =
    (root.ride && typeof root.ride === 'object' ? (root.ride as Record<string, unknown>) : null) ??
    (root.data && typeof root.data === 'object'
      ? (((root.data as Record<string, unknown>).ride &&
          typeof (root.data as Record<string, unknown>).ride === 'object')
          ? ((root.data as Record<string, unknown>).ride as Record<string, unknown>)
          : (root.data as Record<string, unknown>))
      : null) ??
    root;
  return normalizeRideListItemFromApi(candidate as Record<string, unknown>);
}

/**
 * Pushes a detail GET snapshot into list UIs without waiting for GET /my-rides to catch up.
 * Subscribers (e.g. Your Rides) merge by ride id.
 */
export function emitRideListMergeFromDetail(
  ride: RideListItem,
  options?: { insertIfMissing?: boolean }
): void {
  const id = String(ride?.id ?? '').trim();
  if (!id) return;
  const payload: RideListMergeFromDetailPayload = {
    ride,
    insertIfMissing: options?.insertIfMissing === true,
  };
  DeviceEventEmitter.emit(RIDE_LIST_MERGE_FROM_DETAIL, payload);
}

/** Merge list row with authoritative detail response; keeps stable id. */
export function mergeRideListRowWithDetailSnapshot(listRow: RideListItem, detail: RideListItem): RideListItem {
  if (String(listRow.id) !== String(detail.id)) return listRow;
  return {
    ...listRow,
    ...detail,
    id: listRow.id,
  };
}
