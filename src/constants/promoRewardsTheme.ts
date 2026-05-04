/**
 * Light, multi-accent “rewards / offers” chrome — intentionally different from app `COLORS.primary` green.
 * Yellow · coral · mint · sky — keeps text readable on warm whites.
 */
export const PROMO_REWARDS = {
  /** Slightly peachy ivory — warmer than plain off-white */
  shellBg: '#FFF5E8',
  shellBorder: 'rgba(251, 146, 60, 0.42)',
  shellShadow: 'rgba(234, 88, 12, 0.18)',

  chipBg: '#FFFCF7',
  chipBorder: 'rgba(253, 186, 116, 0.55)',
  chipText: '#0F172A',

  /** Cream–peach trough (replaces cool sky tint) */
  trackBg: 'rgba(255, 237, 213, 0.88)',
  trackFill: '#22C55E',
  trackShimmer: 'rgba(254, 249, 195, 0.95)',

  giftBg: '#FFF7D6',
  giftBorder: '#FBBF24',
  giftIcon: '#EF4444',

  pulseRing: 'rgba(251, 191, 36, 0.45)',

  statusActive: '#38BDF8',
  statusEligible: '#4ADE80',

  /** Top strip in offers modal — yellow · sky · mint · coral */
  accentStrip: ['#FACC15', '#38BDF8', '#4ADE80', '#FB7185'] as const,

  headerGiftBg: '#FDE68A',
  headerGiftIcon: '#DC2626',
  pagerRipple: 'rgba(251, 191, 36, 0.28)',

  pulseWell: '#FFEDD5',

  /** Modal progress card — apricot paper */
  modalProgressBg: 'rgba(255, 241, 222, 0.96)',
  modalProgressBorder: 'rgba(253, 186, 116, 0.5)',
} as const;

/** Cycle through for each bar in `OffersPulseLine`. */
export const PULSE_BAR_COLORS = [
  '#38BDF8',
  '#FACC15',
  '#FB923C',
  '#4ADE80',
  '#A78BFA',
  '#FB7185',
] as const;
