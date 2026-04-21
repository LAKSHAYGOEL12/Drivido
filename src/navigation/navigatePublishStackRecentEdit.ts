import { CommonActions } from '@react-navigation/native';
import type { PublishStackParamList } from './types';

export type NavigatePublishStackRecentEditParams = NonNullable<PublishStackParamList['PublishRecentEdit']>;

/**
 * Opens Edit & republish on the Publish tab with a **fresh** nested stack (only `PublishRecentEdit`).
 * Publish is now a root-level navigator (not part of the swipe pager).
 */
export function navigatePublishStackToRecentEdit(
  mainTabs: { dispatch?: (action: unknown) => void; getState?: () => { routes?: unknown[]; index?: number } } | null | undefined,
  params: NavigatePublishStackRecentEditParams
): void {
  if (!mainTabs?.dispatch) return;
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
 * Publish stack is no longer nested inside the bottom tabs, so there is nothing to clear on tab changes.
 */
export function clearPublishTabStackToPublishRideKeepActiveTab(
  _mainTabs: { dispatch?: (action: unknown) => void; getState?: () => unknown } | null | undefined
): void {
  void _mainTabs;
}
