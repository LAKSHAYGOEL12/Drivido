# Push not showing on APK — checklist

Use this when **booking/cancel** works but **no notification** appears.

## 1. Confirm the app registered a token (client)

Release builds don’t show Metro logs. **Android:**

```bash
adb logcat '*:S' ReactNativeJS:V | grep "\[push\]"
```

You should see **one** of:

- `[push] Registered Expo push token with backend (provider=expo).`
- `[push] Registered native fcm token with backend (provider=fcm).`

**Bad signs:**

| Log | Meaning |
|-----|---------|
| `Notification permission not granted` | User must allow notifications in system Settings. |
| `Registration error` + `401` / `Authentication required` | Not logged in or bad token — **log out and log in**; confirm `EXPO_PUBLIC_API_URL` in the **build** matches your API. |
| `Registration error` + network / timeout | Phone can’t reach API (wrong URL, firewall, HTTPS/cleartext). |
| No `[push]` lines at all | Hook not running (unlikely if logged in) or logs filtered wrong. |

**Rebuild note:** `EXPO_PUBLIC_*` values are fixed **when the JS bundle is built**. If you changed `.env` after building, **rebuild the APK**.

## 2. Confirm the backend stored the token

- After login on each phone, **DB or logs** should show **`POST /api/user/push-token`** → **200**.
- Document should have **`provider`**: `expo` | `fcm` | `apns` matching what the app sent.

If there is **no row** or **401**, the server will never send to that device.

## 3. Confirm the backend sends on book/cancel

- On **book** / **cancel**, server logs should show **`sendPushToUsers`** (or your equivalent) **without** errors.
- If FCM/APNs env vars are missing on DigitalOcean, your server may **skip** FCM sends (check server logs for one-time warnings).
- **Expo** path: Expo Push API must accept the token (credentials in Expo dashboard if required).

## 4. Provider mismatch (common)

| App sends | Server must send with |
|-----------|------------------------|
| `expoPushToken` (`ExponentPushToken[…]`) | **Expo Push API** (`expo-server-sdk`) |
| `fcmToken` | **Firebase Admin** (`FIREBASE_SERVICE_ACCOUNT_JSON` on server) |

If the app registered **FCM** but the server only uses **Expo batch**, nothing will be delivered (and the opposite).

## 5. Android OS

- **Battery optimization** off for EcoPickO (optional but helps).
- **Do Not Disturb** off for test.
- Notifications not blocked per-channel (ride events often use `rides` **channelId** on the server payload).

## 6. Quick server-side test

From Firebase or Expo’s “send test notification” to the **same** token string stored for that user — if that fails, the problem is **credentials / token**, not booking logic.
