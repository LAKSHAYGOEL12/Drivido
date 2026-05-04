import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  type AppStateStatus,
  BackHandler,
  Dimensions,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabBarProps,
} from '@react-navigation/material-top-tabs';
import { CommonActions, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import UserAvatar from '../components/common/UserAvatar';
import SearchStack from './SearchStack';
import RidesStack from './RidesStack';
import InboxStack from './InboxStack';
import ProfileStack from './ProfileStack';
import { useInbox } from '../contexts/InboxContext';
import { useAuth } from '../contexts/AuthContext';
import { useOwnerPendingRequests } from '../contexts/OwnerPendingRequestsContext';
import { usePromotionCampaigns } from '../contexts/PromotionCampaignsContext';
import { resolveTopOfferProgresses } from '../utils/promotionOfferCopy';
import { COLORS } from '../constants/colors';
import { navigateToGuestLogin } from './navigateToGuestLogin';
import { findMainTabNavigator } from './findMainTabNavigator';
import { emitRequestMyRidesListRefresh } from '../services/myRidesListRefreshEvents';
import {
  MAIN_TAB_PRIMARY_NESTED_ROUTE,
  shouldShowMainTabBar,
  type MainTabScreenName,
} from './mainTabPrimaryNestedRoute';
import {
  FAB_VISUAL_RISE,
  mainTabBarChromeLayoutStyle,
  mainTabBarSlotHeight,
  TAB_BAR_EXTRA_BOTTOM_INSET,
  TAB_ROW_MIN,
} from './tabBarMetrics';
import {
  handleMainTabAndroidHardwareBackPress,
  publishFabSheetOpenRef,
} from './mainTabAndroidHardwareBack';
import { MAIN_TAB_BAR_DISPLAY_ORDER, type MainTabName } from './mainTabOrder';
import { navigatePublishStackToNewRideWizard } from './navigatePublishStackNewRideWizard';
import FloatingOffersStrip, {
  FLOATING_OFFERS_STRIP_GAP,
} from '../components/promotions/FloatingOffersStrip';

const PUBLISH_FAB_SHEET_OFF_Y = Math.min(520, Math.round(Dimensions.get('window').height * 0.5));

const Tab = createMaterialTopTabNavigator<MainTabParamList>();

/** Horizontal inset so the pill “floats” off the screen edges. */
const TAB_PILL_SIDE_INSET = 20;
/** Same geometry for every tab; focus uses tint + ring (no filled-vs-outline mismatch). */
function mainTabIconSize(_focused: boolean): number {
  return 24;
}

type NavStateLite = {
  index?: number;
  routes?: Array<{ name?: string; state?: NavStateLite }>;
};

/**
 * Merge only layout-related tab bar styles onto the custom bar.
 * - Strips `display` so stale `display: 'none'` from nested screens cannot hide the chrome.
 * - Strips `elevation` / `zIndex` / `opacity` so navigator options cannot flatten or hide the chrome.
 */
function tabBarChromeLayoutStyle(style: unknown): StyleProp<ViewStyle> | undefined {
  if (style == null) return undefined;
  const flat = StyleSheet.flatten(style as StyleProp<ViewStyle>) as Record<string, unknown> | undefined;
  if (!flat || typeof flat !== 'object') return undefined;
  const {
    display: _display,
    elevation: _elevation,
    zIndex: _zIndex,
    opacity: _opacity,
    ...rest
  } = flat;
  return rest as StyleProp<ViewStyle>;
}

/**
 * Focused route **at this navigator’s top level** only.
 *
 * Do not recurse into `route.state`: native-stack screens (e.g. `YourRidesList`) may carry opaque
 * nested `state` that is not part of our route table. Recursing made the “leaf” name !==
 * `YourRidesList` on the list screen and hid the bottom tab bar for the Rides tab only.
 */
function getTopFocusedRouteName(state: NavStateLite | undefined): string | undefined {
  if (!state?.routes?.length) return undefined;
  const rawIdx = typeof state.index === 'number' ? state.index : state.routes.length - 1;
  const idx = Math.min(Math.max(0, rawIdx), state.routes.length - 1);
  return state.routes[idx]?.name;
}

function computeHideMainTabBar(state: MaterialTopTabBarProps['state'] | undefined): boolean {
  if (!state?.routes?.length || state.index == null || state.index < 0) return false;
  const tabRoute = state.routes[state.index] as { name?: string; state?: NavStateLite };
  const rawTabName = tabRoute.name;
  /**
   * Product rule: Publish flow (`LocationPicker`, preview, review, recents, edit) never shows bottom tabs.
   * Visible tabs are only allowed on Search / Your Rides / Inbox / Profile roots.
   */
  const tabName = rawTabName as MainTabScreenName | undefined;
  if (!tabName || !(tabName in MAIN_TAB_PRIMARY_NESTED_ROUTE)) return false;
  const focusedNested = getTopFocusedRouteName(tabRoute.state);
  return !shouldShowMainTabBar(tabName, focusedNested);
}

/**
 * Tab bar already receives full material-tab `state`; we sync three signals from it:
 * - pager swipe enable (mirrors tab-bar visibility),
 * - focused root tab name (drives the SearchRides-only floating offers strip),
 *
 * using nested `navigation.getState()` is unreliable here because that may return the parent
 * stack state on early frames; the material-tab `state` prop is always the authoritative source.
 */
function TabBarWithPagerSwipeSync(
  props: MaterialTopTabBarProps & {
    onPagerSwipeChange: (enabled: boolean) => void;
    onFocusedRootTabChange: (name: string | undefined) => void;
  }
): React.JSX.Element {
  const { onPagerSwipeChange, onFocusedRootTabChange, ...barProps } = props;
  useLayoutEffect(() => {
    onPagerSwipeChange(!computeHideMainTabBar(barProps.state));
    const idx = barProps.state?.index;
    const rootName =
      typeof idx === 'number' && idx >= 0
        ? barProps.state?.routes?.[idx]?.name
        : undefined;
    onFocusedRootTabChange(rootName);
  }, [barProps.state, onPagerSwipeChange, onFocusedRootTabChange]);
  return <MainBottomTabBar {...barProps} />;
}

/**
 * Tab bar visibility: only the root nested routes in `MAIN_TAB_PRIMARY_NESTED_ROUTE`
 * show the bar. Uses tab `state` from props plus **top-level** nested route names (see
 * {@link getTopFocusedRouteName}).
 */
function MainBottomTabBar(props: MaterialTopTabBarProps): React.JSX.Element {
  const { state, descriptors, navigation } = props;
  const hideTabs = computeHideMainTabBar(state);

  const insets = useSafeAreaInsets();
  const { hasUnread } = useInbox();
  const { isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const slotHeight = mainTabBarSlotHeight(insets.bottom);

  if (hideTabs) {
    return <View style={styles.tabBarHidden} collapsable={false} />;
  }

  const bottomPad = insets.bottom + TAB_BAR_EXTRA_BOTTOM_INSET;
  const publishFocused = false;
  const [publishFabSheetOpen, setPublishFabSheetOpen] = useState(false);
  const publishFabSheetTranslateY = useRef(new Animated.Value(PUBLISH_FAB_SHEET_OFF_Y)).current;
  const publishFabBackdropOpacity = useRef(new Animated.Value(0)).current;
  const publishFabCloseBusyRef = useRef(false);

  const closePublishFabSheet = useCallback((afterClose?: () => void) => {
    if (publishFabCloseBusyRef.current) return;
    if (!publishFabSheetOpen) {
      afterClose?.();
      return;
    }
    publishFabCloseBusyRef.current = true;
    Animated.parallel([
      Animated.timing(publishFabSheetTranslateY, {
        toValue: PUBLISH_FAB_SHEET_OFF_Y,
        duration: 280,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(publishFabBackdropOpacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      publishFabCloseBusyRef.current = false;
      if (!finished) return;
      setPublishFabSheetOpen(false);
      afterClose?.();
    });
  }, [publishFabSheetOpen, publishFabSheetTranslateY, publishFabBackdropOpacity]);

  useLayoutEffect(() => {
    if (!publishFabSheetOpen) return;
    publishFabSheetTranslateY.setValue(PUBLISH_FAB_SHEET_OFF_Y);
    publishFabBackdropOpacity.setValue(0);
    const t = requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(publishFabSheetTranslateY, {
          toValue: 0,
          duration: 340,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(publishFabBackdropOpacity, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => cancelAnimationFrame(t);
  }, [publishFabSheetOpen, publishFabSheetTranslateY, publishFabBackdropOpacity]);

  useEffect(() => {
    publishFabSheetOpenRef.current = publishFabSheetOpen;
    return () => {
      publishFabSheetOpenRef.current = false;
    };
  }, [publishFabSheetOpen]);

  useEffect(() => {
    if (!publishFabSheetOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closePublishFabSheet();
      return true;
    });
    return () => sub.remove();
  }, [publishFabSheetOpen, closePublishFabSheet]);

  const navigatePublishReuseRecents = useCallback(() => {
    (navigation as { navigate: (config: Record<string, unknown>) => void }).navigate({
      name: 'PublishStack',
      merge: false,
      params: {
        state: {
          routes: [{ name: 'PublishRecentsPicker' as const }],
          index: 0,
        },
      },
    });
  }, [navigation]);

  const onPublishFabPress = (): void => {
    if (!sessionReady) {
      navigateToGuestLogin(navigation as unknown as NavigationProp<ParamListBase>, { reason: 'tab' });
      return;
    }
    setPublishFabSheetOpen(true);
  };

  const runAfterFabSheetClose = useCallback((action: () => void): void => {
    requestAnimationFrame(() => {
      action();
    });
  }, []);

  const onPublishFabNewRide = (): void => {
    const raw = state.routes[state.index]?.name;
    const exitToTab = (typeof raw === 'string' ? raw : 'SearchStack') as MainTabName;
    closePublishFabSheet(() =>
      runAfterFabSheetClose(() =>
        navigatePublishStackToNewRideWizard(navigation as { dispatch: (action: unknown) => void }, {
          exitToTab,
        })
      )
    );
  };

  const onPublishFabReuseRecent = (): void => {
    closePublishFabSheet(() => runAfterFabSheetClose(() => navigatePublishReuseRecents()));
  };

  const iconTint = (focused: boolean): string =>
    focused ? COLORS.text : COLORS.tabBarIconInactive;

  const focusedRouteKey = state.routes[state.index]?.key;
  const tabBarStyleFromOptions = focusedRouteKey
    ? descriptors[focusedRouteKey]?.options?.tabBarStyle
    : undefined;

  const chromeLayout = tabBarChromeLayoutStyle(tabBarStyleFromOptions);

  return (
    <View
      style={
        [
          mainTabBarChromeLayoutStyle(slotHeight),
          chromeLayout,
          styles.customTabRoot,
        ] as StyleProp<ViewStyle>
      }
      collapsable={false}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.customTabInner,
          { paddingBottom: bottomPad, paddingHorizontal: TAB_PILL_SIDE_INSET },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.floatingPillShadow}>
          <View style={styles.floatingPill}>
            <View style={styles.tabBarRow}>
              {MAIN_TAB_BAR_DISPLAY_ORDER.map((tabName) => {
                if (tabName === 'PublishStack') {
                  return (
                    <View key="publish-fab-slot" style={styles.publishFabSlot} pointerEvents="box-none">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Publish"
                        accessibilityHint="Opens new ride and reuse recent options"
                        accessibilityState={{ selected: publishFocused }}
                        onPress={onPublishFabPress}
                        style={({ pressed }) => [
                          styles.publishFabHitColumn,
                          pressed && styles.publishFabHitColumnPressed,
                        ]}
                      >
                        <View style={[styles.fab, publishFocused && styles.fabSelected]}>
                          <Ionicons name="add" size={26} color={COLORS.white} />
                        </View>
                        <Text style={styles.publishFabLabel} numberOfLines={1}>
                          Publish
                        </Text>
                      </Pressable>
                    </View>
                  );
                }
                const route = state.routes.find((r) => r.name === tabName);
                if (!route) return null;
                const index = state.routes.indexOf(route);
                const focused = state.index === index;
                const { options } = descriptors[route.key];
                const tint = iconTint(focused);
                const onPress = (): void => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (event.defaultPrevented) return;
                  if (!focused) {
                    navigation.navigate(route.name as never);
                  }
                };
                const labelFromOptions = options.tabBarLabel ?? options.title;
                const label =
                  typeof labelFromOptions === 'string'
                    ? labelFromOptions
                    : tabName === 'SearchStack'
                      ? 'Find'
                      : tabName === 'YourRides'
                        ? 'My Trips'
                      : tabName === 'Inbox'
                        ? 'Messages'
                        : 'Profile';
                const showInboxBadge = tabName === 'Inbox' && hasUnread;

                return (
                  <View key={route.key} style={styles.tabSlot}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: focused }}
                      accessibilityLabel={String(label)}
                      onPress={onPress}
                      android_ripple={
                        Platform.OS === 'android'
                          ? { color: COLORS.primaryRipple, borderless: true, radius: 28 }
                          : undefined
                      }
                      style={({ pressed }) => [styles.tabHitCircle, pressed && styles.tabHitCirclePressed]}
                    >
                      <View style={[styles.tabIconWell, focused && styles.tabIconWellFocused]}>
                        <View style={styles.tabIconWrap}>
                          {options.tabBarIcon?.({
                            focused,
                            color: tint,
                          })}
                          {showInboxBadge ? <View style={styles.inboxBadgeDot} /> : null}
                        </View>
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      <Modal
        visible={publishFabSheetOpen}
        transparent
        animationType="none"
        onRequestClose={() => closePublishFabSheet()}
      >
        <View style={styles.publishFabSheetRoot}>
          <Animated.View
            style={[styles.publishFabSheetBackdrop, { opacity: publishFabBackdropOpacity }]}
            pointerEvents="box-none"
          >
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => closePublishFabSheet()} />
          </Animated.View>
          <Animated.View
            style={[
              styles.publishFabSheetCard,
              { paddingBottom: Math.max(insets.bottom, 10) + 6 },
              { transform: [{ translateY: publishFabSheetTranslateY }] },
            ]}
          >
            <View style={styles.publishFabSheetHandle} />
            <View style={styles.publishFabSheetHeader}>
              <View style={styles.publishFabSheetHeaderAccentRow}>
                <View style={styles.publishFabSheetHeaderAccentBar} />
                <View style={styles.publishFabSheetHeaderTextBlock}>
                  <Text style={styles.publishFabSheetTitle}>Publish</Text>
                  <Text style={styles.publishFabSheetCaption}>
                    Start a new ride or reuse a route you have published before.
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.publishFabSheetActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.publishFabSheetRow,
                  styles.publishFabSheetRowNew,
                  pressed && styles.publishFabSheetRowPressedNew,
                ]}
                onPress={onPublishFabNewRide}
                accessibilityRole="button"
                accessibilityLabel="New ride"
                android_ripple={{ color: COLORS.primaryRipple }}
              >
                <View style={[styles.publishFabSheetRowIcon, styles.publishFabSheetRowIconPrimary]}>
                  <Ionicons name="navigate-circle-outline" size={24} color={COLORS.primaryDark} />
                </View>
                <View style={styles.publishFabSheetRowText}>
                  <Text style={styles.publishFabSheetRowTitle}>New ride</Text>
                  <Text style={styles.publishFabSheetRowSub}>Pickup, destination, time, and fare</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.primaryDark} />
              </Pressable>
              <View style={styles.publishFabSheetRowSeparator} />
              <Pressable
                style={({ pressed }) => [
                  styles.publishFabSheetRow,
                  styles.publishFabSheetRowReuse,
                  pressed && styles.publishFabSheetRowPressedReuse,
                ]}
                onPress={onPublishFabReuseRecent}
                accessibilityRole="button"
                accessibilityLabel="Reuse a recent ride"
                android_ripple={{ color: 'rgba(37, 99, 235, 0.12)' }}
              >
                <View style={[styles.publishFabSheetRowIcon, styles.publishFabSheetRowIconSecondary]}>
                  <Ionicons name="albums-outline" size={22} color={COLORS.secondary} />
                </View>
                <View style={styles.publishFabSheetRowText}>
                  <Text style={styles.publishFabSheetRowTitle}>Reuse recent</Text>
                  <Text style={styles.publishFabSheetRowSub}>Copy details from a past listing</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.secondaryLight} />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.publishFabSheetCancel, pressed && styles.publishFabSheetCancelPressed]}
              onPress={() => closePublishFabSheet()}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              android_ripple={{ color: 'rgba(15, 23, 42, 0.06)', borderless: true }}
            >
              <Text style={styles.publishFabSheetCancelText}>Cancel</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

/** Ring diameter tracks selected state (larger + darker emphasis, no pill tint). */
const PROFILE_TAB_RING_IDLE = 26;
const PROFILE_TAB_RING_FOCUSED = 30;

/**
 * Small gold "gift" badge overlaid on the Profile avatar — visible ONLY when:
 *   1. there is at least one live offer, and
 *   2. the user has not yet tapped the Profile tab this JS process.
 *
 * Pulses gently to draw the eye on first view, then disappears on first tap. Session-scoped
 * (no persistence), matching {@link FloatingOffersStrip}'s "show on every cold launch" rule.
 */
function ProfileOfferHintBadge(): React.JSX.Element {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pulse.setValue(0);
    /**
     * Short burst of attention — 3 pulses then settle. A never-ending loop feels "needy" on
     * a persistent tab bar element; three pulses is the standard "nudge" cadence used across
     * premium apps (Swiggy / Zomato / Binance) for non-critical promos.
     */
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 780,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 780,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 3 }
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });
  const haloOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.55],
  });
  const haloScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.9],
  });

  return (
    <View style={styles.profileOfferBadgeWrap} pointerEvents="none">
      <Animated.View
        style={[
          styles.profileOfferBadgeHalo,
          { opacity: haloOpacity, transform: [{ scale: haloScale }] },
        ]}
      />
      <Animated.View style={[styles.profileOfferBadge, { transform: [{ scale }] }]}>
        <Ionicons name="gift" size={7} color="#FBBF24" />
      </Animated.View>
    </View>
  );
}

