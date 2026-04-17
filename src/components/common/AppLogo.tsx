import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { IMAGES } from '../../constants/images';

/** `assets/app-logo.png` pixel ratio — frame matches bitmap so nothing is clipped. */
const LOGO_ASPECT = 1024 / 558;
const MAX_WIDTH = 260;
const H_PADDING = 48;

type Props = {
  style?: StyleProp<ViewStyle>;
};

/** Brand wordmark for auth and other headers (`assets/app-logo.png`). */
export default function AppLogo({ style }: Props): React.JSX.Element {
  const { width: windowWidth } = useWindowDimensions();
  const boxWidth = Math.min(MAX_WIDTH, Math.max(120, windowWidth - H_PADDING));

  return (
    <View
      style={[styles.wrap, { width: boxWidth, aspectRatio: LOGO_ASPECT }, style]}
      accessibilityRole="image"
      accessibilityLabel="App logo"
    >
      <Image source={IMAGES.logo} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 16,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
