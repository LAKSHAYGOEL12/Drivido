/**
 * Asset import paths. Use these for require() or import so paths are centralized.
 */
export const IMAGES = {
  // App icons (from Expo default template)
  icon: require('../../assets/icon.png'),
  favicon: require('../../assets/favicon.png'),
  /** Full-screen marketing splash — JS `BootSplash` only; native splash is blank (see app.json). */
  splash: require('../../assets/splash-screen.png'),

  // Android adaptive icon
  androidIconForeground: require('../../assets/android-icon-foreground.png'),
  androidIconBackground: require('../../assets/android-icon-background.png'),
  androidIconMonochrome: require('../../assets/android-icon-monochrome.png'),

  /** In-app + marketing wordmark (also used for Expo icon / splash via app.json). */
  logo: require('../../assets/app-logo.png'),
  // placeholderAvatar: require('../../assets/placeholder-avatar.png'),
  // aadhaarPlaceholder: require('../../assets/aadhaar-placeholder.png'),
} as const;

export type ImageKey = keyof typeof IMAGES;
