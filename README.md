# EcoPickO (Expo)

## Push notifications

- **App:** `docs/push-notifications.md` — register token, channels, navigation from `data`.
- **Testing flow:** `docs/PUSH_TESTING.md` — login → POST `/api/user/push-token` → logout → DELETE `/api/user/push-token`.
- **Server log expectations** (FCM / Expo / APNs “accepted” lines): see the **backend** repo — `docs/PUSH_TESTING_LOGS.md` and `docs/PUSH_API.md`.

## Env

Copy `.env.example` → `.env`. Set `EXPO_PUBLIC_API_URL` (no trailing slash) before release builds.
