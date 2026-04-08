/**
 * Bottom tab that currently owns the focused tree (Search / Your Rides / Inbox / …).
 * Used when opening owner profile from RideDetail so Trips → back targets the correct tab.
 * Do not infer from the nested stack’s `routeNames` — stack state does not include them.
 */
export function getRideDetailSourceMainTab(
  fromNavigation: { getParent?: () => unknown } | undefined
): 'YourRides' | 'SearchStack' | 'Inbox' {
  const tabs = findMainTabNavigator(fromNavigation);
  const st = tabs?.getState?.() as { routes?: { name?: string }[]; index?: number } | undefined;
  const name = st?.routes?.[st.index ?? 0]?.name;
  if (name === 'YourRides') return 'YourRides';
  if (name === 'Inbox') return 'Inbox';
  return 'SearchStack';
}

/**
 * Walks up from any nested screen to the bottom tab navigator (Find / Your Rides / …).
 */
export function findMainTabNavigator(navigation: { getParent?: () => unknown } | undefined): {
  dispatch: (action: unknown) => void;
  getState: () => { routes?: { name?: string }[]; index?: number };
} | null {
  let current = navigation?.getParent?.() as any | undefined;
  for (let i = 0; i < 5 && current; i += 1) {
    const names: string[] | undefined = current?.getState?.()?.routeNames;
    if (names?.includes('SearchStack') && names?.includes('YourRides')) return current;
    current = current.getParent?.();
  }
  return null;
}

/** Same walk-up as `findMainTabNavigator`, but also exposes `setOptions` for tab bar visibility. */
export function findMainTabNavigatorWithOptions(
  navigation: { getParent?: () => unknown } | undefined
): {
  dispatch?: (action: unknown) => void;
  getState?: () => { routes?: { name?: string }[]; index?: number; routeNames?: string[] };
  setOptions?: (opts: { tabBarStyle?: unknown }) => void;
} | null {
  let current = navigation?.getParent?.() as any | undefined;
  for (let i = 0; i < 5 && current; i += 1) {
    const names: string[] | undefined = current?.getState?.()?.routeNames;
    if (names?.includes('SearchStack') && names?.includes('YourRides')) return current;
    current = current.getParent?.();
  }
  return null;
}
