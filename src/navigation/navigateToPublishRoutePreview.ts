import { CommonActions, StackActions } from '@react-navigation/native';
import type { PublishAfterRouteParams } from './types';
import { rootNavigationRef } from './rootNavigationRef';

/**
 * Walk parents until we find a navigator whose state includes `routeName`
 * (e.g. `PublishStack` owns `PublishRoutePreview`).
 */
export function findNavigatorWithRouteName(
  navigation: { getParent?: () => unknown; getState?: () => { routeNames?: string[] } },
  routeName: string,
  maxHops = 16
): { getParent?: () => unknown; dispatch?: (a: unknown) => void; getState?: () => { routeNames?: string[] } } | null {
  let walker: unknown = navigation;
  for (let i = 0; i < maxHops && walker; i += 1) {
    const n = walker as { getState?: () => { routeNames?: string[] }; getParent?: () => unknown };
    const names = n.getState?.()?.routeNames;
    if (Array.isArray(names) && names.includes(routeName)) {
      return n as { dispatch?: (a: unknown) => void; getParent?: () => unknown; getState?: () => { routeNames?: string[] } };
    }
    walker = n.getParent?.();
  }
  return null;
}

/**
 * Push `PublishRoutePreview` on the stack that actually hosts it (root `PublishStack` when nested elsewhere).
 */
export function navigateToPublishRoutePreview(
  navigation: { getParent?: () => unknown; getState?: () => { routeNames?: string[] } },
  params: PublishAfterRouteParams
): void {
  const publishNav = findNavigatorWithRouteName(navigation, 'PublishRoutePreview');
  if (publishNav?.dispatch) {
    publishNav.dispatch(StackActions.push('PublishRoutePreview', params));
    return;
  }
  const dispatchViaRoot = (): boolean => {
    if (!rootNavigationRef.isReady() || !rootNavigationRef.dispatch) return false;
    rootNavigationRef.dispatch(
      CommonActions.navigate({
        name: 'PublishStack',
        params: { screen: 'PublishRoutePreview', params },
        merge: true,
      } as never)
    );
    return true;
  };
  if (dispatchViaRoot()) return;
  let tries = 0;
  const id = setInterval(() => {
    tries += 1;
    if (dispatchViaRoot() || tries >= 40) {
      clearInterval(id);
    }
  }, 50);
}
