import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { PULSE_BAR_COLORS } from '../../constants/promoRewardsTheme';

/** Same as `PROMO_REWARDS.pulseWell` — inlined to avoid importing `PROMO_REWARDS` here (tab bundle order). */
const PULSE_WELL_PROMO = '#FFEDD5';

const BAR_W = 2;
const GAP = 1;
/** Relative stroke heights — compact variant of the EKG-style wave. */
const HEIGHT_PATTERN = [2, 2, 3, 4, 7, 11, 10, 6, 5, 4, 8, 12, 11, 8, 6, 5, 4, 3, 3, 2, 2, 2];

/** Journey / rides pulse strip — sky, route, brand green (light frosted widget). */
const GLASS_BAR_COLORS = ['#7DD3FC', '#38BDF8', '#34D399', '#1DB954', '#60A5FA'] as const;

type Props = {
  /** Total visible width (matches promo track width). */
  width: number;
  /** `promo` = indigo on pale chip tone; `modal` = theme blue on light gray; `glass` = dark well + spectrum. */
  variant?: 'promo' | 'modal' | 'glass';
};

/**
 * Decorative “pulse line” for Offers — thick rounded segments + slow drift (no SVG dep).
 */
export default function OffersPulseLine({ width, variant = 'promo' }: Props): React.JSX.Element {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 2800,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(drift, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const step = BAR_W + GAP;
  const shiftPx = step * 5;
  const tx = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -shiftPx] });

  const wellBg =
    variant === 'promo'
      ? PULSE_WELL_PROMO
      : variant === 'glass'
        ? 'rgba(255, 255, 255, 0.5)'
        : 'rgba(255, 241, 222, 0.95)';

  const barPalette = variant === 'glass' ? GLASS_BAR_COLORS : PULSE_BAR_COLORS;

  const tiles = [...HEIGHT_PATTERN, ...HEIGHT_PATTERN, ...HEIGHT_PATTERN];

  return (
    <View
      style={[
        styles.clip,
        {
          width,
          backgroundColor: wellBg,
          alignSelf: variant === 'modal' ? 'center' : 'flex-end',
          borderWidth: variant === 'glass' ? StyleSheet.hairlineWidth : 0,
          borderColor: variant === 'glass' ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
        },
      ]}
      accessibilityElementsHidden
    >
      <Animated.View style={[styles.row, { transform: [{ translateX: tx }] }]}>
        {tiles.map((h, i) => (
          <View
            key={`b-${i}`}
            style={[
              styles.bar,
              {
                width: BAR_W,
                marginRight: GAP,
                height: h,
                backgroundColor: barPalette[i % barPalette.length],
                opacity: variant === 'glass' ? 0.88 : 1,
              },
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    height: 16,
    borderRadius: 999,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 16,
    paddingHorizontal: 3,
    paddingBottom: 2,
    paddingTop: 1,
  },
  bar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
});
