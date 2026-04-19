# APK on two phones — push still not showing

Work through **in order**. The backend can say **FCM accepted** while the phone shows nothing — that usually means **payload**, **Firebase project mismatch**, or **OS**.

## 1. Server logs at the moment of book/cancel

| You see | Meaning |
|--------|---------|
| `no deliverable tokens` | Target user has no token in DB — fix **POST /user/push-token** for **that** user on **that** phone. |
| `Push: dispatching` then **`FCM send failed`** | Server/config/token problem (credentials, wrong project, bad token). |
| `FCM: accepted by Firebase` + `messageId` | Google accepted it — go to steps 2–5. |

## 2. Same Firebase project (very common)

- **`google-services.json` in the app** (project root) → **`project_id`** in `project_info`.
- **Server** → `GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_SERVICE_ACCOUNT_JSON` / service account JSON must be **the same Firebase project** as the app.

If the server uses a **different** project than the app, FCM will **fail** or behave oddly.

### Error: `messaging/mismatched-credential` or SenderId mismatch

Means: the **FCM token** on the phone was issued by Firebase **project A** (from the app’s `google-services.json`), but the **service account** JSON the backend uses belongs to **project B**.

**Fix (backend only):**

1. Firebase Console → open the **same** project as in the app’s `google-services.json`.
2. **Project settings → Service accounts → Generate new private key** (or use a key from **that** project).
3. Point **`GOOGLE_APPLICATION_CREDENTIALS`** (or your env var) at that **JSON file**.
4. **`project_id`** inside that JSON must match **`project_id`** in `google-services.json`.
5. Restart the backend.

**App side:** no change if `google-services.json` is already correct — align **server** credentials to the **same** project.

### Duplicate FCM rows (`fcm: 3` etc.)

Several **POST /user/push-token** rows for one user — usually repeated logins; not the cause of mismatched-credential. You can dedupe in DB later if needed.

## 3. FCM payload: `notification` block

On Android, **data-only** messages often **don’t show a heads-up banner** like a normal notification. The server should send FCM with a **`notification`** object (title + body) **and** `data` for your `type` / `rideId`.

Confirm your backend sends something like:

- `notification: { title, body }`
- `android: { notification: { channelId: 'rides' } }` (or `messages` for chat) — channel ids must match the app: **`rides`**, **`messages`**, **`default`**.

## 4. Both devices registered (two phones)

Right before testing:

- **Driver phone:** logged in as driver → server log **`Push token registered`** for **driver’s `userId`**.
- **Passenger phone:** logged in as passenger → same for **passenger’s `userId`**.

Book from passenger → notify **driver** → check **driver phone** (not passenger).

## 5. Phone / OS

- **Settings → Apps → EcoPickO → Notifications** → allowed.
- **Do Not Disturb** off.
- **Battery** → unrestricted / not restricted for EcoPickO (OEM “optimization”).
- App **open in foreground** vs **background** — both should show something if `notification` + channels are correct; if only broken in one state, say which.

## 6. Rebuild after env change

If you changed **`EXPO_PUBLIC_API_URL`** after a build, **rebuild the APK**. Wrong URL → token never reaches production API.

## 7. Quick isolation

From **Firebase Console → Cloud Messaging → send test message** to the **exact FCM token** stored for that user (copy from DB/logs).  

- If **that** doesn’t show on the phone → device / Firebase app config / `google-services.json` / package `com.drivido.app`.
- If **that** shows → problem is **server payload** or **which token** the server sends to.
