import { CommonActions } from '@react-navigation/native';

type MainTabsNav = {
  dispatch: (action: unknown) => void;
  getState: () => { routes?: any[]; index?: number };
};

/**
 * One tab-level reset: Your Rides shows a refreshed list after republish completes.
 */
export function resetPublishTabAndFocusYourRidesInMainTabs(
  mainTabs: MainTabsNav | null | undefined,
  serialToken: number
): void {
  if (!mainTabs?.dispatch || !mainTabs.getState) return;
  const routes = (mainTabs.getState().routes ?? []) as any[];
  const yourRidesIdx = routes.findIndex((r: { name?: string }) => r?.name === 'YourRides');
  if (yourRidesIdx < 0) return;

  const nextRoutes = routes.map((r: any) => {
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
