import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Platform,
  InteractionManager,
  useWindowDimensions,
  TextInput,
  KeyboardAvoidingView,
  Pressable,
} from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import DatePickerModal from '../../components/common/DatePickerModal';
import PassengersPickerModal from '../../components/common/PassengersPickerModal';
import CancelRideConfirmModal from '../../components/common/CancelRideConfirmModal';
import { resetTabsToYourRidesAfterBook } from '../../navigation/navigateAfterBook';
import { findMainTabNavigatorWithOptions, getRideDetailSourceMainTab } from '../../navigation/findMainTabNavigator';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { InboxStackParamList, RidesStackParamList, SearchStackParamList } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';
import { authBackendUserIdRef, useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { fetchRideDetailRaw, invalidateRideDetailCache } from '../../services/rideDetailCache';
import { removePassengerBookingAsOwner } from '../../services/bookings';
import { recordOwnerCancelledRide } from '../../services/ownerCancelledRidesStorage';
import { hasCurrentUserRatedRide, submitRideRating } from '../../services/ratings';
import { hasHandledRatingPrompt, markRatingPromptHandled } from '../../services/ratingPromptStorage';
import { mergeOwnerRatedPassenger, mergePassengerRatedRide } from '../../services/ratedRidesStorage';
import type { RecentPublishedEntry } from '../../services/recent-published-storage';
import { API } from '../../constants/API';
import type {
  CreateBookingRequest,
  RideBookingHistoryEvent,
  RideBookingHistoryUserGroup,
  RideListItem,
} from '../../types/api';
import { COLORS } from '../../constants/colors';
import {
  getRideCardDateShort,
  formatRidePrice,
  getRidePickupTime,
  getRideScheduledAt,
  isRidePastArrivalWindow,
  isRideCancelledByOwner,
  getRideTotalBookingCount,
  isViewerOwnerStrict,
  isViewerRidePublisher,
  pickPublisherPhoneFromRide,
} from '../../utils/rideDisplay';
import { mergeVehicleFieldsIntoRide, normalizeVehicleFieldsFromApiRecord } from '../../utils/rideVehicleFields';
import { vehicleIdString, vehiclesFromUser } from '../../utils/userVehicle';
import {
  bookingPickupDrop,
  bookingDiffersFromPublishedRide,
  viewerTripVersusPublishedDiffers,
} from '../../utils/bookingRoutePreview';
import {
  bookingIsCancelled,
  bookingIsCancelledByOwner,
  bookingHistoryTreatAsCancelledByOwner,
  bookingRowHoldsOccupiedSeats,
  effectiveOccupiedSeatsFromBookingRow,
  pickPreferredBookingForUser,
  pickPreferredBookingStatus,
} from '../../utils/bookingStatus';
import {
  getRideAvailableSeats,
  getRideAvailabilityShort,
  isRideSeatsFull,
} from '../../utils/rideSeats';
import { bookingPassengerDisplayName, ridePublisherDisplayName } from '../../utils/displayNames';
import { bookingPassengerDeactivated, ridePublisherDeactivated } from '../../utils/deactivatedAccount';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import LoginBottomSheet from '../../components/auth/LoginBottomSheet';
import UserAvatar from '../../components/common/UserAvatar';
import { mapRawToBookingRow } from '../../utils/bookingNormalize';
import {
  isRouteTimeOverlapBookingError,
  pickApiErrorBodyMessage,
} from '../../utils/bookingApiErrors';
import {
  findOverlappingPassengerBookingRide,
  PASSENGER_ALREADY_BOOKED_THIS_RIDE_TOAST,
  PASSENGER_OVERLAP_BOOKING_TOAST,
  rideHasActivePassengerBookingForUser,
} from '../../utils/passengerRouteBookingConflict';
import { pickAvatarUrlFromRecord, pickPublisherAvatarUrl } from '../../utils/avatarUrl';
import { getPublisherRouteCoords } from '../../utils/ridePublisherCoords';
import { showToast } from '../../utils/toast';
import { calculateAge } from '../../utils/calculateAge';
import RidePreferenceChips from '../../components/profile/RidePreferenceChips';
import { normalizeRidePreferenceIds } from '../../constants/ridePreferences';
import {
  fetchPassengerBookedRidesForOverlap,
  invalidatePassengerBookedRidesCache,
} from '../../services/fetchPassengerBookedRides';
import { emitRideListMergeFromDetail } from '../../services/rideListFromDetailSync';
import { emitRequestMyRidesBlockingRefresh } from '../../services/myRidesListRefreshEvents';

type RideDetailRouteProp =
  | RouteProp<RidesStackParamList, 'RideDetail'>
  | RouteProp<SearchStackParamList, 'RideDetail'>
  | RouteProp<InboxStackParamList, 'RideDetail'>;

type BookingItem = NonNullable<RideListItem['bookings']>[number];

/** Owner cannot remove passengers when departure is less than 1 hour away. */
const OWNER_REMOVE_MIN_LEAD_MS = 60 * 60 * 1000;

function isTooCloseForOwnerRemovePassenger(ride: RideListItem): boolean {
  const at = getRideScheduledAt(ride);
  if (!at || Number.isNaN(at.getTime())) return false;
  const msUntil = at.getTime() - Date.now();
  if (msUntil <= 0) return false;
  return msUntil < OWNER_REMOVE_MIN_LEAD_MS;
}

function bookingTimelineMs(b: BookingItem): number {
  const ext = b as BookingItem & { updatedAt?: string; createdAt?: string };
  const raw = ext.bookedAt ?? ext.updatedAt ?? ext.createdAt ?? '';
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function bookingSeatCount(b: BookingItem): number {
  const raw = typeof b.seats === 'number' && Number.isFinite(b.seats) ? b.seats : 0;
  return Math.max(0, Math.floor(raw));
}

function isPendingLikeBookingStatus(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return (
    s === 'pending' ||
    s === 'requested' ||
    s === 'request_pending' ||
    s === 'awaiting_approval'
  );
}

function isAcceptedLikeBookingStatus(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'accepted' || s === 'confirmed' || s === 'booked' || s === 'approved';
}

function bookingFlag(
  row: BookingItem,
  key: 'isPendingRequest' | 'isAcceptedPassenger' | 'canOwnerRemove'
): boolean | undefined {
  const v = (row as BookingItem & Record<string, unknown>)[key];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Request-mode owner “Passengers” list: backend-only (`ride.bookings[]` + embedded `bookingHistory` on those rows).
 * No merged ride-level timeline — avoids showing requesters before owner approval.
 */
function requestModeOwnerPassengerListedFromBackendBookingsOnly(
  apiBookings: BookingItem[],
  userId: string,
  primary: BookingItem,
  rideGroups?: RideBookingHistoryUserGroup[]
): boolean {
  const uid = (userId ?? '').trim();
  const rows: BookingItem[] = uid
    ? apiBookings.filter((p) => (p.userId ?? '').trim() === uid)
    : apiBookings.filter((p) => (p.id ?? '').trim() === (primary.id ?? '').trim());
  const toScan = rows.length > 0 ? rows : [primary];
  const rowHasAcceptedEvidence = (r: BookingItem): boolean => {
    if (bookingFlag(r, 'isAcceptedPassenger') === true) return true;
    if (isAcceptedLikeBookingStatus(r.status)) return true;
    const hist = r.bookingHistory;
    if (!Array.isArray(hist)) return false;
    return hist.some((h) => {
      const hs = String(h.status ?? '').trim().toLowerCase();
      if (isAcceptedLikeBookingStatus(hs)) return true;
      const dk = String((h as { displayKey?: string }).displayKey ?? '').trim().toLowerCase();
      return dk === 'booked' || dk === 'rebooked' || dk === 'approved';
    });
  };
  const userHasAcceptedEvidenceFromRideHistory = (): boolean => {
    if (!uid) return false;
    const group = findBookingHistoryGroupForUser(rideGroups, uid);
    if (!group?.events?.length) return false;
    return group.events.some((ev) => {
      if ((ev.seatConfirmationOrdinal ?? 0) > 0) return true;
      const dk = String(ev.displayKey ?? '').trim().toLowerCase();
      if (dk === 'booked' || dk === 'rebooked' || dk === 'approved') return true;
      const et = String(ev.eventType ?? '').trim().toLowerCase();
      return (
        et === 'booked' ||
        et === 'rebooked' ||
        et === 'booking_created' ||
        et === 'approved' ||
        et === 'request_approved' ||
        et === 'owner_approved'
      );
    });
  };

  if (toScan.some((r) => String((r as BookingItem & { ownerListRole?: string }).ownerListRole ?? '').trim())) {
    return toScan.some((r) => {
      const role = String((r as BookingItem & { ownerListRole?: string }).ownerListRole ?? '').trim();
      if (role === 'active_passenger') return true;
      // Keep historical cancelled passenger visible only when backend row/history proves they were accepted before.
      if (role === 'historical_cancelled') {
        return rowHasAcceptedEvidence(r) || userHasAcceptedEvidenceFromRideHistory();
      }
      return false;
    });
  }
  // If this user has any role-tagged rows in the API payload, that role is authoritative.
  // No role seen as active => do not infer from legacy status/history fallbacks.
  const allRowsForUser = uid
    ? apiBookings.filter((p) => (p.userId ?? '').trim() === uid)
    : apiBookings.filter((p) => (p.id ?? '').trim() === (primary.id ?? '').trim());
  if (
    allRowsForUser.some(
      (r) => String((r as BookingItem & { ownerListRole?: string }).ownerListRole ?? '').trim().length > 0
    )
  ) {
    // When role tags exist but none are active/historical-with-accept-evidence, keep hidden.
    return allRowsForUser.some((r) => {
      const role = String((r as BookingItem & { ownerListRole?: string }).ownerListRole ?? '').trim();
      if (role === 'active_passenger') return true;
      if (role === 'historical_cancelled') {
        return rowHasAcceptedEvidence(r) || userHasAcceptedEvidenceFromRideHistory();
      }
      return false;
    });
  }

  for (const r of toScan) {
    if (bookingFlag(r, 'isAcceptedPassenger') === true) return true;
  }
  for (const r of toScan) {
    if (bookingFlag(r, 'isPendingRequest') === true) continue;
    const s = String(r.status ?? '').trim().toLowerCase();
    if (isPendingLikeBookingStatus(s) || s === 'rejected') continue;
    if (isAcceptedLikeBookingStatus(s)) return true;
  }
  for (const r of toScan) {
    const hist = r.bookingHistory;
    if (!Array.isArray(hist)) continue;
    for (const h of hist) {
      const hs = String(h.status ?? '').trim().toLowerCase();
      if (isPendingLikeBookingStatus(hs) || hs === 'rejected') continue;
      if (isAcceptedLikeBookingStatus(hs)) return true;
    }
  }
  return false;
}

function seatPhrase(n: number): string {
  const x = Math.max(0, Math.floor(n));
  return `${x} seat${x !== 1 ? 's' : ''}`;
}

function cancelledSeatsFromRideHistoryEvent(ev: {
  seatsBefore: number;
  seatsChanged: number;
  seatsAfter: number;
}): number {
  const before = Math.max(0, Math.floor(Number(ev.seatsBefore) || 0));
  const after = Math.max(0, Math.floor(Number(ev.seatsAfter) || 0));
  const ch = Number(ev.seatsChanged);
  let delta = before - after;
  if (delta <= 0 && Number.isFinite(ch) && ch !== 0) {
    delta = Math.abs(Math.floor(ch));
  }
  return Math.max(0, delta);
}

/** True if this user had an accepted/confirmed booking snapshot strictly before `h` in the merged timeline. */
function hadPriorAcceptedBookingSnapshot(
  uid: string,
  h: BookingItem,
  historyChronological: BookingItem[]
): boolean {
  if (!uid.trim()) return false;
  const idxH = historyChronological.indexOf(h);
  if (idxH < 0) return false;
  const myT = bookingTimelineMs(h);
  for (let i = 0; i < historyChronological.length; i++) {
    const row = historyChronological[i];
    if ((row.userId ?? '').trim() !== uid) continue;
    if (i === idxH) continue;
    const rt = bookingTimelineMs(row);
    const strictlyBefore = rt < myT || (rt === myT && i < idxH);
    if (!strictlyBefore) continue;
    const st = String(row.status ?? '').trim().toLowerCase();
    if (isPendingLikeBookingStatus(st) || st === 'rejected') continue;
    if (bookingIsCancelled(row.status)) continue;
    if (bookingFlag(row, 'isAcceptedPassenger') === true && bookingSeatCount(row) > 0) return true;
    if (isAcceptedLikeBookingStatus(st) && bookingSeatCount(row) > 0) return true;
  }
  return false;
}

/**
 * Passenger list “Rebooked” badge: true only after a cancellation (or owner removal) that happens **after**
 * the first owner-approved / confirmed booking — not when a pending row is superseded on first accept.
 */
function passengerListRowIsTrueRebook(userId: string, allPassengers: BookingItem[]): boolean {
  const uid = (userId ?? '').trim();
  if (!uid) return false;
  const mine = allPassengers.filter((p) => (p.userId ?? '').trim() === uid);
  if (mine.length === 0) return false;

  let firstAcceptMs: number | null = null;
  for (const p of mine) {
    const st = String(p.status ?? '').trim().toLowerCase();
    if (isPendingLikeBookingStatus(st) || st === 'rejected') continue;
    if (bookingIsCancelled(p.status)) continue;
    const accepted =
      bookingFlag(p, 'isAcceptedPassenger') === true || isAcceptedLikeBookingStatus(st);
    if (!accepted) continue;
    if (bookingSeatCount(p) <= 0 && !bookingRowHoldsOccupiedSeats(p)) continue;
    const t = bookingTimelineMs(p);
    if (firstAcceptMs === null || t < firstAcceptMs) firstAcceptMs = t;
  }
  if (firstAcceptMs === null) return false;
  const firstAcceptAt = firstAcceptMs;

  const hasActive = mine.some((p) => {
    if (bookingIsCancelledByOwner(p.status)) return bookingRowHoldsOccupiedSeats(p);
    return !bookingIsCancelled(p.status);
  });
  if (!hasActive) return false;

  return mine.some((p) => {
    if (!bookingIsCancelled(p.status)) return false;
    if (bookingTimelineMs(p) <= firstAcceptAt) return false;
    // Partial owner removal still has an active booking row — not a passenger "rebook" story.
    if (bookingIsCancelledByOwner(p.status) && bookingRowHoldsOccupiedSeats(p)) return false;
    return true;
  });
}

/** Prefer backend `showRebookedBadge` when sent; else client heuristic (older APIs). */
function passengerRowShowRebookedBadge(b: BookingItem, allPassengers: BookingItem[]): boolean {
  const badgeSrc = String((b as BookingItem & { rebookedBadgeSource?: string }).rebookedBadgeSource ?? '')
    .trim()
    .toLowerCase();
  if (badgeSrc === 'server') {
    return b.showRebookedBadge === true;
  }
  if (typeof b.showRebookedBadge === 'boolean') return b.showRebookedBadge;
  return passengerListRowIsTrueRebook((b.userId ?? '').trim(), allPassengers);
}

function rowReflectsPassengerGivingUpSeats(
  row: BookingItem,
  historyChronological: BookingItem[]
): boolean {
  if (bookingIsCancelledByOwner(row.status)) return false;
  if (bookingHistoryTreatAsCancelledByOwner(row, historyChronological)) return false;

  const rev = (row as BookingItemWithRideHistory).rideHistoryEvent;
  if (rev) {
    if (typeof rev.countsAsPassengerSeatRelease === 'boolean') {
      if (!rev.countsAsPassengerSeatRelease) return false;
      const etCsr = String(rev.eventType ?? '').trim().toLowerCase();
      if (etCsr === 'removed_by_owner' || etCsr === 'cancelled_by_owner' || etCsr === 'owner_removed') {
        return false;
      }
      return true;
    }
    const et = String(rev.eventType ?? '').trim().toLowerCase();
    if (et === 'removed_by_owner' || et === 'cancelled_by_owner' || et === 'owner_removed') return false;
    if (
      et === 'seat_cancelled' ||
      et === 'seats_cancelled' ||
      et === 'seats_reduced' ||
      et === 'partial_cancel' ||
      et === 'partial_seat_cancel' ||
      et === 'passenger_seat_cancel' ||
      et === 'cancel_seats'
    ) {
      return true;
    }
    if (et === 'cancelled' || et === 'passenger_cancelled' || et === 'cancelled_by_passenger') {
      const uid = (row.userId ?? '').trim();
      return uid ? hadPriorAcceptedBookingSnapshot(uid, row, historyChronological) : false;
    }
    return false;
  }

  const st = String(row.status ?? '').trim().toLowerCase();
  if (
    st === 'seats_reduced' ||
    st === 'seat_reduced' ||
    st === 'partial_cancel' ||
    st === 'partial_cancellation' ||
    st === 'seat_cancelled' ||
    st === 'seats_cancelled'
  ) {
    return true;
  }
  if (bookingIsCancelled(row.status)) {
    const uid = (row.userId ?? '').trim();
    return uid ? hadPriorAcceptedBookingSnapshot(uid, row, historyChronological) : true;
  }
  return false;
}

function hadPriorPassengerSeatEvent(h: BookingItem, historyChronological: BookingItem[]): boolean {
  const uid = (h.userId ?? '').trim();
  if (!uid) return false;
  const idxH = historyChronological.indexOf(h);
  const myT = bookingTimelineMs(h);
  for (let i = 0; i < historyChronological.length; i++) {
    const row = historyChronological[i];
    if ((row.userId ?? '').trim() !== uid) continue;
    if (i === idxH) continue;
    const rt = bookingTimelineMs(row);
    const strictlyBefore = rt < myT || (rt === myT && idxH >= 0 && i < idxH);
    if (!strictlyBefore) continue;
    if (rowReflectsPassengerGivingUpSeats(row, historyChronological)) return true;
  }
  return false;
}

function priorRowInPassengerHistory(h: BookingItem, sortedChronological: BookingItem[]): BookingItem | undefined {
  const idx = sortedChronological.indexOf(h);
  if (idx <= 0) return undefined;
  return sortedChronological[idx - 1];
}

/**
 * Some payloads include a current "confirmed N seats" snapshot alongside older history rows.
 * After partial cancels this can create a fake extra "Booked N seats" line (e.g. Booked 1).
 * Suppress that snapshot when:
 * - another accepted snapshot exists with more seats, and
 * - a passenger seat-cancel/cancel event exists at/after this snapshot time.
 */
function shouldSuppressStaleConfirmedSnapshot(
  h: BookingItem,
  historyChronological: BookingItem[]
): boolean {
  const uid = (h.userId ?? '').trim();
  if (!uid) return false;
  const mySeats = bookingSeatCount(h);
  if (mySeats <= 0) return false;
  const myTs = bookingTimelineMs(h);
  let hasAcceptedWithMoreSeats = false;
  let hasCancelAtOrAfter = false;
  for (const row of historyChronological) {
    if (row === h) continue;
    if ((row.userId ?? '').trim() !== uid) continue;
    if (isAcceptedLikeBookingStatus(row.status) && bookingSeatCount(row) > mySeats) {
      hasAcceptedWithMoreSeats = true;
    }
    if (!hasCancelAtOrAfter && rowReflectsPassengerGivingUpSeats(row, historyChronological)) {
      const ts = bookingTimelineMs(row);
      if (ts >= myTs) hasCancelAtOrAfter = true;
    }
    if (hasAcceptedWithMoreSeats && hasCancelAtOrAfter) return true;
  }
  return false;
}

/** Best-effort swatch for free-text vehicle color labels (unknown → neutral grey). */
function vehicleColorLabelToSwatchHex(label: string): string {
  const n = label.trim().toLowerCase();
  if (!n) return '#94a3b8';
  const pairs: [RegExp, string][] = [
    [/midnight|black|nero|schwarz/, '#0f172a'],
    [/white|pearl|ivory|bianco/, '#f1f5f9'],
    [/silver|grey|gray|grigio|grau/, '#94a3b8'],
    [/red|rosso|rubin|crimson/, '#dc2626'],
    [/blue|blu|navy|azul/, '#2563eb'],
    [/green|verde/, '#16a34a'],
    [/yellow|giallo|gold/, '#ca8a04'],
    [/orange|arancio/, '#ea580c'],
    [/brown|marrone|bronze/, '#92400e'],
    [/beige|tan|champagne|cream/, '#d6c4a8'],
    [/purple|viola|violet|plum/, '#7c3aed'],
  ];
  for (const [re, hex] of pairs) {
    if (re.test(n)) return hex;
  }
  return '#94a3b8';
}

/** Prefer active confirmed booking; then any row with seats left (incl. bad cancelled_by_owner+seats); else newest. */
function pickOwnerPrimaryBookingRow(sortedNewestFirst: BookingItem[]): BookingItem | null {
  if (!sortedNewestFirst.length) return null;
  const active = sortedNewestFirst.find((r) => {
    const s = String(r.status ?? '').trim().toLowerCase();
    const seats = bookingSeatCount(r);
    return (s === 'confirmed' || s === 'accepted') && seats > 0 && !bookingIsCancelled(r.status);
  });
  if (active) return active;
  const stillHasSeats = sortedNewestFirst.find((r) => {
    if (bookingSeatCount(r) <= 0) return false;
    return bookingIsCancelledByOwner(r.status);
  });
  if (stillHasSeats) return stillHasSeats;
  return sortedNewestFirst[0];
}

function formatBookingHistoryLineWhen(iso: string): string {
  const t = iso.trim();
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Strip trailing " · {when}" so we can match duplicate Booked/Approved lines from row + ride event. */
function ownerHistoryLineBodyForDedupe(line: string): string {
  const t = line.trim();
  const i = t.lastIndexOf(' · ');
  return i > 0 ? t.slice(0, i).trim() : t;
}

function ownerHistoryLineEligibleForNearDuplicateCollapse(body: string): boolean {
  return (
    /^Booked \d+ seat/.test(body) ||
    /^Rebooked \d+ seat/.test(body) ||
    /^Approved \d+ seat/.test(body) ||
    /^Requested \d+ seat/.test(body)
  );
}

/** Same logical action often appears twice (live row + ride-level event) with slightly different timestamps. */
const OWNER_HISTORY_SAME_ACTION_WINDOW_MS = 120_000;

/** Optional metadata from ride-level `bookingHistory.events[]` (GET /api/rides/:id). */
type BookingItemWithRideHistory = BookingItem & {
  rideHistoryEvent?: {
    eventType: string;
    seatsBefore: number;
    seatsChanged: number;
    seatsAfter: number;
    displayKey?: string;
    displayParams?: { seats?: number; reason?: string };
    countsAsPassengerSeatRelease?: boolean;
    seatConfirmationOrdinal?: number;
    isRebook?: boolean;
  };
};

/**
 * When backend sends `displayKey` / `displayParams` on a timeline event, mirror prior client wording.
 * Returns `null` to fall back to eventType/status heuristics.
 */
function ownerHistoryLineFromBackendDisplayKey(h: BookingItemWithRideHistory, timeSuffix: string): string | null {
  const ev = h.rideHistoryEvent;
  if (!ev) return null;
  const dkRaw = ev.displayKey?.trim().toLowerCase();
  if (!dkRaw) return null;

  const params = ev.displayParams;
  const seatFromParams =
    typeof params?.seats === 'number' && Number.isFinite(params.seats)
      ? Math.max(0, Math.floor(params.seats))
      : undefined;
  const nAfter = Math.max(0, Math.floor(Number(ev.seatsAfter) || 0));
  const nBefore = Math.max(0, Math.floor(Number(ev.seatsBefore) || 0));

  switch (dkRaw) {
    case 'booked':
    case 'rebooked': {
      const seats = seatFromParams ?? (nAfter || nBefore);
      const isRb = dkRaw === 'rebooked' || ev.isRebook === true;
      const verb = isRb ? 'Rebooked' : 'Booked';
      if (seats <= 0) return '';
      return `${verb} ${seatPhrase(seats)}${timeSuffix}`;
    }
    case 'approved': {
      const seats = seatFromParams ?? (nAfter || nBefore);
      if (seats <= 0) return '';
      return `Approved ${seatPhrase(seats)}${timeSuffix}`;
    }
    case 'requested': {
      const seats =
        seatFromParams ??
        (nAfter ||
          nBefore ||
          Math.max(0, Math.floor(Number(ev.seatsChanged) || 0)));
      if (seats <= 0) return '';
      return `Requested ${seatPhrase(seats)}${timeSuffix}`;
    }
    case 'full_cancel_passenger':
      return `Cancelled all seats${timeSuffix}`;
    case 'full_cancel_owner':
      return '';
    case 'full_cancel_system': {
      const r = typeof params?.reason === 'string' ? params.reason.trim() : '';
      return r ? `Cancelled (${r})${timeSuffix}` : `Cancelled all seats${timeSuffix}`;
    }
    case 'request_superseded':
    case 'request_rejected':
    case 'request_expired':
      return '';
    case 'seats_reduced':
    case 'seat_cancelled': {
      const after = nAfter;
      if (after === 0) return `Cancelled all seats${timeSuffix}`;
      const delta = cancelledSeatsFromRideHistoryEvent(ev);
      if (delta > 0) return `Cancelled ${seatPhrase(delta)}${timeSuffix}`;
      return '';
    }
    default:
      return null;
  }
}

/**
 * Owner-facing passenger history: booked / rebooked / partial or full cancel with seat counts;
 * omits owner removals.
 */
function formatOwnerBookingHistoryLineText(
  h: BookingItemWithRideHistory,
  historyChronological: BookingItem[]
): string {
  const ev = h.rideHistoryEvent;
  const when = formatBookingHistoryLineWhen(h.bookedAt ?? '');
  const timeSuffix = when ? ` · ${when}` : '';

  if (ev) {
    const fromBackendKey = ownerHistoryLineFromBackendDisplayKey(h, timeSuffix);
    if (fromBackendKey !== null) return fromBackendKey;

    const et = String(ev.eventType ?? '').trim().toLowerCase();
    if (
      et === 'requested' ||
      et === 'request_created' ||
      et === 'seat_request' ||
      et === 'booking_requested'
    ) {
      const n = Math.max(
        0,
        Math.floor(
          Number(ev.seatsAfter) || Number(ev.seatsBefore) || Number(ev.seatsChanged) || 0
        )
      );
      if (n <= 0) return '';
      return `Requested ${seatPhrase(n)}${timeSuffix}`;
    }
    if (et === 'approved' || et === 'request_approved' || et === 'owner_approved') {
      const n = Math.max(0, Math.floor(Number(ev.seatsAfter) || Number(ev.seatsBefore) || 0));
      if (n <= 0) return '';
      return `Approved ${seatPhrase(n)}${timeSuffix}`;
    }
    if (et === 'booked' || et === 'rebooked' || et === 'booking_created') {
      const n = Math.max(0, Math.floor(Number(ev.seatsAfter) || 0));
      // Same rule as status snapshots: first acceptance after a request is "Booked", not "Rebooked",
      // unless a prior row reflects giving up confirmed seats (hadPriorPassengerSeatEvent).
      const rebooked = hadPriorPassengerSeatEvent(h, historyChronological);
      const verb = rebooked ? 'Rebooked' : 'Booked';
      return `${verb} ${seatPhrase(n)}${timeSuffix}`;
    }
    if (
      et === 'seat_cancelled' ||
      et === 'seats_cancelled' ||
      et === 'seats_reduced' ||
      et === 'partial_cancel' ||
      et === 'partial_seat_cancel' ||
      et === 'passenger_seat_cancel' ||
      et === 'cancel_seats'
    ) {
      const after = Math.max(0, Math.floor(Number(ev.seatsAfter) || 0));
      if (after === 0) {
        return `Cancelled all seats${timeSuffix}`;
      }
      const delta = cancelledSeatsFromRideHistoryEvent(ev);
      if (delta > 0) {
        return `Cancelled ${seatPhrase(delta)}${timeSuffix}`;
      }
      return '';
    }
    if (et === 'removed_by_owner' || et === 'cancelled_by_owner' || et === 'owner_removed') {
      return '';
    }
    if (et === 'cancelled' || et === 'passenger_cancelled' || et === 'cancelled_by_passenger') {
      const after = Math.max(0, Math.floor(Number(ev.seatsAfter) || 0));
      if (after === 0) {
        return `Cancelled all seats${timeSuffix}`;
      }
      const delta = cancelledSeatsFromRideHistoryEvent(ev);
      if (delta > 0) {
        return `Cancelled ${seatPhrase(delta)}${timeSuffix}`;
      }
      return `Cancelled all seats${timeSuffix}`;
    }
    return '';
  }

  if (bookingHistoryTreatAsCancelledByOwner(h, historyChronological)) return '';
  if (bookingIsCancelledByOwner(h.status)) return '';

  const st = String(h.status ?? '').trim().toLowerCase();
  if (bookingIsCancelled(h.status)) {
    return `Cancelled all seats${timeSuffix}`;
  }
  if (
    st === 'seats_reduced' ||
    st === 'seat_reduced' ||
    st === 'partial_cancel' ||
    st === 'partial_cancellation' ||
    st === 'seat_cancelled' ||
    st === 'seats_cancelled'
  ) {
    const prev = priorRowInPassengerHistory(h, historyChronological);
    const after = bookingSeatCount(h);
    if (!prev) return '';
    const before = bookingSeatCount(prev);
    const delta = before - after;
    if (after === 0 && before > 0) {
      return `Cancelled all seats${timeSuffix}`;
    }
    if (delta > 0) {
      return `Cancelled ${seatPhrase(delta)}${timeSuffix}`;
    }
    return '';
  }
  if (st === 'confirmed' || st === 'accepted' || st === 'completed') {
    if (shouldSuppressStaleConfirmedSnapshot(h, historyChronological)) return '';
    const n = bookingSeatCount(h);
    const verb = hadPriorPassengerSeatEvent(h, historyChronological) ? 'Rebooked' : 'Booked';
    return `${verb} ${seatPhrase(n)}${timeSuffix}`;
  }
  if (
    st === 'pending' ||
    st === 'requested' ||
    st === 'request_pending' ||
    st === 'awaiting_approval'
  ) {
    const n = bookingSeatCount(h);
    if (n <= 0) return '';
    return `Requested ${seatPhrase(n)}${timeSuffix}`;
  }
  return '';
}

/**
 * Merges optional `bookingHistory[]` from API into timeline rows (same userId).
 * Use when backend keeps one active booking but returns past seat snapshots.
 */
function expandPassengerHistoryFromBookingRows(list: BookingItem[]): BookingItem[] {
  const byId = new Map<string, BookingItem>();
  for (const row of list) {
    const rowKey = (row.id ?? '').trim() || `${row.userId}|${row.bookedAt}`;
    if (!byId.has(rowKey)) byId.set(rowKey, row);
    const bh = (row as BookingItem & { bookingHistory?: NonNullable<RideListItem['bookings']>[number]['bookingHistory'] })
      .bookingHistory;
    if (!Array.isArray(bh) || bh.length === 0) continue;
    for (let i = 0; i < bh.length; i++) {
      const ev = bh[i];
      const id = (ev.id?.trim() || `bh-${(row.id ?? 'row').trim()}-${i}`).trim();
      if (byId.has(id)) continue;
      // Keep unknown snapshot status non-confirmed to avoid request rows leaking into passenger logic.
      const st = String(ev.status ?? 'pending').trim().toLowerCase() || 'pending';
      const seats =
        typeof ev.seats === 'number' && Number.isFinite(ev.seats) ? Math.max(0, Math.floor(ev.seats)) : 0;
      const synthetic: BookingItem = {
        id,
        userId: row.userId,
        userName: row.userName,
        ...(row.name ? { name: row.name } : {}),
        seats,
        status: st,
        bookedAt: ev.bookedAt?.trim() || row.bookedAt,
        ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
      };
      byId.set(id, synthetic);
    }
  }
  return [...byId.values()];
}

function numFieldLoose(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function userIdsMatchBookingHistory(a: string, b: string): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.toLowerCase() === y.toLowerCase()) return true;
  const nx = x.replace(/[^a-fA-F0-9]/g, '');
  const ny = y.replace(/[^a-fA-F0-9]/g, '');
  if (nx.length >= 12 && ny.length >= 12 && (nx === ny || nx.endsWith(ny) || ny.endsWith(nx))) return true;
  return false;
}

/** Find grouped `bookingHistory` for a passenger (bookings[].userId vs API group userId may differ slightly). */
function findBookingHistoryGroupForUser(
  groups: RideBookingHistoryUserGroup[] | undefined,
  userId: string
): RideBookingHistoryUserGroup | undefined {
  if (!groups?.length) return undefined;
  const u = (userId ?? '').trim();
  return groups.find((g) => userIdsMatchBookingHistory(g.userId, u));
}

/**
 * Parses ride-level `bookingHistory` from GET /api/rides/:id.
 * Supports: `{ userId, events[] }[]`, or a flat `events[]` with `userId` on each row, and several nesting paths.
 */
function parseRideBookingHistoryFromApi(
  resRoot: Record<string, unknown>,
  candidate: Record<string, unknown>
): RideBookingHistoryUserGroup[] {
  const dataObj =
    resRoot.data && typeof resRoot.data === 'object' ? (resRoot.data as Record<string, unknown>) : undefined;
  const rideNested =
    dataObj?.ride && typeof dataObj.ride === 'object' ? (dataObj.ride as Record<string, unknown>) : undefined;
  const raw =
    resRoot.bookingHistory ??
    resRoot.booking_history ??
    (resRoot.ride && typeof resRoot.ride === 'object'
      ? (resRoot.ride as Record<string, unknown>).bookingHistory ??
        (resRoot.ride as Record<string, unknown>).booking_history
      : undefined) ??
    dataObj?.bookingHistory ??
    dataObj?.booking_history ??
    rideNested?.bookingHistory ??
    rideNested?.booking_history ??
    (dataObj?.ride && typeof dataObj.ride === 'object'
      ? ((dataObj.ride as Record<string, unknown>).bookingHistory ??
        (dataObj.ride as Record<string, unknown>).booking_history)
      : undefined) ??
    candidate.bookingHistory ??
    candidate.booking_history;

  if (!Array.isArray(raw) || raw.length === 0) return [];

  const mapEventRow = (e: Record<string, unknown>, userId: string, index: number): RideBookingHistoryEvent | null => {
    const id = String(e.id ?? e._id ?? `ev-${userId}-${index}`).trim();
    const eventType = String(e.eventType ?? e.event_type ?? e.type ?? '').trim() || 'unknown';
    const createdAt = String(e.createdAt ?? e.created_at ?? e.timestamp ?? '').trim();
    const displayKeyRaw = e.displayKey ?? e.display_key;
    const displayKey =
      typeof displayKeyRaw === 'string' && displayKeyRaw.trim() ? displayKeyRaw.trim() : undefined;
    const dpRaw = e.displayParams ?? e.display_params;
    let displayParams: { seats?: number; reason?: string } | undefined;
    if (dpRaw && typeof dpRaw === 'object' && !Array.isArray(dpRaw)) {
      const dp = dpRaw as Record<string, unknown>;
      const sn = dp.seats;
      const rs = dp.reason;
      displayParams = {
        ...(typeof sn === 'number' && Number.isFinite(sn) ? { seats: Math.max(0, Math.floor(sn)) } : {}),
        ...(typeof rs === 'string' && rs.trim() ? { reason: rs.trim() } : {}),
      };
      if (Object.keys(displayParams).length === 0) displayParams = undefined;
    }
    const csrRaw = e.countsAsPassengerSeatRelease ?? e.counts_as_passenger_seat_release;
    const countsAsPassengerSeatRelease = typeof csrRaw === 'boolean' ? csrRaw : undefined;
    const ordRaw = e.seatConfirmationOrdinal ?? e.seat_confirmation_ordinal;
    const seatConfirmationOrdinal =
      typeof ordRaw === 'number' && Number.isFinite(ordRaw) ? Math.floor(ordRaw) : undefined;
    const irRaw = e.isRebook ?? e.is_rebook;
    const isRebook = typeof irRaw === 'boolean' ? irRaw : undefined;

    return {
      id,
      eventType,
      seatsBefore: numFieldLoose(e.seatsBefore ?? e.seats_before),
      seatsChanged: numFieldLoose(e.seatsChanged ?? e.seats_changed),
      seatsAfter: numFieldLoose(e.seatsAfter ?? e.seats_after),
      createdAt,
      ...(displayKey ? { displayKey } : {}),
      ...(displayParams ? { displayParams } : {}),
      ...(countsAsPassengerSeatRelease !== undefined ? { countsAsPassengerSeatRelease } : {}),
      ...(seatConfirmationOrdinal !== undefined ? { seatConfirmationOrdinal } : {}),
      ...(isRebook !== undefined ? { isRebook } : {}),
    };
  };

  const first = raw[0];
  if (first && typeof first === 'object') {
    const fr = first as Record<string, unknown>;
    const hasGroupedShape = Array.isArray(fr.events);
    const hasFlatEventShape =
      (fr.userId != null || fr.user_id != null) &&
      (fr.eventType != null || fr.event_type != null || fr.type != null);
    if (!hasGroupedShape && hasFlatEventShape) {
      const byUser = new Map<string, RideBookingHistoryEvent[]>();
      for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const uid = String(rec.userId ?? rec.user_id ?? '').trim();
        if (!uid) continue;
        const ev = mapEventRow(rec, uid, i);
        if (!ev) continue;
        const list = byUser.get(uid) ?? [];
        list.push(ev);
        byUser.set(uid, list);
      }
      return [...byUser.entries()].map(([userId, events]) => ({ userId, events }));
    }
  }

  const out: RideBookingHistoryUserGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const userId = String(rec.userId ?? rec.user_id ?? '').trim();
    const eventsRaw =
      rec.events ??
      rec.booking_events ??
      (rec as { bookingEvents?: unknown }).bookingEvents;
    if (!userId || !Array.isArray(eventsRaw)) continue;
    const events: RideBookingHistoryEvent[] = [];
    for (let i = 0; i < eventsRaw.length; i++) {
      const ev = eventsRaw[i];
      if (!ev || typeof ev !== 'object') continue;
      const row = mapEventRow(ev as Record<string, unknown>, userId, i);
      if (row) events.push(row);
    }
    if (events.length > 0) out.push({ userId, events });
  }
  return out;
}

function parseBookingHistoryMetaFromApi(
  resRoot: Record<string, unknown>,
  candidate: Record<string, unknown>
): RideListItem['bookingHistoryMeta'] {
  const dataObj =
    resRoot.data && typeof resRoot.data === 'object' ? (resRoot.data as Record<string, unknown>) : undefined;
  const rideNested =
    dataObj?.ride && typeof dataObj.ride === 'object' ? (dataObj.ride as Record<string, unknown>) : undefined;
  const raw =
    candidate.bookingHistoryMeta ??
    candidate.booking_history_meta ??
    resRoot.bookingHistoryMeta ??
    resRoot.booking_history_meta ??
    dataObj?.bookingHistoryMeta ??
    dataObj?.booking_history_meta ??
    rideNested?.bookingHistoryMeta ??
    rideNested?.booking_history_meta;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const source = typeof r.source === 'string' ? r.source.trim() : undefined;
  const orderedBy =
    typeof r.orderedBy === 'string'
      ? r.orderedBy.trim()
      : typeof r.ordered_by === 'string'
        ? r.ordered_by.trim()
        : undefined;
  const deduplication =
    typeof r.deduplication === 'string'
      ? r.deduplication.trim()
      : typeof r.deduplicationPolicy === 'string'
        ? r.deduplicationPolicy.trim()
        : typeof r.deduplication_policy === 'string'
          ? r.deduplication_policy.trim()
          : undefined;
  const sarf = r.serverAuthoredFields ?? r.server_authored_fields;
  const serverAuthoredFields = Array.isArray(sarf)
    ? sarf.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : undefined;
  if (!source && !orderedBy && !deduplication && !serverAuthoredFields?.length) return undefined;
  return {
    ...(source ? { source } : {}),
    ...(orderedBy ? { orderedBy } : {}),
    ...(deduplication ? { deduplication } : {}),
    ...(serverAuthoredFields?.length ? { serverAuthoredFields } : {}),
  };
}

/** When true, `rideBookingHistory` is server-deduped — do not merge embedded `bookings[].bookingHistory` snapshots into the owner timeline. */
function rideUsesServerCanonicalBookingHistory(meta: RideListItem['bookingHistoryMeta']): boolean {
  if (!meta) return false;
  if (String(meta.deduplication ?? '').trim().length > 0) return true;
  if (Array.isArray(meta.serverAuthoredFields) && meta.serverAuthoredFields.length > 0) return true;
  const src = String(meta.source ?? '').trim().toLowerCase();
  return src === 'server' || src === 'canonical' || src === 'timeline';
}

function eventTypeToSyntheticBookingStatus(eventType: string): string {
  const t = String(eventType ?? '').trim().toLowerCase();
  if (t === 'booked' || t === 'rebooked' || t === 'booking_created') return 'confirmed';
  if (
    t === 'requested' ||
    t === 'request_created' ||
    t === 'seat_request' ||
    t === 'booking_requested'
  ) {
    return 'pending';
  }
  if (t === 'approved' || t === 'request_approved' || t === 'owner_approved') return 'confirmed';
  if (
    t === 'seat_cancelled' ||
    t === 'seats_cancelled' ||
    t === 'seats_reduced' ||
    t === 'partial_cancel' ||
    t === 'partial_seat_cancel' ||
    t === 'passenger_seat_cancel' ||
    t === 'cancel_seats'
  ) {
    return 'seats_reduced';
  }
  if (t === 'removed_by_owner' || t === 'cancelled_by_owner' || t === 'owner_removed') {
    return 'cancelled_by_owner';
  }
  if (t === 'cancelled' || t === 'passenger_cancelled' || t === 'cancelled_by_passenger') return 'cancelled';
  // Unknown event types must not synthesize "confirmed" — that incorrectly puts request-only users on the owner Passengers list.
  return t || 'pending';
}

/**
 * Rows under “Booking history” for an owner passenger.
 * `historyChronological` already merges `bookings[]`, embedded `bookingHistory[]`, and ride-level
 * `bookingHistory` events in `mergeRideLevelBookingHistoryIntoTimeline`. Do not replace that
 * timeline with API-only rows — that dropped earlier “Booked N” when the API sent a partial list.
 */
function buildOwnerHistoryDisplayRows(
  _uidForHist: string,
  _primary: BookingItem,
  historyChronological: BookingItem[],
  _rideGroups: RideBookingHistoryUserGroup[] | undefined
): BookingItemWithRideHistory[] {
  return historyChronological as BookingItemWithRideHistory[];
}

/** Merges ride-level owner timeline events into the same chronological list as booking rows. */
function mergeRideLevelBookingHistoryIntoTimeline(
  userId: string,
  list: BookingItem[],
  primary: BookingItem,
  rideGroups: RideBookingHistoryUserGroup[] | undefined,
  serverCanonicalTimeline: boolean
): BookingItem[] {
  const merged = serverCanonicalTimeline ? [...list] : expandPassengerHistoryFromBookingRows(list);
  const byId = new Map<string, BookingItem>();
  for (const row of merged) {
    const k = (row.id ?? '').trim() || `${row.userId}|${row.bookedAt}`;
    if (!byId.has(k)) byId.set(k, row);
  }
  const group = findBookingHistoryGroupForUser(rideGroups, userId);
  if (!group?.events?.length) return [...byId.values()];
  for (let i = 0; i < group.events.length; i++) {
    const ev = group.events[i];
    const eid =
      String(ev.id ?? '').trim() ||
      `idx-${i}-${ev.createdAt ?? ''}-${ev.eventType ?? ''}-${ev.seatsAfter ?? ''}`;
    const rid = `ride-hist-${(userId ?? '').trim()}-${eid}`;
    if (byId.has(rid)) continue;
    const synthetic: BookingItemWithRideHistory = {
      id: rid,
      userId,
      userName: primary.userName,
      ...(primary.name ? { name: primary.name } : {}),
      seats: Math.max(0, Math.floor(ev.seatsAfter ?? 0)),
      status: eventTypeToSyntheticBookingStatus(ev.eventType),
      bookedAt: ev.createdAt || primary.bookedAt,
      ...(primary.avatarUrl ? { avatarUrl: primary.avatarUrl } : {}),
      rideHistoryEvent: {
        eventType: ev.eventType,
        seatsBefore: ev.seatsBefore,
        seatsChanged: ev.seatsChanged,
        seatsAfter: ev.seatsAfter,
        ...(ev.displayKey ? { displayKey: ev.displayKey } : {}),
        ...(ev.displayParams ? { displayParams: ev.displayParams } : {}),
        ...(ev.countsAsPassengerSeatRelease !== undefined
          ? { countsAsPassengerSeatRelease: ev.countsAsPassengerSeatRelease }
          : {}),
        ...(ev.seatConfirmationOrdinal !== undefined
          ? { seatConfirmationOrdinal: ev.seatConfirmationOrdinal }
          : {}),
        ...(ev.isRebook !== undefined ? { isRebook: ev.isRebook } : {}),
      },
    };
    byId.set(rid, synthetic);
  }
  return [...byId.values()];
}

function rideDetailNumericField(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** True when ride payload still indicates people have booked seats (GET /rides/:id for guests often omits `bookings[]`). */
function rideDetailImpliesPassengersBooked(
  candidate: Record<string, unknown>,
  prevRide: RideListItem
): boolean {
  const bookedSeats =
    rideDetailNumericField(candidate.bookedSeats) ?? rideDetailNumericField(candidate.booked_seats);
  const totalBk =
    rideDetailNumericField(candidate.totalBookings) ?? rideDetailNumericField(candidate.total_bookings);
  const seatsTotal = rideDetailNumericField(candidate.seats) ?? prevRide.seats;
  const avail =
    rideDetailNumericField(candidate.availableSeats ?? candidate.seats_available ?? candidate.seatsAvailable) ??
    prevRide.availableSeats;
  const impliedOccupied =
    typeof seatsTotal === 'number' && typeof avail === 'number'
      ? Math.max(0, seatsTotal - avail)
      : undefined;
  return (
    (typeof bookedSeats === 'number' && bookedSeats > 0) ||
    (typeof totalBk === 'number' && totalBk > 0) ||
    (typeof impliedOccupied === 'number' && impliedOccupied > 0)
  );
}

/** In-session cache: last non-empty booking rows seen for a ride (e.g. after viewer logs out, guest GET strips `bookings`). */
const rideDetailGuestBookingsCache = new Map<string, BookingItem[]>();

function mergeGuestRideBookingsWhenApiOmitsList(args: {
  listFromApi: BookingItem[];
  viewerUserId: string;
  rideId: string;
  routeInitialBookings: BookingItem[] | undefined;
  prevPassengers: BookingItem[];
  prevRide: RideListItem;
  candidate: Record<string, unknown>;
}): BookingItem[] {
  const { listFromApi, viewerUserId, rideId, routeInitialBookings, prevPassengers, prevRide, candidate } =
    args;
  if (viewerUserId.trim() || listFromApi.length > 0) return listFromApi;

  if (Array.isArray(routeInitialBookings) && routeInitialBookings.length > 0) {
    return routeInitialBookings;
  }

  const impliesPassengers = rideDetailImpliesPassengersBooked(candidate, prevRide);
  if (impliesPassengers && prevPassengers.length > 0) {
    return prevPassengers;
  }
  if (impliesPassengers) {
    const cached = rideDetailGuestBookingsCache.get(rideId);
    if (cached && cached.length > 0) return cached;
  }
  return listFromApi;
}

export default function RideDetailScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const route = useRoute<RideDetailRouteProp>();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const fullRideBlockAlertShownRef = useRef(false);
  const { user, isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  /** Latest backend user id (Mongo) for post–guest-sheet book; Auth updates after POST /auth/firebase. */
  const authUserIdRef = useRef((user?.id ?? '').trim());
  authUserIdRef.current = (user?.id ?? '').trim();
  const { ride: initialRide, passengerSearch } = route.params;
  const activeDetailRideIdRef = useRef(initialRide.id);
  activeDetailRideIdRef.current = initialRide.id;
  const [ride, setRide] = useState<RideListItem>(() => mergeVehicleFieldsIntoRide(initialRide));
  const [cancelling, setCancelling] = useState(false);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [booking, setBooking] = useState(false);
  const [passengers, setPassengers] = useState<BookingItem[]>(initialRide.bookings ?? []);
  const passengersRef = useRef(passengers);
  const rideSnapshotRef = useRef(ride);
  passengersRef.current = passengers;
  rideSnapshotRef.current = ride;
  /** First GET /rides/:id for this screen has finished (success or failure). Gates alerts that need server truth. */
  const [detailFresh, setDetailFresh] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editSheetExpanded, setEditSheetExpanded] = useState(false);
  const editHalfHeight = Math.max(430, Math.round(windowHeight * 0.68));
  const editFullHeight = Math.max(editHalfHeight, Math.round(windowHeight * 0.94));
  const editSheetSlideY = useRef(new Animated.Value(windowHeight)).current;
  const [editPickup, setEditPickup] = useState('');
  const [editDestination, setEditDestination] = useState('');
  const [editPassengers, setEditPassengers] = useState(1);
  const [editDate, setEditDate] = useState<Date | null>(null);
  const [editTimeHour, setEditTimeHour] = useState(9);
  const [editTimeMinute, setEditTimeMinute] = useState(0);
  const [showEditDateModal, setShowEditDateModal] = useState(false);
  const [showEditPassengersModal, setShowEditPassengersModal] = useState(false);
  const [showEditTimeModal, setShowEditTimeModal] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingReview, setRatingReview] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const ratingBehaviorCheckpoints = ['Safe driving', 'Punctual', 'Polite', 'Clean vehicle'];
  const ratingExperienceCheckpoints = useMemo(() => {
    if (ratingStars >= 5) return ['Outstanding', 'Excellent ride', 'Highly recommended'];
    if (ratingStars === 4) return ['Good driving experience', 'Comfortable ride', 'Smooth route'];
    if (ratingStars === 3) return ['Average experience', 'Can improve timing', 'Okay overall'];
    if (ratingStars === 2) return ['Needs improvement', 'Driving can be smoother', 'Better communication needed'];
    if (ratingStars === 1) return ['Poor experience', 'Very late', 'Unsafe behavior'];
    return [];
  }, [ratingStars]);
  const addRatingCheckpoint = useCallback(
    (label: string) => {
      if (ratingSubmitting || ratingSubmitted) return;
      const nextLabel = label.trim();
      if (!nextLabel) return;
      const tokens = ratingReview
        .split('•')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.some((t) => t.toLowerCase() === nextLabel.toLowerCase())) return;
      const next = [...tokens, nextLabel].join(' • ');
      setRatingReview(next);
    },
    [ratingReview, ratingSubmitting, ratingSubmitted]
  );
  /** Passenger booking: number of seats to request (capped by fresh getRideAvailableSeats). */
  const [bookSeatsCount, setBookSeatsCount] = useState(1);
  const [seatRequests, setSeatRequests] = useState<BookingItem[]>([]);
  const [seatRequestsLoading, setSeatRequestsLoading] = useState(false);
  const [seatRequestActionBookingId, setSeatRequestActionBookingId] = useState<string | null>(null);
  const [openingSeatRequestDetailId, setOpeningSeatRequestDetailId] = useState<string | null>(null);
  const autoRejectPendingInFlightRef = useRef(false);
  const ratingCheckKeyRef = useRef<string | null>(null);
  const viewerBookingNoticeToastKeyRef = useRef<string | null>(null);

  const [cancelBookingSheetVisible, setCancelBookingSheetVisible] = useState(false);
  const [cancelBookingBid, setCancelBookingBid] = useState<string | null>(null);
  const [cancelBookingMaxSeats, setCancelBookingMaxSeats] = useState(1);
  const [cancelBookingSeatsToCancel, setCancelBookingSeatsToCancel] = useState(1);
  const [cancelBookingSheetMode, setCancelBookingSheetMode] = useState<
    'booking' | 'request' | 'owner_remove'
  >('booking');
  const [ownerRemovePassengerLabel, setOwnerRemovePassengerLabel] = useState('');
  const [guestLoginSheetVisible, setGuestLoginSheetVisible] = useState(false);
  const [cancelRideConfirmVisible, setCancelRideConfirmVisible] = useState(false);
  const [passengerBookedRidesForOverlap, setPassengerBookedRidesForOverlap] = useState<RideListItem[]>(
    []
  );
  const [expandedPassengerHistoryIds, setExpandedPassengerHistoryIds] = useState<Set<string>>(new Set());
  const detailRefreshInFlightRef = useRef<Promise<RideListItem | null> | null>(null);

  const currentUserId = (user?.id ?? '').trim();
  const currentUserName = (user?.name ?? '').trim();
  const myPassengerBooking = pickPreferredBookingForUser(passengers, currentUserId);
  const mergedBookingStatus = ride.myBookingStatus;
  const normalizedMergedBookingStatus = String(mergedBookingStatus ?? '').trim().toLowerCase();
  const hasMergedConfirmedBooking =
    mergedBookingStatus != null &&
    normalizedMergedBookingStatus !== '' &&
    !bookingIsCancelled(mergedBookingStatus) &&
    !isPendingLikeBookingStatus(normalizedMergedBookingStatus) &&
    normalizedMergedBookingStatus !== 'rejected';
  const myBookingStatusNormalized = String(
    myPassengerBooking?.status ?? mergedBookingStatus ?? ''
  ).trim().toLowerCase();
  const isMyBookingPending =
    myBookingStatusNormalized === 'pending' ||
    myBookingStatusNormalized === 'requested' ||
    myBookingStatusNormalized === 'request_pending' ||
    myBookingStatusNormalized === 'awaiting_approval';
  const isMyBookingRejected = myBookingStatusNormalized === 'rejected';
  /** Include merged list status so we’re not “not booked” before detail bookings[] loads. Pending is handled separately. */
  const isBookedByMe = Boolean(
    (myPassengerBooking &&
      !bookingIsCancelled(myPassengerBooking.status) &&
      !isPendingLikeBookingStatus(String(myPassengerBooking.status ?? '').trim().toLowerCase()) &&
      String(myPassengerBooking.status ?? '').trim().toLowerCase() !== 'rejected') ||
      hasMergedConfirmedBooking
  );
  const userHasPassengerBookingRow = passengers.some(
    (b) => (b.userId ?? '').trim() === currentUserId
  );
  /** Driver vs passenger for labels, chat, passenger list (may use id fallback when API omits `viewerIsOwner`). */
  const isOwner = isViewerRidePublisher(ride, currentUserId, {
    hasActivePassengerBooking: isBookedByMe,
    hasPassengerBookingRowForUser: userHasPassengerBookingRow,
  });
  /** Edit / Cancel ride — API flag only (isViewerOwnerStrict); never infer from userId. */
  const isOwnerStrict = isViewerOwnerStrict(ride);
  /** Re-book creates a second row; stale `ride.myBookingStatus` may still say cancelled — don't treat as cancelled if we're actively booked. */
  const isMyBookingCancelled =
    !isBookedByMe &&
    (bookingIsCancelled(ride.myBookingStatus) ||
      passengers.some(
        (b) =>
          (b.userId ?? '').trim() === currentUserId && bookingIsCancelled(b.status)
      ));
  const rideIsCompleted = String(ride.status ?? '').trim().toLowerCase() === 'completed';
  const isPastRide = rideIsCompleted || isRidePastArrivalWindow(ride);
  const bookDisabledByViewerActiveBooking =
    !isOwnerStrict &&
    currentUserId.length > 0 &&
    rideHasActivePassengerBookingForUser(ride, currentUserId);
  const overlappingPassengerRide = useMemo(
    () =>
      currentUserId && !isOwnerStrict
        ? findOverlappingPassengerBookingRide({
            candidate: ride,
            bookedRides: passengerBookedRidesForOverlap,
            userId: currentUserId,
          })
        : null,
    [ride, passengerBookedRidesForOverlap, currentUserId, isOwnerStrict]
  );
  const alreadyBookedThisRideFromBookedList = useMemo(() => {
    if (!currentUserId || isOwnerStrict) return false;
    const row = passengerBookedRidesForOverlap.find(
      (r) => (r.id ?? '').trim() === (ride.id ?? '').trim()
    );
    return Boolean(row && rideHasActivePassengerBookingForUser(row, currentUserId));
  }, [passengerBookedRidesForOverlap, ride.id, currentUserId, isOwnerStrict]);
  const bookButtonBlocked =
    bookDisabledByViewerActiveBooking ||
    alreadyBookedThisRideFromBookedList ||
    Boolean(overlappingPassengerRide);
  /** Cancelled rides may still be “upcoming” by time — hide edit/cancel anyway. */
  const isOwnerRideCancelled = isOwnerStrict && isRideCancelledByOwner(ride);
  const bookingModeSource = ride as RideListItem & {
    bookingMode?: string;
    booking_mode?: string;
    instantBooking?: boolean;
    instant_booking?: boolean;
  };
  const bookingModeRaw = String(
    bookingModeSource.bookingMode ??
      bookingModeSource.booking_mode ??
      (
        bookingModeSource.instantBooking === false || bookingModeSource.instant_booking === false
          ? 'request'
          : 'instant'
      )
  ).trim().toLowerCase();
  const isRequestBookingMode = bookingModeRaw === 'request';
  const isOwnerRef = useRef(isOwner);
  const isRequestBookingModeRef = useRef(isRequestBookingMode);
  isOwnerRef.current = isOwner;
  isRequestBookingModeRef.current = isRequestBookingMode;

  /** Whole ride pulled by driver — passenger UI must not imply *they* cancelled or offer re-book. */
  const rideCancelledByOwner = isRideCancelledByOwner(ride);
  const availableSeatsCount = getRideAvailableSeats(ride);
  /** Driver removed this passenger from the booking — they must not re-book this ride. */
  const passengerRemovedByOwner =
    !isOwner &&
    (bookingIsCancelledByOwner(ride.myBookingStatus) ||
      passengers.some(
        (b) => (b.userId ?? '').trim() === currentUserId && bookingIsCancelledByOwner(b.status)
      ));
  const showOwnerFixedActions = isOwnerStrict && !isPastRide && !isOwnerRideCancelled;
  const showPassengerCancelFixedAction =
    !isOwner && isBookedByMe && !isPastRide && !rideCancelledByOwner;
  const showPassengerPendingFixedAction =
    !isOwner && isMyBookingPending && !isPastRide && !rideCancelledByOwner;
  const showPassengerRejectedFixedAction =
    !isOwner && isMyBookingRejected && !isPastRide && !rideCancelledByOwner;
  const showPassengerBookFixedAction =
    !isOwner &&
    !isPastRide &&
    !rideCancelledByOwner &&
    !isBookedByMe &&
    !isMyBookingPending &&
    !isMyBookingRejected &&
    !passengerRemovedByOwner &&
    availableSeatsCount > 0;
  const showOwnerPastRepublishFixedAction = isOwnerStrict && (isPastRide || isOwnerRideCancelled);
  const showFixedActionFooter =
    showOwnerFixedActions ||
    showOwnerPastRepublishFixedAction ||
    showPassengerCancelFixedAction ||
    showPassengerPendingFixedAction ||
    showPassengerRejectedFixedAction ||
    showPassengerBookFixedAction;
  const passengerSelfCancelledBooking =
    isMyBookingCancelled && !rideCancelledByOwner && !passengerRemovedByOwner;

  const pendingSeatRequests = seatRequests.filter((b) => {
    const flagged = bookingFlag(b, 'isPendingRequest');
    if (flagged !== undefined) return flagged;
    return isPendingLikeBookingStatus(b.status);
  });
  const ownerPendingRequestCountForDisplay = Math.max(
    0,
    Math.floor(
      Number(
        ride.pendingRequestCount ??
          ride.pending_request_count ??
          ride.pendingRequests ??
          pendingSeatRequests.length
      ) || 0
    )
  );
  const confirmedPassengers = passengers.filter((b) => {
    const flaggedAccepted = bookingFlag(b, 'isAcceptedPassenger');
    if (flaggedAccepted !== undefined) {
      if (!flaggedAccepted) return false;
      return bookingRowHoldsOccupiedSeats(b);
    }
    const s = String(b.status ?? '').trim().toLowerCase();
    if (isPendingLikeBookingStatus(s) || s === 'rejected') return false;
    return bookingRowHoldsOccupiedSeats(b);
  });
  /** Display list: one entry per passenger user when userId is present (prevents cancel+rebook duplicate rows). */
  const passengersForDisplay: BookingItem[] = (() => {
    const byUser = new Map<string, BookingItem>();
    const out: BookingItem[] = [];
    for (const p of passengers) {
      const uid = (p.userId ?? '').trim();
      if (!uid) {
        out.push(p);
        continue;
      }
      const prev = byUser.get(uid);
      if (!prev) {
        byUser.set(uid, p);
        continue;
      }
      const prevHold = bookingRowHoldsOccupiedSeats(prev);
      const nextHold = bookingRowHoldsOccupiedSeats(p);
      if (!prevHold && nextHold) {
        byUser.set(uid, p);
        continue;
      }
      if (prevHold && !nextHold) continue;
      const prevCancelled = bookingIsCancelled(prev.status);
      const nextCancelled = bookingIsCancelled(p.status);
      // Prefer active booking row over cancelled for the same passenger.
      if (prevCancelled && !nextCancelled) byUser.set(uid, p);
    }
    return [...out, ...byUser.values()];
  })();
  const passengersForDisplayFiltered = passengersForDisplay.filter((p) => {
    const status = String(p.status ?? '').trim().toLowerCase();
    if (isOwner) {
      // Owner list: confirmed/accepted or partial owner-remove rows that still hold seats.
      return bookingRowHoldsOccupiedSeats(p) && !isPendingLikeBookingStatus(status) && status !== 'rejected';
    }
    // Co-passenger list should show only active passengers (never cancelled rows).
    return !bookingIsCancelled(p.status) && !isPendingLikeBookingStatus(status) && status !== 'rejected';
  });

  const rideBookingHistoryGroups = ride.rideBookingHistory;

  /** All booking rows per passenger (re-book / cancel / partial owner-remove) for primary row + chronological history. */
  const perUserPassengerSummaries = useMemo(() => {
    const serverCanonTimeline = rideUsesServerCanonicalBookingHistory(ride.bookingHistoryMeta);
    const byUser = new Map<string, BookingItem[]>();
    const noUserId: BookingItem[] = [];
    for (const p of passengers) {
      const uid = (p.userId ?? '').trim();
      if (!uid) {
        noUserId.push(p);
        continue;
      }
      const list = byUser.get(uid) ?? [];
      list.push(p);
      byUser.set(uid, list);
    }
    const summaries: Array<{
      userId: string;
      primary: BookingItem;
      historyChronological: BookingItem[];
    }> = [];
    for (const [uid, list] of byUser) {
      const newestFirst = [...list].sort((a, b) => bookingTimelineMs(b) - bookingTimelineMs(a));
      const backendRemovablePrimary = newestFirst.find(
        (row) => bookingFlag(row, 'canOwnerRemove') === true
      );
      const primary = backendRemovablePrimary ?? pickOwnerPrimaryBookingRow(newestFirst);
      if (!primary) continue;
      const mergedTimeline = mergeRideLevelBookingHistoryIntoTimeline(
        uid,
        list,
        primary,
        rideBookingHistoryGroups,
        serverCanonTimeline
      );
      const historyChronological = [...mergedTimeline].sort((a, b) => bookingTimelineMs(a) - bookingTimelineMs(b));
      summaries.push({ userId: uid, primary, historyChronological });
    }
    for (const orphan of noUserId) {
      const mergedTimeline = mergeRideLevelBookingHistoryIntoTimeline(
        '',
        [orphan],
        orphan,
        rideBookingHistoryGroups,
        serverCanonTimeline
      );
      const historyChronological = [...mergedTimeline].sort((a, b) => bookingTimelineMs(a) - bookingTimelineMs(b));
      summaries.push({
        userId: '',
        primary: orphan,
        historyChronological,
      });
    }
    summaries.sort((a, b) =>
      bookingPassengerDisplayName(a.primary).localeCompare(bookingPassengerDisplayName(b.primary))
    );
    return summaries;
  }, [passengers, rideBookingHistoryGroups, ride.bookingHistoryMeta]);
  const ownerPassengerSummariesForDisplay = useMemo(() => {
    return perUserPassengerSummaries.filter(({ userId, historyChronological, primary }) => {
      if (isRequestBookingMode) {
        return requestModeOwnerPassengerListedFromBackendBookingsOnly(
          passengers,
          userId,
          primary,
          rideBookingHistoryGroups
        );
      }

      // Instant booking / non-request: keep merged-timeline + occupancy rules for audit edge cases.
      if (
        bookingFlag(primary, 'isPendingRequest') === true &&
        bookingFlag(primary, 'isAcceptedPassenger') !== true
      ) {
        return false;
      }
      const primaryStatus = String(primary.status ?? '').trim().toLowerCase();
      if (isPendingLikeBookingStatus(primaryStatus) || primaryStatus === 'rejected') return false;

      if (bookingIsCancelled(primary.status) && !bookingIsCancelledByOwner(primary.status)) return true;

      const uid = (userId ?? '').trim();
      const mine = uid ? passengers.filter((p) => (p.userId ?? '').trim() === uid) : [];
      if (
        mine.some(
          (r) =>
            bookingFlag(r, 'isPendingRequest') === true && bookingFlag(r, 'isAcceptedPassenger') !== true
        ) &&
        !mine.some(
          (r) =>
            bookingFlag(r, 'isAcceptedPassenger') === true ||
            (bookingRowHoldsOccupiedSeats(r) &&
              !isPendingLikeBookingStatus(String(r.status ?? '').trim().toLowerCase()) &&
              String(r.status ?? '').trim().toLowerCase() !== 'rejected')
        )
      ) {
        return false;
      }

      for (const r of mine) {
        if (bookingFlag(r, 'isAcceptedPassenger') === true && bookingSeatCount(r) > 0) return true;
        const rs = String(r.status ?? '').trim().toLowerCase();
        if (bookingRowHoldsOccupiedSeats(r) && !isPendingLikeBookingStatus(rs) && rs !== 'rejected') return true;
      }

      for (const h of historyChronological) {
        if (bookingFlag(h, 'isPendingRequest') === true) continue;
        const s = String(h.status ?? '').trim().toLowerCase();
        if (s === '' || isPendingLikeBookingStatus(s) || s === 'rejected') continue;
        if (bookingSeatCount(h) <= 0) continue;
        if (isAcceptedLikeBookingStatus(s)) return true;
        if (bookingIsCancelledByOwner(h.status)) return true;
        if (
          s === 'seats_reduced' ||
          s === 'seat_reduced' ||
          s === 'partial_cancel' ||
          s === 'partial_cancellation' ||
          s === 'seat_cancelled' ||
          s === 'seats_cancelled'
        ) {
          return true;
        }
      }

      return false;
    });
  }, [perUserPassengerSummaries, passengers, isRequestBookingMode]);

  /** Passenger detail only sees `booking.bookingHistory` on one row — pass merged ride timeline from here. */
  const computeOwnerBookingHistoryLinesForPassenger = useCallback(
    (uidForHist: string, primary: BookingItem, historyChronological: BookingItem[]): string[] => {
      const rows = buildOwnerHistoryDisplayRows(
        uidForHist,
        primary,
        historyChronological,
        rideBookingHistoryGroups
      );
      const sorted = [...rows].sort((a, b) => bookingTimelineMs(a) - bookingTimelineMs(b));
      const lineEntries = sorted
        .map((h) => ({
          line: formatOwnerBookingHistoryLineText(h, sorted),
          timelineMs: bookingTimelineMs(h),
        }))
        .filter((entry) => entry.line.trim().length > 0);
      const serverCanon = rideUsesServerCanonicalBookingHistory(ride.bookingHistoryMeta);
      // 1) Client near-dedupe only when timeline is not server-canonical (avoids double-processing).
      // 2) Exact line+ms dedupe (unchanged).
      const unique: string[] = [];
      const seen = new Set<string>();
      const lastKeptMsByBody = new Map<string, number>();
      for (const entry of lineEntries) {
        const body = ownerHistoryLineBodyForDedupe(entry.line);
        if (
          !serverCanon &&
          ownerHistoryLineEligibleForNearDuplicateCollapse(body)
        ) {
          const prevMs = lastKeptMsByBody.get(body);
          if (
            prevMs !== undefined &&
            Math.abs(entry.timelineMs - prevMs) < OWNER_HISTORY_SAME_ACTION_WINDOW_MS
          ) {
            continue;
          }
          lastKeptMsByBody.set(body, entry.timelineMs);
        }
        const key = `${entry.line}@@${entry.timelineMs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(entry.line);
      }
      return unique;
    },
    [rideBookingHistoryGroups, ride.bookingHistoryMeta]
  );

  const totalBookingsCount = getRideTotalBookingCount(ride);

  const publishedPickupStr = ride.pickupLocationName ?? ride.from ?? 'Pickup';
  const publishedDestStr = ride.destinationLocationName ?? ride.to ?? 'Destination';
  const publisherCoords = useMemo(() => getPublisherRouteCoords(ride), [
    ride.pickupLatitude,
    ride.pickupLongitude,
    ride.destinationLatitude,
    ride.destinationLongitude,
  ]);

  const searchFrom = passengerSearch?.from?.trim() ?? '';
  const searchTo = passengerSearch?.to?.trim() ?? '';
  const bookPu = myPassengerBooking?.pickupLocationName?.trim() ?? '';
  const bookDe = myPassengerBooking?.destinationLocationName?.trim() ?? '';

  /** Non-owner: trip they searched or saved on the booking (may match published ride). */
  const viewerPickupStr = !isOwner
    ? searchFrom || bookPu || publishedPickupStr
    : '';
  const viewerDestStr = !isOwner
    ? searchTo || bookDe || publishedDestStr
    : '';

  /** Only use saved booking stops for route compare when booking is active (not cancelled). */
  const showDualRouteForViewer =
    !isOwner &&
    (isBookedByMe && myPassengerBooking
      ? bookingDiffersFromPublishedRide(ride, myPassengerBooking)
      : viewerTripVersusPublishedDiffers(ride, searchFrom, searchTo));

  /** Single-column route when published-only or viewer trip matches published. */
  const pickupLabel = isOwner ? publishedPickupStr : viewerPickupStr;
  const destinationLabel = isOwner ? publishedDestStr : viewerDestStr;
  const cardDateShort = getRideCardDateShort(ride);
  const pickupTime = getRidePickupTime(ride);
  const driverName = ridePublisherDisplayName(ride);
  const publisherDeactivated = ridePublisherDeactivated(ride);
  const ridePreferenceIdsForDetail = useMemo(() => {
    const r = ride as RideListItem & {
      publisherRidePreferences?: unknown;
      publisher_ride_preferences?: unknown;
      ridePreferences?: unknown;
      ride_preferences?: unknown;
    };
    const candidates = [
      normalizeRidePreferenceIds(r.publisherRidePreferences),
      normalizeRidePreferenceIds(r.publisher_ride_preferences),
      normalizeRidePreferenceIds(r.ridePreferences),
      normalizeRidePreferenceIds(r.ride_preferences),
    ];
    const fromRide = candidates.find((ids) => ids.length > 0) ?? [];
    return fromRide;
  }, [ride]);
  /** Ride API fields + nested `vehicle` / `publisher` (see rideVehicleFields) + owner profile fallback for your rides. */
  const {
    vehicleNameLine,
    vehiclePlateLine,
    vehicleColorLine,
    hasVehicleDetailsForBlock,
    vehicleSubtitle,
  } = useMemo(() => {
    let name = (ride.vehicleModel ?? '').trim();
    let plate = (ride.licensePlate ?? ride.vehicleNumber ?? '').trim();
    let color = (ride.vehicleColor ?? '').trim();
    if (isOwner && user) {
      const list = vehiclesFromUser(user);
      const rideVid = vehicleIdString(ride.vehicleId as unknown);
      if (rideVid) {
        const match = list.find((v) => vehicleIdString(v.id) === rideVid);
        if (match) {
          name = (match.vehicleModel ?? '').trim() || name;
          plate = (match.licensePlate ?? '').trim() || plate;
          color = (match.vehicleColor ?? '').trim() || color;
        }
      } else if (list.length === 1) {
        const only = list[0];
        if (!name && !plate) {
          name = (only.vehicleModel ?? '').trim();
          plate = (only.licensePlate ?? '').trim();
          color = (only.vehicleColor ?? '').trim() || color;
        }
      }
      /** API often omits vehicle text on detail; keep accordion visible. Prefer `vehicleId` match above; else first saved vehicle. */
      if (list.length > 0 && !name.trim() && !plate.trim()) {
        const fb = list[0];
        name = (fb.vehicleModel ?? '').trim() || name;
        plate = (fb.licensePlate ?? '').trim() || plate;
        color = (fb.vehicleColor ?? '').trim() || color;
      }
    }
    const hasBlock = name.length > 0 || plate.length > 0 || color.length > 0;
    const sub = [name || undefined, plate || undefined]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join(' • ');
    return {
      vehicleNameLine: name,
      vehiclePlateLine: plate,
      vehicleColorLine: color,
      hasVehicleDetailsForBlock: hasBlock,
      vehicleSubtitle: sub,
    };
  }, [
    ride.vehicleModel,
    ride.licensePlate,
    ride.vehicleNumber,
    ride.vehicleColor,
    ride.vehicleId,
    isOwner,
    user,
  ]);
  const totalSeats = ride.seats ?? 0;
  const rideDescriptionText = (
    ride.description ??
    ride.rideDescription ??
    ride.ride_description ??
    (ride as RideListItem & { driverNotes?: string; driver_notes?: string; notes?: string }).driverNotes ??
    (ride as RideListItem & { driverNotes?: string; driver_notes?: string; notes?: string }).driver_notes ??
    (ride as RideListItem & { driverNotes?: string; driver_notes?: string; notes?: string }).notes ??
    initialRide.description ??
    initialRide.rideDescription ??
    initialRide.ride_description ??
    (initialRide as RideListItem & { driverNotes?: string; driver_notes?: string; notes?: string }).driverNotes ??
    (initialRide as RideListItem & { driverNotes?: string; driver_notes?: string; notes?: string }).driver_notes ??
    (initialRide as RideListItem & { driverNotes?: string; driver_notes?: string; notes?: string }).notes ??
    ''
  ).trim();
  const bookedSeatsFromRows = confirmedPassengers.reduce(
    (sum, b) => sum + effectiveOccupiedSeatsFromBookingRow(b),
    0
  );
  const bookedSeatsFromBackend = (() => {
    const rawAccepted = (ride as RideListItem & { acceptedSeats?: unknown; accepted_seats?: unknown }).acceptedSeats ??
      (ride as RideListItem & { acceptedSeats?: unknown; accepted_seats?: unknown }).accepted_seats;
    const acceptedNum =
      typeof rawAccepted === 'number' && Number.isFinite(rawAccepted) ? Math.max(0, Math.floor(rawAccepted)) : undefined;
    if (acceptedNum !== undefined) return acceptedNum;
    const rawBooked = (ride as RideListItem & { bookedSeats?: unknown; booked_seats?: unknown }).bookedSeats ??
      (ride as RideListItem & { bookedSeats?: unknown; booked_seats?: unknown }).booked_seats;
    return typeof rawBooked === 'number' && Number.isFinite(rawBooked) ? Math.max(0, Math.floor(rawBooked)) : 0;
  })();
  const bookedSeats = Math.max(bookedSeatsFromRows, bookedSeatsFromBackend);
  // Passenger UI should show "X seats booked" (not just "seats left").
  // Active only (exclude cancelled bookings) and sum seat counts for the current viewer.
  const viewerBookedSeats = passengers.reduce((sum, b) => {
    const uid = (b.userId ?? '').trim();
    if (!uid || uid !== currentUserId) return sum;
    if (bookingIsCancelled(b.status)) return sum;
    const status = String(b.status ?? '').trim().toLowerCase();
    if (isPendingLikeBookingStatus(status) || status === 'rejected') return sum;
    const rawSeats = typeof b.seats === 'number' && !Number.isNaN(b.seats) ? b.seats : 0;
    const seats = rawSeats > 0 ? Math.max(1, Math.floor(rawSeats)) : 0;
    return sum + seats;
  }, 0);
  /** Owner: no booker names on main card — show your ride + capacity / vehicle. */
  const cardPersonName = isOwner ? 'Your ride' : driverName;
  const cardPersonSubtitle = isOwner
    ? (() => {
        return getRideAvailabilityShort(ride) || `${totalSeats} seat${totalSeats !== 1 ? 's' : ''} offered`;
      })()
    : hasVehicleDetailsForBlock
      ? undefined
      : vehicleSubtitle || undefined;
  const cardAvatarUri =
    !isOwner && publisherDeactivated
      ? undefined
      : ((isOwner ? (user?.avatarUrl ?? '').trim() : (ride.publisherAvatarUrl ?? '').trim()) ||
        undefined);
  const cardAvatarName = isOwner
    ? (currentUserName || user?.name || 'You').trim() || 'You'
    : driverName;
  const ownerUserIdForChat = (ride.userId ?? '').trim();
  /** Signed-in non-owners can message the driver from ride detail; booking is not required. */
  const passengerCanMessageOwner =
    sessionReady &&
    !isOwner &&
    !publisherDeactivated &&
    Boolean(ownerUserIdForChat) &&
    Boolean(currentUserId);
  const openChatWithOwner = useCallback(() => {
    const oid = (ride.userId ?? '').trim();
    if (!oid) return;
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('Chat', {
      ride,
      otherUserName: driverName,
      otherUserId: oid,
      ...(ride.publisherAvatarUrl?.trim()
        ? { otherUserAvatarUrl: ride.publisherAvatarUrl.trim() }
        : {}),
    });
  }, [navigation, ride, driverName]);
  const priceDisplay = formatRidePrice(ride);
  const normalizeRequestBookingItem = useCallback((raw: unknown): BookingItem | null => {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const id = String(row.id ?? row._id ?? '').trim();
    if (!id) return null;
    const userObj = row.user && typeof row.user === 'object' ? (row.user as Record<string, unknown>) : null;
    const userId = String(row.userId ?? row.user_id ?? userObj?._id ?? userObj?.id ?? '').trim();
    const seatsRaw = row.seats;
    const seats =
      typeof seatsRaw === 'number'
        ? seatsRaw
        : typeof seatsRaw === 'string' && seatsRaw.trim() !== ''
          ? Number(seatsRaw)
          : 1;
    const status = String(row.status ?? 'pending').trim().toLowerCase() || 'pending';
    const bookedAt = String(row.createdAt ?? row.bookedAt ?? row.updatedAt ?? new Date().toISOString());
    const avatarUrl =
      pickAvatarUrlFromRecord(row) ?? (userObj ? pickAvatarUrlFromRecord(userObj) : undefined);
    return {
      id,
      userId,
      name: String(row.name ?? row.userName ?? row.username ?? userObj?.name ?? '').trim() || undefined,
      userName: String(row.userName ?? row.username ?? userObj?.username ?? '').trim() || undefined,
      seats: Number.isFinite(seats) ? Math.max(1, Math.floor(seats)) : 1,
      status,
      bookedAt,
      pickupLocationName: String(row.pickupLocationName ?? row.pickup ?? '').trim() || undefined,
      destinationLocationName:
        String(row.destinationLocationName ?? row.dropoff ?? row.destination ?? '').trim() || undefined,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(typeof row.showRebookedBadge === 'boolean' ? { showRebookedBadge: row.showRebookedBadge } : {}),
      ...(String(row.rebookedBadgeSource ?? row.rebooked_badge_source ?? '')
        .trim()
        ? {
            rebookedBadgeSource: String(row.rebookedBadgeSource ?? row.rebooked_badge_source ?? '').trim(),
          }
        : {}),
      ...(String(row.ownerListRole ?? row.owner_list_role ?? '')
        .trim()
        ? { ownerListRole: String(row.ownerListRole ?? row.owner_list_role ?? '').trim() }
        : {}),
    };
  }, []);

  const parseSeatPriceNumber = (r: RideListItem): number | null => {
    // Keep in sync with `formatRidePrice` raw selection.
    const anyRide = r as RideListItem & {
      fare?: unknown;
      amount?: unknown;
      pricePerSeat?: unknown;
      price_per_seat?: unknown;
      farePerSeat?: unknown;
      fare_per_seat?: unknown;
    };
    const raw =
      r.price ??
      (anyRide.fare as string | number | undefined) ??
      (anyRide.amount as string | number | undefined) ??
      (anyRide.pricePerSeat as string | number | undefined) ??
      (anyRide.price_per_seat as string | number | undefined) ??
      (anyRide.farePerSeat as string | number | undefined) ??
      (anyRide.fare_per_seat as string | number | undefined);
    if (raw == null || String(raw).trim() === '') return null;
    const cleaned = String(raw).replace(/[₹$,]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const formatRupees = (n: number): string => {
    const pretty = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
    return `₹${pretty}`;
  };

  // Payment box should show total amount based on seats booked by the viewer.
  // - Passenger: use only their active booking seats
  // - Owner: use total booked seats for the ride
  const pricingSeats =
    myPassengerBooking && !bookingIsCancelled(myPassengerBooking.status)
        ? myPassengerBooking.seats ?? 0
        : 0;
  const seatPriceNumber = parseSeatPriceNumber(ride);
  const totalBookedPriceText =
    !isOwner && seatPriceNumber != null && pricingSeats > 0
      ? formatRupees(seatPriceNumber * pricingSeats)
      : null;
  const rideDetailRatingPromptEnabled = false;
  const ratingTargetUserId = (() => {
    if (!currentUserId) return '';
    if (isOwner) {
      const firstOther = passengers.find((b) => (b.userId ?? '').trim() && (b.userId ?? '').trim() !== currentUserId);
      return (firstOther?.userId ?? '').trim();
    }
    return (ride.userId ?? '').trim();
  })();

  const togglePassengerHistoryExpanded = useCallback((passengerId: string) => {
    setExpandedPassengerHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(passengerId)) {
        next.delete(passengerId);
      } else {
        next.add(passengerId);
      }
      return next;
    });
  }, []);

  const fetchRideDetail = useCallback(async (opts?: { force?: boolean }): Promise<RideListItem | null> => {
    const forRideId = initialRide.id;
    let nextRideSnapshot: RideListItem | null = null;
    try {
      const res = await fetchRideDetailRaw(forRideId, {
        ...opts,
        viewerUserId: currentUserId,
      });
      if (res && typeof res === 'object') {
        const root = res as Record<string, unknown>;
        const candidate =
          (root.ride && typeof root.ride === 'object' ? (root.ride as Record<string, unknown>) : null) ??
          (root.data && typeof root.data === 'object'
            ? (((root.data as Record<string, unknown>).ride &&
                typeof (root.data as Record<string, unknown>).ride === 'object')
                ? ((root.data as Record<string, unknown>).ride as Record<string, unknown>)
                : (root.data as Record<string, unknown>))
            : null) ??
          root;
        const ownerPassengersRaw =
          (Array.isArray(candidate.passengers) ? (candidate.passengers as unknown[]) : null) ??
          (Array.isArray((root as Record<string, unknown>).passengers)
            ? ((root as Record<string, unknown>).passengers as unknown[])
            : null) ??
          (root.data &&
          typeof root.data === 'object' &&
          Array.isArray((root.data as Record<string, unknown>).passengers)
            ? ((root.data as Record<string, unknown>).passengers as unknown[])
            : null);
        const ownerAllBookingsRaw =
          (Array.isArray(candidate.bookings) ? (candidate.bookings as unknown[]) : null) ??
          (Array.isArray((root as Record<string, unknown>).bookings)
            ? ((root as Record<string, unknown>).bookings as unknown[])
            : null) ??
          (root.data &&
          typeof root.data === 'object' &&
          Array.isArray((root.data as Record<string, unknown>).bookings)
            ? ((root.data as Record<string, unknown>).bookings as unknown[])
            : null) ??
          [];
        const contractVersion = String(
          candidate.contractVersion ??
            candidate.contract_version ??
            (root as Record<string, unknown>).contractVersion ??
            (root as Record<string, unknown>).contract_version ??
            (root.data && typeof root.data === 'object'
              ? (root.data as Record<string, unknown>).contractVersion ??
                (root.data as Record<string, unknown>).contract_version
              : '') ??
            ''
        )
          .trim()
          .toLowerCase();
        const bookingHistoryMetaParsed = parseBookingHistoryMetaFromApi(root, candidate as Record<string, unknown>);
        const rowHasOwnerListRole = (r: unknown): boolean =>
          Boolean(
            r &&
              typeof r === 'object' &&
              String(
                (r as Record<string, unknown>).ownerListRole ??
                  (r as Record<string, unknown>).owner_list_role ??
                  ''
              ).trim().length > 0
          );
        const segmentedOwnerPayload =
          (Array.isArray(ownerPassengersRaw) && ownerPassengersRaw.some(rowHasOwnerListRole)) ||
          (Array.isArray(ownerAllBookingsRaw) && ownerAllBookingsRaw.some(rowHasOwnerListRole));
        // Do not merge full `bookings[]` into owner state when API already segments `passengers` vs requests:
        // - contract v3, or
        // - bookingHistoryMeta (server canonical timeline), or
        // - `ownerListRole` on payload rows (segmented owner API)
        // Otherwise pending rows in `bookings[]` leak into Passengers UI.
        const useStrictOwnerPassengers =
          isOwner &&
          ownerPassengersRaw &&
          (contractVersion === 'v3' ||
            rideUsesServerCanonicalBookingHistory(bookingHistoryMetaParsed) ||
            segmentedOwnerPayload);
        const bookingsRaw =
          useStrictOwnerPassengers
            ? ownerPassengersRaw
            : isOwner && ownerPassengersRaw
            ? [...ownerPassengersRaw, ...ownerAllBookingsRaw]
            : ownerAllBookingsRaw;
        const listFromApi: BookingItem[] = bookingsRaw
          .map((b) => {
            if (!b || typeof b !== 'object') return null;
            const row = mapRawToBookingRow(b as Record<string, unknown>);
            return row as BookingItem | null;
          })
          .filter((x): x is BookingItem => x != null);
        const list = mergeGuestRideBookingsWhenApiOmitsList({
          listFromApi,
          viewerUserId: currentUserId,
          rideId: forRideId,
          routeInitialBookings: initialRide.bookings,
          prevPassengers: passengersRef.current,
          prevRide: rideSnapshotRef.current,
          candidate: candidate as Record<string, unknown>,
        });
        const rideBookingHistoryParsed = parseRideBookingHistoryFromApi(root, candidate as Record<string, unknown>);
        if (list.length > 0) {
          rideDetailGuestBookingsCache.set(forRideId, list);
        }
        const rawRes = candidate as RideListItem & Record<string, unknown>;
        const pricing = (rawRes.pricing && typeof rawRes.pricing === 'object')
          ? (rawRes.pricing as Record<string, unknown>)
          : undefined;
        const mergedPrice =
          (rawRes.price as string | number | undefined) ??
          (rawRes.fare as string | number | undefined) ??
          (rawRes.amount as string | number | undefined) ??
          (rawRes.pricePerSeat as string | number | undefined) ??
          (rawRes.price_per_seat as string | number | undefined) ??
          (rawRes.farePerSeat as string | number | undefined) ??
          (rawRes.fare_per_seat as string | number | undefined) ??
          (pricing?.price as string | number | undefined) ??
          (pricing?.fare as string | number | undefined);
        setPassengers(list);
        if (isOwner) {
          let ownerRequestsLenForLog = 0;
          const ownerSeatRequestsRaw =
            (Array.isArray(candidate.seatRequests) ? (candidate.seatRequests as unknown[]) : null) ??
            (Array.isArray((root as Record<string, unknown>).seatRequests)
              ? ((root as Record<string, unknown>).seatRequests as unknown[])
              : null) ??
            (root.data &&
            typeof root.data === 'object' &&
            Array.isArray((root.data as Record<string, unknown>).seatRequests)
              ? ((root.data as Record<string, unknown>).seatRequests as unknown[])
              : null);
          if (ownerSeatRequestsRaw) {
            const normalizedRequests = ownerSeatRequestsRaw
              .map((item) => normalizeRequestBookingItem(item))
              .filter((item): item is BookingItem => Boolean(item));
            ownerRequestsLenForLog = normalizedRequests.length;
            setSeatRequests(normalizedRequests);
          }
          if (__DEV__) {
            const candRec = candidate as Record<string, unknown>;
            const n = (v: unknown): number =>
              typeof v === 'number' && Number.isFinite(v)
                ? v
                : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
                  ? Number(v)
                  : NaN;
            // Helps verify owner segmentation contract quickly while debugging payload leaks.
            console.log(
              '[RideDetail][owner-segmentation]',
              JSON.stringify({
                passengersLen: list.length,
                requestsLen: ownerRequestsLenForLog,
                bookingsLen: ownerAllBookingsRaw.length,
                activePassengerCount: n(candRec.activePassengerCount ?? candRec.active_passenger_count),
                pendingRequestCount: n(candRec.pendingRequestCount ?? candRec.pending_request_count),
                historicalPassengerCount: n(
                  candRec.historicalPassengerCount ?? candRec.historical_passenger_count
                ),
              })
            );
          }
        }
        setRide((prev) => {
          const candidateModeRaw = String(
            candidate.bookingMode ??
              candidate.booking_mode ??
              (
                candidate.instantBooking === false || candidate.instant_booking === false
                  ? 'request'
                  : 'instant'
              )
          )
            .trim()
            .toLowerCase();
          const pubAvatar = pickPublisherAvatarUrl(candidate as Record<string, unknown>);
          const next = {
            ...prev,
            ...candidate,
            bookingMode: candidateModeRaw === 'request' ? 'request' : 'instant',
            instantBooking: candidateModeRaw !== 'request',
            ...(mergedPrice != null && String(mergedPrice).trim() !== ''
              ? { price: String(mergedPrice) }
              : {}),
            bookings: list,
            ...(pubAvatar ? { publisherAvatarUrl: pubAvatar } : {}),
          } as RideListItem;
          const nextDescription = String(
            next.description ?? next.rideDescription ?? next.ride_description ?? ''
          ).trim();
          if (!nextDescription) {
            const prevDescription = String(
              prev.description ?? prev.rideDescription ?? prev.ride_description ?? ''
            ).trim();
            if (prevDescription) {
              next.description = prevDescription;
              next.rideDescription = prevDescription;
              next.ride_description = prevDescription;
            }
          }
          const mine = list.filter((b) => (b.userId ?? '').trim() === currentUserId);
          if (mine.length > 0) {
            next.myBookingStatus = pickPreferredBookingStatus(mine.map((b) => b.status ?? ''));
          } else {
            // Avoid carrying stale local state if the server doesn't include this viewer's booking rows.
            // We only trust server-provided `myBookingStatus` when present; otherwise clear it.
            const mergedStatus = (candidate as RideListItem).myBookingStatus;
            if (mergedStatus !== undefined) {
              next.myBookingStatus = mergedStatus;
            } else if (String(prev.myBookingStatus ?? '').trim().toLowerCase() === 'pending') {
              // Keep local pending state when backend detail temporarily omits my_booking_status.
              next.myBookingStatus = 'pending';
            } else {
              next.myBookingStatus = '';
            }
          }
          if (isRideCancelledByOwner(prev) && !isRideCancelledByOwner(next)) {
            next.status = prev.status ?? 'cancelled';
          }
          const tbRaw = candidate.totalBookings ?? candidate.total_bookings;
          const tb =
            typeof tbRaw === 'number' && !Number.isNaN(tbRaw)
              ? Math.max(0, Math.floor(tbRaw))
              : undefined;
          if (tb !== undefined) {
            next.totalBookings = tb;
          } else if (list.length > 0) {
            next.totalBookings = list.length;
          } else if (prev.totalBookings != null) {
            next.totalBookings = prev.totalBookings;
          }
          const avRaw = candidate.availableSeats ?? candidate.seats_available ?? candidate.seatsAvailable;
          const avMerged =
            typeof avRaw === 'number' && !Number.isNaN(avRaw)
              ? Math.max(0, Math.floor(avRaw))
              : undefined;
          if (avMerged !== undefined) {
            next.availableSeats = avMerged;
          }
          const viRaw = candidate.viewerIsOwner ?? candidate.viewer_is_owner;
          if (typeof viRaw === 'boolean') next.viewerIsOwner = viRaw;
          else if (viRaw === 'true') next.viewerIsOwner = true;
          else if (viRaw === 'false') next.viewerIsOwner = false;
          const candRec = candidate as Record<string, unknown>;
          const numFrom = (v: unknown): number | undefined => {
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string' && v.trim() !== '') {
              const n = Number(v);
              return Number.isFinite(n) ? n : undefined;
            }
            return undefined;
          };
          const pubAvg =
            numFrom(candRec.publisherAvgRating) ??
            numFrom(candRec.publisher_avg_rating) ??
            numFrom(candRec.driverAvgRating) ??
            numFrom(candRec.driver_avg_rating);
          const pubCount =
            numFrom(candRec.publisherRatingCount) ??
            numFrom(candRec.publisher_rating_count) ??
            numFrom(candRec.publisherTotalRatings) ??
            numFrom(candRec.publisher_total_ratings) ??
            numFrom(candRec.driverRatingCount) ??
            numFrom(candRec.driver_rating_count);
          if (pubAvg != null && pubAvg >= 0 && pubAvg <= 5) {
            next.publisherAvgRating = Number(pubAvg.toFixed(1));
          }
          if (pubCount != null && pubCount >= 0) {
            next.publisherRatingCount = Math.max(0, Math.floor(pubCount));
          }
          const pubDateOfBirth =
            (typeof candRec.publisherDateOfBirth === 'string' && candRec.publisherDateOfBirth.trim() !== ''
              ? candRec.publisherDateOfBirth.trim()
              : undefined) ??
            (typeof candRec.publisher_date_of_birth === 'string' && candRec.publisher_date_of_birth.trim() !== ''
              ? candRec.publisher_date_of_birth.trim()
              : undefined) ??
            (typeof candRec.driverDateOfBirth === 'string' && candRec.driverDateOfBirth.trim() !== ''
              ? candRec.driverDateOfBirth.trim()
              : undefined);
          if (pubDateOfBirth) {
            next.publisherDateOfBirth = pubDateOfBirth;
          }
          const activePassengerCount =
            numFrom(candRec.activePassengerCount) ?? numFrom(candRec.active_passenger_count);
          const pendingRequestCount =
            numFrom(candRec.pendingRequestCount) ?? numFrom(candRec.pending_request_count);
          const historicalPassengerCount =
            numFrom(candRec.historicalPassengerCount) ?? numFrom(candRec.historical_passenger_count);
          if (activePassengerCount != null && activePassengerCount >= 0) {
            next.activePassengerCount = Math.max(0, Math.floor(activePassengerCount));
          }
          if (pendingRequestCount != null && pendingRequestCount >= 0) {
            next.pendingRequestCount = Math.max(0, Math.floor(pendingRequestCount));
          }
          if (historicalPassengerCount != null && historicalPassengerCount >= 0) {
            next.historicalPassengerCount = Math.max(0, Math.floor(historicalPassengerCount));
          }
          const dataLayer =
            root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : null;
          const noticeRaw =
            candRec.viewerBookingNotice ??
            candRec.viewer_booking_notice ??
            dataLayer?.viewerBookingNotice ??
            dataLayer?.viewer_booking_notice ??
            root.viewerBookingNotice ??
            root.viewer_booking_notice;
          const noticeStr =
            typeof noticeRaw === 'string' && noticeRaw.trim() !== '' ? noticeRaw.trim() : undefined;
          if (noticeStr !== undefined) {
            next.viewerBookingNotice = noticeStr;
          } else {
            delete (next as Record<string, unknown>).viewerBookingNotice;
          }
          const vehicleNorm = normalizeVehicleFieldsFromApiRecord(candRec);
          const vehicleIdStr = vehicleIdString(candRec.vehicleId ?? candRec.vehicle_id);
          const merged = {
            ...next,
            ...vehicleNorm,
            ...(vehicleIdStr ? { vehicleId: vehicleIdStr } : {}),
            rideBookingHistory: rideBookingHistoryParsed,
            ...(bookingHistoryMetaParsed ? { bookingHistoryMeta: bookingHistoryMetaParsed } : {}),
          } as RideListItem;
          delete (merged as Record<string, unknown>).bookingHistory;
          nextRideSnapshot = merged;
          return merged;
        });
      }
    } catch {
      // keep list params; UI may be slightly stale
      return null;
    } finally {
      if (activeDetailRideIdRef.current === forRideId) {
        setDetailFresh(true);
      }
    }
    return nextRideSnapshot;
  }, [initialRide, currentUserId, isOwner, normalizeRequestBookingItem]);

  const openPublishedRouteMap = useCallback(() => {
    const c = getPublisherRouteCoords(ride);
    if (!c) return;
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate(
      'PublishedRideRouteMap',
      {
        pickupLabel: publishedPickupStr,
        destinationLabel: publishedDestStr,
        pickupLatitude: c.pickupLatitude,
        pickupLongitude: c.pickupLongitude,
        destinationLatitude: c.destinationLatitude,
        destinationLongitude: c.destinationLongitude,
      }
    );
  }, [navigation, ride, publishedPickupStr, publishedDestStr]);

  const fetchSeatRequests = useCallback(async () => {
    if (!isOwner || !isRequestBookingMode) {
      setSeatRequests([]);
      setSeatRequestsLoading(false);
      return;
    }
    setSeatRequestsLoading(true);
    try {
      const response = await api.get(API.endpoints.rides.bookingRequests(ride.id));
      const payload = response?.data ?? response;
      const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const listRaw =
        (Array.isArray(root.requests) ? root.requests : null) ??
        (Array.isArray(root.bookings) ? root.bookings : null) ??
        (Array.isArray(root.data) ? root.data : null) ??
        [];
      const list = listRaw
        .map((item) => normalizeRequestBookingItem(item))
        .filter((item): item is BookingItem => Boolean(item))
        .sort((a, b) => {
          const at = new Date(a.bookedAt).getTime();
          const bt = new Date(b.bookedAt).getTime();
          const aValid = Number.isFinite(at) && !Number.isNaN(at);
          const bValid = Number.isFinite(bt) && !Number.isNaN(bt);
          if (aValid && bValid) return at - bt; // Oldest first
          if (aValid) return -1;
          if (bValid) return 1;
          return String(a.id).localeCompare(String(b.id));
        });
      setSeatRequests(list);
    } catch {
      setSeatRequests([]);
    } finally {
      setSeatRequestsLoading(false);
    }
  }, [isOwner, isRequestBookingMode, ride.id, normalizeRequestBookingItem]);

  const refreshRideDetailEventDriven = useCallback(async (): Promise<RideListItem | null> => {
    if (detailRefreshInFlightRef.current) return detailRefreshInFlightRef.current;
    const run = (async () => {
      const updated = await fetchRideDetail({ force: true });
      if (isOwner && isRequestBookingMode) {
        await fetchSeatRequests();
      }
      return updated;
    })();
    detailRefreshInFlightRef.current = run;
    try {
      return await run;
    } finally {
      detailRefreshInFlightRef.current = null;
    }
  }, [fetchRideDetail, fetchSeatRequests, isOwner, isRequestBookingMode]);

  const rejectAllPendingSeatRequests = useCallback(async (rideId: string) => {
    try {
      const response = await api.get(API.endpoints.rides.bookingRequests(rideId));
      const payload = response?.data ?? response;
      const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const listRaw =
        (Array.isArray(root.requests) ? root.requests : null) ??
        (Array.isArray(root.bookings) ? root.bookings : null) ??
        (Array.isArray(root.data) ? root.data : null) ??
        [];
      const pendingList = listRaw
        .map((item) => normalizeRequestBookingItem(item))
        .filter((item): item is BookingItem => Boolean(item))
        .filter((item) => String(item.status ?? '').trim().toLowerCase() === 'pending');
      if (pendingList.length > 0) {
        await Promise.allSettled(
          pendingList.map((row) => api.patch(API.endpoints.bookings.reject(row.id)))
        );
      }
    } catch {
      // Best-effort cleanup; view refresh handles final truth from backend.
    }
  }, [normalizeRequestBookingItem]);

  const handleSeatRequestAction = useCallback(
    async (bookingId: string, action: 'approve' | 'reject') => {
      if (!bookingId) return;
      setSeatRequestActionBookingId(bookingId);
      try {
        if (action === 'approve') {
          await api.patch(API.endpoints.bookings.approve(bookingId));
        } else {
          await api.patch(API.endpoints.bookings.reject(bookingId));
        }
        let updatedRide = await refreshRideDetailEventDriven();
        if (action === 'approve' && updatedRide && getRideAvailableSeats(updatedRide) <= 0) {
          await rejectAllPendingSeatRequests(updatedRide.id);
        }
        updatedRide = await refreshRideDetailEventDriven();
        if (updatedRide) {
          emitRideListMergeFromDetail(updatedRide);
        }
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : action === 'approve'
              ? 'Could not approve request.'
              : 'Could not reject request.';
        Alert.alert('Error', message);
      } finally {
        setSeatRequestActionBookingId(null);
      }
    },
    [refreshRideDetailEventDriven, rejectAllPendingSeatRequests]
  );

  const openSeatRequestDetail = useCallback(
    (bookingItem: BookingItem) => {
      const bid = String(bookingItem.id ?? '').trim();
      if (!bid) return;
      setOpeningSeatRequestDetailId(bid);
      const uid = (bookingItem.userId ?? '').trim();
      const summary = uid
        ? perUserPassengerSummaries.find((s) => (s.userId ?? '').trim() === uid)
        : undefined;
      const ownerBookingHistoryLines = summary
        ? computeOwnerBookingHistoryLinesForPassenger(
            summary.userId,
            summary.primary,
            summary.historyChronological
          )
        : [];
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          try {
            (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate(
              'BookPassengerDetail',
              {
                ride,
                booking: bookingItem,
                requestMode: true,
                ...(ownerBookingHistoryLines.length > 0 ? { ownerBookingHistoryLines } : {}),
              }
            );
          } finally {
            setOpeningSeatRequestDetailId(null);
          }
        }, 120);
      });
    },
    [navigation, ride, perUserPassengerSummaries, computeOwnerBookingHistoryLinesForPassenger]
  );

  const openCoPassengerRatings = useCallback(
    (b: BookingItem, displayName: string, avatarForModal?: string) => {
      const uid = (b.userId ?? '').trim();
      if (!uid) return;
      const parentNav = (navigation as { getParent?: () => { setOptions?: (o: { tabBarStyle?: unknown }) => void } })
        .getParent?.();
      parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });
      (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('OwnerRatingsModal', {
        userId: uid,
        displayName: displayName.trim() || 'Passenger',
        ...(avatarForModal?.trim() ? { avatarUrl: avatarForModal.trim() } : {}),
        ...(b.dateOfBirth ? { dateOfBirth: b.dateOfBirth } : {}),
      });
    },
    [navigation]
  );

  useEffect(() => {
    if (!isOwner || !isRequestBookingMode) return;
    if (availableSeatsCount > 0) return;
    if (autoRejectPendingInFlightRef.current) return;
    autoRejectPendingInFlightRef.current = true;
    void (async () => {
      await rejectAllPendingSeatRequests(ride.id);
      await fetchSeatRequests();
      autoRejectPendingInFlightRef.current = false;
    })();
  }, [isOwner, isRequestBookingMode, availableSeatsCount, ride.id, rejectAllPendingSeatRequests, fetchSeatRequests]);

  // Ensure edited values are shown immediately after returning from EditRide.
  useFocusEffect(
    useCallback(() => {
      const mainTabs = findMainTabNavigatorWithOptions(navigation as { getParent?: () => unknown });
      mainTabs?.setOptions?.({ tabBarStyle: { display: 'none' } });

      void refreshRideDetailEventDriven();
      if (sessionReady && currentUserId && !isOwnerStrict) {
        void fetchPassengerBookedRidesForOverlap(currentUserId).then((list) =>
          setPassengerBookedRidesForOverlap(list)
        );
      }
      return () => {
        // Keep tabs hidden when navigating to full-screen child flows from Ride Detail.
        setTimeout(() => {
          try {
            const tabState = mainTabs?.getState?.();
            const activeTabRoute = tabState?.routes?.[tabState?.index ?? 0] as
              | { state?: { routes?: { name?: string }[]; index?: number } }
              | undefined;
            const nestedState = activeTabRoute?.state;
            const nestedName = nestedState?.routes?.[nestedState?.index ?? 0]?.name;
            const hideTabsOn = new Set([
              'RideDetail',
              'RideDetailScreen',
              'BookPassengerDetail',
              'Chat',
              'OwnerProfileModal',
              'OwnerRatingsModal',
            ]);
            if (!nestedName || !hideTabsOn.has(nestedName)) {
              mainTabs?.setOptions?.({ tabBarStyle: undefined });
            }
          } catch {
            mainTabs?.setOptions?.({ tabBarStyle: undefined });
          }
        }, 120);
      };
    }, [refreshRideDetailEventDriven, navigation, sessionReady, currentUserId, isOwnerStrict])
  );

  useEffect(() => {
    setBookSeatsCount(1);
    setShowRatingModal(false);
    setRatingStars(0);
    setRatingReview('');
    setRatingSubmitting(false);
    setRatingSubmitted(false);
    ratingCheckKeyRef.current = null;
    viewerBookingNoticeToastKeyRef.current = null;
  }, [ride.id]);

  /**
   * One hint toast per open: backend `viewerBookingNotice` first, else overlap from GET /rides/booked,
   * else same-ride booking when detail omits notice.
   */
  useEffect(() => {
    if (!detailFresh || !sessionReady || !currentUserId) return;
    if (isOwnerStrict || isPastRide) return;
    if (showPassengerPendingFixedAction) return;

    const backendNotice = String(ride.viewerBookingNotice ?? '').trim();
    const backendNoticeLower = backendNotice.toLowerCase();
    const looksLikeAlreadyBookedNotice =
      backendNoticeLower.includes('already have seat') || backendNoticeLower.includes('already booked');
    const looksLikePendingRequestNotice =
      backendNoticeLower.includes('pending') || backendNoticeLower.includes('approval');
    if (
      backendNotice &&
      !(
        looksLikeAlreadyBookedNotice &&
        (isMyBookingPending || looksLikePendingRequestNotice)
      )
    ) {
      const key = `n|${ride.id}|${backendNotice}`;
      if (viewerBookingNoticeToastKeyRef.current === key) return;
      viewerBookingNoticeToastKeyRef.current = key;
      const t = setTimeout(() => {
        showToast({
          variant: 'info',
          message: backendNotice,
          durationMs: 5200,
        });
      }, 400);
      return () => clearTimeout(t);
    }

    if (overlappingPassengerRide) {
      const key = `o|${ride.id}|${overlappingPassengerRide.id}`;
      if (viewerBookingNoticeToastKeyRef.current === key) return;
      viewerBookingNoticeToastKeyRef.current = key;
      const t = setTimeout(() => {
        showToast({
          variant: 'overlap',
          message: PASSENGER_OVERLAP_BOOKING_TOAST,
          durationMs: 6500,
        });
      }, 400);
      return () => clearTimeout(t);
    }

    /** Pending request is not a confirmed seat — show this toast only for confirmed/accepted bookings. */
    const showAlreadyBookedThisRideToast = !isMyBookingPending && isBookedByMe;
    if (showAlreadyBookedThisRideToast) {
      const key = `s|${ride.id}`;
      if (viewerBookingNoticeToastKeyRef.current === key) return;
      viewerBookingNoticeToastKeyRef.current = key;
      const t = setTimeout(() => {
        showToast({
          variant: 'info',
          message: PASSENGER_ALREADY_BOOKED_THIS_RIDE_TOAST,
          durationMs: 4500,
        });
      }, 400);
      return () => clearTimeout(t);
    }
  }, [
    detailFresh,
    sessionReady,
    currentUserId,
    isOwnerStrict,
    isPastRide,
    showPassengerPendingFixedAction,
    isBookedByMe,
    isMyBookingPending,
    ride.id,
    ride.viewerBookingNotice,
    overlappingPassengerRide?.id,
  ]);

  /** Keep seat picker within fresh availability whenever server counts change (never trust stale values). */
  useEffect(() => {
    const a = getRideAvailableSeats(ride);
    setBookSeatsCount((prev) => {
      if (a <= 0) return prev;
      return Math.min(Math.max(1, prev), a);
    });
  }, [ride.bookedSeats, ride.seats, ride.availableSeats, ride.bookings]);

  useEffect(() => {
    fullRideBlockAlertShownRef.current = false;
    setDetailFresh(false);
  }, [initialRide.id]);

  useEffect(() => {
    if (!rideDetailRatingPromptEnabled) return;
    if (!detailFresh) return;
    if (!rideIsCompleted) return;
    if (!currentUserId) return;
    if (!ratingTargetUserId) return;

    const key = `${ride.id}:${currentUserId}:${ratingTargetUserId}`;
    if (ratingCheckKeyRef.current === key) return;
    ratingCheckKeyRef.current = key;

    let cancelled = false;
    void (async () => {
      const handled = await hasHandledRatingPrompt(currentUserId, ride.id);
      if (cancelled || handled) return;
      try {
        const alreadyRated = await hasCurrentUserRatedRide(
          ride.id,
          currentUserId,
          (ratingTargetUserId ?? '').trim() || undefined
        );
        if (cancelled) return;
        if (alreadyRated) {
          await markRatingPromptHandled(currentUserId, ride.id);
          return;
        }
        setShowRatingModal(true);
      } catch {
        // Non-blocking fallback: still allow prompt once; backend duplicate guard prevents resubmission.
        if (!cancelled) setShowRatingModal(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detailFresh, rideIsCompleted, ride.id, currentUserId, ratingTargetUserId, rideDetailRatingPromptEnabled]);

  /** Non-owners cannot view full rides unless they already have a booking (e.g. deep link). */
  useEffect(() => {
    if (!detailFresh) return;
    if (isOwner) return;
    if (!isRideSeatsFull(ride)) return;
    if (isBookedByMe) return;
    if (fullRideBlockAlertShownRef.current) return;
    fullRideBlockAlertShownRef.current = true;
    Alert.alert(
      'Ride full',
      'This ride has no available seats. Details are only available if you already have a booking.',
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  }, [detailFresh, ride, isBookedByMe, isOwner, navigation]);

  const handleEdit = () => {
    if (!isOwnerStrict) {
      Alert.alert('Not allowed', 'Only the driver can edit this ride.');
      return;
    }
    const normalizedDescription = (
      ride.description ??
      ride.rideDescription ??
      ride.ride_description ??
      ''
    ).trim();
    (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate('EditRide', {
      ride: {
        ...ride,
        ...(normalizedDescription
          ? {
              description: normalizedDescription,
              rideDescription: normalizedDescription,
              ride_description: normalizedDescription,
            }
          : {}),
      },
    });
  };

  const handleEditAndRepublish = () => {
    if (!isOwnerStrict) {
      Alert.alert('Not allowed', 'Only the driver can republish this ride.');
      return;
    }
    const pickup = (ride.pickupLocationName ?? ride.from ?? '').trim();
    const destination = (ride.destinationLocationName ?? ride.to ?? '').trim();
    if (!pickup || !destination) {
      Alert.alert('Cannot republish', 'Pickup or destination is missing on this ride.');
      return;
    }
    if (
      typeof ride.pickupLatitude !== 'number' ||
      typeof ride.pickupLongitude !== 'number' ||
      typeof ride.destinationLatitude !== 'number' ||
      typeof ride.destinationLongitude !== 'number'
    ) {
      Alert.alert('Cannot republish', 'Location coordinates are missing on this ride.');
      return;
    }
    const when = getRideScheduledAt(ride) ?? new Date();
    const description = (ride.description ?? ride.rideDescription ?? ride.ride_description ?? '').trim();
    const bookingModeRaw = String(
      (ride as RideListItem & { bookingMode?: string; booking_mode?: string; instantBooking?: boolean }).bookingMode ??
        (ride as RideListItem & { bookingMode?: string; booking_mode?: string; instantBooking?: boolean }).booking_mode ??
        ''
    )
      .trim()
      .toLowerCase();
    const entry: RecentPublishedEntry = {
      id: `republish-${ride.id}`,
      pickup,
      destination,
      pickupLatitude: ride.pickupLatitude,
      pickupLongitude: ride.pickupLongitude,
      destinationLatitude: ride.destinationLatitude,
      destinationLongitude: ride.destinationLongitude,
      dateYmd: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(
        when.getDate()
      ).padStart(2, '0')}`,
      hour: when.getHours(),
      minute: when.getMinutes(),
      seats: Math.max(1, Math.min(6, Math.floor(Number(ride.seats) || 1))),
      rate: String(ride.price ?? '').trim(),
      rideDescription: description,
      description,
      instantBooking:
        bookingModeRaw === 'instant' ||
        (bookingModeRaw === '' &&
          Boolean(
            (ride as RideListItem & { instantBooking?: boolean; instant_booking?: boolean }).instantBooking ??
              (ride as RideListItem & { instantBooking?: boolean; instant_booking?: boolean }).instant_booking
          )),
    };

    const sourceTab = getRideDetailSourceMainTab(navigation as { getParent?: () => unknown });
    if (sourceTab === 'YourRides') {
      (
        navigation as unknown as {
          navigate: (name: 'PublishRecentEdit', params: { entry: RecentPublishedEntry }) => void;
        }
      ).navigate('PublishRecentEdit', { entry });
      return;
    }

    const mainTabs = findMainTabNavigatorWithOptions(navigation as { getParent?: () => unknown });
    (
      mainTabs as
        | {
            navigate?: (config: {
              name: 'PublishStack';
              params: { screen: 'PublishRecentEdit'; params: Record<string, unknown> };
              merge: false;
            }) => void;
          }
        | null
    )?.navigate?.({
      name: 'PublishStack',
      params: {
        screen: 'PublishRecentEdit',
        params: {
          entry,
          returnToRide: {
            tab: sourceTab,
            params: { ride, ...(passengerSearch ? { passengerSearch } : {}) },
          },
        },
      },
      merge: false,
    });
  };

  const expandEditSheet = () => {
    setEditSheetExpanded(true);
  };

  const closeEditSheet = () => {
    Animated.timing(editSheetSlideY, {
      toValue: windowHeight,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setShowEditSheet(false);
      setEditSheetExpanded(false);
    });
  };

  useEffect(() => {
    const p = route.params as RidesStackParamList['RideDetail'] & {
      selectedFrom?: string;
      selectedTo?: string;
    };
    if (!p) return;
    let touched = false;
    if (typeof p.selectedFrom === 'string') {
      setEditPickup(p.selectedFrom);
      touched = true;
    }
    if (typeof p.selectedTo === 'string') {
      setEditDestination(p.selectedTo);
      touched = true;
    }
    if (!touched) return;
    (navigation as { setParams: (params: Record<string, unknown>) => void }).setParams({
      selectedFrom: undefined,
      selectedTo: undefined,
    });
  }, [route.params, navigation]);

  const handleBook = async (opts?: { sessionUserId?: string; stayOnRideDetail?: boolean }) => {
    if (rideCancelledByOwner) {
      Alert.alert('Ride cancelled', 'This ride was cancelled by the driver.');
      return;
    }
    if (isPastRide) {
      Alert.alert('Ride ended', 'This ride is in the past and can no longer be booked.');
      return;
    }
    const cap = getRideAvailableSeats(ride);
    if (cap <= 0) {
      Alert.alert('Full', 'This ride has no available seats.');
      return;
    }
    const seatsToBook = Math.min(Math.max(1, bookSeatsCount), cap);
    /** Prefer Mongo `user.id` from context (API); fall back to sheet callback after auth exchange. */
    const uid = ((user?.id ?? '').trim() || (opts?.sessionUserId ?? '').trim()).trim();
    if (!uid) {
      setGuestLoginSheetVisible(true);
      return;
    }
    if (needsProfileCompletion) {
      Alert.alert(
        'Complete your profile',
        'Add your date of birth, gender, and phone before booking a ride.'
      );
      return;
    }
    const revokedByOwner =
      passengers.some(
        (b) => (b.userId ?? '').trim() === uid && bookingIsCancelledByOwner(b.status)
      ) || bookingIsCancelledByOwner(ride.myBookingStatus);
    if (revokedByOwner) {
      Alert.alert(
        'Cannot book',
        'The driver removed you from this ride. You can’t book it again.'
      );
      return;
    }
    if (!isOwnerStrict && bookButtonBlocked) {
      return;
    }
    const afterGuestSheetLogin = Boolean(opts?.sessionUserId?.trim());
    const stayOnRideDetailAfterBook = Boolean(opts?.stayOnRideDetail);
    setBooking(true);
    try {
      const body: CreateBookingRequest = {
        rideId: ride.id,
        seats: seatsToBook,
        ...(passengerSearch?.from?.trim() && passengerSearch?.to?.trim()
          ? {
              pickupLocationName: passengerSearch.from.trim(),
              destinationLocationName: passengerSearch.to.trim(),
              ...(passengerSearch.fromLatitude != null &&
              passengerSearch.fromLongitude != null
                ? {
                    pickupLatitude: passengerSearch.fromLatitude,
                    pickupLongitude: passengerSearch.fromLongitude,
                  }
                : {}),
              ...(passengerSearch.toLatitude != null && passengerSearch.toLongitude != null
                ? {
                    destinationLatitude: passengerSearch.toLatitude,
                    destinationLongitude: passengerSearch.toLongitude,
                  }
                : {}),
            }
          : {}),
      };
      await api.post(API.endpoints.bookings.create, body);
      invalidatePassengerBookedRidesCache();
      invalidateRideDetailCache(initialRide.id);
      if (isRequestBookingMode) {
        setRide((prev) => ({ ...prev, myBookingStatus: 'pending' }));
        await refreshRideDetailEventDriven();
        Alert.alert('Request sent', 'Your booking request is pending driver approval.');
      } else if (afterGuestSheetLogin && stayOnRideDetailAfterBook) {
        await refreshRideDetailEventDriven();
        Alert.alert('Booked', 'Your seat(s) are confirmed on this ride.', [
          {
            text: 'OK',
            onPress: () => {
              void (async () => {
                await new Promise<void>((resolve) => {
                  InteractionManager.runAfterInteractions(() => resolve());
                });
                await new Promise<void>((r) => setTimeout(r, Platform.OS === 'android' ? 90 : 120));
                resetTabsToYourRidesAfterBook(navigation);
              })();
            },
          },
        ]);
      } else {
        // Let the Book button finish its press animation, then transition without jank.
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });
        await new Promise<void>((r) => setTimeout(r, Platform.OS === 'android' ? 90 : 120));
        resetTabsToYourRidesAfterBook(navigation);
      }
    } catch (e: unknown) {
      if (isRouteTimeOverlapBookingError(e)) {
        invalidatePassengerBookedRidesCache();
        void fetchPassengerBookedRidesForOverlap(uid, { force: true }).then((list) =>
          setPassengerBookedRidesForOverlap(list)
        );
        const serverMsg = pickApiErrorBodyMessage(e);
        showToast({
          variant: 'overlap',
          message: serverMsg ?? 'Booking was not created.',
          durationMs: 6500,
        });
      } else {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Failed to book ride.';
        Alert.alert('Error', message);
      }
    } finally {
      setBooking(false);
    }
  };

  /** Shared DELETE /bookings/:id cancel for passengers (sheet or single-seat alert). */
  const executePassengerSeatCancel = useCallback(
    async (args: {
      bid: string;
      seatsToCancel: number;
      maxSeats: number;
      flow?: 'booking' | 'request';
    }) => {
      const { bid, seatsToCancel, maxSeats, flow = 'booking' } = args;
      if (!bid || seatsToCancel < 1) return;
      setCancellingBooking(true);
      try {
        const cancelAll = seatsToCancel >= maxSeats;
        const url = `${API.endpoints.bookings.cancel(bid)}?seats=${encodeURIComponent(
          String(seatsToCancel)
        )}&seatsToCancel=${encodeURIComponent(String(seatsToCancel))}`;

        await api.delete(url);
        invalidatePassengerBookedRidesCache();
        await refreshRideDetailEventDriven();

        if (cancelAll) {
          if (flow === 'request') {
            Alert.alert('Cancelled', 'Your seat request was cancelled.', [
              { text: 'OK', onPress: () => void navigateBackAfterCancel() },
            ]);
          } else {
            Alert.alert('Cancelled', 'Your booking was cancelled. You can find it under Past rides.', [
              { text: 'OK', onPress: () => void navigateBackAfterCancel() },
            ]);
          }
        } else {
          Alert.alert(
            'Updated',
            `Cancelled ${seatsToCancel} seat${seatsToCancel !== 1 ? 's' : ''}.`
          );
        }
      } catch (e: unknown) {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Could not cancel booking.';
        Alert.alert('Error', message);
      } finally {
        setCancellingBooking(false);
        setCancelBookingBid(null);
        setCancelBookingMaxSeats(1);
        setCancelBookingSeatsToCancel(1);
      }
    },
    [refreshRideDetailEventDriven, navigateBackAfterCancel]
  );

  const handleCancelBooking = () => {
    const bid = myPassengerBooking?.id?.trim();
    if (!bid) {
      Alert.alert('Cancel booking', 'Could not find your booking. Try again in a moment.');
      return;
    }
    if (cancellingBooking) return;
    // Max seats to show in the cancellation sheet should reflect the viewer's active booked seats.
    const myBookingSeats = viewerBookedSeats > 0 ? Math.max(1, Math.floor(viewerBookedSeats)) : 1;

    if (myBookingSeats === 1) {
      Alert.alert(
        'Cancel booking?',
        'Cancel your seat on this ride? You can book again if seats are still available.',
        [
          { text: 'Keep booking', style: 'cancel' },
          {
            text: 'Cancel booking',
            style: 'destructive',
            onPress: () =>
              void executePassengerSeatCancel({ bid, seatsToCancel: 1, maxSeats: 1, flow: 'booking' }),
          },
        ]
      );
      return;
    }

    setCancelBookingBid(bid);
    setCancelBookingMaxSeats(myBookingSeats);
    setCancelBookingSeatsToCancel(1);
    setCancelBookingSheetMode('booking');
    setCancelBookingSheetVisible(true);
  };

  const openPendingRequestActions = useCallback(() => {
    const bid = myPassengerBooking?.id?.trim();
    if (!bid) {
      Alert.alert('Request', 'Could not find your pending request. Please refresh and try again.');
      return;
    }
    if (cancellingBooking) return;
    const requestedSeatsRaw =
      typeof myPassengerBooking?.seats === 'number' && Number.isFinite(myPassengerBooking.seats)
        ? myPassengerBooking.seats
        : 1;
    const requestedSeats = Math.max(1, Math.floor(requestedSeatsRaw));

    if (requestedSeats === 1) {
      Alert.alert(
        'Cancel request?',
        'Withdraw your pending seat request for this ride?',
        [
          { text: 'Keep request', style: 'cancel' },
          {
            text: 'Cancel request',
            style: 'destructive',
            onPress: () =>
              void executePassengerSeatCancel({ bid, seatsToCancel: 1, maxSeats: 1, flow: 'request' }),
          },
        ]
      );
      return;
    }

    setCancelBookingBid(bid);
    setCancelBookingMaxSeats(requestedSeats);
    setCancelBookingSeatsToCancel(1);
    setCancelBookingSheetMode('request');
    setCancelBookingSheetVisible(true);
  }, [myPassengerBooking, cancellingBooking, executePassengerSeatCancel]);

  const closeCancelBookingSheet = useCallback(() => {
    if (cancellingBooking) return;
    setCancelBookingSheetVisible(false);
    setCancelBookingBid(null);
    setCancelBookingMaxSeats(1);
    setCancelBookingSeatsToCancel(1);
    setCancelBookingSheetMode('booking');
    setOwnerRemovePassengerLabel('');
  }, [cancellingBooking]);

  const navigateBackAfterCancel = useCallback(async () => {
    emitRequestMyRidesBlockingRefresh({
      blocking: true,
      expectedRemovedRideId: (ride.id ?? '').trim() || undefined,
    });
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Platform.OS === 'android' ? 220 : 280)
    );
    navigation.goBack();
  }, [navigation, ride.id]);

  const confirmCancelSeats = useCallback(
    async (seatsToCancel: number) => {
      const bid = cancelBookingBid;
      if (!bid) return;
      if (seatsToCancel < 1) return;

      if (cancelBookingSheetMode === 'owner_remove') {
        setCancelBookingSheetVisible(false);
        setCancellingBooking(true);
        const label = ownerRemovePassengerLabel.trim() || 'Passenger';
        try {
          await removePassengerBookingAsOwner(bid);
          invalidateRideDetailCache(initialRide.id);
          await refreshRideDetailEventDriven();
          Alert.alert('Passenger removed', `${label} was removed from this ride.`);
        } catch (e: unknown) {
          const message =
            e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : 'Could not remove passenger.';
          Alert.alert('Error', message);
        } finally {
          setCancellingBooking(false);
          setCancelBookingBid(null);
          setCancelBookingMaxSeats(1);
          setCancelBookingSeatsToCancel(1);
          setCancelBookingSheetMode('booking');
          setOwnerRemovePassengerLabel('');
        }
        return;
      }

      setCancelBookingSheetVisible(false);
      await executePassengerSeatCancel({
        bid,
        seatsToCancel,
        maxSeats: cancelBookingMaxSeats,
        flow: cancelBookingSheetMode === 'request' ? 'request' : 'booking',
      });
    },
    [
      cancelBookingBid,
      cancelBookingMaxSeats,
      cancelBookingSheetMode,
      ownerRemovePassengerLabel,
      executePassengerSeatCancel,
      fetchRideDetail,
      initialRide.id,
    ]
  );

  const openOwnerRemovePassengerSheet = useCallback(
    (booking: BookingItem, passengerLabel: string) => {
      if (!isOwnerStrict) return;
      const bid = booking.id?.trim();
      if (!bid) {
        Alert.alert('Remove passenger', 'Could not find this booking. Pull to refresh and try again.');
        return;
      }
      const statusLo = String(booking.status ?? '').trim().toLowerCase();
      if (statusLo === 'pending' || statusLo === 'rejected') return;
      if (bookingIsCancelledByOwner(booking.status)) {
        const partial = Boolean(
          (booking as BookingItem & { ownerPartialSeatRemoval?: boolean }).ownerPartialSeatRemoval
        );
        if (!partial) return;
      } else if (bookingIsCancelled(booking.status)) {
        return;
      }
      if (isTooCloseForOwnerRemovePassenger(ride)) {
        Alert.alert(
          'Too close to departure',
          'Passengers can’t be removed within 1 hour of the ride’s start time.'
        );
        return;
      }
      const maxSeats = Math.max(
        1,
        effectiveOccupiedSeatsFromBookingRow(booking) || bookingSeatCount(booking)
      );
      setCancelBookingBid(bid);
      setCancelBookingMaxSeats(maxSeats);
      setCancelBookingSeatsToCancel(1);
      setCancelBookingSheetMode('owner_remove');
      setOwnerRemovePassengerLabel(passengerLabel);
      setCancelBookingSheetVisible(true);
    },
    [isOwnerStrict, ride]
  );

  const runOwnerCancelRide = useCallback(async () => {
    setCancelRideConfirmVisible(false);
    setCancelling(true);
    try {
      await api.delete(API.endpoints.rides.detail(ride.id));
      await recordOwnerCancelledRide(currentUserId, {
        id: ride.id,
        userId: ride.userId ?? currentUserId,
        pickupLocationName: ride.pickupLocationName,
        destinationLocationName: ride.destinationLocationName,
        pickupLatitude: ride.pickupLatitude,
        pickupLongitude: ride.pickupLongitude,
        destinationLatitude: ride.destinationLatitude,
        destinationLongitude: ride.destinationLongitude,
        scheduledAt: ride.scheduledAt,
        scheduledDate: ride.scheduledDate,
        scheduledTime: ride.scheduledTime,
        rideDate: ride.rideDate,
        rideTime: ride.rideTime,
        price: ride.price,
        seats: ride.seats,
        username: ride.username,
        ...(ride.name ? { name: ride.name } : {}),
        estimatedDurationSeconds: ride.estimatedDurationSeconds,
        status: 'cancelled',
      });
      await navigateBackAfterCancel();
    } catch (e: unknown) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Failed to cancel ride.';
      Alert.alert('Error', message);
    } finally {
      setCancelling(false);
    }
  }, [ride, currentUserId, navigateBackAfterCancel]);

  const handleCancelRide = () => {
    if (!isOwnerStrict) {
      Alert.alert('Not allowed', 'Only the driver can cancel this ride.');
      return;
    }
    setCancelRideConfirmVisible(true);
  };

  const handleSkipRating = useCallback(() => {
    if (!currentUserId) {
      setShowRatingModal(false);
      return;
    }
    void markRatingPromptHandled(currentUserId, ride.id);
    setShowRatingModal(false);
  }, [currentUserId, ride.id]);

  const handleSubmitRating = useCallback(async () => {
    if (ratingSubmitting || ratingSubmitted) return;
    if (!currentUserId) return;
    if (!ratingTargetUserId) {
      Alert.alert('Rating unavailable', 'Could not find who to rate for this completed ride.');
      return;
    }
    if (ratingStars < 1 || ratingStars > 5) {
      Alert.alert('Select rating', 'Please select 1 to 5 stars.');
      return;
    }

    setRatingSubmitting(true);
    try {
      await submitRideRating({
        rideId: ride.id,
        toUserId: ratingTargetUserId,
        rating: ratingStars,
        review: ratingReview.trim() || undefined,
      });
      await markRatingPromptHandled(currentUserId, ride.id);
      if (isOwner) {
        void mergeOwnerRatedPassenger(currentUserId, ride.id, ratingTargetUserId);
      } else {
        void mergePassengerRatedRide(currentUserId, ride.id);
      }
      setRatingSubmitted(true);
      setShowRatingModal(false);
      Alert.alert('Thanks for your feedback');
    } catch (e: unknown) {
      const status =
        e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;
      if (status === 409) {
        await markRatingPromptHandled(currentUserId, ride.id);
        if (isOwner) {
          void mergeOwnerRatedPassenger(currentUserId, ride.id, ratingTargetUserId);
        } else {
          void mergePassengerRatedRide(currentUserId, ride.id);
        }
        setRatingSubmitted(true);
        setShowRatingModal(false);
        Alert.alert('Already rated', 'Your feedback was recorded earlier.');
        return;
      }
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Could not submit rating right now.';
      Alert.alert('Error', message);
    } finally {
      setRatingSubmitting(false);
    }
  }, [
    ratingSubmitting,
    ratingSubmitted,
    currentUserId,
    ratingTargetUserId,
    ratingStars,
    ratingReview,
    ride.id,
    isOwner,
  ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ride plan</Text>
        <View style={styles.headerTrailingSpacer} />
      </View>

      <>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          showFixedActionFooter ? { paddingBottom: 128 + insets.bottom } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Main ride card (reference layout) */}
        <View style={styles.detailCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardDateTime}>
              {cardDateShort} • {pickupTime}
            </Text>
          </View>

          {showDualRouteForViewer ? (
            <View style={styles.routeStack}>
              <Text style={styles.routeSectionLabel}>{"Driver's route (published)"}</Text>
              <View style={styles.cardRouteRow}>
                <View style={styles.cardRouteTimeline}>
                  <View style={styles.hollowDot} />
                  <View style={styles.timelineDashCompact} />
                  <Ionicons name="location" size={18} color={COLORS.primary} />
                </View>
                <View style={styles.cardRouteTextCol}>
                  <View style={styles.cardRouteStop}>
                    <Text style={styles.routeLabelCompact}>PICKUP</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {publishedPickupStr}
                    </Text>
                  </View>
                  <View style={styles.cardRouteStopSpacedCompact}>
                    <Text style={styles.routeLabelCompact}>DROP-OFF</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {publishedDestStr}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.routeSubDivider} />

              <Text style={styles.routeSectionLabel}>
                {isBookedByMe ? 'Your pickup & drop-off' : 'Your pickup & drop-off (search)'}
              </Text>
              <View style={styles.cardRouteRow}>
                <View style={styles.cardRouteTimeline}>
                  <View style={styles.hollowDotSmall} />
                  <View style={styles.timelineDashCompact} />
                  <Ionicons name="location" size={18} color={COLORS.textSecondary} />
                </View>
                <View style={styles.cardRouteTextCol}>
                  <View style={styles.cardRouteStop}>
                    <Text style={styles.routeLabelCompact}>PICKUP</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {viewerPickupStr}
                    </Text>
                  </View>
                  <View style={styles.cardRouteStopSpacedCompact}>
                    <Text style={styles.routeLabelCompact}>DROP-OFF</Text>
                    <Text style={styles.routePlaceCompact} numberOfLines={4}>
                      {viewerDestStr}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.cardRouteRow}>
              <View style={styles.cardRouteTimeline}>
                <View style={styles.hollowDot} />
                <View style={styles.timelineDash} />
                <Ionicons name="location" size={20} color={COLORS.primary} />
              </View>
              <View style={styles.cardRouteTextCol}>
                <View style={styles.cardRouteStop}>
                  <Text style={styles.routeLabel}>
                    {isOwner ? 'PICKUP' : isBookedByMe ? 'YOUR PICKUP' : 'PICKUP'}
                  </Text>
                  <Text style={styles.routePlace} numberOfLines={2}>
                    {pickupLabel}
                  </Text>
                </View>
                <View style={styles.cardRouteStopSpaced}>
                  <Text style={styles.routeLabel}>
                    {isOwner ? 'DROP-OFF' : isBookedByMe ? 'YOUR DROP-OFF' : 'DROP-OFF'}
                  </Text>
                  <Text style={styles.routePlace} numberOfLines={2}>
                    {destinationLabel}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {publisherCoords ? (
            <TouchableOpacity
              style={styles.viewRouteMapRow}
              onPress={openPublishedRouteMap}
              activeOpacity={0.75}
            >
              <View style={styles.viewRouteMapIconWrap}>
                <Ionicons name="map-outline" size={22} color={COLORS.primary} />
              </View>
              <View style={styles.viewRouteMapTextCol}>
                <Text style={styles.viewRouteMapTitle}>View route map</Text>
                <Text style={styles.viewRouteMapSub} numberOfLines={2}>
                  Driving directions for the route the driver published
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.cardDivider} />

          {!isOwner ? <Text style={styles.driverRowSectionLabel}>Driver</Text> : null}

          <View style={styles.cardDriverRow}>
            <View style={styles.avatarWrap}>
              <UserAvatar
                uri={cardAvatarUri}
                name={cardAvatarName}
                size={isOwner ? 44 : 38}
                backgroundColor={COLORS.primary}
                fallbackTextColor={COLORS.white}
              />
            </View>
            <View style={styles.cardDriverText}>
              <View style={styles.cardDriverNameRow}>
                <Text
                  style={[styles.driverNameBold, !isOwner && styles.driverNamePassenger]}
                  numberOfLines={isOwner ? 2 : 1}
                >
                  {cardPersonName}
                </Text>
              </View>
              {cardPersonSubtitle ? (
                <Text
                  style={[styles.driverVehicle, !isOwner && styles.driverVehiclePassenger]}
                  numberOfLines={isOwner ? 2 : 1}
                >
                  {cardPersonSubtitle}
                </Text>
              ) : null}
            </View>
            {!isOwner ? (
              <View style={styles.cardDriverActions}>
                {passengerCanMessageOwner ? (
                  <TouchableOpacity
                    style={styles.ownerChatIconBtn}
                    onPress={openChatWithOwner}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${driverName || 'the driver'}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={22} color={COLORS.primary} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.detailsPill, styles.detailsPillDriver]}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${driverName || 'driver'} profile`}
                  accessibilityHint="Opens ratings, trip history, and profile details"
                  onPress={() => {
                    const ownerId = (ride.userId ?? '').trim();
                    if (!ownerId) {
                      scrollRef.current?.scrollToEnd({ animated: true });
                      return;
                    }

                    // Hide bottom tabs immediately while the profile screen mounts.
                    const parentNav = (navigation as any)?.getParent?.();
                    parentNav?.setOptions?.({ tabBarStyle: { display: 'none' } });

                    const ridesSourceTab = getRideDetailSourceMainTab(navigation);
                    /** Driver number only after the passenger has a confirmed seat (not pending request). */
                    const passengerMaySeeDriverPhone = isBookedByMe;
                    const pubPhone = passengerMaySeeDriverPhone ? pickPublisherPhoneFromRide(ride) : undefined;

                    (navigation as any).navigate('OwnerProfileModal', {
                      userId: ownerId,
                      displayName: driverName || ride.name || ride.username || 'User',
                      ...(publisherDeactivated ? { peerDeactivated: true } : {}),
                      ...(ride.publisherAvatarUrl?.trim() && !publisherDeactivated
                        ? { avatarUrl: ride.publisherAvatarUrl.trim() }
                        : {}),
                      ...(typeof ride.publisherAvgRating === 'number' &&
                      Number.isFinite(ride.publisherAvgRating)
                        ? { publisherAvgRating: ride.publisherAvgRating }
                        : {}),
                      ...(typeof ride.publisherRatingCount === 'number' &&
                      Number.isFinite(ride.publisherRatingCount) &&
                      ride.publisherRatingCount >= 0
                        ? { publisherRatingCount: ride.publisherRatingCount }
                        : {}),
                      ...(ride.publisherDateOfBirth?.trim()
                        ? { dateOfBirth: ride.publisherDateOfBirth.trim() }
                        : {}),
                      ...(pubPhone ? { publisherPhone: pubPhone } : {}),
                      ...(!passengerMaySeeDriverPhone ? { hidePublisherPhone: true } : {}),
                      _returnToRide: {
                        tab: ridesSourceTab,
                        params: {
                          ride,
                          ...(passengerSearch ? { passengerSearch } : {}),
                        },
                      },
                    });
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.detailsPillText, styles.detailsPillDriverText]}>View profile</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {ridePreferenceIdsForDetail.length > 0 ? (
          <View
            style={[styles.detailCard, styles.vehicleInfoDetailCard]}
            accessibilityRole="summary"
            accessibilityLabel="Ride preferences"
          >
            <Text style={styles.vehicleInfoSectionLabel}>Ride preferences</Text>
            <View style={styles.ridePrefsRow}>
              <View style={styles.ridePrefsIconWrap} importantForAccessibility="no-hide-descendants">
                <Ionicons name="options-outline" size={22} color={COLORS.primary} />
              </View>
              <View style={styles.ridePrefsTextCol}>
                <RidePreferenceChips ids={ridePreferenceIdsForDetail} />
              </View>
            </View>
          </View>
        ) : null}

        {/* Fare & payment — directly after trip summary so price sits with route/driver context */}
        <View
          style={[styles.detailCard, styles.vehicleInfoDetailCard]}
          accessibilityRole="summary"
          accessibilityLabel={`Payment. Pay in cash. ${totalBookedPriceText ?? priceDisplay ?? ''}`}
        >
          <Text style={styles.vehicleInfoSectionLabel}>Fare & payment</Text>
          <View style={styles.paymentRow}>
            <View style={styles.paymentRowLeft}>
              <Text style={styles.paymentMethod}>Pay in cash (₹)</Text>
              <Text style={styles.paymentSeats}>
                {!isOwner
                  ? viewerBookedSeats > 0
                    ? `${viewerBookedSeats} seat${viewerBookedSeats !== 1 ? 's' : ''} booked · ${availableSeatsCount} left`
                    : getRideAvailabilityShort(ride) || '—'
                  : getRideAvailabilityShort(ride) ||
                    `${totalSeats} seat${totalSeats !== 1 ? 's' : ''} offered`}
              </Text>
            </View>
            <Text style={styles.paymentPrice}>
              {totalBookedPriceText ?? (priceDisplay !== '—' ? priceDisplay : '₹—')}
            </Text>
          </View>
        </View>

        {hasVehicleDetailsForBlock ? (
          <View
            style={[styles.detailCard, styles.vehicleInfoDetailCard]}
            accessibilityRole="summary"
            accessibilityLabel={[
              'Vehicle',
              vehicleNameLine.trim() || undefined,
              vehiclePlateLine.trim() ? `License plate ${vehiclePlateLine}` : undefined,
              vehicleColorLine.trim() || undefined,
            ]
              .filter(Boolean)
              .join('. ')}
          >
            <Text style={styles.vehicleInfoSectionLabel}>Vehicle</Text>
            <View style={styles.vehicleInfoCardRow}>
              <View style={styles.vehicleInfoIconWrap} importantForAccessibility="no-hide-descendants">
                <Ionicons name="car-outline" size={22} color="#4f46e5" />
              </View>
              <View style={styles.vehicleInfoTextCol}>
                <Text style={styles.vehicleInfoModel} numberOfLines={2}>
                  {vehicleNameLine.trim() ? vehicleNameLine : 'Vehicle'}
                </Text>
                {(vehiclePlateLine.trim() || vehicleColorLine.trim()) ? (
                  <View style={styles.vehicleInfoMetaRow}>
                    {vehiclePlateLine.trim() ? (
                      <View style={styles.vehicleInfoPlatePill}>
                        <Text style={styles.vehicleInfoPlateText} numberOfLines={1}>
                          {vehiclePlateLine}
                        </Text>
                      </View>
                    ) : null}
                    {vehicleColorLine.trim() ? (
                      <View style={styles.vehicleInfoColorRow}>
                        <View
                          style={[
                            styles.vehicleInfoColorSwatch,
                            {
                              backgroundColor: vehicleColorLabelToSwatchHex(vehicleColorLine),
                            },
                          ]}
                        />
                        <Text style={styles.vehicleInfoColorName} numberOfLines={1}>
                          {vehicleColorLine}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {rideDescriptionText ? (
          <View
            style={[styles.detailCard, styles.vehicleInfoDetailCard]}
            accessibilityRole="summary"
            accessibilityLabel={`Driver notes. ${rideDescriptionText}`}
          >
            <Text style={styles.vehicleInfoSectionLabel}>Driver notes</Text>
            <View style={styles.rideDescriptionRow}>
              <View style={styles.rideDescriptionIconWrap} importantForAccessibility="no-hide-descendants">
                <Ionicons name="document-text-outline" size={22} color={COLORS.primary} />
              </View>
              <Text
                style={styles.rideDescriptionBody}
                selectable
              >
                {rideDescriptionText}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Seat requests (owner + request-book mode) */}
        {isOwner && isRequestBookingMode && availableSeatsCount > 0 ? (
          <View style={[styles.block, styles.seatRequestsBlock]}>
            <View style={styles.seatRequestsHeader}>
              <Text style={styles.seatRequestsHeading}>
                Requests <Text style={styles.seatRequestsCount}>{ownerPendingRequestCountForDisplay}</Text>
              </Text>
              {seatRequestsLoading && pendingSeatRequests.length > 0 ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={styles.seatRequestsHeaderSpinner} />
              ) : null}
            </View>
            {pendingSeatRequests.length > 0 ? (
              <View
                style={[
                  styles.seatRequestsList,
                  seatRequestsLoading ? styles.seatRequestsListRefreshing : null,
                ]}
              >
                {pendingSeatRequests.map((b) => {
                  const displayName = bookingPassengerDisplayName(b);
                  const { lineShort } = bookingPickupDrop(ride, b);
                  const actionBusy = seatRequestActionBookingId === b.id;
                  const createdAt = new Date(b.bookedAt);
                  const requestAgo = (() => {
                    if (Number.isNaN(createdAt.getTime())) return '';
                    const mins = Math.max(1, Math.floor((Date.now() - createdAt.getTime()) / 60000));
                    if (mins < 60) return `${mins}m ago`;
                    const hours = Math.floor(mins / 60);
                    if (hours < 24) return `${hours}h ago`;
                    const days = Math.floor(hours / 24);
                    return `${days}d ago`;
                  })();
                  const [fromLine = lineShort, toLine = ''] = String(lineShort).split('→').map((s) => s.trim());
                  return (
                    <TouchableOpacity
                      key={`req_${b.id}`}
                      style={styles.seatRequestCard}
                      activeOpacity={0.82}
                      onPress={() => openSeatRequestDetail(b)}
                    >
                      <View style={styles.seatRequestTop}>
                        <View style={styles.seatRequestTopLeft}>
                          <View style={styles.seatRequestIdentityRow}>
                            <UserAvatar
                              uri={b.avatarUrl}
                              name={displayName}
                              size={38}
                              backgroundColor="#e2e8f0"
                            />
                            <View style={styles.seatRequestIdentityText}>
                              <Text style={styles.seatRequestName} numberOfLines={1}>
                                {displayName}
                              </Text>
                              <View style={styles.seatRequestMetaRow}>
                                {requestAgo ? (
                                  <Text style={styles.seatRequestMetaTextMuted}>{requestAgo}</Text>
                                ) : null}
                              </View>
                            </View>
                          </View>
                          <View style={styles.seatRequestRouteWrap}>
                            <Text style={styles.seatRequestRouteLine} numberOfLines={1}>
                              • {fromLine}
                            </Text>
                            {toLine ? (
                              <Text style={styles.seatRequestRouteLine} numberOfLines={1}>
                                • {toLine}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.seatRequestSeatsBadge}>
                          <Text style={styles.seatRequestSeats}>
                            {b.seats} seat{b.seats !== 1 ? 's' : ''}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.seatRequestDivider} />
                      <View style={styles.seatRequestActions}>
                        <TouchableOpacity
                          style={styles.seatRequestApproveBtn}
                          activeOpacity={0.75}
                          onPress={() => void handleSeatRequestAction(b.id, 'approve')}
                          disabled={actionBusy}
                        >
                          {actionBusy ? (
                            <ActivityIndicator size="small" color={COLORS.white} />
                          ) : (
                            <Text style={styles.seatRequestApproveText}>Approve</Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.seatRequestRejectBtn}
                          activeOpacity={0.75}
                          onPress={() => void handleSeatRequestAction(b.id, 'reject')}
                          disabled={actionBusy}
                        >
                          {actionBusy ? (
                            <ActivityIndicator size="small" color={COLORS.error} />
                          ) : (
                            <Text style={styles.seatRequestRejectText}>Reject</Text>
                          )}
                        </TouchableOpacity>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : seatRequestsLoading ? (
              <View style={styles.seatRequestsPlaceholder}>
                <View style={styles.seatRequestsSkeletonCard}>
                  <View style={styles.seatRequestsSkeletonLineWide} />
                  <View style={styles.seatRequestsSkeletonLine} />
                </View>
                <View style={styles.seatRequestsSkeletonCard}>
                  <View style={styles.seatRequestsSkeletonLineWide} />
                  <View style={styles.seatRequestsSkeletonLine} />
                </View>
                <View style={styles.seatRequestsLoadingRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.seatRequestsLoadingText}>Loading requests…</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.noPassengers}>No pending requests</Text>
            )}
          </View>
        ) : null}

        {/* Passengers: signed-in owner gets management list; everyone else (incl. guests) sees who’s already booked. */}
        {(sessionReady && isOwner) || !isOwner ? (
          <View style={styles.block}>
            <Text style={styles.passengersHeading}>Passengers</Text>
            {sessionReady && isOwner ? (
              ownerPassengerSummariesForDisplay.length > 0 ? (
                <View style={styles.passengersList}>
                  {ownerPassengerSummariesForDisplay.map(({ userId: ownerSummaryUserId, primary, historyChronological }) => {
                    const b = primary;
                    const isMe = (b.userId ?? '').trim() === currentUserId;
                    const displayName = isMe ? (currentUserName || 'You') : bookingPassengerDisplayName(b);
                    const bookingCancelled = bookingIsCancelled(b.status);
                    /** Only when API marks partial owner removal; `seats` may be non-zero on full removal for display. */
                    const partialOwnerRemoveStillBooked =
                      bookingIsCancelledByOwner(b.status) &&
                      bookingSeatCount(b) > 0 &&
                      Boolean(
                        (b as BookingItem & { ownerPartialSeatRemoval?: boolean }).ownerPartialSeatRemoval
                      );
                    const bookingCancelledForDisplay = bookingCancelled && !partialOwnerRemoveStillBooked;
                    const lastActiveHistoryRow = [...historyChronological]
                      .reverse()
                      .find((h) => {
                        const s = String(h.status ?? '').trim().toLowerCase();
                        if (s === 'pending' || s === 'rejected') return false;
                        if (bookingIsCancelled(h.status)) return false;
                        return bookingSeatCount(h) > 0;
                      });
                    const removedSeatsFromHistory = bookingSeatCount(lastActiveHistoryRow ?? ({} as BookingItem));
                    const maxSeatsSeenInHistory = historyChronological.reduce(
                      (max, h) => Math.max(max, bookingSeatCount(h)),
                      0
                    );
                    const currentSeats = effectiveOccupiedSeatsFromBookingRow(b) || bookingSeatCount(b);
                    const seatCountForOwnerRow =
                      bookingCancelledForDisplay && bookingIsCancelledByOwner(b.status)
                        ? Math.max(currentSeats, removedSeatsFromHistory, maxSeatsSeenInHistory)
                        : currentSeats;
                    const isRebooked =
                      !partialOwnerRemoveStillBooked &&
                      !bookingCancelledForDisplay &&
                      !isPastRide &&
                      passengerRowShowRebookedBadge(b, passengers);
                    const shouldFadeCancelled = bookingCancelledForDisplay && !isRebooked;
                    const mergedForRoute: BookingItem =
                      isMe && passengerSearch?.from?.trim() && passengerSearch?.to?.trim()
                        ? {
                            ...b,
                            pickupLocationName:
                              b.pickupLocationName?.trim() || passengerSearch.from.trim(),
                            destinationLocationName:
                              b.destinationLocationName?.trim() || passengerSearch.to.trim(),
                          }
                        : b;
                    const { lineShort } = bookingPickupDrop(ride, mergedForRoute);
                    const statusLo = String(b.status ?? '').trim().toLowerCase();
                    const passengerUid = (b.userId ?? '').trim();
                    const canOwnerRemoveFromAnyHistoryRow = historyChronological.some(
                      (h) => bookingFlag(h as BookingItem, 'canOwnerRemove') === true
                    );
                    const canOwnerRemoveFromAnyPassengerRow =
                      passengerUid.length > 0 &&
                      passengers.some(
                        (row) =>
                          (row.userId ?? '').trim() === passengerUid &&
                          bookingFlag(row, 'canOwnerRemove') === true
                      );
                    const canOwnerRemovePassenger =
                      ((): boolean => {
                        if (canOwnerRemoveFromAnyHistoryRow || canOwnerRemoveFromAnyPassengerRow) return true;
                        const backendCanOwnerRemove = bookingFlag(b, 'canOwnerRemove');
                        // Keep backward-compatible behavior: honor explicit allow from backend,
                        // but when backend sends false/omits due rollout mismatch, use legacy rule.
                        if (backendCanOwnerRemove === true) return true;
                        return (
                      isOwnerStrict &&
                      !isPastRide &&
                      !isOwnerRideCancelled &&
                      !isMe &&
                      bookingSeatCount(b) > 0 &&
                      (partialOwnerRemoveStillBooked ||
                        (bookingRowHoldsOccupiedSeats(b) &&
                          !isPendingLikeBookingStatus(statusLo) &&
                          statusLo !== 'rejected' &&
                          !bookingIsCancelled(b.status)))
                        );
                      })();

                    return (
                      <View
                        key={ownerSummaryUserId || b.id}
                        style={[styles.passengerRowOwner, shouldFadeCancelled && styles.passengerRowCancelled]}
                      >
                        <TouchableOpacity
                          style={styles.passengerRowOwnerMainTap}
                          onPress={() => {
                            const ownerBookingHistoryLines = computeOwnerBookingHistoryLinesForPassenger(
                              ownerSummaryUserId,
                              primary,
                              historyChronological
                            );
                            (navigation as { navigate: (n: string, p: Record<string, unknown>) => void }).navigate(
                              'BookPassengerDetail',
                              {
                                ride,
                                booking: b,
                                ...(ownerBookingHistoryLines.length > 0
                                  ? { ownerBookingHistoryLines }
                                  : {}),
                              }
                            );
                          }}
                          activeOpacity={shouldFadeCancelled ? 0.55 : 0.72}
                        >
                          <View style={styles.passengerRowOwnerIcon}>
                            <UserAvatar
                              uri={
                                isMe
                                  ? (b.avatarUrl?.trim() || user?.avatarUrl?.trim() || undefined)
                                  : (b.avatarUrl ?? '').trim() || undefined
                              }
                              name={displayName}
                              size={40}
                              backgroundColor="rgba(41, 190, 139, 0.14)"
                              fallbackTextColor={COLORS.primary}
                            />
                          </View>
                          <View style={styles.passengerRowOwnerText}>
                            <View style={styles.passengerNameRow}>
                              <Text
                                style={[styles.passengerNameOwner, shouldFadeCancelled && styles.passengerNameCancelled]}
                              >
                                {displayName}
                              </Text>
                            </View>
                            {bookingCancelledForDisplay || isRebooked ? (
                              <Text
                                style={[
                                  styles.passengerBookingCancelledLabel,
                                  isRebooked && styles.passengerBookingRebookedLabel,
                                ]}
                              >
                                {isRebooked
                                  ? 'Rebooked'
                                  : bookingIsCancelledByOwner(b.status)
                                    ? 'Removed by you'
                                    : 'Cancelled'}
                              </Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                        <View style={styles.passengerRowOwnerRight}>
                          <View style={styles.passengerRowRightActions}>
                            <Text
                              style={[
                                styles.passengerSeatsCompact,
                                shouldFadeCancelled && styles.passengerNameCancelled,
                              ]}
                            >
                              {seatCountForOwnerRow} seat{seatCountForOwnerRow !== 1 ? 's' : ''}
                            </Text>
                            {!shouldFadeCancelled &&
                            bookingSeatCount(b) > 0 &&
                            !bookingPassengerDeactivated(b) ? (
                              <TouchableOpacity
                                style={styles.passengerChatIconBtn}
                                onPress={() => {
                                  const userId = (b.userId ?? '').trim();
                                  if (!userId) return;
                                  const rid = String(ride.id ?? '').trim();
                                  if (!rid) return;
                                  navigation.navigate('Chat', {
                                    ride,
                                    rideId: rid,
                                    otherUserId: userId,
                                    otherUserName: displayName.trim() || 'Passenger',
                                    ...(b.avatarUrl?.trim() ? { otherUserAvatarUrl: b.avatarUrl.trim() } : {}),
                                  });
                                }}
                                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                accessibilityRole="button"
                                accessibilityLabel="Chat with passenger"
                              >
                                <Ionicons name="chatbubble-ellipses-outline" size={24} color={COLORS.primary} />
                              </TouchableOpacity>
                            ) : null}
                            {canOwnerRemovePassenger ? (
                              <TouchableOpacity
                                style={styles.passengerOwnerRemoveBtn}
                                onPress={() => openOwnerRemovePassengerSheet(b, displayName)}
                                disabled={cancellingBooking}
                                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                              >
                                <Text style={styles.passengerOwnerRemoveText}>Remove</Text>
                              </TouchableOpacity>
                            ) : (
                              !shouldFadeCancelled ? <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} /> : null
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.noPassengers}>No other passengers yet</Text>
              )
            ) : !isOwner && passengersForDisplayFiltered.length > 0 ? (
              <View style={styles.passengersList}>
                {passengersForDisplayFiltered.map((b) => {
                  const isMe = (b.userId ?? '').trim() === currentUserId;
                  const uidForHistory = (b.userId ?? '').trim();
                  const historySummary = uidForHistory
                    ? perUserPassengerSummaries.find((s) => (s.userId ?? '').trim() === uidForHistory)
                    : perUserPassengerSummaries.find((s) => s.primary.id === b.id);
                  const historyChronological = historySummary?.historyChronological ?? [];
                  const historyCancelledOnly = historyChronological.filter((h) => bookingIsCancelled(h.status));
                  const displayName = isMe ? (currentUserName || 'You') : bookingPassengerDisplayName(b);
                  const bookingCancelled = bookingIsCancelled(b.status);
                  const isRebooked =
                    !bookingCancelled &&
                    !isPastRide &&
                    passengerRowShowRebookedBadge(b, passengers);
                  const shouldFadeCancelled = bookingCancelled && !isRebooked;

                  const coPassengerUid = (b.userId ?? '').trim();
                  /** Open ratings modal for any viewer with a passenger user id (incl. guests). */
                  const canOpenRatings = Boolean(coPassengerUid);
                  const rowAvatarUri =
                    isMe
                      ? (b.avatarUrl?.trim() || user?.avatarUrl?.trim() || undefined)
                      : b.avatarUrl?.trim() || undefined;
                  const avgKnown =
                    typeof b.avgRating === 'number' && Number.isFinite(b.avgRating) && b.avgRating > 0
                      ? b.avgRating
                      : null;
                  const rc =
                    typeof b.ratingCount === 'number' && b.ratingCount > 0 ? Math.floor(b.ratingCount) : 0;

                  const coPassengerBody = (
                    <>
                      <View style={styles.passengerRowOwnerIcon}>
                        <UserAvatar
                          uri={rowAvatarUri}
                          name={displayName}
                          size={40}
                          backgroundColor="rgba(41, 190, 139, 0.14)"
                          fallbackTextColor={COLORS.primary}
                        />
                      </View>
                      <View style={styles.passengerRowOwnerText}>
                        <View style={styles.passengerNameRow}>
                          <Text
                            style={[styles.passengerNameOwner, shouldFadeCancelled && styles.passengerNameCancelled]}
                          >
                            {displayName}
                          </Text>
                        </View>
                        {bookingCancelled || isRebooked ? (
                          <Text
                            style={[
                              styles.passengerBookingCancelledLabel,
                              isRebooked && styles.passengerBookingRebookedLabel,
                            ]}
                          >
                            {isRebooked
                              ? 'Rebooked'
                              : bookingIsCancelledByOwner(b.status) ||
                                  bookingHistoryTreatAsCancelledByOwner(b, historyChronological)
                                ? 'Cancelled by owner'
                                : 'Cancelled'}
                          </Text>
                        ) : null}
                        {avgKnown != null ? (
                          <View style={styles.passengerRatingRow}>
                            <Ionicons name="star" size={14} color="#f59e0b" />
                            <Text style={styles.passengerRatingAvg}>{avgKnown.toFixed(1)}</Text>
                            {rc > 0 ? (
                              <Text style={styles.passengerRatingCount}>
                                ({rc} ride{rc !== 1 ? 's' : ''})
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                        <Text
                          style={[
                            styles.passengerSeatsMeta,
                            shouldFadeCancelled && styles.passengerNameCancelled,
                          ]}
                        >
                          {b.seats} seat{b.seats !== 1 ? 's' : ''}
                        </Text>
                      </View>
                      <View style={styles.passengerRowOwnerRight}>
                        <View style={styles.passengerRowRightActions}>
                          {canOpenRatings ? (
                            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                          ) : null}
                        </View>
                      </View>
                    </>
                  );

                  return canOpenRatings ? (
                    <TouchableOpacity
                      key={b.id}
                      style={[
                        styles.passengerRowOwner,
                        styles.passengerRowCopassenger,
                        shouldFadeCancelled && styles.passengerRowCancelled,
                      ]}
                      onPress={() => openCoPassengerRatings(b, displayName, rowAvatarUri)}
                      activeOpacity={shouldFadeCancelled ? 0.55 : 0.72}
                    >
                      {coPassengerBody}
                    </TouchableOpacity>
                  ) : (
                    <View
                      key={b.id}
                      style={[
                        styles.passengerRowOwner,
                        styles.passengerRowCopassenger,
                        shouldFadeCancelled && styles.passengerRowCancelled,
                      ]}
                    >
                      {coPassengerBody}
                    </View>
                  );
                })}
              </View>
            ) : !isOwner ? (
              <Text style={styles.noPassengers}>No other passengers yet</Text>
            ) : null}
          </View>
        ) : null}

        {isOwnerStrict && isOwnerRideCancelled ? null : isOwnerStrict && !isPastRide ? null : showPassengerCancelFixedAction ? null : showPassengerPendingFixedAction ? null : showPassengerRejectedFixedAction ? null : !isOwner && rideCancelledByOwner ? (
          <View style={[styles.button, styles.buttonOwnerRideCancelled]}>
            <Ionicons name="ban-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonOwnerRideCancelledText}>Ride cancelled by the driver</Text>
          </View>
        ) : !isOwner && passengerRemovedByOwner && !isPastRide && !rideCancelledByOwner ? (
          <View style={[styles.button, styles.buttonOwnerRideCancelled]}>
            <Ionicons name="person-remove-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonOwnerRideCancelledText}>
              The driver removed you from this ride. You can’t book it again.
            </Text>
          </View>
        ) : !isOwner && passengerRemovedByOwner && isPastRide ? (
          <View style={[styles.button, styles.buttonBookingCancelled]}>
            <Ionicons name="person-remove-outline" size={22} color={COLORS.error} />
            <Text style={styles.buttonBookingCancelledText}>Removed by the driver</Text>
          </View>
        ) : !isOwner && isMyBookingCancelled && isPastRide ? (
          <View style={[styles.button, styles.buttonBookingCancelled]}>
            <Ionicons name="ban-outline" size={22} color={COLORS.error} />
            <Text style={styles.buttonBookingCancelledText}>You cancelled your booking</Text>
          </View>
        ) : isPastRide && isOwnerStrict ? null : isPastRide ? (
          <View style={[styles.button, styles.buttonPastEnded]}>
            <Ionicons name="time-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonPastEndedText}>This ride is in the past</Text>
          </View>
        ) : availableSeatsCount <= 0 ? (
          <View style={[styles.button, styles.buttonPastEnded]}>
            <Ionicons name="people-outline" size={22} color={COLORS.textMuted} />
            <Text style={styles.buttonPastEndedText}>Full</Text>
          </View>
        ) : showPassengerBookFixedAction ? null : null}
      </ScrollView>
      {showFixedActionFooter ? (
        <View style={[styles.ownerActionsFooter, { paddingBottom: Math.max(10, insets.bottom) }]}>
          <View style={styles.ownerActionsFooterInner}>
            {showOwnerFixedActions ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.ownerActionBtn,
                    styles.ownerActionBtnCancel,
                    cancelling && styles.ownerActionBtnDisabled,
                  ]}
                  onPress={handleCancelRide}
                  disabled={cancelling}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel ride"
                >
                  {cancelling ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <>
                      <Ionicons name="close-circle-outline" size={20} color={COLORS.white} />
                      <Text style={styles.ownerActionBtnCancelText} numberOfLines={1}>
                        Cancel ride
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.ownerActionBtn,
                    styles.ownerActionBtnEdit,
                    cancelling && styles.ownerActionBtnDisabled,
                  ]}
                  onPress={handleEdit}
                  disabled={cancelling}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Edit ride"
                >
                  <Ionicons name="create-outline" size={20} color={COLORS.white} />
                  <Text style={styles.ownerActionBtnEditText} numberOfLines={1}>
                    Edit ride
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
            {showOwnerPastRepublishFixedAction ? (
              <TouchableOpacity
                style={[styles.button, styles.buttonRepublishPast, styles.footerSingleActionBtn]}
                onPress={handleEditAndRepublish}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh-circle-outline" size={22} color={COLORS.primary} />
                <Text style={styles.buttonRepublishPastText}>Edit & republish ride</Text>
              </TouchableOpacity>
            ) : null}
            {showPassengerCancelFixedAction ? (
              <TouchableOpacity
                style={[styles.button, styles.buttonCancelPassenger, styles.footerSingleActionBtn]}
                onPress={handleCancelBooking}
                disabled={cancellingBooking}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Cancel your ride"
              >
                {cancellingBooking ? (
                  <ActivityIndicator size="small" color={COLORS.error} />
                ) : (
                  <>
                    <Ionicons name="close-circle-outline" size={20} color={COLORS.error} />
                    <Text style={styles.buttonCancelPassengerText}>Cancel your ride</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            {showPassengerPendingFixedAction ? (
              <TouchableOpacity
                style={[styles.button, styles.buttonPendingRequest, styles.footerSingleActionBtn]}
                onPress={openPendingRequestActions}
                activeOpacity={0.85}
              >
                <Ionicons name="time-outline" size={22} color={COLORS.primary} />
                <Text style={styles.buttonPendingRequestText}>Request pending approval</Text>
              </TouchableOpacity>
            ) : null}
            {showPassengerRejectedFixedAction ? (
              <View style={[styles.button, styles.buttonRequestRejected, styles.footerSingleActionBtn]}>
                <Ionicons name="time-outline" size={22} color={COLORS.error} />
                <Text style={styles.buttonRequestRejectedText}>{driverName} rejected</Text>
              </View>
            ) : null}
            {showPassengerBookFixedAction ? (
              <View style={styles.footerBookWrap}>
                {passengerSelfCancelledBooking ? (
                  <Text style={styles.rebookHint}>You cancelled your booking — you can book again.</Text>
                ) : null}
                {availableSeatsCount > 1 ? (
                  <View style={styles.seatPickerRow}>
                    <Text style={styles.seatPickerLabel}>Seats</Text>
                    <View style={styles.seatPickerControls}>
                      <TouchableOpacity
                        style={[styles.seatPickerBtn, bookSeatsCount <= 1 && styles.seatPickerBtnDisabled]}
                        onPress={() => setBookSeatsCount((c) => Math.max(1, c - 1))}
                        disabled={bookSeatsCount <= 1 || booking}
                        hitSlop={8}
                      >
                        <Ionicons name="remove" size={22} color={COLORS.primary} />
                      </TouchableOpacity>
                      <Text style={styles.seatPickerValue}>{bookSeatsCount}</Text>
                      <TouchableOpacity
                        style={[
                          styles.seatPickerBtn,
                          bookSeatsCount >= availableSeatsCount && styles.seatPickerBtnDisabled,
                        ]}
                        onPress={() => setBookSeatsCount((c) => Math.min(availableSeatsCount, c + 1))}
                        disabled={bookSeatsCount >= availableSeatsCount || booking}
                        hitSlop={8}
                      >
                        <Ionicons name="add" size={22} color={COLORS.primary} />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.seatPickerHint}>
                      {availableSeatsCount} seat{availableSeatsCount !== 1 ? 's' : ''} left
                    </Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.buttonBook,
                    styles.footerSingleActionBtn,
                    bookButtonBlocked && styles.buttonBookDisabled,
                  ]}
                  onPress={() => void handleBook()}
                  disabled={booking || availableSeatsCount <= 0 || bookButtonBlocked}
                  activeOpacity={0.8}
                >
                  {booking ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="book-outline" size={22} color="#fff" />
                      <Text style={styles.buttonBookText}>
                        {isRequestBookingMode
                          ? passengerSelfCancelledBooking
                            ? 'Request again'
                            : bookSeatsCount > 1
                              ? 'Request seats'
                              : 'Request to book'
                          : passengerSelfCancelledBooking
                            ? 'Book again'
                            : bookSeatsCount > 1
                              ? 'Book seats'
                              : 'Book'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      <Modal
        visible={openingSeatRequestDetailId != null}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.requestDetailOpeningOverlay}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.requestDetailOpeningText}>Opening request...</Text>
        </View>
      </Modal>
      </>
      <LoginBottomSheet
        visible={guestLoginSheetVisible}
        onClose={() => setGuestLoginSheetVisible(false)}
        onLoggedIn={() => {
          InteractionManager.runAfterInteractions(() => {
            let attempts = 0;
            const maxAttempts = 50;
            const tick = () => {
              const id = (
                authBackendUserIdRef.current.trim() ||
                authUserIdRef.current.trim()
              ).trim();
              if (id) {
                void handleBook({
                  sessionUserId: id,
                  stayOnRideDetail: true,
                });
                return;
              }
              attempts += 1;
              if (attempts >= maxAttempts) {
                Alert.alert('Sign-in', 'Could not confirm your account. Try booking again.');
                return;
              }
              setTimeout(tick, 80);
            };
            setTimeout(tick, 0);
          });
        }}
        navigation={navigation as NavigationProp<ParamListBase>}
      />
      <Modal visible={showRatingModal} transparent animationType="fade" onRequestClose={handleSkipRating}>
        <KeyboardAvoidingView
          style={styles.ratingOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        >
          <Pressable style={styles.ratingOverlayPressable} onPress={handleSkipRating} />
          <View style={[styles.ratingSheet, { paddingBottom: 16 + Math.max(insets.bottom, 10) }]}>
            <View style={styles.ratingHandle} />
            <TouchableOpacity
              style={styles.ratingCloseBtn}
              onPress={handleSkipRating}
              disabled={ratingSubmitting || ratingSubmitted}
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
            <Text style={styles.ratingTitle}>Rate your ride</Text>
            <Text style={styles.ratingSubtitle}>Tap a star to rate your experience</Text>

            <View style={styles.ratingStarsRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setRatingStars(s)}
                  disabled={ratingSubmitting || ratingSubmitted}
                  hitSlop={8}
                >
                  <Ionicons
                    name={ratingStars >= s ? 'star' : 'star-outline'}
                    size={34}
                    color={COLORS.warning}
                  />
                </TouchableOpacity>
              ))}
            </View>
            {ratingStars > 0 ? (
              <View style={styles.ratingCheckpointBlock}>
                <Text style={styles.ratingCheckpointHeading}>Experience</Text>
                <View style={styles.ratingCheckpointWrap}>
                  {ratingExperienceCheckpoints.map((label) => (
                    <TouchableOpacity
                      key={`exp-${label}`}
                      style={styles.ratingCheckpointChip}
                      onPress={() => addRatingCheckpoint(label)}
                      disabled={ratingSubmitting || ratingSubmitted}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.ratingCheckpointChipText}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.ratingCheckpointHeading}>Behavior</Text>
                <View style={styles.ratingCheckpointWrap}>
                  {ratingBehaviorCheckpoints.map((label) => (
                    <TouchableOpacity
                      key={`beh-${label}`}
                      style={styles.ratingCheckpointChip}
                      onPress={() => addRatingCheckpoint(label)}
                      disabled={ratingSubmitting || ratingSubmitted}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.ratingCheckpointChipText}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <Text style={styles.ratingInputLabel}>Write your review (optional)</Text>
            <TextInput
              style={styles.ratingInput}
              placeholder="Tell us about the driver, the vehicle, or the route..."
              placeholderTextColor={COLORS.textMuted}
              value={ratingReview}
              onChangeText={setRatingReview}
              multiline
              editable={!ratingSubmitting && !ratingSubmitted}
            />

            <TouchableOpacity
              style={[
                styles.ratingSubmitBtn,
                (ratingStars < 1 || ratingSubmitting || ratingSubmitted) && styles.ratingSubmitBtnDisabled,
              ]}
              onPress={handleSubmitRating}
              disabled={ratingStars < 1 || ratingSubmitting || ratingSubmitted}
            >
              {ratingSubmitting ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.ratingSubmitText}>Submit Feedback</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={showEditSheet} transparent animationType="none" onRequestClose={closeEditSheet}>
        <View style={styles.editSheetOverlay}>
          <TouchableOpacity style={styles.editSheetDismissArea} activeOpacity={1} onPress={closeEditSheet} />
          <Animated.View
            style={[
              styles.editSheetCard,
              { height: editSheetExpanded ? editFullHeight : editHalfHeight, transform: [{ translateY: editSheetSlideY }] },
            ]}
          >
            <TouchableOpacity style={styles.editSheetHandleArea} onPress={expandEditSheet} activeOpacity={0.9}>
              <View style={styles.editSheetHandle} />
            </TouchableOpacity>
            <View style={styles.editSheetHeader}>
              <Text style={styles.editSheetTitle}>Edit ride details</Text>
              <TouchableOpacity onPress={closeEditSheet} hitSlop={10}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.editSheetBodyScroll}
              contentContainerStyle={styles.editSheetBody}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.editPreviewCard}>
                <TouchableOpacity
                  style={styles.editPreviewRow}
                  onPress={() =>
                    (navigation as { navigate: (name: string, params: Record<string, unknown>) => void }).navigate('LocationPicker', {
                      field: 'from',
                      currentFrom: editPickup,
                      currentTo: editDestination,
                      returnScreen: 'SearchRides',
                    })
                  }
                  activeOpacity={0.75}
                >
                  <View style={styles.editPreviewIconCol}>
                    <View style={styles.editPreviewGreenDot} />
                    <View style={styles.editPreviewDotted} />
                  </View>
                  <View style={styles.editPreviewTextWrap}>
                    <Text style={styles.editPreviewValue} numberOfLines={1}>{editPickup}</Text>
                    <Text style={styles.editPreviewLabel}>PICKUP</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.editPreviewRow}
                  onPress={() =>
                    (navigation as { navigate: (name: string, params: Record<string, unknown>) => void }).navigate('LocationPicker', {
                      field: 'to',
                      currentFrom: editPickup,
                      currentTo: editDestination,
                      returnScreen: 'SearchRides',
                    })
                  }
                  activeOpacity={0.75}
                >
                  <View style={styles.editPreviewIconCol}>
                    <View style={styles.editPreviewRedPin} />
                  </View>
                  <View style={styles.editPreviewTextWrap}>
                    <Text style={styles.editPreviewValue} numberOfLines={1}>{editDestination}</Text>
                    <Text style={styles.editPreviewLabel}>DESTINATION</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>

                <View style={styles.editPreviewDivider} />

                <TouchableOpacity style={styles.editMetaRow} onPress={() => setShowEditDateModal(true)} activeOpacity={0.75}>
                  <View style={styles.editMetaLeft}>
                    <Ionicons name="calendar-outline" size={20} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.editMetaCenter}>
                    <Text style={styles.editMetaValue}>
                      {editDate ? `${editDate.getDate()}/${editDate.getMonth() + 1}/${editDate.getFullYear()}` : cardDateShort}
                    </Text>
                    <Text style={styles.editMetaLabel}>DEPARTURE DATE</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>

                <View style={styles.editPreviewDivider} />

                <TouchableOpacity style={styles.editMetaRow} onPress={() => setShowEditTimeModal(true)} activeOpacity={0.75}>
                  <View style={styles.editMetaLeft}>
                    <Ionicons name="time-outline" size={20} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.editMetaCenter}>
                    <Text style={styles.editMetaValue}>
                      {String(editTimeHour).padStart(2, '0')}:{String(editTimeMinute).padStart(2, '0')}
                    </Text>
                    <Text style={styles.editMetaLabel}>PREFERRED TIME</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>

                <View style={styles.editPreviewDivider} />

                <TouchableOpacity style={styles.editMetaRow} onPress={() => setShowEditPassengersModal(true)} activeOpacity={0.75}>
                  <View style={styles.editMetaLeft}>
                    <Ionicons name="people-outline" size={20} color={COLORS.textSecondary} />
                  </View>
                  <View style={styles.editMetaCenter}>
                    <Text style={styles.editMetaValue}>
                      {editPassengers} passenger{editPassengers !== 1 ? 's' : ''}
                    </Text>
                    <Text style={styles.editMetaLabel}>SEATING SPACE</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.editSheetText}>
                Tap the top handle to expand this sheet to full screen.
              </Text>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={cancelBookingSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={closeCancelBookingSheet}
      >
        <TouchableOpacity
          style={styles.cancelBookingSheetOverlay}
          activeOpacity={1}
          onPress={closeCancelBookingSheet}
          disabled={cancellingBooking}
        >
          <View style={styles.cancelBookingSheetCard} onStartShouldSetResponder={() => true}>
            <View style={styles.cancelBookingSheetHandleArea}>
              <View style={styles.cancelBookingSheetHandle} />
            </View>
            <View style={styles.cancelBookingSheetHeader}>
              <Text style={styles.cancelBookingSheetTitle}>
                {cancelBookingSheetMode === 'request'
                  ? 'Pending request'
                  : cancelBookingSheetMode === 'owner_remove'
                    ? 'Remove passenger'
                    : 'Cancel booking'}
              </Text>
              <TouchableOpacity onPress={closeCancelBookingSheet} hitSlop={10} disabled={cancellingBooking}>
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.cancelBookingSheetSubText}>
              {cancelBookingSheetMode === 'request'
                ? `You requested ${cancelBookingMaxSeats} seat${cancelBookingMaxSeats !== 1 ? 's' : ''}. Select how many request seat${cancelBookingMaxSeats !== 1 ? 's' : ''} to cancel.`
                : cancelBookingSheetMode === 'owner_remove'
                  ? `Remove ${ownerRemovePassengerLabel} from this ride? They’ll be notified and won’t be able to book this ride again.`
                  : `You booked ${cancelBookingMaxSeats} seat${cancelBookingMaxSeats !== 1 ? 's' : ''}. Select how many to cancel.`}
            </Text>

            {cancelBookingSheetMode === 'owner_remove' ? null : (
              <View style={styles.cancelBookingCounterRow}>
                <TouchableOpacity
                  style={[
                    styles.cancelBookingCounterBtn,
                    cancelBookingSeatsToCancel <= 1 && styles.cancelBookingCounterBtnDisabled,
                  ]}
                  onPress={() => setCancelBookingSeatsToCancel((s) => Math.max(1, s - 1))}
                  disabled={cancellingBooking || cancelBookingSeatsToCancel <= 1}
                  hitSlop={8}
                  activeOpacity={0.85}
                >
                  <Ionicons name="remove" size={20} color={COLORS.primary} />
                </TouchableOpacity>

                <View style={styles.cancelBookingCounterValueWrap}>
                  <Text style={styles.cancelBookingCounterValue}>{cancelBookingSeatsToCancel}</Text>
                  <Text style={styles.cancelBookingCounterUnit}>
                    {`seat${cancelBookingSeatsToCancel !== 1 ? 's' : ''} to cancel`}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.cancelBookingCounterBtn,
                    cancelBookingSeatsToCancel >= cancelBookingMaxSeats && styles.cancelBookingCounterBtnDisabled,
                  ]}
                  onPress={() => setCancelBookingSeatsToCancel((s) => Math.min(cancelBookingMaxSeats, s + 1))}
                  disabled={cancellingBooking || cancelBookingSeatsToCancel >= cancelBookingMaxSeats}
                  hitSlop={8}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={20} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={styles.cancelBookingConfirmBtn}
              onPress={() => void confirmCancelSeats(cancelBookingSeatsToCancel)}
              disabled={cancellingBooking}
              activeOpacity={0.9}
            >
              {cancellingBooking ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.cancelBookingConfirmText}>
                  {cancelBookingSheetMode === 'owner_remove'
                    ? 'Remove passenger'
                    : cancelBookingSheetMode === 'request'
                      ? `Cancel request ${cancelBookingSeatsToCancel} seat${cancelBookingSeatsToCancel !== 1 ? 's' : ''}`
                      : `Cancel ${cancelBookingSeatsToCancel} seat${cancelBookingSeatsToCancel !== 1 ? 's' : ''}`}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBookingKeepBtn}
              onPress={closeCancelBookingSheet}
              disabled={cancellingBooking}
              activeOpacity={0.9}
            >
              <Text style={styles.cancelBookingKeepText}>
                {cancelBookingSheetMode === 'owner_remove' ? 'Keep passenger' : 'Keep booking'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <DatePickerModal
        visible={showEditDateModal}
        onClose={() => setShowEditDateModal(false)}
        selectedDate={editDate}
        onSelectDate={(d) => {
          setEditDate(d);
          setShowEditDateModal(false);
        }}
      />
      <PassengersPickerModal
        visible={showEditPassengersModal}
        onClose={() => setShowEditPassengersModal(false)}
        value={editPassengers}
        onDone={(n) => setEditPassengers(Math.max(1, Math.min(4, n)))}
      />
      <CancelRideConfirmModal
        visible={cancelRideConfirmVisible}
        onClose={() => setCancelRideConfirmVisible(false)}
        onConfirmCancel={() => void runOwnerCancelRide()}
      />
      <Modal visible={showEditTimeModal} transparent animationType="slide" onRequestClose={() => setShowEditTimeModal(false)}>
        <TouchableOpacity style={styles.editTimeOverlay} activeOpacity={1} onPress={() => setShowEditTimeModal(false)}>
          <View style={styles.editTimeCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.editTimeTitle}>Set time</Text>
            <View style={styles.editTimeRow}>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeHour((h) => (h + 23) % 24)}>
                <Ionicons name="remove" size={20} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.editTimeValue}>{String(editTimeHour).padStart(2, '0')}</Text>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeHour((h) => (h + 1) % 24)}>
                <Ionicons name="add" size={20} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.editTimeColon}>:</Text>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeMinute((m) => (m + 55) % 60)}>
                <Ionicons name="remove" size={20} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.editTimeValue}>{String(editTimeMinute).padStart(2, '0')}</Text>
              <TouchableOpacity style={styles.editTimeBtn} onPress={() => setEditTimeMinute((m) => (m + 5) % 60)}>
                <Ionicons name="add" size={20} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.editTimeDoneBtn} onPress={() => setShowEditTimeModal(false)}>
              <Text style={styles.editTimeDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  openingDetailsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  openingDetailsText: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  headerBack: {
    width: 40,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  /** Balances back control so title stays centered */
  headerTrailingSpacer: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  detailCard: {
    backgroundColor: COLORS.background,
    borderRadius: 15,
    padding: 17,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  cardDateTime: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    flex: 1,
    paddingRight: 12,
  },
  cardRouteRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  cardRouteTimeline: {
    width: 26,
    alignItems: 'center',
    marginRight: 12,
  },
  hollowDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  timelineDash: {
    width: 2,
    flex: 1,
    minHeight: 36,
    marginVertical: 5,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  cardRouteTextCol: {
    flex: 1,
    minWidth: 0,
  },
  cardRouteStop: {
    marginBottom: 0,
  },
  cardRouteStopSpaced: {
    marginTop: 18,
  },
  routeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.6,
  },
  routePlace: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 3,
  },
  routeStack: {
    width: '100%',
  },
  routeSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 2,
  },
  timelineDashCompact: {
    width: 2,
    flex: 1,
    minHeight: 28,
    marginVertical: 4,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  routeLabelCompact: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  routePlaceCompact: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 3,
    lineHeight: 18,
  },
  cardRouteStopSpacedCompact: {
    marginTop: 14,
  },
  hollowDotSmall: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    backgroundColor: COLORS.white,
  },
  routeSubDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderLight,
    marginVertical: 14,
  },
  viewRouteMapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
  },
  viewRouteMapIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(41, 190, 139, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewRouteMapTextCol: {
    flex: 1,
    minWidth: 0,
  },
  viewRouteMapTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  viewRouteMapSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 15,
  },
  driverRowSectionLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
    marginBottom: 5,
    marginTop: 0,
  },
  cardDriverRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 10,
  },
  cardDriverText: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  cardDriverNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  driverNameBold: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  driverNamePassenger: {
    fontSize: 14,
  },
  driverVehicle: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 3,
  },
  driverVehiclePassenger: {
    fontSize: 11,
    marginTop: 2,
  },
  /** Slightly tighter than main ride `detailCard`. */
  vehicleInfoDetailCard: {
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  vehicleInfoSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.55,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  vehicleInfoCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  vehicleInfoIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 9,
    backgroundColor: '#f3f4ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleInfoTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  vehicleInfoModel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  /** Plate + color on one horizontal line (no wrap). */
  vehicleInfoMetaRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 7,
  },
  vehicleInfoPlatePill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexShrink: 0,
    maxWidth: '52%',
  },
  vehicleInfoPlateText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  vehicleInfoColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    flexGrow: 0,
    minWidth: 0,
  },
  vehicleInfoColorSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  vehicleInfoColorName: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  cardDriverActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 6,
  },
  ownerRowChatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(41, 190, 139, 0.1)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  ownerRowChatPillText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  ownerChatIconBtn: {
    padding: 6,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsPillDriver: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  detailsPillDriverText: {
    fontSize: 13,
    fontWeight: '600',
    marginRight: 2,
  },
  detailsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundSecondary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailsPillText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginRight: 4,
  },
  block: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  paymentRowLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  paymentMethod: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  paymentSeats: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  paymentPrice: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.primary,
  },
  /** Matches vehicle row: icon + text for scan-friendly “driver notes” on ride detail. */
  rideDescriptionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rideDescriptionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 9,
    backgroundColor: 'rgba(41, 190, 139, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ridePrefsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  ridePrefsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(41, 190, 139, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ridePrefsTextCol: {
    flex: 1,
    minWidth: 0,
  },
  rideDescriptionBody: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 23,
    color: COLORS.text,
    letterSpacing: 0.1,
  },
  passengersHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 14,
    marginBottom: 6,
  },
  seatRequestsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 6,
  },
  seatRequestsHeaderSpinner: {
    marginRight: 4,
  },
  seatRequestsCount: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  seatRequestsHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  seatRequestsBlock: {
    backgroundColor: COLORS.white,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  seatRequestsList: {
    paddingTop: 6,
  },
  seatRequestsListRefreshing: {
    opacity: 0.92,
  },
  seatRequestsPlaceholder: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  seatRequestsSkeletonCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.backgroundSecondary,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  seatRequestsSkeletonLineWide: {
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.border,
    width: '72%',
    marginBottom: 10,
  },
  seatRequestsSkeletonLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.borderLight,
    width: '48%',
  },
  seatRequestsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  seatRequestsManageAll: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  seatRequestsManageAllBtn: {
    minHeight: 24,
    justifyContent: 'center',
    alignItems: 'flex-end',
    minWidth: 70,
  },
  seatRequestsLoadingText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  seatRequestCard: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  seatRequestTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  seatRequestTopLeft: {
    flex: 1,
    minWidth: 0,
  },
  seatRequestIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seatRequestIdentityText: {
    flex: 1,
    minWidth: 0,
  },
  seatRequestName: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  seatRequestMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  seatRequestMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f59e0b',
  },
  seatRequestMetaDot: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginHorizontal: 1,
  },
  seatRequestMetaTextMuted: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  seatRequestRouteWrap: {
    marginTop: 8,
    paddingLeft: 48,
    gap: 2,
  },
  seatRequestRouteLine: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
    fontWeight: '500',
  },
  seatRequestSeatsBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: 8,
  },
  seatRequestSeats: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6366f1',
  },
  seatRequestDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderLight,
    marginTop: 12,
    marginBottom: 10,
  },
  seatRequestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seatRequestApproveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 10,
  },
  seatRequestApproveText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  seatRequestRejectBtn: {
    width: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
  },
  seatRequestRejectText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '700',
  },
  requestDetailOpeningOverlay: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  requestDetailOpeningText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  passengersList: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  passengerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  passengerRowOwner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginHorizontal: -4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  passengerRowOwnerMainTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  passengerOwnerRemoveBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.error,
    marginLeft: 4,
  },
  passengerOwnerRemoveText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.error,
  },
  passengerRowOwnerIcon: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passengerRowCopassenger: {
    paddingVertical: 10,
  },
  passengerRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  passengerRatingAvg: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  passengerRatingCount: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  passengerSeatsMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  passengerRowOwnerText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
  },
  passengerNameOwner: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  passengerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  /** Owner view: explicit label when this passenger’s booking was cancelled. */
  passengerBookingCancelledLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.error,
    marginTop: 4,
  },
  passengerBookingRebookedLabel: {
    color: '#16a34a',
  },
  passengerBookingHistory: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    alignSelf: 'stretch',
  },
  passengerBookingHistoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  passengerBookingHistoryTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
    flex: 1,
  },
  passengerBookingHistoryLine: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  passengerBookedRouteCaption: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.4,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  passengerRouteHint: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  passengerRowOwnerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
    flexShrink: 0,
  },
  passengerRowRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  passengerChatIconBtn: {
    padding: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passengerSeatsCompact: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  passengerName: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  passengerSeats: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  passengerRowCancelled: {
    opacity: 0.92,
  },
  passengerNameCancelled: {
    color: COLORS.textMuted,
  },
  passengerCaptionCancelled: {
    color: COLORS.textMuted,
  },
  passengerHintCancelled: {
    color: COLORS.textMuted,
  },
  passengerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passengerActionBtn: {
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passengerActionBtnChat: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  noPassengers: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  linkButton: {
    paddingVertical: 12,
    marginBottom: 4,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  /** Owner: Cancel (red) left, Edit (green) right */
  ownerActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginTop: 16,
  },
  ownerActionsFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  ownerActionsFooterInner: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  footerSingleActionBtn: {
    marginTop: 0,
    width: '100%',
  },
  footerBookWrap: {
    width: '100%',
  },
  ownerActionBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    gap: 8,
  },
  ownerActionBtnEdit: {
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  ownerActionBtnEditText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
    flexShrink: 1,
  },
  ownerActionBtnCancel: {
    backgroundColor: COLORS.error,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  ownerActionBtnCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
    flexShrink: 1,
  },
  ownerActionBtnDisabled: {
    opacity: 0.55,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 10,
    marginTop: 16,
  },
  rebookHint: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
    lineHeight: 20,
  },
  buttonBook: {
    backgroundColor: COLORS.primary,
  },
  buttonBookDisabled: {
    opacity: 0.5,
  },
  buttonBookText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  seatPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  seatPickerLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginRight: 4,
  },
  seatPickerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  seatPickerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  seatPickerBtnDisabled: {
    opacity: 0.35,
    borderColor: COLORS.border,
  },
  seatPickerValue: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
    minWidth: 28,
    textAlign: 'center',
  },
  seatPickerHint: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginLeft: 'auto',
  },
  buttonBooked: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonBookedText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  /** Passenger: outlined destructive — single row, no extra chrome */
  buttonCancelPassenger: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1.5,
    borderColor: COLORS.error,
  },
  buttonCancelPassengerText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
    flexShrink: 1,
    textAlign: 'center',
  },
  buttonBookingCancelled: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
  },
  buttonBookingCancelledText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.error,
  },
  buttonPendingRequest: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.32)',
  },
  buttonPendingRequestText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  buttonRequestRejected: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  buttonRequestRejectedText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.error,
  },
  buttonPastEnded: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonPastEndedText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  buttonRepublishPast: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  buttonRepublishPastText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
  /** Owner cancelled — no edit/cancel; muted “done” state */
  buttonOwnerRideCancelled: {
    backgroundColor: COLORS.backgroundSecondary,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    opacity: 0.92,
  },
  buttonOwnerRideCancelledText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  ratingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  ratingOverlayPressable: {
    flex: 1,
  },
  ratingSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    maxHeight: '84%',
  },
  ratingHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  ratingCloseBtn: {
    position: 'absolute',
    right: 14,
    top: 12,
    zIndex: 2,
    padding: 4,
  },
  ratingTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 6,
  },
  ratingSubtitle: {
    marginTop: 4,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  ratingStarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
    marginBottom: 14,
  },
  ratingInputLabel: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  ratingCheckpointBlock: {
    marginBottom: 12,
    gap: 8,
  },
  ratingCheckpointHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  ratingCheckpointWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratingCheckpointChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eef8f4',
    borderWidth: 1,
    borderColor: '#d7efe4',
  },
  ratingCheckpointChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  ratingInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
    color: COLORS.text,
    backgroundColor: COLORS.backgroundSecondary,
  },
  ratingSubmitBtn: {
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  ratingSubmitBtnDisabled: {
    backgroundColor: 'rgba(34,197,94,0.45)',
  },
  ratingSubmitText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
  },
  editSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  editSheetDismissArea: {
    flex: 1,
  },
  editSheetCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    minHeight: 380,
    maxHeight: '96%',
  },
  editSheetHandleArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  editSheetHandle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
  },
  editSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  editSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  editSheetBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  editSheetBodyScroll: {
    flex: 1,
  },
  editSheetText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: 10,
  },
  editPreviewCard: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.background,
  },
  editPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  editPreviewIconCol: {
    width: 22,
    alignItems: 'center',
  },
  editPreviewGreenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.background,
    marginTop: 2,
  },
  editPreviewDotted: {
    width: 2,
    minHeight: 14,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    borderStyle: 'dashed',
    marginVertical: 3,
  },
  editPreviewRedPin: {
    width: 10,
    height: 14,
    borderRadius: 6,
    backgroundColor: COLORS.error,
    marginTop: 2,
  },
  editPreviewTextWrap: {
    flex: 1,
    marginLeft: 10,
  },
  editPreviewValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  editPreviewLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginTop: 1,
  },
  editPreviewDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  editMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  editMetaLeft: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editMetaCenter: {
    flex: 1,
    marginLeft: 10,
  },
  editMetaValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  editMetaLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  editTimeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  editTimeCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
  },
  editTimeTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 10,
  },
  editTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  editTimeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundSecondary,
  },
  editTimeValue: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  editTimeColon: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginHorizontal: 2,
  },
  editTimeDoneBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  editTimeDoneText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  cancelBookingSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  cancelBookingSheetCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    minHeight: 240,
  },
  cancelBookingSheetHandleArea: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 10,
  },
  cancelBookingSheetHandle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.border,
  },
  cancelBookingSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  cancelBookingSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  cancelBookingSheetSubText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  cancelBookingCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  cancelBookingCounterBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundSecondary,
  },
  cancelBookingCounterBtnDisabled: {
    opacity: 0.45,
  },
  cancelBookingCounterValueWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  cancelBookingCounterValue: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.error,
    lineHeight: 30,
  },
  cancelBookingCounterUnit: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  cancelBookingConfirmBtn: {
    marginTop: 10,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.error,
  },
  cancelBookingConfirmText: {
    color: COLORS.white,
    fontWeight: '900',
    fontSize: 16,
  },
  cancelBookingSheetOptions: {
    gap: 10,
  },
  cancelBookingSheetOption: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
    backgroundColor: 'rgba(239,68,68,0.10)',
    alignItems: 'center',
  },
  cancelBookingSheetOptionText: {
    color: COLORS.error,
    fontWeight: '800',
    fontSize: 15,
  },
  cancelBookingKeepBtn: {
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.backgroundSecondary,
  },
  cancelBookingKeepText: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: 15,
  },
});
