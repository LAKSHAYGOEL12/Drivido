import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { COLORS } from '../../constants/colors';
import { IMAGES } from '../../constants/images';

export type BootSplashProps = {
  /** Fires when the bitmap is decoded — call `SplashScreen.hideAsync()` after this so native → JS does not flash. */
  onContentReady?: () => void;
};

/**
 * Full-bleed splash: `splash-screen.png` fills the entire app window (`cover`).
 * Native launch uses a blank drawable (`splash-native-blank.png`); this view is the first branded frame once JS runs.
 */
export default function BootSplash({ onContentReady }: BootSplashProps): React.JSX.Element {
  const [imageReady, setImageReady] = useState(false);
  const handleLoadEnd = useCallback(() => {
    setImageReady(true);
    onContentReady?.();
  }, [onContentReady]);

  return (
    <View style={styles.root} pointerEvents="none" accessibilityLabel="Splash screen">
      <Image
        source={IMAGES.splash}
        style={styles.image}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        onLoadEnd={handleLoadEnd}
      />
      {!imageReady ? (
        <View style={styles.loaderOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#ffffff',
  },
  image: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
});
