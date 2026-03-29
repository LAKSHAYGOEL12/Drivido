import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { avatarInitialsFromName } from '../../utils/avatarInitials';

type ProfileHeaderProps = {
  name: string;
  subtitle?: string;
  avatar?: React.ReactNode;
  style?: ViewStyle;
};

export default function ProfileHeader({
  name,
  subtitle,
  avatar,
  style,
}: ProfileHeaderProps): React.JSX.Element {
  return (
    <View style={[styles.container, style]}>
      {avatar ?? (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText} adjustsFontSizeToFit numberOfLines={1}>
            {avatarInitialsFromName(name)}
          </Text>
        </View>
      )}
      <Text style={styles.name}>{name}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
});
