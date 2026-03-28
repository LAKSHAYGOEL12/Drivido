import { StyleSheet, Text, TextInput } from 'react-native';

/**
 * PostScript / loaded names from `@expo-google-fonts/roboto` (same on iOS & Android after `useFonts`).
 * Use these if you need an explicit face instead of `fontWeight`.
 */
export const FONTS = {
  light: 'Roboto_300Light',
  regular: 'Roboto_400Regular',
  medium: 'Roboto_500Medium',
  semiBold: 'Roboto_600SemiBold',
  bold: 'Roboto_700Bold',
  extraBold: 'Roboto_800ExtraBold',
  black: 'Roboto_900Black',
} as const;

const DEFAULT_FONT = FONTS.regular;

type WithLegacyDefaultProps = {
  defaultProps?: { style?: object | object[] | undefined };
};

let applied = false;

/** Set default `fontFamily` on Text and TextInput (call once after `useFonts` succeeds). */
export function applyGlobalRobotoFont(): void {
  if (applied) return;
  applied = true;

  const base = { fontFamily: DEFAULT_FONT };

  const T = Text as unknown as WithLegacyDefaultProps;
  T.defaultProps ??= {};
  T.defaultProps.style = StyleSheet.flatten([T.defaultProps.style, base]);

  const TI = TextInput as unknown as WithLegacyDefaultProps;
  TI.defaultProps ??= {};
  TI.defaultProps.style = StyleSheet.flatten([TI.defaultProps.style, base]);
}