function ProfileTabBarIcon({
  focused,
  color,
  size: _size,
  avatarUrl,
  displayName,
  showOfferHint,
}: {
  focused: boolean;
  color: string;
  size: number;
  avatarUrl?: string | null;
  displayName: string;
  showOfferHint: boolean;
}): React.JSX.Element {
  const uri = (avatarUrl ?? '').trim();
  const name = displayName.trim() || 'You';
  const ring = focused ? PROFILE_TAB_RING_FOCUSED : PROFILE_TAB_RING_IDLE;
  const r = ring / 2;
  const avatarSize = focused ? 26 : 22;
  return (
    <View style={styles.profileTabIconHost} collapsable={false}>
      <View
        style={[
          styles.profileTabClip,
          {
            width: ring,
            height: ring,
            borderRadius: r,
          },
          focused ? styles.profileTabClipFocused : styles.profileTabClipIdle,
        ]}
      >
        <UserAvatar
          uri={uri || undefined}
          name={name}
          size={avatarSize}
          backgroundColor={COLORS.backgroundSecondary}
          fallbackTextColor={focused ? COLORS.text : color}
        />
      </View>
      {showOfferHint ? <ProfileOfferHintBadge /> : null}
    </View>
  );
}

/**
 * Nested stack leaf for `Tab.Screen` listeners (`focus` / `tabPress`).
 *
 * `navigation.getState()` there is often the **main bottom-tab** state (routes: SearchStack,
 * YourRides, …), not the nested native stack. Using {@link getTopFocusedRouteName} on that tree
 * yields the **tab** name (`YourRides`), not `YourRidesList`, which incorrectly fired
 * `resetRidesTabToYourRidesList` on every tab focus and broke the tab bar UI.
 */
