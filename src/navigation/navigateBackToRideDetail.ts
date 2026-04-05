import { CommonActions, StackActions, type NavigationState } from '@react-navigation/native';
import type { TripsReturnToRideContext } from './types';
import { findMainTabNavigator } from './findMainTabNavigator';

/**
 * From Profile → Trips: return to the Ride detail that opened the owner profile (Find, Your Rides, or Inbox tab).
 * Uses `StackActions.popTo` when that stack already contains `RideDetail`, so `OwnerProfileModal` is popped.
 */
export function navigateMainTabsBackToRideDetail(
  fromNavigation: { getParent?: () => unknown } | undefined,
  ctx: TripsReturnToRideContext
): void {
  const main = findMainTabNavigator(fromNavigation);
  if (!main?.dispatch || !main.getState || !ctx.params?.ride) return;

  const detailParams = {
    ride: ctx.params.ride,
    ...(ctx.params.passengerSearch ? { passengerSearch: ctx.params.passengerSearch } : {}),
  };

  const tryPopToRideDetail = (): void => {
    const st = main.getState() as NavigationState;
    const tabRoute = st.routes?.find((r) => r.name === ctx.tab);
    const stackState = tabRoute?.state as NavigationState | undefined;
    const stackKey = stackState?.key;
    const hasRideDetail = (stackState?.routes ?? []).some((r) => r.name === 'RideDetail');
    if (stackKey && hasRideDetail) {
      main.dispatch({
        ...StackActions.popTo('RideDetail', detailParams, { merge: true }),
        target: stackKey,
      } as never);
      return;
    }
    main.dispatch(
      CommonActions.navigate({
        name: ctx.tab,
        params: {
          screen: 'RideDetail',
          params: detailParams,
        },
        merge: true,
      } as never)
    );
  };

  main.dispatch(CommonActions.navigate({ name: ctx.tab, merge: true } as never));
  // After a tab switch, `queueMicrotask` can run before the tab navigator commits nested state.
  setTimeout(tryPopToRideDetail, 0);
}
