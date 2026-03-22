# Android release APK

## Option A — EAS Build (recommended)

Builds in the cloud; signing is handled by EAS on first run.

### One-time setup

1. Install EAS CLI: `npm install -g eas-cli` (or use `npx eas-cli` / `npx eas`).
2. Log in: `eas login` (Expo account).
3. Link the project (creates `projectId` in app config if missing):  
   `eas init`  
   or `eas build:configure`.

4. Ensure **`.env`** has production values (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, etc.) — they are baked in at build time via `app.config.js`.

### Build a release **APK**

```bash
eas build -p android --profile release
```

- Artifact: **APK** (profile `release` in `eas.json` sets `buildType: "apk"`).
- Download the `.apk` from the Expo dashboard or CLI when the build finishes.

### Other profiles (see `eas.json`)

| Profile      | Output   | Use case              |
|-------------|----------|------------------------|
| `release`   | APK      | Sideload / testers     |
| `production`| AAB      | Google Play upload     |
| `preview`   | APK      | Internal distribution  |

---

## Option B — Local release APK (advanced)

Requires Android SDK + a release keystore.

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

APK path (typical): `android/app/build/outputs/apk/release/app-release.apk`.

Configure signing in `android/app/build.gradle` / `gradle.properties` (see [React Native signing](https://reactnative.dev/docs/signed-apk-android)). EAS is easier for most teams.

---

## Notes

- **Expo Go** does not reflect native changes; use a **development build** or **release build** to test push, maps, etc.
- From SDK 53, **Android push** needs a dev/release build, not Expo Go.
