import api from './api';
import { API } from '../constants/API';

export type BookingHistoryGroupByRide = 'true' | '1' | 'yes' | 'ride';

/**
 * GET /api/bookings/history — all booking attempts for the current user.
 * @param rideId optional filter
 * @param groupByRide backend groups by ride id when true / 1 / yes / ride
 */
export async function fetchPassengerBookingHistory(opts?: {
  rideId?: string;
  groupByRide?: boolean | BookingHistoryGroupByRide;
}): Promise<unknown> {
  const params = new URLSearchParams();
  if (opts?.rideId?.trim()) params.set('rideId', opts.rideId.trim());
  if (opts?.groupByRide) {
    const v = opts.groupByRide === true ? 'true' : String(opts.groupByRide);
    params.set('groupByRide', v);
  }
  const q = params.toString();
  const path = `${API.endpoints.bookings.history}${q ? `?${q}` : ''}`;
  return api.get<unknown>(path);
}
