import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { useTheme } from './ThemeContext';
import { registerAppAlertListener, type AppAlertButton, type AppAlertOptions } from '../utils/appAlert';

function inferAccent(
  title: string,
  buttons: AppAlertButton[]
): 'default' | 'danger' | 'success' {
  const t = title.toLowerCase();
  if (buttons.some((b) => b.style === 'destructive')) return 'danger';
  if (t.includes('error') || t.includes('failed') || t.includes('not allowed')) return 'danger';
  if (
    t.includes('thanks') ||
    t.includes('booked') ||
    t.includes('request sent') ||
    t.includes('sent') ||
    t.includes('saved') ||
    t.includes('updated') ||
    t.includes('passenger removed') ||
    t.includes('removed') ||
    t.includes('cancelled') ||
    t.includes('canceled')
  ) {
    return 'success';
  }
  return 'default';
}

export function AppAlertProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [queue, setQueue] = useState<AppAlertOptions[]>([]);

  const current = queue[0];

  const enqueue = useCallback((opt: AppAlertOptions) => {
    setQueue((q) => [...q, opt]);
  }, []);

  useEffect(() => {
    registerAppAlertListener(enqueue);
    return () => {
      registerAppAlertListener(null);
    };
  }, [enqueue]);

  const dismissFront = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const onButtonPress = useCallback(
    (btn: AppAlertButton) => {
      try {
        btn.onPress?.();
      } finally {
        dismissFront();
      }
    },
    [dismissFront]
  );

  const onRequestClose = useCallback(() => {
    const opts = queue[0];
    if (opts?.cancelable) {
      try {
        opts.onDismiss?.();
      } finally {
        dismissFront();
      }
      return;
    }
    const cancel = opts?.buttons?.find((b) => b.style === 'cancel');
    if (cancel) {
      try {
        cancel.onPress?.();
      } finally {
        dismissFront();
      }
    } else {
      dismissFront();
    }
  }, [queue, dismissFront]);

  const onScrimPress = useCallback(() => {
    const opts = queue[0];
    if (!opts?.cancelable) return;
    try {
      opts.onDismiss?.();
    } finally {
      dismissFront();
    }
  }, [queue, dismissFront]);

  const visible = queue.length > 0 && current != null;
  const buttons = current?.buttons?.length ? current.buttons : [{ text: 'OK', style: 'default' as const }];
  const accent = current ? inferAccent(current.title, buttons) : 'default';

  const cardBg = isDark ? COLORS.dark.backgroundSecondary : COLORS.background;
  const titleColor = isDark ? COLORS.dark.text : COLORS.text;
  const bodyColor = isDark ? COLORS.dark.textSecondary : COLORS.textSecondary;
  const borderColor = isDark ? COLORS.dark.border : COLORS.borderLight;
  const maxCardW = Math.min(340, windowWidth - 48);

  return (
    <>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onRequestClose}
      >
        <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} pointerEvents="box-none">
          <Pressable
            style={[styles.scrim, isDark && styles.scrimDark]}
            onPress={current?.cancelable ? onScrimPress : undefined}
            accessibilityLabel={current?.cancelable ? 'Dismiss' : undefined}
          />
          <View style={styles.center} pointerEvents="box-none">
            <View
              style={[
                styles.card,
                {
                  backgroundColor: cardBg,
                  borderColor,
                  maxWidth: maxCardW,
                },
                Platform.OS === 'ios'
                  ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 12 },
                      shadowOpacity: isDark ? 0.45 : 0.18,
                      shadowRadius: 24,
                    }
                  : { elevation: 24 },
              ]}
            >
              <View style={styles.iconRow}>
                {accent === 'danger' ? (
                  <View style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(239,68,68,0.2)' : '#fef2f2' }]}>
                    <Ionicons name="alert-circle" size={28} color={COLORS.error} />
                  </View>
                ) : accent === 'success' ? (
                  <View
                    style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(41,190,139,0.2)' : 'rgba(41,190,139,0.12)' }]}
                  >
                    <Ionicons name="checkmark-circle" size={28} color={COLORS.primary} />
                  </View>
                ) : (
                  <View
                    style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(59,130,246,0.2)' : '#eff6ff' }]}
                  >
                    <Ionicons name="information-circle" size={28} color={COLORS.info} />
                  </View>
                )}
              </View>
              <Text style={[styles.title, { color: titleColor }]} accessibilityRole="header">
                {current?.title ?? ''}
              </Text>
              {current?.message ? (
                <Text style={[styles.message, { color: bodyColor }]}>{current.message}</Text>
              ) : null}

              <View
                style={[
                  styles.buttonsRow,
                  buttons.length > 2 && styles.buttonsStack,
                ]}
              >
                {buttons.map((btn, idx) => {
                  const key = `${btn.text}-${idx}`;
                  const isCancel = btn.style === 'cancel';
                  const isDestructive = btn.style === 'destructive';
                  const isPrimary = !isCancel && !isDestructive;

                  return (
                    <Pressable
                      key={key}
                      onPress={() => onButtonPress(btn)}
                      style={({ pressed }) => [
                        styles.btnBase,
                        buttons.length <= 2 && styles.btnFlex,
                        buttons.length > 2 && styles.btnFullWidth,
                        isCancel && [
                          styles.btnGhost,
                          { borderColor: isDark ? COLORS.dark.border : COLORS.border },
                          pressed && styles.btnPressed,
                        ],
                        isDestructive && [styles.btnDanger, pressed && styles.btnPressed],
                        isPrimary && [styles.btnPrimary, pressed && styles.btnPressed],
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={btn.text}
                    >
                      <Text
                        style={[
                          styles.btnText,
                          isCancel && { color: titleColor },
                          isDestructive && styles.btnTextOnColor,
                          isPrimary && styles.btnTextOnColor,
                        ]}
                        numberOfLines={2}
                      >
                        {btn.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  scrimDark: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 18,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  message: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  buttonsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 10,
    marginTop: 22,
    marginHorizontal: -2,
  },
  buttonsStack: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
  },
  btnBase: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFlex: {
    flex: 1,
    minWidth: 0,
  },
  btnFullWidth: {
    width: '100%',
  },
  btnGhost: {
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
  },
  btnDanger: {
    backgroundColor: COLORS.error,
  },
  btnPressed: {
    opacity: 0.88,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
  btnTextOnColor: {
    color: COLORS.white,
  },
});
