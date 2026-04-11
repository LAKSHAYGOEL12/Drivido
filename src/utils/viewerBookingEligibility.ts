import type { RideListItem } from '../types/api';

export type ViewerRideBookingEligibility = {
  /** True when backend sent eligibility (nested `viewer_booking_context` and/or legacy root fields). */
  fromServer: boolean;
  canBook: boolean;
  canRequest: boolean;
  blockReason: string;
  /** Machine-oriented code from `viewer_booking_context.block_reason_code` when present. */
  blockReasonCode?: string;
  cooldownEndsAt?: string;
  activeBookingId?: string;
};

function parseBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

/** Prefer snake_case SSOT; legacy camel nested only if snake absent. */
function pickViewerBookingContextRecord(r: Record<string, unknown>): Record<string, unknown> | null {
  const snake = r.viewer_booking_context;
  if (snake && typeof snake === 'object') return snake as Record<string, unknown>;
  const camel = r.viewerBookingContext;
  if (camel && typeof camel === 'object') return camel as Record<string, unknown>;
  return null;
}

function readEligibilityFields(
  nested: Record<string, unknown> | null,
  root: Record<string, unknown>
): {
  canBook: boolean | undefined;
  canRequest: boolean | undefined;
  blockReason: string;
  blockReasonCode: string;
  cooldownEndsAt?: string;
  activeBookingId?: string;
} {
  if (nested) {
    const canBook = parseBool(nested.can_book ?? nested.canBook);
    const canRequest = parseBool(nested.can_request ?? nested.canRequest);
    const blockReasonCode = String(
      nested.block_reason_code ?? nested.blockReasonCode ?? ''
    ).trim();
    const blockReasonRaw = String(nested.block_reason ?? nested.blockReason ?? '').trim();
    const blockReason = blockReasonRaw || blockReasonCode;
    const cooldownRaw = String(nested.cooldown_ends_at ?? nested.cooldownEndsAt ?? '').trim();
    const activeRaw = String(nested.active_booking_id ?? nested.activeBookingId ?? '').trim();
    return {
      canBook,
      canRequest,
      blockReason,
      blockReasonCode,
      cooldownEndsAt: cooldownRaw || undefined,
      activeBookingId: activeRaw || undefined,
    };
  }
  const canBook = parseBool(root.can_book ?? root.canBook);
  const canRequest = parseBool(root.can_request ?? root.canRequest);
  const blockReasonCode = String(root.block_reason_code ?? root.blockReasonCode ?? '').trim();
  const blockReasonRaw = String(
    root.block_reason ?? root.blockReason ?? root.blockReasonCode ?? root.block_reason_code ?? ''
  ).trim();
  const blockReason = blockReasonRaw || blockReasonCode;
  const cooldownRaw = String(root.cooldown_ends_at ?? root.cooldownEndsAt ?? '').trim();
  const activeRaw = String(root.active_booking_id ?? root.activeBookingId ?? '').trim();
  return {
    canBook,
    canRequest,
    blockReason,
    blockReasonCode,
    cooldownEndsAt: cooldownRaw || undefined,
    activeBookingId: activeRaw || undefined,
  };
}

function eligibilitySignalsPresent(args: {
  canBook: boolean | undefined;
  canRequest: boolean | undefined;
  blockReason: string;
  blockReasonCode: string;
  cooldownEndsAt?: string;
  activeBookingId?: string;
}): boolean {
  const { canBook, canRequest, blockReason, blockReasonCode, cooldownEndsAt, activeBookingId } = args;
  return (
    canBook !== undefined ||
    canRequest !== undefined ||
    blockReason.length > 0 ||
    blockReasonCode.length > 0 ||
    Boolean(cooldownEndsAt) ||
    Boolean(activeBookingId)
  );
}

/**
 * Read passenger booking eligibility from ride payload (GET /rides, GET /rides/:id).
 * **SSOT:** `viewer_booking_context` (snake_case) when present — root `can_book` / `block_reason` duplicates
 * are ignored for reads when nested is present. Falls back to root fields only when nested is absent (older API).
 */
export function readViewerRideBookingEligibility(ride: RideListItem): ViewerRideBookingEligibility {
  const r = ride as Record<string, unknown>;
  const nested = pickViewerBookingContextRecord(r);
  const fields = readEligibilityFields(nested, r);
  const fromServer = eligibilitySignalsPresent(fields);

  return {
    fromServer,
    canBook: fields.canBook ?? false,
    canRequest: fields.canRequest ?? false,
    blockReason: fields.blockReason,
    ...(fields.blockReasonCode ? { blockReasonCode: fields.blockReasonCode } : {}),
    cooldownEndsAt: fields.cooldownEndsAt,
    activeBookingId: fields.activeBookingId,
  };
}

/** Human-readable relative hint from ISO 8601 (cooldown end). */
export function formatCooldownEndsAtHint(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const diff = t - Date.now();
  if (diff <= 0) return 'in a moment';
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.ceil(mins / 60);
  if (h < 24) return `in about ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.ceil(h / 24);
  return `in about ${d} day${d === 1 ? '' : 's'}`;
}

export function viewerBookingNotAllowedMessage(elig: ViewerRideBookingEligibility): string {
  if (elig.cooldownEndsAt) {
    const hint = formatCooldownEndsAtHint(elig.cooldownEndsAt);
    if (hint) return `Please wait before trying again (${hint}).`;
  }
  return elig.blockReason.trim() || 'You can’t book this ride right now.';
}
