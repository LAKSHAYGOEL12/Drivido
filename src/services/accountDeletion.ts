/**
 * Scheduled account deletion (grace period), not instant client-side Firebase delete.
 *
 * ## Backend contract (EcoPickO API)
 *
 * ### User model
 * - `accountDeletionPending` (boolean)
 * - `accountDeletionRequestedAt` / `accountDeletionEffectiveAt` (dates → ISO strings on the wire)
 *
 * ### `POST …/user/account-deletion/request` (JWT + `authenticate`)
 * Body: `{ password?: string, idToken?: string }` — **at least one** required.
 * - If `password` is sent: verify bcrypt when the user has a backend password.
 * - If `idToken` is sent: verify Firebase token matches the user’s `firebaseUid` (phone/social).
 * - Sets pending + requestedAt + effectiveAt = now + grace. **Does not** delete the Firebase user.
 * - **Idempotent:** if already pending, **200** with current schedule.
 *
 * ### `POST …/user/account-deletion/cancel`
 * Clears pending + date fields (`$unset` on dates in Mongo).
 *
 * ### `GET /auth/me` (`toUserShape`)
 * Includes camel + snake: `accountDeletionPending`, `accountDeletionRequestedAt`,
 * `accountDeletionEffectiveAt`, and `account_deletion_*` — dates as ISO strings or null.
 *
 * ### POST responses (request / cancel)
 * Same deletion flags (camel + snake) plus `user: toUserShape(...)` so clients can skip an extra
 * `/me` round-trip; this app still calls `refreshUser()` for a single source of truth.
 *
 * ### Worker
 * Batch job: pending && effectiveAt <= now → revoke refresh tokens, anonymize Mongo user, delete
 * Firebase user (see server `accountDeletionSweep`).
 */
import { API } from '../constants/API';
import api from './api';

function requestPath(): string {
  const p = API.endpoints.user.accountDeletion.request;
  return p.startsWith('/') ? p : `/${p}`;
}

function cancelPath(): string {
  const p = API.endpoints.user.accountDeletion.cancel;
  return p.startsWith('/') ? p : `/${p}`;
}

export type RequestAccountDeletionInput = {
  password?: string;
  idToken?: string;
};

export async function requestAccountDeletion(args: RequestAccountDeletionInput): Promise<void> {
  const password = args.password?.trim();
  const idToken = args.idToken?.trim();
  if (!password && !idToken) {
    throw new Error('Password or Firebase idToken is required to schedule account deletion.');
  }
  const body: { password?: string; idToken?: string } = {};
  if (password) body.password = password;
  if (idToken) body.idToken = idToken;
  await api.post(requestPath(), body);
}

export async function cancelAccountDeletion(): Promise<void> {
  await api.post(cancelPath(), {});
}
