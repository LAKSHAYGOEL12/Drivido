import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

type StatItem = {
  label: string;
  value: string | number;
};

type StatsRowProps = {
  stats: StatItem[];
  style?: ViewStyle;
};

export default function StatsRow({ stats, style }: StatsRowProps): React.JSX.Element {
  return (
    <View style={[styles.container, style]}>
      {stats.map(({ label, value }, index) => (
        <View
          key={label}
          style={[
            styles.stat,
            index < stats.length - 1 && styles.statBorder,
          ]}
        >
          <Text style={styles.value}>{value}</Text>
          <Text style={styles.label}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statBorder: {
    borderRightWidth: 1,
    borderRightColor: '#f1f5f9',
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  label: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
});
