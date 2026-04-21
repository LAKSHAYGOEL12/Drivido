import { CommonActions } from '@react-navigation/native';
import { clearPublishRouteDirectionsMemoryCache } from '../utils/publishRouteDirectionsMemoryCache';
import type { MainTabName } from './mainTabOrder';
import { buildPublishWizardRootRoute } from './publishStackWizardRoot';

type TabNav = { dispatch: (action: unknown) => void };

export type NewRideWizardOptions = {
  /** Bottom tab the user was on before opening the Publish FAB (used when backing out of pickup). */
  exitToTab: MainTabName;
};

/**
 * FAB “New ride”: Publish stack is a single `LocationPicker` (pickup). Pickup → destination uses **push**
 * so back returns to pickup; route preview and later steps also push so the stack mirrors the wizard.
 * Back on pickup with an empty stack exits via `publishFabExitTab`.
 */
export function navigatePublishStackToNewRideWizard(
  tabNavigation: TabNav | null | undefined,
  options: NewRideWizardOptions
): void {
  if (!tabNavigation?.dispatch) return;
  clearPublishRouteDirectionsMemoryCache();
  const root = buildPublishWizardRootRoute({ publishFabExitTab: options.exitToTab });
  tabNavigation.dispatch(
    CommonActions.navigate({
      name: 'PublishStack',
      merge: false,
      params: {
        state: {
          routes: [root],
          index: 0,
        },
      },
    } as never)
  );
}
