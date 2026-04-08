import { rootNavigationRef } from './rootNavigationRef';

/** After Firebase sign-in while Mongo user is deactivated — same stack pattern as Verify Email. */
export function resetNavigationToReactivateAccount(retries = 20): void {
  if (rootNavigationRef.isReady()) {
    rootNavigationRef.reset({
      index: 1,
      routes: [{ name: 'Main' }, { name: 'ReactivateAccount' }],
    });
    return;
  }
  if (retries <= 0) return;
  setTimeout(() => resetNavigationToReactivateAccount(retries - 1), 80);
}
