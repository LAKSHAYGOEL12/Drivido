import { DeviceEventEmitter } from 'react-native';
import type { RideListItem } from '../types/api';

/** Emitted when ride detail has a fresher snapshot than the list (e.g. after approve/reject). */
export const RIDE_LIST_MERGE_FROM_DETAIL = 'rideListMergeFromDetail' as const;

/**
 * Pushes a detail GET snapshot into list UIs without waiting for GET /my-rides to catch up.
 * Subscribers (e.g. Your Rides) merge by ride id.
 */
export function emitRideListMergeFromDetail(ride: RideListItem): void {
  const id = String(ride?.id ?? '').trim();
  if (!id) return;
  DeviceEventEmitter.emit(RIDE_LIST_MERGE_FROM_DETAIL, ride);
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