function getNestedLeafFromTabListenerNavigation(
  navigation: { getState?: () => NavStateLite },
  tabRouteName: 'YourRides' | 'Inbox'
): string | undefined {
  const st = navigation?.getState?.();
  if (!st?.routes?.length) return undefined;
  const names = new Set(st.routes.map((r) => r?.name).filter(Boolean) as string[]);
  const looksLikeMainTabNavigator =
    names.has('SearchStack') && names.has('YourRides') && names.has(tabRouteName);
  if (looksLikeMainTabNavigator) {
    const entry = st.routes.find((r) => r?.name === tabRouteName);
    return getTopFocusedRouteName(entry?.state);
  }
  return getTopFocusedRouteName(st);
}

/** Nested screen name at top of Inbox stack (InboxList, Chat, RideDetail, …). */
function getInboxStackFocusedName(navigation: { getState?: () => NavStateLite }): string | undefined {
  return getNestedLeafFromTabListenerNavigation(navigation, 'Inbox');
}

function resetInboxTabToInboxList(mainTabs: { dispatch: (a: unknown) => void; getState: () => { routes?: any[]; index?: number } }): void {
  const tabState = mainTabs.getState();
  const routes = (tabState?.routes ?? []) as any[];
  const inboxIndex = routes.findIndex((r: { name?: string }) => r?.name === 'Inbox');
  if (inboxIndex < 0) return;
  const nextRoutes = routes.map((r: any) => {
    if (r?.name !== 'Inbox') return r;
    return {
      ...r,
      state: {
        routes: [{ name: 'InboxList' as const }],
        index: 0,
      },
    };
  });
  mainTabs.dispatch(
    CommonActions.reset({
      index: inboxIndex,
      routes: nextRoutes,
    } as never)
  );
}

