/**
 * App-wide colors. Use named constants instead of raw hex.
 */
export const COLORS = {
  primary: '#29be8b',
  primaryDark: '#00cc6a',
  primaryLight: '#66ffb3',

  secondary: '#2563eb',
  secondaryDark: '#1d4ed8',

  background: '#ffffff',
  backgroundSecondary: '#f8fafc',

  text: '#0f172a',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',

  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',

  white: '#ffffff',
  black: '#000000',

  // Dark mode (optional)
  dark: {
    background: '#0f172a',
    backgroundSecondary: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    border: '#334155',
  },
} as const;

export type ColorKey = keyof typeof COLORS;
