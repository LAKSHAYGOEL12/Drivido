import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/** Shared ref so navigation can run after auth-gate remounts (guest book → Your Rides). */
export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();
