import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { COLORS } from '../../constants/colors';

export type LoadingSpinnerProps = {
  /** Bouncing brand dots (default) or native circular spinner. */
  variant?: 'dots' | 'spinner';
  /** Dot / hit area scale. */
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  /** Optional caption under the loader. */
  label?: string;
  style?: ViewStyle;
  /** When false, fills available space (e.g. full screen). When true, wraps content only. */
  inline?: boolean;
  /** Passed through to ActivityIndicator when variant is `spinner`. */
  spinnerSize?: 'small' | 'large';
};

const DOT = { sm: 7, md: 9, lg: 11 } as const;
const LIFT = { sm: 5, md: 7, lg: 9 } as const;

export default function LoadingSpinner({
  variant = 'dots',
  size = 'md',
  color = COLORS.primary,
  label,
  style,
  inline = false,
  spinnerSize = 'large',
}: LoadingSpinnerProps): React.JSX.Element {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (variant !== 'dots') return;

    const rise = 280;
    const fall = 280;
    const bounce = 560;
    const period = 1000;

    const loop = (v: Animated.Value, leadMs: number, tailMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(leadMs),
          Animated.timing(v, {
            toValue: 1,
            duration: rise,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: fall,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(tailMs),
        ])
      );

    // Staggered waves; each cycle length `period` so dots stay rhythmically offset.
    const a1 = loop(d1, 0, period - bounce);
    const a2 = loop(d2, 120, period - 120 - bounce);
    const a3 = loop(d3, 240, period - 240 - bounce);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [variant, d1, d2, d3]);

  const dotPx = DOT[size];
  const lift = LIFT[size];
  const y1 = d1.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] });
  const y2 = d2.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] });
  const y3 = d3.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] });
  const o1 = d1.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const o2 = d2.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const o3 = d3.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <View style={[inline ? styles.containerInline : styles.containerBlock, styles.container, style]}>
      {variant === 'spinner' ? (
        <ActivityIndicator size={spinnerSize} color={color} />
      ) : (
        <View style={styles.dotsRow} accessibilityRole="progressbar" accessibilityLabel={label || 'Loading'}>
          <Animated.View
            style={[
              styles.dot,
              {
                width: dotPx,
                height: dotPx,
                borderRadius: dotPx / 2,
                backgroundColor: color,
                opacity: o1,
                transform: [{ translateY: y1 }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.dot,
              {
                width: dotPx,
                height: dotPx,
                borderRadius: dotPx / 2,
                backgroundColor: color,
                opacity: o2,
                transform: [{ translateY: y2 }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.dot,
              {
                width: dotPx,
                height: dotPx,
                borderRadius: dotPx / 2,
                backgroundColor: color,
                opacity: o3,
                transform: [{ translateY: y3 }],
              },
            ]}
          />
        </View>
      )}
      {label ? (
        <Text style={[styles.label, size === 'sm' && styles.labelSm]} numberOfLines={2}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  containerBlock: {
    flex: 1,
  },
  containerInline: {
    flexGrow: 0,
    flexShrink: 0,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 10,
    minHeight: 28,
  },
  dot: {
    alignSelf: 'flex-end',
  },
  label: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  labelSm: {
    marginTop: 10,
    fontSize: 13,
  },
});
