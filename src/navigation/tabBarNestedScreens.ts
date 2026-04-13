/**
 * Nested stack routes where the bottom tab bar should be hidden.
 * Keep in sync across tabs — referenced from focus/unmount cleanup in screens.
 */
export const TAB_BAR_HIDDEN_SEARCH_STACK = new Set([
  'RideDetail',
  /** Legacy / defensive — registered name is `RideDetail`. */
  'RideDetailScreen',
  'EditRide',
  'LocationPicker',
  'PublishedRideRouteMap',
  'BookPassengerDetail',
  'Chat',
  'OwnerProfileModal',
  'OwnerRatingsModal',
]);

export const TAB_BAR_HIDDEN_PUBLISH_STACK = new Set([
  /** Not in `PublishStack` today; kept so tab bar stays hidden if a flow ever pushes these. */
  'RideDetail',
  'RideDetailScreen',
  'Chat',
  'LocationPicker',
  'PublishRoutePreview',
  'PublishSelectDate',
  'PublishSelectTime',
  'PublishPrice',
  'PublishRecentEdit',
]);

export const TAB_BAR_HIDDEN_RIDES_STACK = new Set([
  'RideDetail',
  'RideDetailScreen',
  'EditRide',
  'BookPassengerDetail',
  'PublishedRideRouteMap',
  'Chat',
  'OwnerProfileModal',
  'OwnerRatingsModal',
]);

export const TAB_BAR_HIDDEN_INBOX_STACK = new Set([
  'RideDetail',
  'RideDetailScreen',
  'BookPassengerDetail',
  'PublishedRideRouteMap',
  'LocationPicker',
  'EditRide',
  'Chat',
  'OwnerProfileModal',
  'OwnerRatingsModal',
]);

export const TAB_BAR_HIDDEN_PROFILE_STACK = new Set([
  'ProfileEntry',
  'EditProfile',
  'AccountSecurity',
  'Trips',
  'Ratings',
  'RatingsScreen',
]);

/** Root ref / post-login checks: user is on a full-screen ride detail flow. */
export function isRootLeafRideDetailRoute(name: string | undefined): boolean {
  return name === 'RideDetail' || name === 'RideDetailScreen';
}
