import { bookingIsCancelled, bookingIsCancelledByOwner } from './bookingStatus';

export type BookingHistoryTone = 'success' | 'danger' | 'warning' | 'neutral';

/** One row in the passenger booking activity timeline. */
export type BookingHistoryTimelineItem = {
  id: string;
  tone: BookingHistoryTone;
  /** Ionicons glyph name */
  icon: 'checkmark-circle' | 'close-circle-outline' | 'alert-circle-outline' | 'time-outline' | 'remove-circle-outline';
  /** Primary time (absolute, user-locale) */
  whenPrimary: string;
  /** Short relative hint when parseable, e.g. "3d ago" */
  whenRelative?: string;
  /** Main headline, e.g. "Booking confirmed" */
  title: string;
  /** Seat count chip, e.g. "2 seats" */
  seatsLabel?: string;
};

function seatPhrase(n: number): string {
  const x = Math.max(0, Math.floor(n));
  return `${x} seat${x !== 1 ? 's' : ''}`;
}

type EmbeddedBookingSnapshot = {
  seats: number;
  status?: string;
  bookedAt?: string;
  displayKey?: string;
  displayParams?: { seats?: number; reason?: string };
  passengerListSegmentId?: string;
  passenger_list_segment_id?: string;
};

function embeddedSnapshotSegmentId(h: EmbeddedBookingSnapshot): string {
  return String(h.passengerListSegmentId ?? h.passenger_list_segment_id ?? '').trim();
}

function parseBookedAtMs(iso: string | undefined): number | null {
  if (!iso || !String(iso).trim()) return null;
  const t = Date.parse(String(iso).trim());
  return Number.isFinite(t) ? t : null;
}

/**
 * When owner nav lines are missing, `booking.bookingHistory` may still list prior-segment snapshots.
 * Prefer API `passengerListSegmentId` on each snapshot; else drop snapshots strictly before this booking row’s `bookedAt`.
 */
function filterEmbeddedSnapshotsForPassengerListSegment(
  embedded: EmbeddedBookingSnapshot[],
  scopeSegmentId: string | undefined,
  floorBookedAt: string | undefined
): EmbeddedBookingSnapshot[] {
  const sid = (scopeSegmentId ?? '').trim();
  if (!sid || sid.toLowerCase().startsWith('legacy-')) return embedded;
  const hasSnapSeg = embedded.some((h) => embeddedSnapshotSegmentId(h) !== '');
  if (hasSnapSeg) {
    return embedded.filter((h) => embeddedSnapshotSegmentId(h) === sid);
  }
  const floorMs = parseBookedAtMs(floorBookedAt);
  if (floorMs == null) return embedded;
  return embedded.filter((h) => {
    const m = parseBookedAtMs(h.bookedAt);
    if (m == null) return true;
    return m >= floorMs - 2000;
  });
}

/** Embedded `bookingHistory[]` snapshots (no ride-level events): best-effort same wording as owner lines. */
function humanizeEmbeddedBookingSnapshot(
  h: {
    seats: number;
    status?: string;
    displayKey?: string;
    displayParams?: { seats?: number; reason?: string };
  },
  prev?: { seats: number; status?: string }
): string {
  const dk = String(h.displayKey ?? '').trim().toLowerCase();
  const dp = h.displayParams;
  const nFromParams =
    typeof dp?.seats === 'number' && Number.isFinite(dp.seats) ? Math.max(0, Math.floor(dp.seats)) : undefined;
  const n = nFromParams ?? Math.max(0, Math.floor(Number(h.seats) || 0));
  if (dk === 'booked') return `Booked ${seatPhrase(n)}`;
  if (dk === 'rebooked') return `Rebooked ${seatPhrase(n)}`;
  if (dk === 'requested' && n > 0) return `Requested ${seatPhrase(n)}`;
  if (dk === 'approved' && n > 0) return `Approved ${seatPhrase(n)}`;
  if (dk === 'full_cancel_passenger' || dk === 'full_cancel_system') {
    const r = typeof dp?.reason === 'string' ? dp.reason.trim() : '';
    return r ? `Cancelled (${r})` : 'Cancelled all seats';
  }
  if (dk === 'seats_reduced' || dk === 'seat_cancelled') {
    if (n <= 0 && prev) {
      const prevSeats = Math.max(0, Math.floor(Number(prev.seats) || 0));
      if (prevSeats > 0) return `Cancelled ${seatPhrase(prevSeats)}`;
    }
    if (prev) {
      const prevSeats = Math.max(0, Math.floor(Number(prev.seats) || 0));
      const delta = prevSeats - n;
      if (n === 0 && prevSeats > 0) return 'Cancelled all seats';
      if (delta > 0) return `Cancelled ${seatPhrase(delta)}`;
    }
    return '';
  }
  if (dk === 'request_superseded' || dk === 'request_rejected' || dk === 'request_expired' || dk === 'full_cancel_owner') {
    return '';
  }

  const s = String(h.status ?? '').trim().toLowerCase();

  if (bookingIsCancelledByOwner(h.status)) return '';

  if (
    s === 'seats_reduced' ||
    s === 'seat_reduced' ||
    s === 'partial_cancel' ||
    s === 'partial_cancellation' ||
    s === 'seat_cancelled' ||
    s === 'seats_cancelled'
  ) {
    if (!prev) return '';
    const prevSeats = Math.max(0, Math.floor(Number(prev.seats) || 0));
    const delta = prevSeats - n;
    if (n === 0 && prevSeats > 0) return 'Cancelled all seats';
    if (delta > 0) return `Cancelled ${seatPhrase(delta)}`;
    return '';
  }

  if (bookingIsCancelled(h.status)) {
    return 'Cancelled all seats';
  }

  if (s === 'pending' || s === 'rejected') return '';

  if (s === 'confirmed' || s === 'accepted' || s === 'completed') {
    const ps = prev ? String(prev.status ?? '').trim().toLowerCase() : '';
    const prevWasPassengerCancel =
      prev &&
      (ps === 'cancelled' || ps === 'canceled') &&
      !bookingIsCancelledByOwner(prev.status);
    if (prevWasPassengerCancel) {
      return `Rebooked ${seatPhrase(n)}`;
    }
    return `Booked ${seatPhrase(n)}`;
  }

  return '';
}

