/**
 * Light theme — almost-white canvas: reads as a white app, with a tiny bit of tone so it’s not harsh #FFF.
 * - **background** = default screen base.
 * - **backgroundSecondary** = grouped fields — barely darker than base.
 * - **surface** = true white for cards / chrome lift.
 */
export const COLORS = {
  /** Brand — Spotify green (#1DB954). RGB 29,185,84 for alpha helpers below. */
  primary: '#1DB954',
  primaryDark: '#169C46',
  primaryLight: '#1ED760',
  primaryRipple: 'rgba(29, 185, 84, 0.14)',
  primaryMuted22: 'rgba(29, 185, 84, 0.22)',
  primaryMuted38: 'rgba(29, 185, 84, 0.38)',
  /**
   * Opaque instant-booking “on” card — mint matched to primaryRipple over **canvas** (`background`),
   * so corners stay even on the default screen base.
   */
  instantBookingOnSurface: '#ddf1e8',

  /** Secondary — links, informational highlights */
  secondary: '#2563EB',
  secondaryLight: '#60A5FA',

  /** Surfaces — see module comment */
  background: '#FCFCFD',
  backgroundSecondary: '#F5F6F8',
  surface: '#FFFFFF',

  /** Typography */
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',

  /** Dividers — soft on near-white surfaces */
  border: '#E2E8F0',
  borderLight: '#F2F4F8',

  /** Floating bottom tab pill (MainBottomTabBar) — softer edge + inactive icons */
  tabBarPillBorder: 'rgba(15, 23, 42, 0.08)',
  /** Selected tab icon well (neutral “glass” chip, iOS-style). */
  tabBarSelectedWell: 'rgba(15, 23, 42, 0.055)',
  tabBarIconInactive: '#64748B',

  /** Semantic status */
  success: '#1DB954',
  warning: '#F59E0B',
  error: '#DC2626',
  info: '#2563EB',

  /** Ride availability */
  rideAvailable: '#1DB954',
  rideFull: '#EF4444',
  rideFewSeats: '#F59E0B',

  white: '#FFFFFF',
  black: '#000000',

  /** Dark palette (reserved for future theme toggle) */
  dark: {
    background: '#020617',
    backgroundSecondary: '#0F172A',
    surface: '#111827',

    text: '#F8FAFC',
    textSecondary: '#94A3B8',

    border: '#1F2937',
  },
} as const;

export type ColorKey = keyof typeof COLORS;
