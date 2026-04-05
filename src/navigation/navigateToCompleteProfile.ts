import { rootNavigationRef } from './rootNavigationRef';

/**
 * Only Complete Profile on the root stack so BottomTabs (`Main`) is not mounted until the user finishes.
 * After success, `CompleteProfile` calls `goMain()` which resets to `Main`.
 */
export function resetNavigationToCompleteProfile(retries = 20): void {
  if (rootNavigationRef.isReady()) {
    rootNavigationRef.reset({
      index: 0,
      routes: [{ name: 'CompleteProfile' }],
    });
    return;
  }
  if (retries <= 0) return;
  setTimeout(() => resetNavigationToCompleteProfile(retries - 1), 80);
}