function toneAndIconForTitle(title: string): { tone: BookingHistoryTone; icon: BookingHistoryTimelineItem['icon'] } {
  const t = title.toLowerCase();
  if (t.startsWith('cancelled')) {
    return { tone: 'danger', icon: 'close-circle-outline' };
  }
  if (t.startsWith('rebooked') || t.startsWith('booked')) {
    return { tone: 'success', icon: 'checkmark-circle' };
  }
  if (t.startsWith('approved')) {
    return { tone: 'success', icon: 'checkmark-circle' };
  }
  if (t.startsWith('requested')) {
    return { tone: 'neutral', icon: 'time-outline' };
  }
  return { tone: 'neutral', icon: 'time-outline' };
}

/** Split "A · B · Jan 5, 3:30 PM" → body vs trailing timestamp segment. */
function splitBodyAndWhenLabel(line: string): { body: string; whenLabel: string } {
  const trimmed = line.trim();
  const idx = trimmed.lastIndexOf(' · ');
  if (idx <= 0) return { body: trimmed, whenLabel: '' };
  const whenLabel = trimmed.slice(idx + 3).trim();
  const body = trimmed.slice(0, idx).trim();
  return { body, whenLabel };
}

function parseWhenLabels(whenLabel: string): { primary: string; relative?: string } {
  if (!whenLabel) return { primary: '' };
  const d = new Date(whenLabel);
  if (Number.isNaN(d.getTime())) {
    return { primary: whenLabel };
  }
  const now = Date.now();
  const diffMs = now - d.getTime();
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const primary = d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60000);
  let relative: string | undefined;
  if (past) {
    if (mins < 1) relative = 'Just now';
    else if (mins < 60) relative = `${mins} min ago`;
    else {
      const h = Math.floor(mins / 60);
      if (mins < 1440) relative = `${h} hr ago`;
      else {
        const d = Math.floor(mins / 1440);
        if (mins < 10080) relative = `${d} day${d !== 1 ? 's' : ''} ago`;
        else {
          const mo = Math.floor(mins / 43200);
          relative = `${mo} mo ago`;
        }
      }
    }
  }
  return { primary, relative };
}

function splitSeatsAndTitle(body: string): { seatsLabel?: string; title: string } {
  const parts = body.split(' · ').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { title: body };
  const first = parts[0];
  if (/^\d+\s+seats?$/i.test(first)) {
    const title = parts.slice(1).join(' · ').trim();
    return {
      seatsLabel: first,
      title: title || 'Booking update',
    };
  }
  return { title: parts.join(' · ') };
}

export function parseOwnerHistoryLineToTimelineItem(line: string, id: string): BookingHistoryTimelineItem {
  const { body, whenLabel } = splitBodyAndWhenLabel(line);
  const { seatsLabel, title } = splitSeatsAndTitle(body);
  const { tone, icon } = toneAndIconForTitle(title);
  const { primary, relative } = parseWhenLabels(whenLabel);
  return {
    id,
    tone,
    icon,
    whenPrimary: primary || whenLabel || 'Time not recorded',
    whenRelative: relative,
    title,
    seatsLabel,
  };
}

