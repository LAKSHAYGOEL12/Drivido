import { CommonActions } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

/** Walk up until we find the bottom tab navigator (has SearchStack + YourRides). */
function findMainTabNavigator(navigation: NavigationProp<ParamListBase>): NavigationProp<ParamListBase> | null {
  let current = navigation.getParent?.() as NavigationProp<ParamListBase> | undefined;
  for (let i = 0; i < 4 && current; i += 1) {
    const names = current.getState?.()?.routeNames as string[] | undefined;
    if (names?.includes('SearchStack') && names?.includes('YourRides')) {
      return current;
    }
    current = current.getParent?.() as NavigationProp<ParamListBase> | undefined;
  }
  return null;
}

/**
 * After a successful booking: reset all main tabs so Search stack is only SearchRides,
 * and open Your Rides on YourRidesList with `_afterBookRefresh` to show loader + refetch.
 */
export function resetTabsToYourRidesAfterBook(navigation: NavigationProp<ParamListBase>): void {
  const tabNav = findMainTabNavigator(navigation);
  const token = Date.now();

  if (!tabNav?.dispatch) {
    (navigation as { navigate: (name: string, params: object) => void }).navigate('YourRides', {
      screen: 'YourRidesList',
      params: { _afterBookRefresh: token },
    });
    return;
  }

  tabNav.dispatch(
    CommonActions.reset({
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
            routes: [{ name: 'YourRidesList', params: { _afterBookRefresh: token } }],
            index: 0,
          },
        },
        {
          name: 'Inbox',
          state: { routes: [{ name: 'InboxList' }], index: 0 },
        },
        { name: 'Profile' },
      ],
    })
  );
}