/** Nested screen at top of Your Rides stack (see {@link getNestedLeafFromTabListenerNavigation}). */
function getRidesStackFocusedName(navigation: { getState?: () => NavStateLite }): string | undefined {
  return getNestedLeafFromTabListenerNavigation(navigation, 'YourRides');
}

function resetRidesTabToYourRidesList(mainTabs: {
  dispatch: (a: unknown) => void;
  getState: () => { routes?: any[]; index?: number };
}): void {
  const tabState = mainTabs.getState();
  const routes = (tabState?.routes ?? []) as any[];
  const ridesIndex = routes.findIndex((r: { name?: string }) => r?.name === 'YourRides');
  if (ridesIndex < 0) return;
  const nextRoutes = routes.map((r: any) => {
    if (r?.name !== 'YourRides') return r;
    return {
      ...r,
      state: {
        routes: [{ name: 'YourRidesList' as const }],
        index: 0,
      },
    };
  });
  mainTabs.dispatch(
    CommonActions.reset({
      index: ridesIndex,
      routes: nextRoutes,
    } as never)
  );
}

function RidesTabIconWithDot({
  focused,
  color,
  size,
  showNotificationDot,
}: {
  focused: boolean;
  color: string;
  size: number;
  showNotificationDot: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.ridesTabIconWrap}>
      <Ionicons name="car-outline" size={size} color={color} />
      {showNotificationDot ? <View style={styles.ridesTabNotificationDot} /> : null}
    </View>
  );
}

