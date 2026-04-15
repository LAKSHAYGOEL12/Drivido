import { CommonActions } from '@react-navigation/native';

type MainTabsNav = {
  dispatch: (action: unknown) => void;
  getState: () => { routes?: any[]; index?: number };
};

/**
 * One tab-level reset: Your Rides shows a refreshed list, Publish tab collapses to `PublishRide`.
 * Use this after republish from `PublishRecentEdit` — `navigation.getParent()` is not reliably
 * the Publish stack (e.g. from RidesStack it is the rides navigator), so stack-only `RESET` there
 * is ignored (dev warning) and the Publish tab can stay stale.
 */
export function resetPublishTabAndFocusYourRidesInMainTabs(
  mainTabs: MainTabsNav | null | undefined,
  serialToken: number
): void {
  if (!mainTabs?.dispatch || !mainTabs.getState) return;
  const routes = (mainTabs.getState().routes ?? []) as any[];
  const yourRidesIdx = routes.findIndex((r: { name?: string }) => r?.name === 'YourRides');
  const publishIdx = routes.findIndex((r: { name?: string }) => r?.name === 'PublishStack');
  if (yourRidesIdx < 0 || publishIdx < 0) return;

  const nextRoutes = routes.map((r: any) => {
    if (r?.name === 'PublishStack') {
      return {
        ...r,
        state: {
          index: 0,
          routes: [{ name: 'PublishRide' as const, params: { _publishTabResetToken: serialToken } }],
        },
      };
    }
    if (r?.name === 'YourRides') {
      return {
        ...r,
        state: {
          index: 0,
          routes: [{ name: 'YourRidesList' as const, params: { _afterBookRefresh: serialToken } }],
        },
      };
    }
    return r;
  });

  mainTabs.dispatch(
    CommonActions.reset({
      index: yourRidesIdx,
      routes: nextRoutes,
    } as never)
  );
}
