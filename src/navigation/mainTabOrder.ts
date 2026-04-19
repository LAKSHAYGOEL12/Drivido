/**
 * Canonical bottom tab order — must match `BottomTabs.tsx` `Tab.Screen` order.
 * Use for `CommonActions.reset` / notification navigation instead of hard-coded indices.
 */
export const MAIN_TAB_ORDER = [
  'SearchStack',
  'YourRides',
  'PublishStack',
  'Inbox',
  'Profile',
] as const;

export type MainTabName = (typeof MAIN_TAB_ORDER)[number];

export function mainTabIndex(name: MainTabName): number {
  const i = MAIN_TAB_ORDER.indexOf(name);
  if (i < 0) {
    throw new Error(`mainTabIndex: unknown tab "${String(name)}"`);
  }
  return i;
}
