/**
 * Physical order of `Tab.Screen` in `BottomTabs` / material tab pager indices.
 * Publish is intentionally NOT a pager tab route (opened from FAB/root stack).
 */
export const MAIN_TAB_NAVIGATOR_ORDER = [
  'SearchStack',
  'YourRides',
  'Inbox',
  'Profile',
] as const;

/**
 * Bottom pill visual order — FAB sits between My Trips and Messages.
 * (Navigator order differs; see {@link MAIN_TAB_NAVIGATOR_ORDER}.)
 */
export const MAIN_TAB_BAR_DISPLAY_ORDER = [
  'SearchStack',
  'YourRides',
  'PublishStack',
  'Inbox',
  'Profile',
] as const;

export type MainTabName = (typeof MAIN_TAB_NAVIGATOR_ORDER)[number];

/**
 * Index in the **pager / `CommonActions.reset` routes array** (same as {@link MAIN_TAB_NAVIGATOR_ORDER}).
 */
export function mainTabIndex(name: MainTabName): number {
  const i = MAIN_TAB_NAVIGATOR_ORDER.indexOf(name);
  if (i < 0) {
    throw new Error(`mainTabIndex: unknown tab "${String(name)}"`);
  }
  return i;
}

/** @deprecated Prefer {@link MAIN_TAB_BAR_DISPLAY_ORDER} (UI) or {@link MAIN_TAB_NAVIGATOR_ORDER} (pager). */
export const MAIN_TAB_ORDER = MAIN_TAB_BAR_DISPLAY_ORDER;
