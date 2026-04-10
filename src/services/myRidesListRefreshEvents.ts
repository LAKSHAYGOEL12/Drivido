import { DeviceEventEmitter } from 'react-native';

/** Ask Your Rides to reload merged list (driven GET /my-rides + booked + catalog). */
export const REQUEST_MY_RIDES_LIST_REFRESH = 'requestMyRidesListRefresh' as const;

export type MyRidesRefreshRequestPayload = {
  /** When true, YourRides should show a blocking loader while re-fetching. */
  blocking?: boolean;
  /** Optional ride id expected to disappear after refresh. */
  expectedRemovedRideId?: string;
};

/** Login/sign-up/session restore, or app returned from background — refresh “My rides” source data. */
export function emitRequestMyRidesListRefresh(): void {
  DeviceEventEmitter.emit(REQUEST_MY_RIDES_LIST_REFRESH);
}

/** Ask YourRides for a blocking refresh (used after cancel flows). */
export function emitRequestMyRidesBlockingRefresh(payload: MyRidesRefreshRequestPayload): void {
  DeviceEventEmitter.emit(REQUEST_MY_RIDES_LIST_REFRESH, payload);
}
