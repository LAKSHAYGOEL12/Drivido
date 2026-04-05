import api from './api';
import { API } from '../constants/API';

/**
 * Owner removes the passenger booking completely.
 */
export async function removePassengerBookingAsOwner(bookingId: string): Promise<void> {
  const id = bookingId.trim();
  if (!id) throw new Error('Missing booking id');
  await api.post(API.endpoints.bookings.removePassenger(id), {});
}
