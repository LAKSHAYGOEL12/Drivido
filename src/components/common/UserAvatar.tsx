import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS } from '../../constants/colors';

export type UserAvatarProps = {
  /** Remote or file URI */
  uri?: string | null;
  /** Fallback initial (first character shown) */
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  /** Initial letter color when `uri` is empty */
  fallbackTextColor?: string;
};

export default function UserAvatar({
  uri,
  name,
  size = 40,
  style,
  backgroundColor = '#dbeafe',
  fallbackTextColor = COLORS.text,
}: UserAvatarProps): React.JSX.Element {
  const trimmed = (uri ?? '').trim();
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const r = size / 2;
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: r,
          backgroundColor: trimmed ? COLORS.backgroundSecondary : backgroundColor,
        },
        style,
      ]}
    >
      {trimmed ? (
        <Image source={{ uri: trimmed }} style={{ width: size, height: size, borderRadius: r }} resizeMode="cover" />
      ) : (
        <Text
          style={[styles.initial, { fontSize: Math.round(size * 0.42), color: fallbackTextColor }]}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontWeight: '800',
  },
});
