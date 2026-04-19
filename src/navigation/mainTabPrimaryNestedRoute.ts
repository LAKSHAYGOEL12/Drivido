/**
 * Bottom tab bar policy (enforced in `BottomTabs.tsx`):
 *
 * The tab bar is shown **only** when the user is on exactly **one** of these five nested “root”
 * screens — the initial screen of each tab’s stack. Every other nested route in any tab stack
 * hides the bar (`tabBarStyle: { display: 'none' }`).
 *
 * This is intentionally strict: full-screen flows (ride detail, publish wizard, chat, profile
 * subpages, modals, etc.) never keep the bottom tabs visible.
 *
 * Auth / onboarding lives outside `BottomTabs` and has no tab bar.
 *
 * Primary enforcement: `BottomTabs` (material top tab + bottom custom bar) → `MainBottomTabBar` + tab `state`
 * (updates on every nested navigation). A few screens also call `setOptions({ tabBarStyle })` for edge timing; keep
 * those aligned with this map.
 */
export const MAIN_TAB_PRIMARY_NESTED_ROUTE = {
  SearchStack: 'SearchRides',
  PublishStack: 'PublishRide',
  YourRides: 'YourRidesList',
  Inbox: 'InboxList',
  Profile: 'ProfileHome',
} as const;

export type MainTabScreenName = keyof typeof MAIN_TAB_PRIMARY_NESTED_ROUTE;

/**
 * `true` only when the focused leaf route in this tab’s stack is that tab’s single allowed
 * “tabs visible” screen (see {@link MAIN_TAB_PRIMARY_NESTED_ROUTE}).
 */
export function shouldShowMainTabBar(
  tab: MainTabScreenName,
  focusedNestedRouteName: string | undefined
): boolean {
  const root = MAIN_TAB_PRIMARY_NESTED_ROUTE[tab];
  if (focusedNestedRouteName == null || focusedNestedRouteName === '') {
    return true;
  }
  return focusedNestedRouteName === root;
}
