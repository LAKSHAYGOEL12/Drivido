import type { RideListItem } from '../types/api';

export const ACCOUNT_DEACTIVATED_API_CODE = 'ACCOUNT_DEACTIVATED';

export const DEACTIVATED_ACCOUNT_LABEL = 'Deactivated user';

/** True when API returned 403 with account-deactivation error (camel/snake `code` / string `error`). */
export function isAccountDeactivatedApiError(status: number, data: unknown): boolean {
  if (status !== 403) return false;
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const code = typeof d.code === 'string' ? d.code.toUpperCase() : '';
  if (code === ACCOUNT_DEACTIVATED_API_CODE) return true;
  const err = typeof d.error === 'string' ? d.error.toUpperCase() : '';
  if (err === ACCOUNT_DEACTIVATED_API_CODE) return true;
  return false;
}

export function backendUserRecordInactive(rec: unknown): boolean {
  if (!rec || typeof rec !== 'object') return false;
  const r = rec as Record<string, unknown>;
  return r.accountActive === false || r.account_active === false;
}

/** True when GET /ratings/:userId envelope marks the rated user as inactive (embedded `user` or top-level flags). */
export function ratingsEnvelopeSubjectInactive(
  root: Record<string, unknown> | null | undefined,
  data: Record<string, unknown>,
  userObj: Record<string, unknown>
): boolean {
  const layers = [userObj, data, root].filter(Boolean) as Record<string, unknown>[];
  for (const L of layers) {
    if (backendUserRecordInactive(L)) return true;
    if (L.subjectAccountActive === false || L.subject_account_active === false) return true;
    if (L.subjectDeactivated === true || L.subject_deactivated === true) return true;
    if (L.accountDeactivated === true || L.account_deactivated === true) return true;
  }
  return false;
}

/** True when a single rating row marks the reviewer as deactivated. */
export function ratingRowReviewerInactive(obj: Record<string, unknown>, fromUserObj: Record<string, unknown>): boolean {
  if (backendUserRecordInactive(fromUserObj)) return true;
  if (obj.fromUserAccountActive === false || obj.from_user_account_active === false) return true;
  if (obj.fromAccountActive === false || obj.from_account_active === false) return true;
  return false;
}

export function ridePublisherDeactivated(ride: RideListItem): boolean {
  const r = ride as RideListItem & {
    publisherAccountActive?: boolean;
    publisher_account_active?: boolean;
    publisherDeactivated?: boolean;
    publisher_deactivated?: boolean;
  };
  if (r.publisherAccountActive === false || r.publisher_account_active === false) return true;
  if (r.publisherDeactivated === true || r.publisher_deactivated === true) return true;
  return false;
}

export type DeactivatedBookingLike = {
  userId?: string;
  accountActive?: boolean;
  account_active?: boolean;
  passengerAccountActive?: boolean;
  passenger_account_active?: boolean;
  user?: { accountActive?: boolean; account_active?: boolean };
};

export function bookingPassengerDeactivated(b: DeactivatedBookingLike): boolean {
  if (b.passengerAccountActive === false || b.passenger_account_active === false) return true;
  if (b.accountActive === false || b.account_active === false) return true;
  const u = b.user;
  if (u && typeof u === 'object') {
    if (u.accountActive === false || u.account_active === false) return true;
  }
  return false;
}

/** Whether the peer in a chat (by Mongo user id) is the deactivated party on this ride payload. */
export function ridePeerDeactivated(ride: RideListItem, peerUserId: string): boolean {
  const pid = peerUserId.trim();
  if (!pid || pid.startsWith('name-')) return false;
  const ownerId = (ride.userId ?? '').trim();
  if (ownerId && pid === ownerId && ridePublisherDeactivated(ride)) return true;
  for (const row of ride.bookings ?? []) {
    if ((row.userId ?? '').trim() !== pid) continue;
    if (bookingPassengerDeactivated(row)) return true;
  }
  return false;
}
