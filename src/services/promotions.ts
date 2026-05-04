import { API } from '../constants/API';
import api, { hasAuthAccessToken } from './api';
import { promotionsLocaleSearchParams } from '../utils/promotionLocale';
import type { PromotionCampaign, PromotionMeRow } from '../types/promotions';

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function pickNum(obj: Record<string, unknown> | null | undefined, keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function coalesceUseDistinctCalendarDays(rulesObj: Record<string, unknown>): boolean {
  if (
    Object.prototype.hasOwnProperty.call(rulesObj, 'distinctCalendarDays') &&
    rulesObj.distinctCalendarDays != null
  ) {
    const v = rulesObj.distinctCalendarDays;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      return t === '1' || t === 'true' || t === 'yes';
    }
  }
  return Boolean(rulesObj.useDistinctCalendarDays);
}

function idString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  return '';
}

function normalizeCampaign(raw: unknown): PromotionCampaign | null {
  const r = asObject(raw);
  if (!r) return null;
  const slug = String(
    r.slug ?? r.campaignSlug ?? r.id ?? r.campaignId ?? idString(r._id)
  ).trim();
  if (!slug) return null;
  const rulesObj = asObject(r.rules);
  const rewardObj = asObject(r.reward);
  const rules: PromotionCampaign['rules'] = rulesObj
    ? {
        useDistinctCalendarDays: coalesceUseDistinctCalendarDays(rulesObj),
        distinctCalendarDays:
          typeof rulesObj.distinctCalendarDays === 'number' ? rulesObj.distinctCalendarDays : undefined,
        targetRides:
          typeof rulesObj.targetRides === 'number'
            ? rulesObj.targetRides
            : typeof rulesObj.targetRides === 'string'
              ? Number(rulesObj.targetRides)
              : undefined,
        threshold:
          typeof rulesObj.threshold === 'number'
            ? rulesObj.threshold
            : typeof rulesObj.threshold === 'string'
              ? Number(rulesObj.threshold)
              : undefined,
        timezone: typeof rulesObj.timezone === 'string' ? rulesObj.timezone : undefined,
        ownerMinAcceptedPassengerSeats: pickNum(rulesObj, [
          'ownerMinAcceptedPassengerSeats',
          'owner_min_accepted_passenger_seats',
        ]),
      }
    : undefined;
  const reward: PromotionCampaign['reward'] = rewardObj
    ? {
        title: typeof rewardObj.title === 'string' ? rewardObj.title : undefined,
        description: typeof rewardObj.description === 'string' ? rewardObj.description : undefined,
      }
    : undefined;

  return {
    slug,
    headline:
      typeof r.headline === 'string'
        ? r.headline
        : typeof r.title === 'string'
          ? r.title
          : undefined,
    subtitle: typeof r.subtitle === 'string' ? r.subtitle : undefined,
    shortDescription:
      typeof r.shortDescription === 'string'
        ? r.shortDescription
        : typeof r.description === 'string'
          ? r.description
          : undefined,
    reward,
    rules,
  };
}

