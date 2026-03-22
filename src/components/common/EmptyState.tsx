import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

type EmptyStateProps = {
  message?: string;
  subtitle?: string;
  style?: ViewStyle;
};

export default function EmptyState({
  message = 'Nothing here yet',
  subtitle,
  style,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.message}>{message}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  message: {
    fontSize: 18,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 8,
    textAlign: 'center',
  },
});
