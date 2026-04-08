import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'drivido_pref_push_notifications_allowed';

type NotificationPreferencesContextValue = {
  /** When false, the app does not register (or unregisters) the device for push. */
  pushNotificationsAllowed: boolean;
  /** Persisted preference; safe to call when logged in (Profile). */
  setPushNotificationsAllowed: (next: boolean) => Promise<void>;
  /** AsyncStorage read finished — before this, treat as allowed so existing users keep current behavior. */
  notificationPrefsHydrated: boolean;
};

const NotificationPreferencesContext = createContext<NotificationPreferencesContextValue | null>(null);

export function NotificationPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [allowed, setAllowed] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (raw === '0' || raw === 'false') setAllowed(false);
        else setAllowed(true);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPushNotificationsAllowed = useCallback(async (next: boolean) => {
    setAllowed(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Preference still updated in memory for the session.
    }
  }, []);

  const pushNotificationsAllowed = hydrated ? allowed : true;

  const value = useMemo(
    () => ({
      pushNotificationsAllowed,
      setPushNotificationsAllowed,
      notificationPrefsHydrated: hydrated,
    }),
    [pushNotificationsAllowed, setPushNotificationsAllowed, hydrated]
  );

  return (
    <NotificationPreferencesContext.Provider value={value}>{children}</NotificationPreferencesContext.Provider>
  );
}

export function useNotificationPreferences(): NotificationPreferencesContextValue {
  const ctx = useContext(NotificationPreferencesContext);
  if (!ctx) {
    throw new Error('useNotificationPreferences must be used within NotificationPreferencesProvider');
  }
  return ctx;
}
