import React from 'react';
import { StyleSheet, View, ViewProps, ViewStyle } from 'react-native';

type CardProps = ViewProps & {
  children: React.ReactNode;
  style?: ViewStyle;
};

export default function Card({ children, style, ...rest }: CardProps): React.JSX.Element {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
});
