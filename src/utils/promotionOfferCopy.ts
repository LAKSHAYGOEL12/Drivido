import type { PromotionCampaign, PromotionMeRow } from '../types/promotions';
import {
  promotionEffectiveCredits,
  promotionEligible,
  promotionThreshold,
  rulesUseDistinctCalendarDays,
} from './promotionProgressDisplay';

export type ResolvedOfferProgress = {
  campaignForCopy: PromotionCampaign;
  /** Numerator for progress bar + ratio (rides or distinct days depending on rules). */
  progress: number;
  rules: PromotionCampaign['rules'] | null | undefined;
  /** Same as `progress` for copy strings (“n of m …”). */
  effective: number;
  threshold: number | null;
  eligible: boolean;
};

function meRowSlug(row: PromotionMeRow): string {
  return String(row.slug ?? row.campaignSlug ?? '').trim();
}

function num(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

export function resolveOfferPrimaryLine(o: ResolvedOfferProgress): string {
  const c = o.campaignForCopy;
  const raw =
    (typeof c.headline === 'string' && c.headline.trim()) ||
    (typeof c.shortDescription === 'string' && c.shortDescription.trim()) ||
    (typeof c.subtitle === 'string' && c.subtitle.trim()) ||
    '';
  return raw || 'Complete rides to earn a reward';
}

export function resolveTopOfferProgresses(
  catalog: PromotionCampaign[],
  meRows: PromotionMeRow[] | undefined
): { offers: ResolvedOfferProgress[]; lines: string[] } {
  const bySlug = new Map<string, PromotionMeRow>();
  for (const row of meRows ?? []) {
    const s = meRowSlug(row);
    if (s) bySlug.set(s, row);
  }

  const offers: ResolvedOfferProgress[] = [];
  const lines: string[] = [];

  for (const c of catalog) {
    const slug = String(c.slug ?? '').trim();
    if (!slug) continue;
    const row = bySlug.get(slug) ?? {};
    const rules = c.rules ?? null;
    const threshold = promotionThreshold(rules);

    const serverCredits = row.effectiveCredits;
    const hasServerCredits = typeof serverCredits === 'number' && !Number.isNaN(serverCredits);

    let effective: number;
    let progress: number;
    if (hasServerCredits) {
      effective = Math.max(0, Math.floor(serverCredits));
      progress = effective;
    } else {
      const completedRides = num(row.completedRides ?? row.progress ?? row.creditsTotal);
      const distinctDays = num(row.distinctCalendarDays ?? row.distinctDays ?? row.creditsDistinctDays);
      effective = promotionEffectiveCredits({ completedRides, distinctDays, rules });
      progress = rulesUseDistinctCalendarDays(rules) ? distinctDays : completedRides;
    }

    const eligible = promotionEligible(effective, threshold, row.eligible);

    const resolved: ResolvedOfferProgress = {
      campaignForCopy: c,
      progress,
      rules,
      effective,
      threshold,
      eligible,
    };
    offers.push(resolved);
    lines.push(resolveOfferPrimaryLine(resolved));
  }

  return { offers, lines };
}

export function resolveOfferProgressLine(args: {
  campaign: PromotionCampaign | undefined;
  sessionReady: boolean;
  effective: number;
  threshold: number | null;
  eligible: boolean;
}): string {
  const { campaign, sessionReady, effective, threshold, eligible } = args;
  if (!sessionReady) return '';
  if (eligible) return '';
  if (threshold == null || threshold <= 0) return '';
  const rules = campaign?.rules;
  if (rulesUseDistinctCalendarDays(rules)) {
    return `${effective} of ${threshold} distinct days`;
  }
  return `${effective} of ${threshold} rides`;
}
