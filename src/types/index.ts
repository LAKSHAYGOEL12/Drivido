/**
 * Core domain types: User, Ride, Booking.
 */

export interface User {
  id: string;
  phone: string;
  name: string;
  /** Optional: profile image URI */
  avatarUri?: string | null;
  /** Optional: verified (e.g. Aadhaar) */
  verified?: boolean;
  createdAt?: string;
}

export interface Ride {
  id: string;
  from: string;
  to: string;
  date: string;
  time: string;
  price: string;
  seats: number;
  driverId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  /** ISO date */
  departureAt?: string;
  status?: RideStatus;
  createdAt?: string;
}

export type RideStatus = 'open' | 'full' | 'cancelled' | 'completed';

export interface Booking {
  id: string;
  rideId: string;
  userId: string;
  seats: number;
  status: BookingStatus;
  /** ISO date */
  bookedAt: string;
  /** Optional: pickup/drop notes */
  note?: string | null;
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';

/** Minimal ride summary for list items */
export interface RideSummary {
  id: string;
  from: string;
  to: string;
  date: string;
  time: string;
  price: string;
  seats: number;
  driverName: string;
}
