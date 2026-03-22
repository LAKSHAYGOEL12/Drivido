import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/common/Button';
import { COLORS } from '../../constants/colors';

export default function Profile(): React.JSX.Element {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>👤 Profile</Text>
      {user ? (
        <Text style={styles.subtitle}>{user.phone}{user.email ? ` • ${user.email}` : ''}</Text>
      ) : null}
      <Button
        title="Log out"
        onPress={logout}
        variant="outline"
        style={styles.logoutButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 24,
  },
  logoutButton: {
    marginTop: 8,
    minWidth: 160,
  },
});
