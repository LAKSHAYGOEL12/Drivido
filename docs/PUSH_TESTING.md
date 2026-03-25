# Push — testing (app + server logs)

## App (this repo)

1. **Login** → app obtains device token → **`POST /api/user/push-token`** with `Authorization: Bearer <accessToken>` (`usePushNotifications` → `registerCurrentDevicePushToken` in `pushTokenRegistration.ts`; POST helper in `pushTokenApi.ts`).
2. **Logout** → **`DELETE /api/user/push-token`** for this device (runs before session clear; uses last POSTed token or resolves the current device token).
3. **Trigger** booking / cancel, then confirm behavior on device + **server** logs.

## Backend (your API repo)

- **Registering a token** only updates the **logged-in** user (see current API behavior).
- **Delivery logs** (after `Push: dispatching`) are documented in the backend as **`docs/PUSH_TESTING_LOGS.md`** — expect lines like **FCM: accepted**, **Expo: accepted**, or **APNs: accepted** with `messageId` / `dataType` as applicable.
- **“Accepted”** means Firebase / Expo / Apple accepted the message; the **phone** can still block display (permissions, battery, DND).

## Expected log order (server)

`Push token registered` → `Push: dispatching` → provider-specific **accepted** line (see backend doc).

If you see **no deliverable tokens**, the target user has no stored token or wrong `userId` — fix **POST** for that user first.

**APK installed but nothing on screen:** see **`docs/TROUBLESHOOT_PUSH_NO_SHOW.md`** (Firebase project match, FCM `notification` + `channelId`, two-user registration).
