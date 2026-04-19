import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mainTabScrollBottomInset } from './tabBarMetrics';

/** Bottom padding for main-tab home scroll views so content clears the floating pill + FAB. */
export function useMainTabScrollBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  return useMemo(() => mainTabScrollBottomInset(bottom), [bottom]);
}
