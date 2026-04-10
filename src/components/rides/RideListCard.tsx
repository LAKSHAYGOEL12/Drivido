import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RideListItem } from '../../types/api';
import { COLORS } from '../../constants/colors';
import {
  getRideCardDateShort,
  formatRidePrice,
  formatOwnerRideCardTitle,
  getRideDepartureArrivalRow,
  getRouteDurationMinutes,
  getRideTotalBookingCount,
  isRideCancelledByOwner,
  isViewerOwnerStrict,
  isViewerRideOwner,
  readPendingSeatRequestCount,
  userIdsMatch,
} from '../../utils/rideDisplay';
import {
  bookingIsPendingLike,
  bookingIsCancelledByOwner,
  bookingRowHoldsOccupiedSeats,
  effectiveOccupiedSeatsFromBookingRow,
} from '../../utils/bookingStatus';
import { getRideAvailabilityShort, isRideSeatsFull } from '../../utils/rideSeats';
import { bookingPassengerDisplayName, ridePublisherDisplayName } from '../../utils/displayNames';
import UserAvatar from '../common/UserAvatar';

export type RideListCardProps = {
  ride: RideListItem;
  onPress: () => void;
  onRatePress?: () => void;
  /** When set and this user owns the ride, card shows booker name(s) instead of driver. */
  currentUserId?: string;
  /** Used for owner avatar initial when there are no passenger names on the card. */
  currentUserName?: string;
  /** Current user profile image (owner card when no passenger row to show). */
  viewerAvatarUrl?: string;
  /** Past rides: show “Cancelled” when the viewer’s booking was cancelled. */
  showCancelledBadge?: boolean;
  /** Past rides: show “Rejected” when owner rejected passenger request. */
  showRejectedBadge?: boolean;
  /** Optional badge label override for rejected state. */
  rejectedBadgeText?: string;
  /** Past rides (passenger): driver removed you from this booking. */
  showRemovedByDriverBadge?: boolean;
  /** Past rides: show “Completed” after destination + 1h window (not cancelled). */
  showCompletedBadge?: boolean;
  /** Past rides completed: show inline rating CTA row. */
  showRatePrompt?: boolean;
  /** Past rides completed and already rated: show read-only rated row. */
  showRatedState?: boolean;
  /** Search: full ride; viewer has no seat — faded + “Full” badge (tap still handled by parent). */
  seatFullUnavailable?: boolean;
  /** Past rides tab: hide “N seats left” / “offered” in header and “Full” affordances (for everyone). */
  hideSeatAvailability?: boolean;
  /**
   * My Rides tab: for rides you published, show only current seats booked — no avatar, no passenger names,
   * no “Had N passengers” (uses active bookings / seat count only).
   */
  myRidesOwnerSummary?: boolean;
  /** Past owner cards: keep owner identity avatar/name instead of passenger avatar. */
  ownerUseSelfIdentity?: boolean;
};

