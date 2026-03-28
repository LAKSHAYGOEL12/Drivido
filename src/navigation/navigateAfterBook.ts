import { CommonActions } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { rootNavigationRef } from './rootNavigationRef';

/** Walk up until we find the bottom tab navigator (has SearchStack + YourRides). */
function findMainTabNavigator(navigation: NavigationProp<ParamListBase>): NavigationProp<ParamListBase> | null {
  let current: NavigationProp<ParamListBase> | undefined = navigation.getParent?.() as
    | NavigationProp<ParamListBase>
    | undefined;
  for (let i = 0; i < 12 && current; i += 1) {
    const names = current.getState?.()?.routeNames as string[] | undefined;
    if (names?.includes('SearchStack') && names?.includes('YourRides')) {
      return current;
    }
    current = current.getParent?.() as NavigationProp<ParamListBase> | undefined;
  }
  return null;
}

function buildResetToYourRidesAction(afterBookRefreshToken?: number) {
  const token = afterBookRefreshToken ?? Date.now();
  const yourRidesListParams =
    afterBookRefreshToken != null ? { _afterBookRefresh: afterBookRefreshToken } : undefined;
  return CommonActions.reset({
    index: 2,
    routes: [
      {
        name: 'SearchStack',
        state: {
          routes: [{ name: 'SearchRides', params: { _tabResetToken: token } }],
          index: 0,
        },
      },
      {
        name: 'PublishStack',
        state: { routes: [{ name: 'PublishRide' }], index: 0 },
      },
      {
        name: 'YourRides',
        state: {
          routes: [{ name: 'YourRidesList', ...(yourRidesListParams ? { params: yourRidesListParams } : {}) }],
          index: 0,
        },
      },
      {
        name: 'Inbox',
        state: { routes: [{ name: 'InboxList' }], index: 0 },
      },
      { name: 'Profile' },
    ],
  });
}

/**
 * Switch to Your Rides tab and reset stacks (same mechanism as after booking).
 * `CommonActions.navigate` alone often leaves the Search tab focused when called from a nested stack.
 */
export function navigateToYourRidesTab(navigation: NavigationProp<ParamListBase>): void {
  const action = buildResetToYourRidesAction(undefined);
  const tabNav = findMainTabNavigator(navigation);
  if (tabNav?.dispatch) {
    tabNav.dispatch(action);
    return;
  }
  let walker: NavigationProp<ParamListBase> | undefined = navigation as NavigationProp<ParamListBase>;
  for (let i = 0; i < 14 && walker; i += 1) {
    const names = walker.getState?.()?.routeNames as string[] | undefined;
    if (names?.includes('YourRides') && walker.dispatch) {
      walker.dispatch(action);
      return;
    }
    walker = walker.getParent?.() as NavigationProp<ParamListBase> | undefined;
  }
  (navigation as { dispatch?: (a: unknown) => void }).dispatch?.(action);
}

/**
 * After a successful booking: reset all main tabs so Search stack is only SearchRides,
 * and open Your Rides on YourRidesList with `_afterBookRefresh` to show loader + refetch.
 */
export function resetTabsToYourRidesAfterBook(navigation: NavigationProp<ParamListBase>): void {
  const tabNav = findMainTabNavigator(navigation);
  const token = Date.now();
  const action = buildResetToYourRidesAction(token);

  if (!tabNav?.dispatch) {
    (navigation as { navigate: (name: string, params: object) => void }).navigate('Main', {
      screen: 'YourRides',
      params: {
        screen: 'YourRidesList',
        params: { _afterBookRefresh: token },
      },
    });
    return;
  }

  tabNav.dispatch(action);
}

/**
 * After guest logs in from ride detail, `RootNavigator` briefly unmounts `NavigationContainer`
 * ("Thinking" gate) — tab `dispatch` from RideDetail is dropped. Wait for root ref, then
 * navigate Main → Your Rides → YourRidesList with refresh.
 */
export function resetToYourRidesAfterGuestLoginGate(): void {
  const token = Date.now();
  let tries = 0;
  const maxTries = 50;

  const run = () => {
    tries += 1;
    if (!rootNavigationRef.isReady()) {
      if (tries < maxTries) setTimeout(run, 80);
      return;
    }
    rootNavigationRef.navigate('Main', {
      screen: 'YourRides',
      params: {
        screen: 'YourRidesList',
        params: { _afterBookRefresh: token },
      },
    });
  };

  setTimeout(run, 520);
}