export default function BottomTabs(): React.JSX.Element {
  const { bottom: safeBottom } = useSafeAreaInsets();
  const tabBarLayoutHeight = mainTabBarSlotHeight(safeBottom);
  const { hasOwnerPendingSeatRequests } = useOwnerPendingRequests();
  const { user, isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const prevSignedInUserIdRef = useRef<string | undefined>(undefined);
  /**
   * Swipe between tabs only on each tab’s root screen (same rule as tab bar visibility).
   * Start false until the tab bar sync runs so the pager never briefly steals horizontal gestures.
   */
  const [mainTabPagerSwipeEnabled, setMainTabPagerSwipeEnabled] = useState(false);
  const onPagerSwipeChange = useCallback((enabled: boolean) => {
    setMainTabPagerSwipeEnabled((prev) => (prev === enabled ? prev : enabled));
  }, []);

  /**
   * Focused root tab name (e.g. `SearchStack`, `YourRides`, `Inbox`, `Profile`, `PublishStack`).
   * Synced from the material-tab state via {@link TabBarWithPagerSwipeSync}. Drives the
   * floating offers strip — product wants the strip pinned to the SearchRides home only,
   * never on Your Rides / Inbox / Profile, so a dedicated signal is cheaper and safer than
   * recomputing from `navigation.getState()` every render.
   */
  const [focusedRootTab, setFocusedRootTab] = useState<string | undefined>(undefined);
  const onFocusedRootTabChange = useCallback((name: string | undefined) => {
    setFocusedRootTab((prev) => (prev === name ? prev : name));
  }, []);

  /**
   * Profile tab's "gold gift" attention hint is driven by the same
   * {@link usePromotionCampaigns} signal the floating strip consumes, so the two stay in sync
   * (if offers vanish the hint disappears; if they arrive mid-session the hint reappears).
   *
   * Production behavior (per product): the hint is **persistent** while any offer is live.
   * It is intentionally not dismissed on Profile tap — the user can close the floating strip,
   * but the Profile tab continues to advertise that offers are still claimable. The badge only
   * goes away when there are no active offers (offers expired, fully redeemed, or session lost).
   */
  const { catalog, meRows } = usePromotionCampaigns();
  const liveOfferCount = useMemo(
    () => resolveTopOfferProgresses(catalog, meRows).offers.length,
    [catalog, meRows]
  );
  const showProfileOfferHint = sessionReady && liveOfferCount > 0;

  /** New session or account switch — refresh driver/passenger list so “My rides” isn’t stale. */
  useEffect(() => {
    const uid = user?.id?.trim();
    if (!sessionReady || !uid) {
      prevSignedInUserIdRef.current = undefined;
      return;
    }
    if (uid !== prevSignedInUserIdRef.current) {
      prevSignedInUserIdRef.current = uid;
      emitRequestMyRidesListRefresh();
    }
  }, [sessionReady, user?.id]);

  /** Foreground after background — same refresh (Your Rides may be mounted; listener runs full merge). */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (!sessionReady) return;
      if ((prev === 'background' || prev === 'inactive') && next === 'active') {
        emitRequestMyRidesListRefresh();
      }
    });
    return () => sub.remove();
  }, [sessionReady]);

  /**
   * Instagram-style main flow: from Messages / My Trips / Profile / Publish **stack roots**, Android back
   * opens Find (`SearchRides`) via the same nested `navigate` as tapping Find (`merge: false`), not pager tab history.
   * Registered here so it runs **after** focused screens’ listeners (reverse callback order).
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', handleMainTabAndroidHardwareBackPress);
    return () => sub.remove();
  }, []);

  /**
   * `mainTabPagerSwipeEnabled` is recomputed from `!computeHideMainTabBar(state)` on every
   * nav change (see {@link TabBarWithPagerSwipeSync}), so it is already the perfect signal
   * for whether the **bottom tab chrome is currently visible**. We piggy-back on it to drive
   * the floating offer strip's visibility — the strip disappears whenever the tabs do
   * (Publish wizard, Location picker, Chat thread, etc.).
   */
  const tabChromeVisible = mainTabPagerSwipeEnabled;
  /**
   * Product rule: the floating offer strip lives **only** on the Search/Home tab root.
   * On other tabs (Your Rides / Inbox / Profile / Publish) the strip is hidden even though
   * the bottom tab chrome is visible — switching to a different tab is *not* a dismiss,
   * we just don't want the strip to follow the user across tabs.
   */
  const offersStripVisible = tabChromeVisible && focusedRootTab === 'SearchStack';
  /**
   * Strip is **flush** with the top of the bottom-tab assembly — `tabBarLayoutHeight`
   * (= `mainTabBarSlotHeight`) already accounts for the publish FAB's vertical rise, so the
   * slot's top edge is exactly where the FAB's circle peaks. Setting `bottomOffset =
   * tabBarLayoutHeight` (+ a 0pt gap) parks the strip's bottom edge right on that line so it
   * reads as "attached to the tab bar" with zero visible gap — production-standard placement.
   */
  const offersStripBottom = tabBarLayoutHeight + FLOATING_OFFERS_STRIP_GAP;

  return (
    <View style={stylesRoot.tabsHost} collapsable={false}>
    <Tab.Navigator
      /** Avoid competing with explicit Android handling in `mainTabAndroidHardwareBack`. */
      backBehavior="none"
      initialRouteName="SearchStack"
      tabBarPosition="bottom"
      tabBar={(props) => (
        <TabBarWithPagerSwipeSync
          {...props}
          onPagerSwipeChange={onPagerSwipeChange}
          onFocusedRootTabChange={onFocusedRootTabChange}
        />
      )}
      screenOptions={{
        tabBarActiveTintColor: COLORS.text,
        tabBarInactiveTintColor: COLORS.textSecondary,
        tabBarStyle: mainTabBarChromeLayoutStyle(tabBarLayoutHeight),
        lazy: true,
        swipeEnabled: mainTabPagerSwipeEnabled,
        /**
         * `false`: tab bar taps jump directly (no pager “scroll” through other tabs). Swipes still animate
         * on release — see `PanResponderAdapter` (`jumpToIndex(nextIndex, true)` in finishGesture).
         */
        animationEnabled: false,
        sceneStyle: {
          backgroundColor: COLORS.backgroundSecondary,
        },
      }}
    >
      <Tab.Screen
        name="SearchStack"
        component={SearchStack}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate({
              name: 'SearchStack',
              params: {
                screen: 'SearchRides',
                params: { _tabResetToken: Date.now() },
              },
              merge: false,
            });
          },
        })}
        options={() => ({
            title: 'Find',
            tabBarLabel: 'Find',
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name="search-outline" size={mainTabIconSize(focused)} color={color} />
            ),
        })}
      />
      <Tab.Screen
        name="YourRides"
        component={RidesStack}
        listeners={({ navigation }) => ({
          /**
           * Same pattern as Inbox: when returning to this tab, `route` can still report YourRidesList
           * while RideDetail (etc.) is on the nested stack — a tap would not reset and a stale screen flashes first.
           */
          focus: () => {
            if (!sessionReady) return;
            const mainTabs = findMainTabNavigator(navigation);
            if (!mainTabs?.dispatch || !mainTabs?.getState) return;
            const focused = getRidesStackFocusedName(navigation);
            if (focused && focused !== 'YourRidesList') {
              resetRidesTabToYourRidesList(mainTabs);
            }
          },
          tabPress: (e) => {
            if (!sessionReady) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            const focused = getRidesStackFocusedName(navigation);
            if (focused === undefined || focused === 'YourRidesList') {
              return;
            }
            e.preventDefault();
            const mainTabs = findMainTabNavigator(navigation);
            if (!mainTabs?.dispatch || !mainTabs?.getState) {
              navigation.navigate({
                name: 'YourRides',
                params: { screen: 'YourRidesList' as const },
                merge: false,
              } as never);
              return;
            }
            resetRidesTabToYourRidesList(mainTabs);
          },
        })}
        options={() => ({
            title: 'Your Rides',
            tabBarLabel: 'My Trips',
            tabBarIcon: ({ focused, color }) => (
              <RidesTabIconWithDot
                focused={focused}
                color={color}
                size={mainTabIconSize(focused)}
                showNotificationDot={sessionReady && hasOwnerPendingSeatRequests}
              />
            ),
        })}
      />
      <Tab.Screen
        name="Inbox"
        component={InboxStack}
        listeners={({ navigation }) => ({
          /**
           * When switching from another tab (e.g. Search) back to Inbox, `route` can be stale:
           * `getFocusedRouteNameFromRoute(route)` may wrongly default to InboxList while Chat is still
           * on the nested stack — so we read the **live** Inbox stack via `navigation.getState()`.
           */
          focus: () => {
            if (!sessionReady) return;
            const mainTabs = findMainTabNavigator(navigation);
            if (!mainTabs?.dispatch || !mainTabs?.getState) return;
            const focused = getInboxStackFocusedName(navigation);
            if (focused && focused !== 'InboxList') {
              resetInboxTabToInboxList(mainTabs);
            }
          },
          tabPress: (e) => {
            if (!sessionReady) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            const focused = getInboxStackFocusedName(navigation);
            if (focused === undefined || focused === 'InboxList') {
              return;
            }
            e.preventDefault();
            const mainTabs = findMainTabNavigator(navigation);
            if (!mainTabs?.dispatch || !mainTabs?.getState) {
              navigation.navigate({
                name: 'Inbox',
                params: { screen: 'InboxList' as const },
                merge: false,
              } as never);
              return;
            }
            resetInboxTabToInboxList(mainTabs);
          },
        })}
        options={() => ({
            title: 'Messages',
            tabBarLabel: 'Messages',
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name="chatbubbles-outline" size={mainTabIconSize(focused)} color={color} />
            ),
        })}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        listeners={({ navigation }) => ({
          /**
           * Match Find / Publish: tab bar tap replaces nested stack in one action (`merge: false`).
           * Avoid `focus` + `CommonActions.reset` — that ran after the first paint and briefly showed
           * stale screens (e.g. someone else’s Trips left on the Profile stack).
           */
          tabPress: (e) => {
            // Note: the gold-gift hint on the Profile tab is NOT dismissed on tap.
            // It must stay visible for as long as any live offer exists, so the user
            // always knows there is something claimable inside Profile → Rewards.
            if (!sessionReady) {
              e.preventDefault();
              navigateToGuestLogin(navigation, { reason: 'tab' });
              return;
            }
            e.preventDefault();
            const uid = user?.id?.trim();
            navigation.navigate({
              name: 'Profile',
              params: {
                screen: 'ProfileHome',
                params: uid
                  ? {
                      userId: uid,
                      displayName: user?.name,
                      ...(user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
                    }
                  : undefined,
              },
              merge: false,
            } as never);
          },
        })}
        options={() => ({
            title: 'Profile',
            tabBarLabel: 'Profile',
            tabBarIcon: ({ focused, color }) => (
              <ProfileTabBarIcon
                focused={focused}
                color={color}
                size={mainTabIconSize(focused)}
                avatarUrl={user?.avatarUrl}
                displayName={user?.name ?? 'You'}
                showOfferHint={showProfileOfferHint}
              />
            ),
        })}
      />
    </Tab.Navigator>
    <FloatingOffersStrip
      visible={offersStripVisible}
      bottomOffset={offersStripBottom}
      sideInset={TAB_PILL_SIDE_INSET}
    />
    </View>
  );
}

