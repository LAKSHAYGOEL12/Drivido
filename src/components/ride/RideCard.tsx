import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Card from '../common/Card';

type RideCardProps = {
  from: string;
  to: string;
  date?: string;
  price?: string;
  seats?: number;
};

export default function RideCard({
  from,
  to,
  date,
  price,
  seats,
}: RideCardProps): React.JSX.Element {
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.route}>{from} → {to}</Text>
        {price ? <Text style={styles.price}>{price}</Text> : null}
      </View>
      {(date || seats != null) && (
        <View style={styles.meta}>
          {date ? <Text style={styles.metaText}>{date}</Text> : null}
          {seats != null ? (
            <Text style={styles.metaText}>{seats} seat{seats !== 1 ? 's' : ''}</Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  route: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  price: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2563eb',
  },
  meta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  metaText: {
    fontSize: 13,
    color: '#64748b',
  },
});
