import { CommonActions } from '@react-navigation/native';
import { rootNavigationRef } from './rootNavigationRef';

/** Set by `MainBottomTabBar` when the Publish FAB sheet is open — lets Android back close the sheet instead of jumping to Find. */
export const publishFabSheetOpenRef = { current: false };

type RouteNode = {
  name?: string;
  state?: { routes?: RouteNode[]; index?: number };
};

/**
 * Instagram-style main tabs: Android back from another tab's stack root opens Find (`SearchRides`)
 * with the same nested navigation as tapping the Find tab (`merge: false`), so the transition is a
 * single coordinated jump — not “previous tab” history from the pager.
 *
 * When a nested stack can still pop (e.g. Chat, Ride detail), returns `false` so the inner stack handles back.
 * When already on Find at `SearchRides`, returns `false` so {@link SearchRides} can clear the form / exit.
 */
export function handleMainTabAndroidHardwareBackPress(): boolean {
  if (!rootNavigationRef.isReady()) return false;
  if (publishFabSheetOpenRef.current) return false;

  const root = rootNavigationRef.getRootState() as {
    routes?: RouteNode[];
    index?: number;
  };
  const rootIdx = typeof root.index === 'number' ? root.index : 0;
  const top = root.routes?.[rootIdx];
  if (top?.name !== 'Main' || top.state == null) return false;

  const mainSt = top.state as { routes?: RouteNode[]; index?: number };
  if (!mainSt.routes?.length) return false;
  const tabIdx = typeof mainSt.index === 'number' ? mainSt.index : 0;
  const tabRoute = mainSt.routes[tabIdx];
  const tabName = tabRoute?.name;
  if (!tabName) return false;

  const nested = tabRoute.state;
  const nestedIdx =
    nested != null && typeof nested.index === 'number' ? nested.index : 0;
  /** Native-stack back should pop inner screens first (chat, ride detail, …). */
  if (nestedIdx > 0) return false;

  if (tabName === 'SearchStack') {
    return false;
  }

  const token = Date.now();
  rootNavigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: {
        screen: 'SearchStack',
        params: {
          screen: 'SearchRides',
          params: { _tabResetToken: token },
        },
      },
      merge: false,
    } as never)
  );
  return true;
}
