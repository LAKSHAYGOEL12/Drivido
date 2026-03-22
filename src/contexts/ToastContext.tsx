import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { useTheme } from './ThemeContext';
import { registerToastListener, type ToastPayload, type ToastVariant } from '../utils/toast';

const DEFAULT_MS = 3400;

function variantColors(variant: ToastVariant, isDark: boolean): { bg: string; border: string; title: string; body: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string } {
  switch (variant) {
    case 'error':
      return {
        bg: isDark ? '#3f1212' : '#fff1f2',
        border: COLORS.error,
        title: isDark ? '#fecaca' : '#991b1b',
        body: isDark ? '#fecdd3' : '#7f1d1d',
        icon: 'alert-circle',
        iconColor: COLORS.error,
      };
    case 'success':
      return {
        bg: isDark ? '#052e16' : '#ecfdf5',
        border: COLORS.primary,
        title: isDark ? '#bbf7d0' : '#14532d',
        body: isDark ? '#86efac' : '#166534',
        icon: 'checkmark-circle',
        iconColor: COLORS.primary,
      };
    default:
      return {
        bg: isDark ? COLORS.dark.backgroundSecondary : COLORS.background,
        border: COLORS.primary,
        title: isDark ? COLORS.dark.text : COLORS.text,
        body: isDark ? COLORS.dark.textSecondary : COLORS.textSecondary,
        icon: 'information-circle',
        iconColor: COLORS.primary,
      };
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -12, duration: 180, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY]);

  useEffect(() => {
    const listener = (payload: ToastPayload) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast(payload);
    };
    registerToastListener(listener);
    return () => {
      registerToastListener(null);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.durationMs ?? DEFAULT_MS;

    opacity.setValue(0);
    translateY.setValue(-12);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }),
    ]).start();

    hideTimer.current = setTimeout(() => {
      hide();
    }, duration);

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [toast, hide, opacity, translateY]);

  const v = toast ? variantColors(toast.variant ?? 'info', isDark) : null;
  const maxToastWidth = Math.min(width - 32, 400);

  return (
    <>
      {children}
      {toast && v ? (
        <View
          style={[styles.overlay, { paddingTop: Math.max(insets.top, 12) }]}
          pointerEvents="none"
        >
          <Animated.View
            style={[
              styles.toast,
              {
                maxWidth: maxToastWidth,
                opacity,
                transform: [{ translateY }],
                backgroundColor: v.bg,
                borderLeftColor: v.border,
                ...Platform.select({
                  ios: {
                    shadowColor: '#0f172a',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: isDark ? 0.35 : 0.12,
                    shadowRadius: 12,
                  },
                  android: { elevation: 6 },
                }),
              },
            ]}
          >
            <Ionicons name={v.icon as never} size={22} color={v.iconColor} style={styles.toastIcon} />
            <View style={styles.toastTextCol}>
              {toast.title ? (
                <Text style={[styles.toastTitle, { color: v.title }]} numberOfLines={2}>
                  {toast.title}
                </Text>
              ) : null}
              <Text style={[styles.toastBody, { color: v.body }]} numberOfLines={4}>
                {toast.message}
              </Text>
            </View>
          </Animated.View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderLeftWidth: 4,
    marginHorizontal: 16,
  },
  toastIcon: {
    marginTop: 2,
    marginRight: 12,
  },
  toastTextCol: {
    flex: 1,
    minWidth: 0,
  },
  toastTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  toastBody: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
});
