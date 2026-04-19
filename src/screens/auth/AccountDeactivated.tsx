import React from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, Linking } from 'react-native';
import { Alert } from '../../utils/themedAlert';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';

const SUPPORT_MAILTO =
  'mailto:developers@drivido.in?subject=' + encodeURIComponent('EcoPickO — Reactivate account');

type Props = RootStackScreenProps<'AccountDeactivated'>;

export default function AccountDeactivated(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();
  const { clearAccountDeactivationNotice } = useAuth();

  const continueAsGuest = () => {
    clearAccountDeactivationNotice();
    if (rootNavigationRef.isReady()) {
      rootNavigationRef.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  };

  const openSupport = () => {
    void Linking.openURL(SUPPORT_MAILTO).catch(() => {
      Alert.alert('Contact support', 'Email developers@drivido.in to reactivate your account.');
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}>
          <Ionicons name="person-remove-outline" size={40} color={COLORS.textSecondary} />
        </View>
        <Text style={styles.title}>Account deactivated</Text>
        <Text style={styles.body}>
          This account is no longer active. You have been signed out. Past rides and chats may show
          &quot;Deactivated user&quot; instead of personal details.
        </Text>
        <Text style={styles.body}>
          To use this account again, sign in with the same method — you’ll see a Reactivate screen while
          you’re still signed in with Firebase. Or contact support if you need help.
        </Text>

        <Pressable style={styles.primaryBtn} onPress={continueAsGuest} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Continue</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={openSupport} accessibilityRole="button">
          <Text style={styles.secondaryBtnText}>Contact support</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.white },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 14,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
});