/** One-line preview for lists; full names only on ride detail. */
function placePreview(raw: string, maxChars: number): string {
  const t = raw.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export default function RideListCard({
  ride,
  onPress,
  onRatePress,
  currentUserId,
  currentUserName,
  viewerAvatarUrl,
  showCancelledBadge,
  showRejectedBadge,
  rejectedBadgeText,
  showRemovedByDriverBadge,
  showCompletedBadge,
  showRatePrompt,
  showRatedState,
  seatFullUnavailable,
  hideSeatAvailability,
  myRidesOwnerSummary,
  ownerUseSelfIdentity,
}: RideListCardProps): React.JSX.Element {
  const showSeatAvailabilityRow = !hideSeatAvailability && ride.seats != null;
  const showFullUnavailableUi = Boolean(seatFullUnavailable && !hideSeatAvailability);
  const pickupFull = ride.pickupLocationName ?? ride.from ?? 'Pickup';
  const destFull = ride.destinationLocationName ?? ride.to ?? 'Destination';
  const pickup = placePreview(pickupFull, 40);
  const dest = placePreview(destFull, 40);
  const driverName = ridePublisherDisplayName(ride);
  const isOwner = isViewerRideOwner(ride, currentUserId);
  /** Publisher = same `userId` as viewer, or API `viewerIsOwner` — so pending shows on any list, not only My rides. */
  const isRidePublisherViewer =
    Boolean(currentUserId?.trim()) &&
    (userIdsMatch(currentUserId, ride.userId) || isViewerOwnerStrict(ride));
  const bookings = ride.bookings ?? [];
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
  const pendingRequestCount = readPendingSeatRequestCount(ride, bookings);
  const confirmedBookings = bookings.filter((b) => {
    const s = String(b.status ?? '').trim().toLowerCase();
    if (bookingIsPendingLike(s) || s === 'rejected') return false;
    return bookingRowHoldsOccupiedSeats(b);
  });
  const activePassengerCount = confirmedBookings.length;
  const bookedSeats = confirmedBookings.reduce(
    (sum, b) => sum + effectiveOccupiedSeatsFromBookingRow(b),
    0
  );
  const totalBookingsCount = getRideTotalBookingCount(ride);
  const ownerMyRidesSeatOnly = Boolean(isOwner && myRidesOwnerSummary);
  const ownerHasPendingRequests = isRidePublisherViewer && pendingRequestCount > 0;

  const displayName = (() => {
    if (ownerHasPendingRequests) return 'Awaiting your approval';
    if (ownerMyRidesSeatOnly) {
      if (isRequestBookingMode) {
        if (isRideSeatsFull(ride)) return 'Ride full';
        if (bookedSeats > 0) {
          return `${bookedSeats} seat${bookedSeats !== 1 ? 's' : ''} booked`;
        }
        return 'No seats booked yet';
      }
      if (isRideSeatsFull(ride)) return 'Ride full';
      if (bookedSeats > 0) {
        return `${bookedSeats} seat${bookedSeats !== 1 ? 's' : ''} booked`;
      }
      return 'No seats booked yet';
    }
    if (isOwner && ownerUseSelfIdentity) return currentUserName || 'You';
    if (isOwner) return formatOwnerRideCardTitle(ride);
    return driverName;
  })();
  const displaySubtitle = ownerHasPendingRequests
    ? 'Open this ride to approve or decline'
    : ownerMyRidesSeatOnly
      ? ''
      : isOwner
        ? hideSeatAvailability
          ? isRequestBookingMode
            ? pendingRequestCount > 0
              ? `${pendingRequestCount} request${pendingRequestCount !== 1 ? 's' : ''} pending`
              : ''
            : activePassengerCount > 0
            ? `${activePassengerCount} passenger${activePassengerCount !== 1 ? 's' : ''}`
            : ''
          : isRequestBookingMode
            ? pendingRequestCount > 0
              ? `${pendingRequestCount} request${pendingRequestCount !== 1 ? 's' : ''} pending`
              : ''
            : confirmedBookings.length > 0
            ? `${bookedSeats} seat${bookedSeats !== 1 ? 's' : ''} booked`
            : totalBookingsCount > 0
              ? `${isRideCancelledByOwner(ride) ? 'Cancelled · ' : ''}Had ${totalBookingsCount} passenger${totalBookingsCount !== 1 ? 's' : ''}`
              : ''
        : '';
  const nameSourceForAvatar = confirmedBookings.length > 0 ? confirmedBookings : bookings;
  const firstBookingForAvatar = nameSourceForAvatar[0];
  const passengerAvatarUrl = firstBookingForAvatar?.avatarUrl?.trim();
  const driverAvatarUrl = ride.publisherAvatarUrl?.trim();
  const avatarImageUri = isOwner
    ? ownerUseSelfIdentity
      ? viewerAvatarUrl?.trim()
      : firstBookingForAvatar
      ? passengerAvatarUrl
      : viewerAvatarUrl?.trim()
    : driverAvatarUrl;
  const avatarDisplayName = isOwner
    ? ownerUseSelfIdentity
      ? currentUserName || 'You'
      : firstBookingForAvatar
      ? bookingPassengerDisplayName(firstBookingForAvatar)
      : currentUserName || 'You'
    : driverName;
  const showAvatarRow = !ownerMyRidesSeatOnly;
  const priceDisplay = formatRidePrice(ride);
  const dateShort = getRideCardDateShort(ride);
  const timeRow = getRideDepartureArrivalRow(ride);
  const routeMins = getRouteDurationMinutes(ride);
  const showDepartureArrival = Boolean(timeRow && routeMins != null && timeRow.durationLabel && timeRow.arrival);

  return (
    <TouchableOpacity
      style={[styles.card, showFullUnavailableUi && styles.cardFullUnavailable]}
      onPress={onPress}
      activeOpacity={0.72}
    >
      <View style={styles.headerRow}>
        <Text style={styles.dateTime} numberOfLines={1}>
          {dateShort}
          {showSeatAvailabilityRow
            ? ` · ${getRideAvailabilityShort(ride) || `${ride.seats} seat${ride.seats !== 1 ? 's' : ''} offered`}`
            : ''}
        </Text>
        <View style={styles.headerRight}>
          {showFullUnavailableUi ? (
            <View style={styles.fullBadge}>
              <Text style={styles.fullBadgeText}>Full</Text>
            </View>
          ) : null}
          {showCompletedBadge ? (
            <View style={styles.completedBadge}>
              <Text style={styles.completedBadgeText}>Completed</Text>
            </View>
          ) : null}
          {showCancelledBadge ? (
            <View style={styles.cancelledBadge}>
              <Text style={styles.cancelledBadgeText}>Cancelled</Text>
            </View>
          ) : null}
          {showRejectedBadge ? (
            <View style={styles.rejectedBadge}>
              <Text style={styles.rejectedBadgeText}>{(rejectedBadgeText ?? 'Rejected').trim()}</Text>
            </View>
          ) : null}
          {showRemovedByDriverBadge ? (
            <View style={styles.removedByDriverBadge}>
              <Text style={styles.removedByDriverBadgeText}>Removed by driver</Text>
            </View>
          ) : null}
        </View>
      </View>
      {showFullUnavailableUi ? (
        <Text style={styles.fullHint} numberOfLines={1}>
          All seats booked
        </Text>
      ) : null}

      <View style={styles.timeRoutePriceRow}>
        <View style={styles.timeColumn}>
          {timeRow ? (
            showDepartureArrival ? (
              <>
                <Text style={styles.timeClock}>{timeRow.departure}</Text>
                <Text style={styles.timeDuration}>{timeRow.durationLabel}</Text>
                <Text style={styles.timeClock}>{timeRow.arrival}</Text>
              </>
            ) : (
              <Text style={styles.timeClock}>{timeRow.departure}</Text>
            )
          ) : (
            <Text style={styles.timeClockMuted}>—</Text>
          )}
        </View>
        <View style={styles.timeline}>
          <View style={styles.hollowDot} />
          <View style={styles.timelineDash} />
          <View style={styles.hollowDotBottom} />
        </View>
        <View style={styles.routeTextCol}>
          <Text style={styles.routePlace} numberOfLines={1} ellipsizeMode="tail">
            {pickup}
          </Text>
          <Text style={styles.routePlace} numberOfLines={1} ellipsizeMode="tail">
            {dest}
          </Text>
        </View>
        {priceDisplay !== '—' ? (
          <Text style={styles.priceInline} numberOfLines={1}>
            {priceDisplay}
          </Text>
        ) : (
          <View style={styles.pricePlaceholder} />
        )}
      </View>

      {!showCompletedBadge ? <View style={styles.divider} /> : null}

      <View style={[styles.driverRow, !showAvatarRow && styles.driverRowNoAvatar]}>
        {showAvatarRow ? (
          <View style={styles.avatarWrap}>
            <UserAvatar
              uri={avatarImageUri}
              name={avatarDisplayName}
              size={36}
              backgroundColor={COLORS.primary}
              fallbackTextColor={COLORS.white}
            />
          </View>
        ) : null}
        <View style={styles.driverText}>
          {isOwner && !ownerMyRidesSeatOnly && !String(displayName).trim() ? null : (
            <Text
              style={[styles.driverName, ownerHasPendingRequests && styles.driverNamePendingRequest]}
              numberOfLines={isOwner && !ownerMyRidesSeatOnly ? 2 : 1}
              ellipsizeMode="tail"
            >
              {displayName}
            </Text>
          )}
          {displaySubtitle ? (
            <Text
              style={styles.driverVehicle}
              numberOfLines={isOwner && !ownerMyRidesSeatOnly ? 2 : 1}
              ellipsizeMode="tail"
            >
              {displaySubtitle}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
      </View>

      {showRatePrompt || showRatedState ? (
        <>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.rateRow}
            onPress={onRatePress ?? onPress}
            disabled={showRatedState}
            activeOpacity={0.75}
          >
            <View style={styles.rateRowLeft}>
              <View style={styles.rateIconCircle}>
                <Ionicons
                  name={showRatedState ? 'checkmark-circle' : 'star-outline'}
                  size={20}
                  color={showRatedState ? COLORS.success : '#6366f1'}
                />
              </View>
              <Text style={[styles.rateTitle, showRatedState && styles.ratedTitle]}>
                {showRatedState ? 'Rated' : 'Rate your ride'}
              </Text>
            </View>
            <Text style={styles.rateActionText}>{showRatedState ? 'Thanks for feedback' : 'Tap to rate'}</Text>
          </TouchableOpacity>
        </>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
    }),
  },
  cardFullUnavailable: {
    opacity: 0.58,
  },
  fullBadge: {
    backgroundColor: 'rgba(100,116,139,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.45)',
  },
  fullBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fullHint: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  cancelledBadge: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  cancelledBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.error,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  rejectedBadge: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  rejectedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.error,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  removedByDriverBadge: {
    backgroundColor: 'rgba(234,88,12,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(234,88,12,0.4)',
  },
  removedByDriverBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#c2410c',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  completedBadge: {
    backgroundColor: 'rgba(34,197,94,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.45)',
  },
  completedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803d',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dateTime: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.text,
  },
  timeRoutePriceRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 2,
  },
  timeColumn: {
    width: 56,
    justifyContent: 'space-between',
    paddingRight: 4,
    minHeight: 72,
  },
  timeClock: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  timeClockMuted: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  timeDuration: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginVertical: 2,
  },
  priceInline: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primary,
    flexShrink: 0,
    marginLeft: 6,
    alignSelf: 'flex-start',
    minWidth: 72,
    textAlign: 'right',
  },
  pricePlaceholder: {
    width: 72,
    marginLeft: 6,
  },
  timeline: {
    width: 22,
    alignItems: 'center',
    marginRight: 8,
  },
  hollowDotBottom: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.error,
    backgroundColor: COLORS.white,
  },
  hollowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  timelineDash: {
    width: 2,
    flex: 1,
    minHeight: 14,
    marginVertical: 3,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  routeTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between',
    minHeight: 72,
  },
  routePlace: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 8,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverRowNoAvatar: {
    paddingLeft: 0,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 8,
  },
  driverText: {
    flex: 1,
    minWidth: 0,
  },
  driverName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  driverNamePendingRequest: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.2,
  },
  driverVehicle: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingBottom: 2,
  },
  rateRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  rateIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6366f1',
  },
  ratedTitle: {
    color: COLORS.success,
  },
  rateActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
});
