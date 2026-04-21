import type { ViewStyle } from 'react-native';

/**
 * Single source of truth for the floating bottom tab + FAB vertical slot.
 * Used by the tab navigator, {@link MainBottomTabBar} height callbacks, and scroll insets
 * (e.g. Your Rides) so they never disagree.
 */
export const TAB_BAR_EXTRA_BOTTOM_INSET = 6;
export const TAB_ROW_MIN = 48;
/** Slight lift so the publish FAB clears the pill and is less likely to feel “in the swipe path”. */
export const FAB_VISUAL_RISE = 26;

/**
 * Extra space beyond {@link mainTabBarSlotHeight} for scrollable content on main-tab “home” screens,
 * so the last row clears FAB shadow, ripples, badges, and stays comfortable to tap.
 */
export const MAIN_TAB_SCROLL_CLEARANCE = 20;

/** Design-time height of the overlay tab bar region (matches `tabBarStyle.height` on `BottomTabs`). */
export function mainTabBarSlotHeight(safeAreaBottom: number): number {
  return TAB_ROW_MIN + FAB_VISUAL_RISE + safeAreaBottom + TAB_BAR_EXTRA_BOTTOM_INSET;
}

/**
 * Use as `contentContainerStyle={{ paddingBottom: mainTabScrollBottomInset(insets.bottom) }}` (plus any
 * keyboard offset) on Find / My Trips / Messages / Profile / Publish root scroll content so it can scroll
 * fully above the floating pill + FAB.
 */
export function mainTabScrollBottomInset(safeAreaBottom: number): number {
  return mainTabBarSlotHeight(safeAreaBottom) + MAIN_TAB_SCROLL_CLEARANCE;
}

/** Extra scroll padding when a screen pins a primary CTA above the tab bar (e.g. Publish). */
export const MAIN_TAB_STICKY_PRIMARY_CTA_EXTRA = 58;

/**
 * Default overlay region for the custom tab bar (matches `BottomTabs` `screenOptions.tabBarStyle`).
 * Always merge this under per-route `tabBarStyle` in {@link MainBottomTabBar}: several flows call
 * `setOptions({ tabBarStyle: undefined })` to clear `display: 'none'`, which otherwise strips height
 * and collapses the pill while the absolute FAB stays visible.
 */
export function mainTabBarChromeLayoutStyle(slotHeight: number): ViewStyle {
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    height: slotHeight,
  };
}
