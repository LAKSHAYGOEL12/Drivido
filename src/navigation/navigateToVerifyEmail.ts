import { rootNavigationRef } from './rootNavigationRef';

/** Clears auth modals and shows Verify Email on the root stack. */
export function resetNavigationToVerifyEmail(email?: string, retries = 20): void {
  if (rootNavigationRef.isReady()) {
    rootNavigationRef.reset({
      index: 1,
      routes: [
        { name: 'Main' },
        { name: 'VerifyEmail', params: email ? { email } : undefined },
      ],
    });
    return;
  }
  if (retries <= 0) return;
  setTimeout(() => resetNavigationToVerifyEmail(email, retries - 1), 80);
}
