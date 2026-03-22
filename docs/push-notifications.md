# Push notifications (Expo)

## Client behavior

- After login, the app requests notification permission (physical device), obtains an **Expo push token**, and sends it to the backend: `POST /api/user/push-token` with `{ expoPushToken, platform: "ios" | "android" }`.
- On logout, the app calls `DELETE /api/user/push-token` (with `Authorization: Bearer …`) so the server can drop tokens for that user.
- Tapping a notification navigates using the **`data`** payload (see below).

## Backend: register token

Implement:

| Method | Path | Body | Auth |
|--------|------|------|------|
| `POST` | `/api/user/push-token` | `{ expoPushToken: string, platform: "ios" \| "android" }` | Bearer |
| `DELETE` | `/api/user/push-token` | — | Bearer |

If `POST` is missing, the app still works; dev builds log a warning.

## Backend: send (Expo Push API)

Use [Expo’s push API](https://docs.expo.dev/push-notifications/sending-notifications/). Include a **`data`** object so the app can route taps.

### `data` fields (recommended)

| Field | Description |
|-------|-------------|
| `type` | `chat_message` · `ride_booked` · `ride_cancelled` (aliases like `ride_cancel`, `message` are accepted) |
| `rideId` | Ride id (Mongo/ObjectId string) |
| `otherUserName` | Chat partner display name (messages) |
| `otherUserId` | Chat partner user id (optional) |

### Android channels

The app defines channels: `default`, `messages`, `rides`. Set `channelId` in the Expo/Android payload to match (e.g. messages → `messages`, ride events → `rides`).

### iOS

Use EAS / native build with push capability. For `getExpoPushTokenAsync`, configure **EAS project id** (`extra.eas.projectId` in `app.config.js` or `app.json`) for production.

## Expo Go

From SDK 53, **Android push in Expo Go is not supported** — use a development build (`expo run:android` / EAS) for full push testing.
