import { DeviceEventEmitter } from 'react-native';

/** Ask Your Rides to reload merged list (driven GET /my-rides + booked + catalog). */
export const REQUEST_MY_RIDES_LIST_REFRESH = 'requestMyRidesListRefresh' as const;

/** Login/sign-up/session restore, or app returned from background — refresh “My rides” source data. */
export function emitRequestMyRidesListRefresh(): void {
  DeviceEventEmitter.emit(REQUEST_MY_RIDES_LIST_REFRESH);
}
