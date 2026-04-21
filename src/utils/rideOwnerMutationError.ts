/**
 * Owner ride mutations (PATCH/DELETE on `/rides/:id`, PATCH `/rides/:id/cancel`) may return **409**
 * with a stable `code` (see server `ridesController` + shared `rideStatus`).
 * `api.request` throws `Object.assign(new Error(message), { status, data })`.
 */
export function rideOwnerMutationUserMessage(err: unknown): string | null {
  const status =
    err && typeof err === 'object' && 'status' in err ? (err as { status?: number }).status : undefined;
  if (status !== 409) return null;
  const data =
    err && typeof err === 'object' && 'data' in (err as object)
      ? (err as { data?: unknown }).data
      : undefined;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const code = String(d.code ?? d.errorCode ?? '').trim();
  switch (code) {
    case 'RIDE_DEPARTURE_REACHED':
      return 'The departure time for this ride has passed. You can’t edit or cancel it anymore.';
    case 'RIDE_COMPLETED':
      return 'This ride is already completed.';
    case 'RIDE_CANCELLED':
      return 'This ride is already cancelled.';
    default:
      return null;
  }
}
