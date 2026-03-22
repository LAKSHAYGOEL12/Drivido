/**
 * Asset import paths. Use these for require() or import so paths are centralized.
 */
export const IMAGES = {
  // App icons (from Expo default template)
  icon: require('../../assets/icon.png'),
  favicon: require('../../assets/favicon.png'),
  splash: require('../../assets/splash-icon.png'),

  // Android adaptive icon
  androidIconForeground: require('../../assets/android-icon-foreground.png'),
  androidIconBackground: require('../../assets/android-icon-background.png'),
  androidIconMonochrome: require('../../assets/android-icon-monochrome.png'),

  // Placeholders – add your own assets under assets/ and reference here
  // logo: require('../../assets/logo.png'),
  // placeholderAvatar: require('../../assets/placeholder-avatar.png'),
  // aadhaarPlaceholder: require('../../assets/aadhaar-placeholder.png'),
} as const;

export type ImageKey = keyof typeof IMAGES;
