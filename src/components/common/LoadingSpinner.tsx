import React from 'react';
import { ActivityIndicator, StyleSheet, View, ViewStyle } from 'react-native';

type LoadingSpinnerProps = {
  size?: 'small' | 'large';
  color?: string;
  style?: ViewStyle;
};

export default function LoadingSpinner({
  size = 'large',
  color = '#2563eb',
  style,
}: LoadingSpinnerProps): React.JSX.Element {
  return (
    <View style={[styles.container, style]}>
      <ActivityIndicator size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
