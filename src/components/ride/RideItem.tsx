import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';

type RideItemProps = {
  from: string;
  to: string;
  time?: string;
  onPress?: () => void;
};

export default function RideItem({
  from,
  to,
  time,
  onPress,
}: RideItemProps): React.JSX.Element {
  const content = (
    <View style={styles.row}>
      <View style={styles.route}>
        <Text style={styles.from}>{from}</Text>
        <Text style={styles.to}>{to}</Text>
      </View>
      {time ? <Text style={styles.time}>{time}</Text> : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  route: {
    flex: 1,
  },
  from: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  to: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  time: {
    fontSize: 14,
    color: '#64748b',
  },
});
