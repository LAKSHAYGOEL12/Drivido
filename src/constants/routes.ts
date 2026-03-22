/**
 * Navigation route names. Single source of truth for navigators and links.
 */
export const ROOT_ROUTES = {
  Auth: 'Auth',
  Main: 'Main',
} as const;

export const AUTH_ROUTES = {
  Login: 'Login',
  Register: 'Register',
} as const;

export const MAIN_TAB_ROUTES = {
  SearchStack: 'SearchStack',
  PublishStack: 'PublishStack',
  YourRides: 'YourRides',
  Inbox: 'Inbox',
  Profile: 'Profile',
} as const;

/** All route names flattened for type-safe navigate('ScreenName') */
export const ROUTES = {
  ...ROOT_ROUTES,
  ...AUTH_ROUTES,
  ...MAIN_TAB_ROUTES,
} as const;

export type RootRouteName = keyof typeof ROOT_ROUTES;
export type AuthRouteName = keyof typeof AUTH_ROUTES;
export type MainTabRouteName = keyof typeof MAIN_TAB_ROUTES;
