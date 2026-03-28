import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { RideListItem } from '../types/api';

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
    returnScreen?: 'SearchRides' | 'PublishRide';
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
  };
  RideDetail: { ride: RideListItem; passengerSearch?: PassengerSearchParams };
  /** Open another user's profile from ride details without switching bottom tab. */
  OwnerProfileModal: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
    /** From ride payload for signed-in users (backend); avoids client ratings fetch on profile. */
    publisherAvgRating?: number;
    publisherRatingCount?: number;
  } | undefined;
  /** Ratings view for an arbitrary user opened from ride details modal. */
  OwnerRatingsModal: { userId: string; displayName?: string; avatarUrl?: string } | undefined;
  EditRide: { ride: RideListItem };
  BookPassengerDetail: {
    ride: RideListItem;
    booking: NonNullable<RideListItem['bookings']>[number];
    requestMode?: boolean;
  };
  Chat: { ride: RideListItem; otherUserName: string; otherUserId?: string; otherUserAvatarUrl?: string };
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
  LocationPicker: {
    field?: 'from' | 'to';
    currentFrom?: string;
    currentTo?: string;
    currentPickupLatitude?: number;
    currentPickupLongitude?: number;
    currentDestinationLatitude?: number;
    currentDestinationLongitude?: number;
    returnScreen?: 'SearchRides' | 'PublishRide';
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
  /** Open another user's profile from ride details without switching bottom tab. */
  OwnerProfileModal: {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
    publisherAvgRating?: number;
    publisherRatingCount?: number;
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
  BookPassengerDetail: {
    ride: RideListItem;
    booking: NonNullable<RideListItem['bookings']>[number];
    requestMode?: boolean;
  };
  Chat: { ride: RideListItem; otherUserName: string; otherUserId?: string; otherUserAvatarUrl?: string };
};

/**
 * Inbox tab: stack (InboxList → Chat). Back from Chat returns to InboxList.
 */
export type InboxStackParamList = {
  InboxList: undefined;
  Chat: { ride: RideListItem; otherUserName: string; otherUserId?: string; otherUserAvatarUrl?: string };
};

/**
 * Profile tab: stack (ProfileHome -> Ratings)
 */
export type ProfileStackParamList = {
  ProfileEntry:
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
  ForgotPassword: undefined;
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
export type RootAuthScreenProps<T extends 'Login' | 'Register' | 'VerifyEmail' | 'ForgotPassword'> =
  RootStackScreenProps<T>;

export type MainTabScreenPropsFromRoot<T extends keyof MainTabParamList> = CompositeScreenProps<
  MainTabScreenProps<T>,
  RootStackScreenProps<'Main'>
>;
