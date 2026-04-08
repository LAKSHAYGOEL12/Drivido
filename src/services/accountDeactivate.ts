/**
 * Account deactivation (reversible “pause”) — distinct from scheduled deletion.
 *
 * ## Backend (production)
 *
 * ### User model
 * - `accountActive` (boolean, default `true`) — when `false`, user is deactivated.
 * - Optional: `deactivatedAt` (Date), `deactivationReason` (string, internal).
 *
 * ### Middleware (every authenticated route except reactivate + public health)
 * - After JWT validation, if `!user.accountActive` → **403** JSON:
 *   `{ "code": "ACCOUNT_DEACTIVATED", "message": "..." }`
 * - Same response for **POST /api/auth/firebase** when Firebase is valid but Mongo user is inactive
 *   (so the app cannot obtain a new JWT while deactivated).
 *
 * ### POST `/api/user/deactivate` (JWT + authenticate)
 * Body: `{ password?: string, idToken?: string }` — at least one required (same pattern as account-deletion request).
 * - Sets `accountActive: false`, `deactivatedAt: now`.
 * - **Revoke** refresh tokens for this user.
 * - **Rides / bookings (recommended):** cancel or hide future published rides; cancel pending bookings;
 *   notify counter-parties per your policy.
 * - Response: `{ user: toUserShape(...) }` or flags on envelope; client calls `logout()` after success.
 *
 * ### POST `/api/user/reactivate`
 * - Same body verification as deactivate (`password` / `idToken` via `verifyUserReauth`).
 * - **Mobile cold path:** the user may have **no** access token (exchange returned `ACCOUNT_DEACTIVATED`);
 *   the app posts **without** `Authorization` unless a stale token exists. Ensure this route accepts
 *   reauth via body when JWT is absent, or the reactivate button will fail with 401.
 * - Sets `accountActive: true`, clears deactivation fields.
 *
 * ### GET `/api/ratings/:userId` (or your ratings list for a profile subject)
 * - Deactivated **subject:** redacted user payload (`accountActive: false`), zeros for aggregates, empty review
 *   arrays, plus top-level + `data`: `subjectDeactivated` / `subject_deactivated: true` (client treats any of these).
 * - Deactivated **reviewer rows:** `fromUserId: null`, `fromUserAccountActive: false`, redacted `from`/`fromUser`
 *   (name only “Deactivated user”, no `_id`/avatars), stripped review text; active rows keep full metadata.
 *
 * ### GET `/api/auth/me` and ride/booking payloads
 * - Include `accountActive` / `account_active` on the current user.
 * - For **embedded other users** (driver on ride, passenger on booking, chat peer):
 *   - `publisherAccountActive` / `publisher_account_active` on ride when showing driver.
 *   - `passengerAccountActive` / `passenger_account_active` on booking rows (or nested `user.accountActive`).
 *   - GET `/chat/conversations`: `otherUserAccountActive` / `other_user_account_active` when peer is deactivated
 *     (client falls back to `ride` + `otherUserId` to compute label if only ride flags are present).
 *
 * ### Client behavior
 * - 403 `ACCOUNT_DEACTIVATED` on any API → sign out + “Account deactivated” screen.
 * - Lists/cards show **Deactivated user**; profile modal and chat hide PII; messaging disabled when peer deactivated.
 */
import { API } from '../constants/API';
import api from './api';

function deactivatePath(): string {
  const p = API.endpoints.user.deactivate;
  return p.startsWith('/') ? p : `/${p}`;
}

function reactivatePath(): string {
  const p = API.endpoints.user.reactivate;
  return p.startsWith('/') ? p : `/${p}`;
}

export type AccountDeactivateRequestBody = {
  password?: string;
  idToken?: string;
};

export async function requestAccountDeactivate(args: AccountDeactivateRequestBody): Promise<void> {
  const password = args.password?.trim();
  const idToken = args.idToken?.trim();
  if (!password && !idToken) {
    throw new Error('Password or Firebase idToken is required to deactivate your account.');
  }
  const body: { password?: string; idToken?: string } = {};
  if (password) body.password = password;
  if (idToken) body.idToken = idToken;
  await api.post(deactivatePath(), body);
}

/** Optional — enable when backend exposes reactivation in-app. */
export async function requestAccountReactivate(args: AccountDeactivateRequestBody): Promise<void> {
  const password = args.password?.trim();
  const idToken = args.idToken?.trim();
  if (!password && !idToken) {
    throw new Error('Password or Firebase idToken is required to reactivate your account.');
  }
  const body: { password?: string; idToken?: string } = {};
  if (password) body.password = password;
  if (idToken) body.idToken = idToken;
  await api.post(reactivatePath(), body);
}
