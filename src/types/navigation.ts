import type { ParamListBase } from '@react-navigation/native';
import type { AuthStackParamList } from '../navigation/types';
import type { MainTabParamList } from '../navigation/types';
import type { RootStackParamList } from '../navigation/types';

/**
 * Typed params for nested navigator screens.
 * Use with navigation.navigate('Screen', { screen: 'Child', params: { ... } })
 */
export type NavigatorScreenParams<T extends ParamListBase> =
  | { screen: keyof T; params?: T[keyof T] }
  | undefined;

export type AuthScreenParams = NavigatorScreenParams<AuthStackParamList>;
export type MainTabParams = NavigatorScreenParams<MainTabParamList>;
export type RootScreenParams = NavigatorScreenParams<RootStackParamList>;

/** Params for Root stack screens that host a navigator */
export type RootStackScreenParams = {
  Auth: AuthScreenParams;
  Main: MainTabParams;
};

// Re-export param lists for convenience
export type { AuthStackParamList, MainTabParamList, RootStackParamList } from '../navigation/types';