export function embeddedBookingSnapshotToTimelineItem(
  h: {
    seats: number;
    status?: string;
    bookedAt?: string;
    displayKey?: string;
    displayParams?: { seats?: number; reason?: string };
  },
  index: number,
  prev?: { seats: number; status?: string; bookedAt?: string }
): BookingHistoryTimelineItem | null {
  const title = humanizeEmbeddedBookingSnapshot(h, prev);
  if (!title.trim()) return null;
  const { tone, icon } = toneAndIconForTitle(title);
  const rawWhen = (h.bookedAt ?? '').trim();
  const { primary, relative } = parseWhenLabels(rawWhen);
  return {
    id: `emb-${index}-${rawWhen}-${title}`,
    tone,
    icon,
    whenPrimary: primary || rawWhen || 'Time not recorded',
    whenRelative: relative,
    title,
    seatsLabel: undefined,
  };
}

function isAllowedPassengerHistoryRow(item: BookingHistoryTimelineItem): boolean {
  const t = item.title.trim().toLowerCase();
  return (
    t.startsWith('booked ') ||
    t.startsWith('rebooked ') ||
    t.startsWith('cancelled ') ||
    t.startsWith('requested ') ||
    t.startsWith('approved ')
  );
}

/** Drop back-to-back identical “booked / approved / requested” titles (duplicate embedded snapshots). */
function collapseConsecutiveDuplicateBookingTitles(items: BookingHistoryTimelineItem[]): BookingHistoryTimelineItem[] {
  const out: BookingHistoryTimelineItem[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    const t = it.title.trim().toLowerCase();
    const isBookLike =
      t.startsWith('booked ') ||
      t.startsWith('rebooked ') ||
      t.startsWith('approved ') ||
      t.startsWith('requested ');
    if (prev && isBookLike && prev.title === it.title) {
      continue;
    }
    out.push(it);
  }
  return out;
}

/** Request-mode: same seats can appear as both "Booked N" and "Rebooked N" — keep one (Rebooked wins). */
function collapseAdjacentBookedRebookedSameSeatTitles(items: BookingHistoryTimelineItem[]): BookingHistoryTimelineItem[] {
  const out: BookingHistoryTimelineItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const next = items[i + 1];
    const ct = cur.title.trim().toLowerCase();
    const nt = next?.title.trim().toLowerCase() ?? '';
    const toBook = ct.match(/^(booked)\s+(\d+)\s+seats?$/);
    const toRebook = nt.match(/^(rebooked)\s+(\d+)\s+seats?$/);
    if (next && toBook && toRebook && toBook[2] === toRebook[2]) {
      out.push(next);
      i += 1;
      continue;
    }
    const toRebook2 = ct.match(/^(rebooked)\s+(\d+)\s+seats?$/);
    const toBook2 = nt.match(/^(booked)\s+(\d+)\s+seats?$/);
    if (next && toRebook2 && toBook2 && toRebook2[2] === toBook2[2]) {
      out.push(cur);
      i += 1;
      continue;
    }
    out.push(cur);
  }
  return out;
}

export function buildBookingHistoryTimelineItems(args: {
  ownerBookingHistoryLines?: string[] | undefined;
  embedded?: EmbeddedBookingSnapshot[] | undefined;
  /** Non-legacy segment on the booking row — trims embedded fallback to this segment. */
  scopeToPassengerListSegmentId?: string;
  /** Current booking `bookedAt` — used when snapshots lack segment ids (drops older-segment events). */
  scopeEmbeddedSnapshotsAfterBookedAt?: string;
}): BookingHistoryTimelineItem[] {
  const lines = (args.ownerBookingHistoryLines ?? []).map((l) => String(l).trim()).filter(Boolean);
  if (lines.length > 0) {
    return collapseAdjacentBookedRebookedSameSeatTitles(
      collapseConsecutiveDuplicateBookingTitles(
        lines
          .map((line, i) => parseOwnerHistoryLineToTimelineItem(line, `nav-${i}`))
          .filter(isAllowedPassengerHistoryRow)
      )
    );
  }
  const embRaw = args.embedded;
  if (Array.isArray(embRaw) && embRaw.length > 0) {
    const emb = filterEmbeddedSnapshotsForPassengerListSegment(
      embRaw as EmbeddedBookingSnapshot[],
      args.scopeToPassengerListSegmentId,
      args.scopeEmbeddedSnapshotsAfterBookedAt
    );
    if (emb.length === 0) return [];
    return collapseAdjacentBookedRebookedSameSeatTitles(
      collapseConsecutiveDuplicateBookingTitles(
        emb
          .map((h, i) => embeddedBookingSnapshotToTimelineItem(h, i, i > 0 ? emb[i - 1] : undefined))
          .filter((x): x is BookingHistoryTimelineItem => x != null)
          .filter(isAllowedPassengerHistoryRow)
      )
    );
  }
  return [];
}