function firstCampaignArrayFromObject(o: Record<string, unknown>): unknown[] | null {
  const nestedData = asObject(o.data);
  const payload = asObject(o.payload);
  const result = asObject(o.result);
  const body = asObject(o.body);
  const candidates: (unknown[] | null | undefined)[] = [
    Array.isArray(o.campaigns) ? o.campaigns : null,
    nestedData && Array.isArray(nestedData.campaigns) ? nestedData.campaigns : null,
    payload && Array.isArray(payload.campaigns) ? payload.campaigns : null,
    result && Array.isArray(result.campaigns) ? result.campaigns : null,
    body && Array.isArray(body.campaigns) ? body.campaigns : null,
    Array.isArray(o.offers) ? o.offers : null,
    Array.isArray(o.userCampaigns) ? o.userCampaigns : null,
    Array.isArray(o.items) ? o.items : null,
    Array.isArray(o.results) ? o.results : null,
    Array.isArray(o.list) ? o.list : null,
    Array.isArray(o.records) ? o.records : null,
    Array.isArray(o.rows) ? o.rows : null,
    Array.isArray(o.data) ? o.data : null,
    Array.isArray(o.catalog) ? o.catalog : null,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

function catalogArrayFromPayload(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  const o = asObject(raw);
  if (!o) return null;
  const direct = firstCampaignArrayFromObject(o);
  if (direct) return direct;
  /** One more level: `{ data: { campaigns } }` where `data` is not yet unwrapped. */
  const dataOnly = asObject(o.data);
  if (dataOnly) {
    const inner = firstCampaignArrayFromObject(dataOnly);
    if (inner) return inner;
  }
  return null;
}

export function normalizePromotionCatalog(raw: unknown): PromotionCampaign[] {
  const arr = catalogArrayFromPayload(raw);
  if (!arr) {
    if (__DEV__ && raw && typeof raw === 'object') {
      console.warn('[promotions] catalog: unrecognized envelope; keys:', Object.keys(raw as object));
    }
    return [];
  }
  const out = arr
    .map((item) => {
      const el = asObject(item);
      const nestedCampaign = el ? asObject(el.campaign) : null;
      if (nestedCampaign && !String(el?.slug ?? '').trim()) {
        return normalizeCampaign(nestedCampaign);
      }
      return normalizeCampaign(item);
    })
    .filter((c): c is PromotionCampaign => c != null);
  if (__DEV__ && out.length === 0 && arr.length > 0) {
    console.warn(
      '[promotions] catalog:',
      arr.length,
      'row(s) dropped — need slug/campaignSlug/id/campaignId/_id on each campaign (or nested `campaign`).'
    );
  }
  return out;
}

function normalizeMeRow(raw: unknown): PromotionMeRow | null {
  const r = asObject(raw);
  if (!r) return null;

  const campaign = asObject(r.campaign);
  const progress = asObject(r.progress);

  if (campaign || progress) {
    const slug = String(
      campaign?.slug ??
        campaign?.campaignSlug ??
        campaign?.id ??
        campaign?.campaignId ??
        idString(campaign?._id) ??
        (typeof progress?.campaignSlug === 'string' ? progress.campaignSlug : undefined) ??
        (typeof progress?.slug === 'string' ? progress.slug : undefined) ??
        (progress?.campaignId != null ? String(progress.campaignId) : undefined) ??
        idString(progress?._id) ??
        r.slug ??
        r.campaignSlug ??
        r.campaignId ??
        r.id ??
        idString(r._id) ??
        ''
    ).trim();
    if (!slug) return null;

    const effectiveCredits = pickNum(progress, ['effectiveCredits', 'effective_credits']);
    const creditsTotal = pickNum(progress, ['creditsTotal', 'credits_total', 'completedRides', 'completed_rides']);
    const creditsDistinctDays = pickNum(progress, [
      'creditsDistinctDays',
      'credits_distinct_days',
      'distinctCalendarDays',
      'distinct_calendar_days',
    ]);
    const eligible =
      typeof progress?.eligible === 'boolean'
        ? progress.eligible
        : typeof r.eligible === 'boolean'
          ? r.eligible
          : undefined;

    return {
      slug,
      campaignSlug: typeof campaign?.slug === 'string' ? campaign.slug : undefined,
      effectiveCredits,
      creditsTotal,
      creditsDistinctDays,
      completedRides: creditsTotal,
      progress: typeof r.progress === 'number' ? r.progress : effectiveCredits,
      distinctCalendarDays: creditsDistinctDays,
      distinctDays: creditsDistinctDays,
      eligible,
    };
  }

  const slug = String(
    r.slug ?? r.campaignSlug ?? r.campaignId ?? r.id ?? idString(r._id)
  ).trim();
  if (!slug) return null;
  const flatProgress = typeof r.progress === 'number' ? r.progress : undefined;
  return {
    slug,
    campaignSlug: typeof r.campaignSlug === 'string' ? r.campaignSlug : undefined,
    completedRides: typeof r.completedRides === 'number' ? r.completedRides : undefined,
    progress: flatProgress,
    distinctCalendarDays:
      typeof r.distinctCalendarDays === 'number' ? r.distinctCalendarDays : undefined,
    distinctDays: typeof r.distinctDays === 'number' ? r.distinctDays : undefined,
    eligible: typeof r.eligible === 'boolean' ? r.eligible : undefined,
    effectiveCredits: pickNum(r, ['effectiveCredits', 'effective_credits']),
    creditsTotal: pickNum(r, ['creditsTotal', 'credits_total']),
    creditsDistinctDays: pickNum(r, ['creditsDistinctDays', 'credits_distinct_days']),
  };
}

function meRowsArrayFromPayload(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  const o = asObject(raw);
  if (!o) return null;
  const nestedData = asObject(o.data);
  const payload = asObject(o.payload);
  const result = asObject(o.result);
  return (
    (Array.isArray(o.campaigns) ? o.campaigns : null) ??
    (nestedData && Array.isArray(nestedData.campaigns) ? nestedData.campaigns : null) ??
    (payload && Array.isArray(payload.campaigns) ? payload.campaigns : null) ??
    (result && Array.isArray(result.campaigns) ? result.campaigns : null) ??
    (Array.isArray(o.progress) ? o.progress : null) ??
    (Array.isArray(o.entries) ? o.entries : null) ??
    (Array.isArray(o.items) ? o.items : null) ??
    (Array.isArray(o.results) ? o.results : null) ??
    firstCampaignArrayFromObject(o)
  );
}

export function normalizePromotionMe(raw: unknown): PromotionMeRow[] {
  const arr = meRowsArrayFromPayload(raw);
  if (!arr) return [];
  return arr.map(normalizeMeRow).filter((row): row is PromotionMeRow => row != null);
}

export async function fetchPromotionCatalog(): Promise<PromotionCampaign[]> {
  const q = promotionsLocaleSearchParams();
  const path = `${API.endpoints.promotions.campaigns}?${q}`;
  const res = await api.getOptional<unknown>(path);
  return normalizePromotionCatalog(res);
}

export async function fetchPromotionMe(): Promise<PromotionMeRow[]> {
  if (!hasAuthAccessToken()) return [];
  const q = promotionsLocaleSearchParams();
  const path = `${API.endpoints.promotions.me}?${q}`;
  try {
    const res = await api.getOptional<unknown>(path);
    return normalizePromotionMe(res);
  } catch {
    return [];
  }
}
