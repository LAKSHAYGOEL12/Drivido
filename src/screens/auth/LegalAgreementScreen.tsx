import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { RootStackScreenProps } from '../../navigation/types';
import { COLORS } from '../../constants/colors';
import {
  LEGAL_AGREEMENT_EFFECTIVE_DATE,
  LEGAL_AGREEMENT_SECTIONS,
  LEGAL_AGREEMENT_TITLE,
  LEGAL_AGREEMENT_VERSION,
} from '../../constants/legal/legalAgreement';

type Props = RootStackScreenProps<'LegalAgreement'>;

export default function LegalAgreementScreen(): React.JSX.Element {
  const navigation = useNavigation<Props['navigation']>();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Close legal agreement"
        >
          <Ionicons name="close" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Legal
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{LEGAL_AGREEMENT_TITLE}</Text>
        <Text style={styles.meta}>
          Effective: {LEGAL_AGREEMENT_EFFECTIVE_DATE}  |  Version: {LEGAL_AGREEMENT_VERSION}
        </Text>

        {LEGAL_AGREEMENT_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.lines.map((line) => (
              <Text key={`${section.title}:${line.slice(0, 24)}`} style={styles.lineText}>
                - {line}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 6,
  },
  meta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 18,
  },
  section: {
    marginBottom: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundSecondary,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 8,
  },
  lineText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textSecondary,
    marginBottom: 5,
  },
});
