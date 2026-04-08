import { rootNavigationRef } from './rootNavigationRef';

/** Full-screen notice after server reports ACCOUNT_DEACTIVATED. */
export function resetNavigationToAccountDeactivated(retries = 20): void {
  if (rootNavigationRef.isReady()) {
    rootNavigationRef.reset({
      index: 1,
      routes: [{ name: 'Main' }, { name: 'AccountDeactivated' }],
    });
    return;
  }
  if (retries <= 0) return;
  setTimeout(() => resetNavigationToAccountDeactivated(retries - 1), 80);
}
