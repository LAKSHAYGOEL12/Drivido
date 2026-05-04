/**
 * Promotion campaign payloads from GET `/promotions/campaigns` and related `/promotions/me` rows.
 * Shapes are defensive — backend may extend fields.
 */
export type PromotionReward = {
  title?: string;
  description?: string;
};

export type PromotionRules = {
  /** When true, progress uses distinct calendar days instead of completed rides. */
  useDistinctCalendarDays?: boolean;
  /**
   * API often sends this (boolean or 0/1). Prefer over `useDistinctCalendarDays` when both exist.
   * Normalized into `useDistinctCalendarDays` in `normalizeCampaign`.
   */
  distinctCalendarDays?: boolean | number;
  targetRides?: number;
  threshold?: number;
  /** IANA / backend timezone string when present. */
  timezone?: string;
  ownerMinAcceptedPassengerSeats?: number;
};

export type PromotionCampaign = {
  slug?: string;
  /** Backend / CMS title (normalized into `headline` when parsing). */
  title?: string;
  headline?: string;
  subtitle?: string;
  shortDescription?: string;
  description?: string;
  reward?: PromotionReward;
  rules?: PromotionRules;
};

/**
 * One logical row from GET `/promotions/me` for a campaign.
 * Supports flat rows and nested `{ campaign, progress }` (normalized into this shape).
 */
export type PromotionMeRow = {
  slug?: string;
  campaignSlug?: string;
  /** Raw completed-ride style counts when server does not send `effectiveCredits`. */
  completedRides?: number;
  progress?: number;
  distinctCalendarDays?: number;
  distinctDays?: number;
  /** Server truth for unlock state when present. */
  eligible?: boolean;
  /** Credits toward threshold — preferred over recomputing from ride/day counts. */
  effectiveCredits?: number;
  creditsTotal?: number;
  creditsDistinctDays?: number;
};