const stylesRoot = StyleSheet.create({
  tabsHost: {
    flex: 1,
  },
});

const styles = StyleSheet.create({
  tabBarHidden: {
    height: 0,
    overflow: 'hidden',
  },
  customTabRoot: {
    backgroundColor: 'transparent',
    overflow: 'visible',
    /** Keep the floating pill above full-bleed scroll content (e.g. Your Rides list). */
    zIndex: 50,
    elevation: 50,
  },
  /** Pins the pill to the bottom of the tab bar slot; empty space above stays non-blocking (`box-none` on parents). */
  customTabInner: {
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  /** Lifted capsule — soft diffuse shadow, hairline border (current iOS / Material 3 feel). */
  floatingPillShadow: {
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 10,
  },
  floatingPill: {
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.tabBarPillBorder,
    paddingVertical: 7,
    paddingHorizontal: 10,
    overflow: 'visible',
  },
  tabBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TAB_ROW_MIN,
  },
  publishFabSlot: {
    width: 68,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 4,
    /** FAB sits in the reserved column (not screen-center) so it does not cover Messages. */
    marginTop: -FAB_VISUAL_RISE,
  },
  publishFabHitColumn: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingBottom: 2,
  },
  publishFabHitColumnPressed: {
    opacity: 0.92,
  },
  publishFabLabel: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.tabBarIconInactive,
    letterSpacing: -0.15,
  },
  tabSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    overflow: 'visible',
  },
  /** Circle hit target — avoids full-width rectangular press / ripple reading as a “square”. */
  tabHitCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tabHitCirclePressed: {
    opacity: 0.92,
  },
  tabIconWell: {
    minWidth: 48,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconWellFocused: {
    backgroundColor: COLORS.tabBarSelectedWell,
  },
  tabIconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 30,
  },
  inboxBadgeDot: {
    position: 'absolute',
    top: -1,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.error,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    /** Neutral shadow so the fill stays a solid green (green glow + soft white ring read “blurry”). */
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  fabSelected: {
    backgroundColor: COLORS.primaryDark,
  },
  publishFabSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  publishFabSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  publishFabSheetCard: {
    marginHorizontal: 0,
    marginBottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 0,
    paddingTop: 8,
    borderTopWidth: 3,
    borderTopColor: COLORS.primary,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 12 },
    }),
  },
  publishFabSheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    opacity: 0.88,
    marginBottom: 10,
  },
  publishFabSheetHeader: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  publishFabSheetHeaderAccentRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  publishFabSheetHeaderAccentBar: {
    width: 4,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginRight: 12,
    alignSelf: 'stretch',
    minHeight: 48,
  },
  publishFabSheetHeaderTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  publishFabSheetTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primaryDark,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  publishFabSheetCaption: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  publishFabSheetActions: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.primaryMuted38,
  },
  publishFabSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  publishFabSheetRowNew: {
    backgroundColor: COLORS.instantBookingOnSurface,
  },
  publishFabSheetRowReuse: {
    backgroundColor: COLORS.surface,
  },
  publishFabSheetRowPressedNew: {
    backgroundColor: COLORS.primaryMuted22,
  },
  publishFabSheetRowPressedReuse: {
    backgroundColor: 'rgba(37, 99, 235, 0.06)',
  },
  publishFabSheetRowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.primaryMuted38,
    marginLeft: 14 + 40 + 12,
  },
  publishFabSheetRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  publishFabSheetRowIconPrimary: {
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.primaryMuted38,
  },
  publishFabSheetRowIconSecondary: {
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(37, 99, 235, 0.22)',
  },
  publishFabSheetRowText: {
    flex: 1,
    minWidth: 0,
  },
  publishFabSheetRowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  publishFabSheetRowSub: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  publishFabSheetCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 6,
    paddingVertical: 14,
    borderRadius: 16,
  },
  publishFabSheetCancelPressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
  },
  publishFabSheetCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  /**
   * Non-clipping host wraps the avatar ring so the offer-hint badge can sit at the top-right
   * corner and extend beyond the ring's circular boundary.
   */
  profileTabIconHost: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  profileTabClip: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileTabClipIdle: {
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  profileTabClipFocused: {
    borderWidth: 2,
    borderColor: COLORS.text,
  },
  /** Offer-hint badge positioning — top-right of the avatar ring, halo centered on the badge. */
  profileOfferBadgeWrap: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  profileOfferBadgeHalo: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(251, 191, 36, 0.55)',
  },
  /** Dark indigo coin with a gold gift glyph — matches the floating strip's stub palette. */
  profileOfferBadge: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1E1B4B',
    borderWidth: 1.5,
    borderColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.25,
        shadowRadius: 2,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  ridesTabIconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ridesTabNotificationDot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: COLORS.error,
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
});
