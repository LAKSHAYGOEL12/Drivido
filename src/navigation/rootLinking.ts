import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Minimal deep-link baseline: custom scheme from `app.json` (`scheme`: ecopicko).
 * Extend `config.screens` when you add shareable URLs (ride id, reset password, etc.).
 */
export const rootLinking: LinkingOptions<RootStackParamList> = {
  prefixes: ['ecopicko://'],
  config: {
    screens: {
      Main: '',
    },
  },
};
