import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { RideListItem } from '../types/api';
import type { RecentPublishedEntry } from '../services/recent-published-storage';

/** Searcher's trip when opening ride detail from search (booking may differ from driver's end-to-end route). */
export type PassengerSearchParams = {
  from: string;
  to: string;
  fromLatitude?: number;
  fromLongitude?: number;
  toLatitude?: number;
  toLongitude?: number;
};

/**
 * Trips → back should reopen ride detail on Find or Your Rides (avoids landing on your Profile home).
 */
export type TripsReturnToRideContext = {
  tab: 'YourRides' | 'SearchStack' | 'Inbox';
  params: {
    ride: RideListItem;
    passengerSearch?: PassengerSearchParams;
  };
};

/**
 * Auth stack: Login → Register
 */
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

/**
 * Search tab: stack (SearchRides → LocationPicker | SearchResults → RideDetail)
 */
export type SearchStackParamList = {
  SearchRides: {
    selectedFrom?: string;
    selectedTo?: string;
    preservedDate?: string;
    preservedPassengers?: string;
    fromLatitude?: number;
    fromLongitude?: number;
    toLatitude?: number;
    toLongitude?: number;
    /** Set when Search tab is pressed: clears stack + resets form (timestamp). */
    _tabResetToken?: number;
  } | undefined;
  LocationPicker: {
    field?: 'from' | 'to';
    currentFrom?: string;
    currentTo?: string;
    currentDate?: string;
    currentPassengers?: string;
    currentFromLatitude?: number;
    currentFromLongitude?: number;
    currentToLatitude?: number;
    currentToLongitude?: number;
    returnScreen?: 'SearchRides' | 'PublishRide' | 'PublishRecentEdit';
    publishRestoreKey?: string;
  } | undefined;
  SearchResults: {
    from: string;
    to: string;
    date: string;
    /** Passenger count from search form (for recent searches). */
    passengers?: string;
    fromLatitude?: number;
    fromLongitude?: number;
    toLatitude?: number;
    toLongitude?: number;
    /** Non-blocking warning banner/toast on results screen (e.g. same pickup/destination). */
    sameRouteWarning?: boolean;
  };
  RideDetail: { ride: RideListItem; passengerSearch?: PassengerSearchParams };
  /** Map + directions for the publisher’s pickup → drop-off (from stored coordinates). */
  PublishedRideRouteMap: {
    pickupLabel: string;
    destinationLabel: string;
    pickupLatitude: number;
    pickupLongitude: number;
    destinationLatitude: number;
    destinationLongitude: number;
  };
  /** Open another user's profile from ride details without switching bottom tab. */
  OwnerProfileModal: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
    /** From ride payload for signed-in users (backend); avoids client ratings fetch on profile. */
    publisherAvgRating?: number;
    publisherRatingCount?: number;
    dateOfBirth?: string;
    /** Driver contact when API includes it on the ride (or pass-through from ride detail). */
    publisherPhone?: string;
    /**
     * From ride detail: hide Call / do not load driver phone until passenger has an accepted booking
     * (not pending/rejected). Omit for other entry points.
     */
    hidePublisherPhone?: boolean;
    /** When true, profile is a minimal “deactivated” placeholder (no PII, no ratings/trips fetch). */
    peerDeactivated?: boolean;
    /** Set from RideDetail so Trips → back returns to this ride. */
    _returnToRide?: TripsReturnToRideContext;
  } | undefined;
  /** Ratings view for an arbitrary user opened from ride details modal. */
  OwnerRatingsModal: { userId: string; displayName?: string; avatarUrl?: string } | undefined;
  EditRide: { ride: RideListItem };
  BookPassengerDetail: {
    ride: RideListItem;
    booking: NonNullable<RideListItem['bookings']>[number];
    requestMode?: boolean;
    /**
     * Pre-rendered lines from ride detail’s merged timeline (multiple booking rows, ride-level
     * `bookingHistory`, etc.). Used when `booking.bookingHistory` is missing on the active row.
     */
    ownerBookingHistoryLines?: string[];
  };
  Chat: {
    ride?: RideListItem;
    rideId?: string;
    otherUserName: string;
    otherUserId: string;
    otherUserAvatarUrl?: string;
    /** Peer account deactivated — mask header and block new messages. */
    otherUserDeactivated?: boolean;
  };
};

/**
 * Publish tab: stack (PublishRide → LocationPicker)
 */
