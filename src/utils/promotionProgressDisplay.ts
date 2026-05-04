import type { PromotionRules } from '../types/promotions';

export function rulesUseDistinctCalendarDays(rules: PromotionRules | null | undefined): boolean {
  return Boolean(rules?.useDistinctCalendarDays);
}

export function promotionThreshold(rules: PromotionRules | null | undefined): number | null {
  if (!rules) return null;
  const raw = rules.targetRides ?? rules.threshold;
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

export function promotionEffectiveCredits(args: {
  completedRides: number;
  distinctDays: number;
  rules: PromotionRules | null | undefined;
}): number {
  const { completedRides, distinctDays, rules } = args;
  if (rulesUseDistinctCalendarDays(rules)) return Math.max(0, Math.floor(distinctDays));
  return Math.max(0, Math.floor(completedRides));
}

export function promotionProgressRatio(
  progressNumerator: number,
  rules: PromotionRules | null | undefined
): number {
  const t = promotionThreshold(rules);
  if (t == null || t <= 0) return 0;
  return Math.min(1, Math.max(0, progressNumerator / t));
}

export function promotionEligible(
  effective: number,
  threshold: number | null,
  explicitEligible: boolean | undefined
): boolean {
  if (typeof explicitEligible === 'boolean') return explicitEligible;
  if (threshold == null || threshold <= 0) return false;
  return effective >= threshold;
}

export function promotionProgressSegmentCount(threshold: number | null): number {
  if (threshold == null || threshold <= 0) return 0;
  return Math.min(16, Math.max(1, Math.floor(threshold)));
}

export function promotionFilledSegments(ratio: number, threshold: number | null): number {
  const total = promotionProgressSegmentCount(threshold);
  if (total <= 0) return 0;
  return Math.min(total, Math.max(0, Math.round(ratio * total)));
}
