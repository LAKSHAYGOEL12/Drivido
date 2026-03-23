# Push notifications (Expo)

## Checklist (frontend)

| Item | App behavior |
|------|----------------|
| **POST after every login** | `usePushNotifications` runs when `isAuthenticated` + `userId`; POST runs whenever a token is obtained (not only first install) so the logged-in user owns the device token. |
| **DELETE on logout** | Controlled by `UNREGISTER_PUSH_TOKEN_ON_LOGOUT` in `AuthContext.tsx` (`false` = skip DELETE for testing; set `true` for production). |
| **`EXPO_PUBLIC_API_URL`** | Set before **release** builds; no trailing `/`; rebuild after changes. |
| **Permission** | `requestPermissionsAsync` before token fetch; alert + **Open Settings** if denied. |
| **Android channels** | `default`, `messages`, `rides` (match server `channelId`). |
| **Tap → navigate** | `handleNotificationNavigation.ts` reads `data`. |
| **2xx on POST** | API client treats **204** and empty body as success (`services/api.ts`). |

**End-to-end testing:** See **`docs/PUSH_TESTING.md`** (login → POST token → skip DELETE while testing → read server logs per backend **`docs/PUSH_TESTING_LOGS.md`**).

## Client behavior

- After login, the app requests permission and registers a push token with **`POST /api/user/push-token`** (see table below).
- **Two modes (automatic):**
  1. **Expo Push** — if `EXPO_PUBLIC_EAS_PROJECT_ID` / `extra.eas.projectId` is set, the app sends **`expoPushToken`** (ExponentPushToken…).
  2. **No Expo project ID** — the app sends a **native token** instead (no EAS / Expo cloud builds required for this path):
     - Android: **`fcmToken`** (Firebase Cloud Messaging)
     - iOS: **`apnsToken`** (APNs device token)  
     Your backend must send with **Firebase Admin (FCM)** or **APNs**, not the Expo Push HTTP API.
- On logout, if `UNREGISTER_PUSH_TOKEN_ON_LOGOUT` is `true` in `AuthContext.tsx`, the app calls `DELETE /api/user/push-token`. The **backend does not remove tokens on logout by itself** — only **DELETE** (or your POST dedupe rules) changes stored tokens. **`false`** while testing (no DELETE); **`true`** for production.

## Backend: register token (aligned with API)

**`POST /api/user/push-token`** — send **one** token field (+ optional `platform`):

| Field | Stored provider | Delivery |
|-------|-----------------|----------|
| `expoPushToken` or `pushToken` | `expo` | Expo Push API (`ExponentPushToken[…]`) |
| `fcmToken` | `fcm` | Firebase Admin → FCM |
| `apnsToken` | `apns` | APNs (e.g. node-apn) |

Optional `platform`: `ios` | `android` | `web`. **This app** sends `ios` | `android` and uses `expoPushToken` / `fcmToken` / `apnsToken` only.

**`DELETE /api/user/push-token`** — backend accepts the same token in body or `?pushToken=` (see server docs).

If `POST` is missing, the app still works; dev builds log a warning.

## Backend: send

Server routes by stored **provider**: Expo batch (`expo-server-sdk`), **Firebase Admin** for FCM, **APNs** for apns. Production env typically needs `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` and/or APNs `.p8` vars — see your repo’s `src/utils/expoPush.js`, `fcmPush.js`, `apnsPush.js`.

Include a **`data`** object on the notification so the app can route taps.

### `data` fields (aligned with server `docs/PUSH_API.md`)

| `type` | Typical target | Extra `data` (beyond `rideId`) | Tap → app |
|--------|----------------|----------------------------------|-----------|
| `ride_booked` | Driver | `passengerName`, `passengerId` | Your Rides → Ride detail |
| `ride_cancelled` | Passengers (owner cancelled) | — | Your Rides → Ride detail |
| `booking_cancelled` | Driver (passenger cancelled) | `passengerId`, `passengerName` | Your Rides → Ride detail |
| `chat_message` | Recipient | `otherUserName`, `otherUserId` | Inbox → Chat |

Always include **`rideId`**. Title/body are for display; routing uses **`type` + `rideId`** (and chat fields for inbox).

Aliases still work: e.g. `message` / `chat` for chat; `ride_cancel` for cancel-style events.

### Android channels

The app defines channels: `default`, `messages`, `rides`. Set `channelId` in the Expo/Android payload to match (e.g. messages → `messages`, ride events → `rides`).

### Optional: Expo `projectId` (Expo Push API)

Only needed if you want **Expo Push** tokens instead of raw FCM/APNs:

- **`.env`**: `EXPO_PUBLIC_EAS_PROJECT_ID=<uuid>` ([expo.dev](https://expo.dev) → project settings), merged in **`app.config.js`**.
- **Rebuild** the native app.

If you skip this, the app uses **native FCM/APNs** only — no EAS cloud builds required for token registration.

### iOS

Native **APNs** path needs a proper dev/release build with push entitlements; **Expo Go** has limits for push.

## Android: `google-services.json`

1. Add **`google-services.json`** from Firebase (Android app package must match `app.config.js` → `android.package`, e.g. `com.drivido.app`).
2. Place it in the **project root** (next to `package.json`). `app.config.js` sets `android.googleServicesFile: './google-services.json'`.
3. **Rebuild** the native app (`npx expo prebuild` + `npx expo run:android`, or EAS Build). Metro-only reload is not enough.

## Expo Go

From SDK 53, **Android push in Expo Go is not supported** — use a development build (`expo run:android` / EAS) for full push testing.
