/**
 * Each bottom tab’s stack shows the main tab bar only on this nested route.
 * Any other screen in that stack hides the bar (`BottomTabs` + blur cleanups).
 */
export const MAIN_TAB_PRIMARY_NESTED_ROUTE = {
  SearchStack: 'SearchRides',
  PublishStack: 'PublishRide',
  YourRides: 'YourRidesList',
  Inbox: 'InboxList',
  Profile: 'ProfileHome',
} as const;

export type MainTabScreenName = keyof typeof MAIN_TAB_PRIMARY_NESTED_ROUTE;