export type PublishStackParamList = {
  PublishRide: {
    selectedFrom?: string;
    selectedTo?: string;
    pickupLatitude?: number;
    pickupLongitude?: number;
    destinationLatitude?: number;
    destinationLongitude?: number;
    selectedRate?: string;
    /** Google Directions duration for selected path (seconds). */
    selectedDurationSeconds?: number;
    /** Route distance (km) from Directions / route preview — drives estimated fare range. */
    selectedDistanceKm?: number;
    /** Set when returning from map picker so merged params don’t keep a stale `selectedDistanceKm`. */
    clearRouteFare?: boolean;
    /** Echo from price screen — used when reopening fare editor. */
    initialPricePerSeat?: number;
    _publishRestoreKey?: string;
  } | undefined;
  PublishRecentEdit: {
    entry: RecentPublishedEntry;
    /** Optional source context: return to originating RideDetail instead of Publish tab root on back. */
    returnToRide?: TripsReturnToRideContext;
    selectedFrom?: string;
    selectedTo?: string;
    pickupLatitude?: number;
    pickupLongitude?: number;
    destinationLatitude?: number;
    destinationLongitude?: number;
    clearRouteFare?: boolean;
    selectedRate?: string;
    selectedDurationSeconds?: number;
    selectedDistanceKm?: number;
    initialPricePerSeat?: number;
    selectedDateIso?: string;
    selectedTimeHour?: number;
    selectedTimeMinute?: number;
  } | undefined;
  LocationPicker: {
    field?: 'from' | 'to';
    currentFrom?: string;
    currentTo?: string;
    currentPickupLatitude?: number;
    currentPickupLongitude?: number;
    currentDestinationLatitude?: number;
    currentDestinationLongitude?: number;
    returnScreen?: 'SearchRides' | 'PublishRide' | 'PublishRecentEdit';
    /** Publish tab: restores form after stack reset */
    publishRestoreKey?: string;
  } | undefined;
  PublishRoutePreview: {
    selectedFrom?: string;
    selectedTo?: string;
    pickupLatitude?: number;
    pickupLongitude?: number;
    destinationLatitude?: number;
    destinationLongitude?: number;
    selectedDistanceKm?: number;
    publishRestoreKey?: string;
  };
  PublishPrice: {
    selectedFrom?: string;
    selectedTo?: string;
    pickupLatitude?: number;
    pickupLongitude?: number;
    destinationLatitude?: number;
    destinationLongitude?: number;
    selectedDistanceKm: number;
    /** Preserve selected date when opening price and returning to PublishRide reset. */
    selectedDateIso?: string;
    /** Preserve selected time when opening price and returning to PublishRide reset. */
    selectedTimeHour?: number;
    selectedTimeMinute?: number;
    /** From route preview (Directions); omitted when user skipped preview — computed from distance. */
    selectedDurationSeconds?: number;
    /** Last confirmed price from Publish — keeps field when reopening fare. */
    initialPricePerSeat?: number;
    publishRestoreKey?: string;
    /** When set, Continue resets to PublishRecentEdit instead of PublishRide. */
    publishRecentEditEntry?: RecentPublishedEntry;
  };
};

/**
 * Your Rides tab: stack (YourRidesList → RideDetail | Chat)
 */
export type RidesStackParamList = {
  /** `_afterBookRefresh`: set after booking — list clears and refetches with loader. */
  YourRidesList: { _afterBookRefresh?: number } | undefined;
  RideDetail: {
    ride: RideListItem;
    passengerSearch?: PassengerSearchParams;
    selectedFrom?: string;
    selectedTo?: string;
  };
  PublishedRideRouteMap: {
    pickupLabel: string;
    destinationLabel: string;
    pickupLatitude: number;
    pickupLongitude: number;
    destinationLatitude: number;
    destinationLongitude: number;
  };
  /** Open another user's profile from ride details without switching bottom tab. */
  OwnerProfileModal: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
    publisherAvgRating?: number;
    publisherRatingCount?: number;
    dateOfBirth?: string;
    publisherPhone?: string;
    hidePublisherPhone?: boolean;
    /** When true, profile is a minimal “deactivated” placeholder (no PII, no ratings/trips fetch). */
    peerDeactivated?: boolean;
    _returnToRide?: TripsReturnToRideContext;
  } | undefined;
  /** Ratings view for an arbitrary user opened from ride details modal. */
  OwnerRatingsModal: { userId: string; displayName?: string; avatarUrl?: string } | undefined;
  LocationPicker: {
    field?: 'from' | 'to';
    currentFrom?: string;
    currentTo?: string;
    currentDate?: string;
    currentPassengers?: string;
    currentFromLatitude?: number;
    currentFromLongitude?: number;
    currentToLatitude?: number;
    currentToLongitude?: number;
    returnScreen?: 'SearchRides' | 'PublishRide';
  } | undefined;
  EditRide: { ride: RideListItem };
  PublishRecentEdit: {
    entry: RecentPublishedEntry;
    returnToRide?: TripsReturnToRideContext;
  };
  BookPassengerDetail: {
    ride: RideListItem;
    booking: NonNullable<RideListItem['bookings']>[number];
    requestMode?: boolean;
    ownerBookingHistoryLines?: string[];
  };
  Chat: {
    ride?: RideListItem;
    rideId?: string;
    otherUserName: string;
    otherUserId: string;
    otherUserAvatarUrl?: string;
    /** Peer account deactivated — mask header and block new messages. */
    otherUserDeactivated?: boolean;
  };
};

