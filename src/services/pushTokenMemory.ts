/**
 * Last push token registered with POST /user/push-token — used for DELETE on logout
 * so the backend can remove the exact device token (recommended by API).
 */
let lastToken: string | null = null;
let lastKind: 'expo' | 'fcm' | 'apns' | null = null;

export function setLastRegisteredPushToken(
  token: string,
  kind: 'expo' | 'fcm' | 'apns'
): void {
  lastToken = token;
  lastKind = kind;
}

export function getLastRegisteredPushToken(): {
  token: string;
  kind: 'expo' | 'fcm' | 'apns';
} | null {
  if (!lastToken || !lastKind) return null;
  return { token: lastToken, kind: lastKind };
}

export function clearLastRegisteredPushToken(): void {
  lastToken = null;
  lastKind = null;
}
