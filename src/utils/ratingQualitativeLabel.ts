import { COLORS } from '../constants/colors';

/**
 * Maps average rating (0–5) to a short label for profile UI.
 * 0.0 → NewComer (not “Excellent”).
 */
export function ratingQualitativeLabel(avg: number | null | undefined): string {
  const r = typeof avg === 'number' && Number.isFinite(avg) ? avg : 0;
  if (r <= 0) return 'NewComer';
  if (r >= 4) return 'Excellent';
  if (r >= 3) return 'Good';
  if (r >= 2) return 'Average';
  return 'Bad';
}

/**
 * Text color for the qualitative label: blue (NewComer), green (Excellent), yellow (Good),
 * neutral (Average), red (Bad).
 */
export function ratingQualitativeColor(avg: number | null | undefined): string {
  const r = typeof avg === 'number' && Number.isFinite(avg) ? avg : 0;
  if (r <= 0) return COLORS.info;
  if (r >= 4) return COLORS.success;
  if (r >= 3) return COLORS.warning;
  if (r >= 2) return COLORS.textSecondary;
  return COLORS.error;
}