/**
 * Inbox tab: InboxList → Chat → RideDetail, plus routes RideDetail may push (same as Rides / Search stacks).
 */
export type InboxStackParamList = {
  InboxList: undefined;
  Chat: {
    ride?: RideListItem;
    rideId?: string;
    otherUserName: string;
    otherUserId: string;
    otherUserAvatarUrl?: string;
    otherUserDeactivated?: boolean;
  };
  /** Same screen as other tabs — open the ride this chat belongs to (e.g. from inbox-only stack). */
  RideDetail: { ride: RideListItem; passengerSearch?: PassengerSearchParams };
} & Pick<
  RidesStackParamList,
  | 'PublishedRideRouteMap'
  | 'LocationPicker'
  | 'EditRide'
  | 'BookPassengerDetail'
  | 'OwnerProfileModal'
  | 'OwnerRatingsModal'
>;

/**
 * Profile tab: stack (ProfileHome -> Ratings)
 */
export type ProfileStackParamList = {
  ProfileEntry:
    | {
        userId?: string;
        displayName?: string;
        avatarUrl?: string;
        /** From ride/chat when publisher/passenger is deactivated — skip PII and ratings/trips fetch. */
        peerDeactivated?: boolean;
        _returnToRideDetail?: {
          tab: string;
          params: unknown;
        };
      }
    | undefined;
  ProfileHome:
    | {
        userId?: string;
        displayName?: string;
        avatarUrl?: string;
        _returnToRideDetail?: {
          tab: string;
          params: unknown;
        };
      }
    | undefined;
  Ratings:
    | {
        userId?: string;
        displayName?: string;
        /** Profile photo URL when known (e.g. current user from auth). */
        avatarUrl?: string;
        _returnToRideDetail?: {
          tab: string;
          params: unknown;
        };
      }
    | undefined;
  /** Signed-in user: phone + vehicle fields only. */
  EditProfile: undefined;
  /** Password, deactivate messaging, delete account (email/password Firebase users). */
  AccountSecurity: undefined;
  /** Trip stats; omit `userId` for the signed-in user. */
  Trips:
    | {
        userId?: string;
        displayName?: string;
        /** When set (e.g. from owner modal after ride detail), back reopens that ride on Find / Your Rides / Inbox. */
        _returnToRide?: TripsReturnToRideContext;
      }
    | undefined;
};

/**
 * Main app: 5 bottom tabs
 */
export type MainTabParamList = {
  SearchStack:
    | undefined
    | {
        screen: keyof SearchStackParamList;
        params?: SearchStackParamList[keyof SearchStackParamList];
      };
  PublishStack: undefined;
  YourRides:
    | undefined
    | {
        screen: keyof RidesStackParamList;
        params?: RidesStackParamList[keyof RidesStackParamList];
      };
  Inbox:
    | undefined
    | {
        screen: keyof InboxStackParamList;
        params?: InboxStackParamList[keyof InboxStackParamList];
      };
  Profile:
    | undefined
    | {
        screen: keyof ProfileStackParamList;
        params?: ProfileStackParamList[keyof ProfileStackParamList];
      };
};

/**
 * Root: main tabs + auth modals (guests browse Search; book / other tabs open Login).
 */
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Login: { reason?: 'book' | 'tab' } | undefined;
  Register: undefined;
  /** After email/password signup — user must open Firebase verification link, then Continue. */
  VerifyEmail: { email?: string } | undefined;
  /** After email is verified — DOB, gender, phone, terms (optional skip). */
  CompleteProfile: undefined;
  ForgotPassword: undefined;
  /** After API returns ACCOUNT_DEACTIVATED — user dismissed to guest Main. */
  AccountDeactivated: undefined;
  /** Firebase signed in but Mongo user deactivated — reauth + POST /user/reactivate to resume. */
  ReactivateAccount: undefined;
};

// Screen prop types for use in components
export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> =
  BottomTabScreenProps<MainTabParamList, T>;

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

/** Auth screens mounted on root stack (modal) — same props shape as old Auth stack. */
export type RootAuthScreenProps<
  T extends
    | 'Login'
    | 'Register'
    | 'VerifyEmail'
    | 'CompleteProfile'
    | 'ForgotPassword'
    | 'AccountDeactivated'
    | 'ReactivateAccount',
> = RootStackScreenProps<T>;

export type MainTabScreenPropsFromRoot<T extends keyof MainTabParamList> = CompositeScreenProps<
  MainTabScreenProps<T>,
  RootStackScreenProps<'Main'>
>;
