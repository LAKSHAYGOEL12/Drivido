import { CommonActions, type NavigationState } from '@react-navigation/native';
import type { PublishStackParamList } from './types';

export type NavigatePublishStackRecentEditParams = NonNullable<PublishStackParamList['PublishRecentEdit']>;

type MainTabsNav = {
  dispatch: (action: unknown) => void;
  getState: () => { routes?: unknown[]; index?: number };
};

/**
 * Replace **only** the Publish tab’s nested stack with `PublishRecentEdit` (same pattern as
 * `resetTabNestedStack` in `BottomTabs`).
 *
 * Do **not** use `CommonActions.reset` on the whole tab navigator: that has been breaking other
 * tabs’ stacks (e.g. Your Rides → RideDetail disappears), so back from republish lands on Find.
 */
function openPublishRecentEditOnTab(mainTabs: MainTabsNav, params: NavigatePublishStackRecentEditParams): void {
  mainTabs.dispatch(
    CommonActions.navigate({
      name: 'PublishStack',
      merge: false,
      params: {
        state: {
          routes: [{ name: 'PublishRecentEdit' as const, params }],
          index: 0,
        },
      },
    } as never)
  );
}

/**
 * Opens Edit & republish on the Publish tab with a **fresh** nested stack (only `PublishRecentEdit`).
 * Other bottom tabs keep their navigation state (ride detail stays under Your Rides / Find / Inbox).
 */
export function navigatePublishStackToRecentEdit(
  mainTabs: { dispatch?: (action: unknown) => void; getState?: () => { routes?: unknown[]; index?: number } } | null | undefined,
  params: NavigatePublishStackRecentEditParams
): void {
  if (!mainTabs?.dispatch) return;
  if (mainTabs.getState) {
    openPublishRecentEditOnTab(mainTabs as MainTabsNav, params);
    return;
  }
  mainTabs.dispatch(
    CommonActions.navigate({
      name: 'PublishStack',
      merge: false,
      params: {
        screen: 'PublishRecentEdit',
        params,
      },
    } as never)
  );
}

/**
 * Reset only the **nested** Publish stack to `PublishRide` via `target`, so the active bottom tab
 * does not change (unlike `navigate('PublishStack')`, which would jump to Publish after returning
 * to Your Rides). Avoid tab-level `CommonActions.reset` — it rebuilds all tabs and can wipe
 * RideDetail under Your Rides.
 */
export function clearPublishTabStackToPublishRideKeepActiveTab(
  mainTabs: { dispatch?: (action: unknown) => void; getState?: () => unknown } | null | undefined
): void {
  if (!mainTabs?.dispatch || !mainTabs.getState) return;
  const token = Date.now();
  const tabState = mainTabs.getState() as NavigationState;
  const publishRoute = tabState.routes?.find((r) => r.name === 'PublishStack') as
    | { state?: { key?: string } }
    | undefined;
  const stackKey = publishRoute?.state?.key;
  const innerReset = CommonActions.reset({
    index: 0,
    routes: [{ name: 'PublishRide' as const, params: { _publishTabResetToken: token } }],
  });
  if (stackKey) {
    mainTabs.dispatch({ ...innerReset, target: stackKey } as never);
    return;
  }
  mainTabs.dispatch(
    CommonActions.navigate({
      name: 'PublishStack',
      merge: false,
      params: {
        state: {
          routes: [{ name: 'PublishRide' as const, params: { _publishTabResetToken: token } }],
          index: 0,
        },
      },
    } as never)
  );
}
