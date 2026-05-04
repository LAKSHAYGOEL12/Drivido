import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { findMainTabNavigator } from '../../navigation/findMainTabNavigator';
import { rootNavigationRef } from '../../navigation/rootNavigationRef';
import { navigatePublishStackToNewRideWizard } from '../../navigation/navigatePublishStackNewRideWizard';
import { navigateToGuestLogin } from '../../navigation/navigateToGuestLogin';
import type { ResolvedOfferProgress } from '../../utils/promotionOfferCopy';
import { resolveOfferProgressLine } from '../../utils/promotionOfferCopy';
import {
  promotionFilledSegments,
  promotionProgressRatio,
  promotionProgressSegmentCount,
} from '../../utils/promotionProgressDisplay';

/**
 * Production bottom-sheet modal for offer details.
 *
 * Why a bottom sheet (not a centered ticket card):
 * - Native iOS / Android interaction pattern — feels like the strip "expands" upward into this sheet.
 * - Leaves the coupon-ticket motif to the floating strip, keeping the modal free to be a rich
 *   details surface (hero orb, large headline, segmented progress, paired CTAs).
 * - Safer for long content — scroll fills the available height between the hero and the action
 *   footer without clipping the CTAs (a pain point with the old fixed-height card layout).
 */

const SCRIM_BASE = '#020617';

const SHEET_BG = '#FFFFFF';
const SHEET_BORDER = 'rgba(15, 23, 42, 0.06)';
const HANDLE_COLOR = 'rgba(15, 23, 42, 0.14)';

const INK = COLORS.text;
const INK_MUTED = COLORS.textSecondary;
const INK_DIM = COLORS.textMuted;

/** Indigo accent family — used for eyebrows, pager dots, counter chip. Brand green stays for CTA + progress. */
const INDIGO_500 = '#6366F1';
const INDIGO_600 = '#4F46E5';
const INDIGO_100 = 'rgba(99, 102, 241, 0.1)';
const INDIGO_200 = 'rgba(99, 102, 241, 0.24)';

/** Hero gradient — matches the left stub on the floating strip so both surfaces feel like one product. */
const HERO_BG_TOP = '#1E1B4B';
const HERO_BG_BOT = '#4338CA';
const HERO_GLOW = 'rgba(251, 191, 36, 0.22)';
const HERO_INNER_RING = 'rgba(251, 191, 36, 0.42)';
const HERO_ICON_WELL = 'rgba(251, 191, 36, 0.18)';

const PROGRESS_CARD_BG = '#F8FAFC';
const PROGRESS_CARD_BORDER = 'rgba(15, 23, 42, 0.06)';
const PROGRESS_SEG_EMPTY = 'rgba(99, 102, 241, 0.12)';
const PROGRESS_SEG_FILL = COLORS.primary;

const CLOSE_BG = 'rgba(15, 23, 42, 0.05)';
const CLOSE_BG_PRESSED = 'rgba(15, 23, 42, 0.1)';
const CLOSE_FG = COLORS.textSecondary;

/** Window-space rect from `measureInWindow` on the Offers strip — accepted for API compat. */
export type OfferChipAnchor = { x: number; y: number; width: number; height: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  offers: ResolvedOfferProgress[];
  lines: string[];
  sessionReady: boolean;
  loadingMe: boolean;
  /** Which offer the user was viewing on the strip when they opened the modal. */
  focusOfferIndex: number;
  navigation: NavigationProp<ParamListBase>;
  /**
   * Kept for API compatibility with callers that still measure a chip anchor. The new sheet
   * design animates from the bottom of the screen so it does not need origin-based motion.
   */
  offerAnchor?: OfferChipAnchor | null;
};

function navigateToSearchRidesHome(navigation: NavigationProp<ParamListBase>): void {
  const tabs = findMainTabNavigator(navigation);
  const token = Date.now();
  /** Nested stack params — `screen` is correct here (inside `params`). */
  const searchStackParams = {
    screen: 'SearchRides' as const,
    params: { _tabResetToken: token },
  };
  /**
   * `CommonActions.navigate` requires top-level **`name`** (tab route id), not `screen`.
   * @see https://reactnavigation.org/docs/navigation-actions#navigate
   */
  const tabNavigateAction = CommonActions.navigate({
    name: 'SearchStack',
    params: searchStackParams,
  });
  if (tabs?.dispatch) {
    tabs.dispatch(tabNavigateAction);
    return;
  }
  /** Root `navigate('Main', { screen, params })` uses `screen` for the first nested level. */
  const mainNestedParams = {
    screen: 'SearchStack' as const,
    params: searchStackParams,
  };
  if (rootNavigationRef.isReady()) {
    rootNavigationRef.navigate('Main', mainNestedParams);
    return;
  }
  (navigation as { navigate: (name: string, params?: unknown) => void }).navigate('Main', mainNestedParams);
}

function publishDispatchTarget(
  navigation: NavigationProp<ParamListBase>
): { dispatch: (a: unknown) => void } | null {
  const tabs = findMainTabNavigator(navigation);
  if (tabs?.dispatch) return { dispatch: (a) => tabs.dispatch(a as never) };
  if (rootNavigationRef.isReady()) {
    return { dispatch: (a) => rootNavigationRef.dispatch(a as never) };
  }
  const d = navigation.dispatch;
  return typeof d === 'function' ? { dispatch: (a) => d(a as never) } : null;
}

function navigateToPublishFromSearch(
  navigation: NavigationProp<ParamListBase>,
  sessionReady: boolean
): void {
  if (!sessionReady) {
    navigateToGuestLogin(navigation, { reason: 'tab' });
    return;
  }
  const target = publishDispatchTarget(navigation);
  if (target) {
    navigatePublishStackToNewRideWizard(target, { exitToTab: 'SearchStack' });
  }
}

export default function SearchOffersModal({
  visible,
  onClose,
  offers,
  lines,
  sessionReady,
  loadingMe,
  focusOfferIndex,
  navigation,
}: Props): React.JSX.Element {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const heroPulse = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      const safe = Math.min(Math.max(0, focusOfferIndex), Math.max(0, offers.length - 1));
      setIdx(safe);
    }
  }, [visible, focusOfferIndex, offers.length]);

  useEffect(() => {
    if (!visible) {
      closingRef.current = false;
      sheetProgress.stopAnimation();
      sheetProgress.setValue(0);
      heroPulse.stopAnimation();
      heroPulse.setValue(0);
      progressAnim.stopAnimation();
      progressAnim.setValue(0);
      return;
    }
    /** Enter — gentle spring so the sheet settles without overshoot at the top. */
    sheetProgress.setValue(0);
    Animated.spring(sheetProgress, {
      toValue: 1,
      stiffness: 260,
      damping: 28,
      mass: 0.9,
      overshootClamping: true,
      useNativeDriver: true,
    }).start();

    /**
     * Hero orb pulse — 2 beats then settle. Same "three-pulse-then-rest" cadence used on the
     * Profile offer badge so the product's attention grammar is consistent.
     */
    heroPulse.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(heroPulse, {
          toValue: 1,
          duration: 820,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heroPulse, {
          toValue: 0,
          duration: 820,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 2 }
    ).start();
  }, [visible, sheetProgress, heroPulse, progressAnim]);

  const requestClose = useCallback(
    (after?: () => void) => {
      if (closingRef.current || !visible) return;
      closingRef.current = true;
      Animated.timing(sheetProgress, {
        toValue: 0,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        closingRef.current = false;
        if (finished) {
          onClose();
          after?.();
        }
      });
    },
    [visible, sheetProgress, onClose]
  );

  const scrimAnimatedStyle = useMemo(
    () => ({
      opacity: sheetProgress.interpolate({
        inputRange: [0, 0.2, 1],
        outputRange: [0, 0.35, 0.48],
      }),
    }),
    [sheetProgress]
  );

  /** Sheet enters by sliding up from below the screen and fading in subtly at the same time. */
  const sheetAnimatedStyle = useMemo(
    () => ({
      opacity: sheetProgress.interpolate({
        inputRange: [0, 0.2, 1],
        outputRange: [0, 1, 1],
      }),
      transform: [
        {
          translateY: sheetProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [winH * 0.5, 0],
          }),
        },
      ],
    }),
    [sheetProgress, winH]
  );

  const heroOrbScale = heroPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });
  const heroGlowOpacity = heroPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.7],
  });
  const heroGlowScale = heroPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.35],
  });

  const o = offers[idx];
  const rowLine = lines[idx] ?? '';

  const heading = useMemo(() => {
    if (!o) return 'Offers';
    const c = o.campaignForCopy;
    const h =
      (typeof c.headline === 'string' && c.headline.trim()) ||
      (typeof c.title === 'string' && c.title.trim()) ||
      rowLine.trim();
    return h || 'Offer';
  }, [o, rowLine]);

  const offerSubtitle = useMemo(() => {
    if (!o) return '';
    const c = o.campaignForCopy;
    const s =
      (typeof c?.shortDescription === 'string' && c.shortDescription.trim()) ||
      (typeof c?.subtitle === 'string' && c.subtitle.trim()) ||
      '';
    if (!s.trim()) return '';
    if (s.trim().toLowerCase() === heading.trim().toLowerCase()) return '';
    return s.trim();
  }, [o, heading]);

  const showTrack = Boolean(o && sessionReady && o.threshold != null && !o.eligible);
  const sliceTotal = o ? promotionProgressSegmentCount(o.threshold) : 0;
  const ratio = o ? promotionProgressRatio(o.progress, o.rules) : 0;
  const filledSlices = o && showTrack ? promotionFilledSegments(ratio, o.threshold) : 0;
  const progressLabel =
    o &&
    resolveOfferProgressLine({
      campaign: o.campaignForCopy,
      sessionReady,
      effective: o.effective,
      threshold: o.threshold,
      eligible: o.eligible,
    });
  const unlockedLabel = String(o?.campaignForCopy?.reward?.title ?? '').trim() || 'Reward unlocked';

  /** Animate the filled-segment count when the sheet opens or the active offer changes. */
  useEffect(() => {
    if (!visible) return;
    progressAnim.stopAnimation();
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 640,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [visible, idx, progressAnim]);

  const onSearchRides = (): void => {
    requestClose(() => {
      InteractionManager.runAfterInteractions(() => navigateToSearchRidesHome(navigation));
    });
  };

  const onPublish = (): void => {
    requestClose(() => {
      InteractionManager.runAfterInteractions(() => navigateToPublishFromSearch(navigation, sessionReady));
    });
  };

  const multi = offers.length > 1;
  const sheetMaxHeight = Math.round(winH * 0.88);
  /** Content area cap — leaves airy top gap above the sheet so the scrim reads as a backdrop. */
  const sheetMinTopGap = Math.max(insets.top + 36, 64);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => requestClose()}>
      <View style={styles.flexFill}>
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM_BASE }, scrimAnimatedStyle]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => requestClose()} accessibilityLabel="Dismiss" />
        </Animated.View>

        {o ? (
          <View style={styles.sheetWrap} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.sheet,
                {
                  maxHeight: sheetMaxHeight,
                  /** Reserve safe area at the bottom so CTAs clear the gesture area on notched devices. */
                  paddingBottom: Math.max(insets.bottom, 12) + 16,
                  marginTop: sheetMinTopGap,
                },
                sheetAnimatedStyle,
              ]}
            >
              {/* HANDLE BAR — universal "drag / dismiss" affordance */}
              <View style={styles.handleRow}>
                <View style={styles.handleBar} />
              </View>

              {/* CLOSE — absolute top-right so it never shifts with content */}
              <Pressable
                onPress={() => requestClose()}
                style={({ pressed }) => [styles.closeBtn, pressed && { backgroundColor: CLOSE_BG_PRESSED }]}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
                {...Platform.select({
                  android: { android_ripple: { color: 'rgba(15, 23, 42, 0.08)', borderless: true, radius: 22 } },
                  default: {},
                })}
              >
                <Ionicons name="close" size={18} color={CLOSE_FG} />
              </Pressable>

              {/* BODY — single flex column, no scroll. Everything fits on first open. */}
              <View style={styles.body}>
                {/* TOP ROW: just the counter chip (the pager lives at the bottom of the body) */}
                <View style={styles.topRow}>
                  <View style={styles.counterChip}>
                    <Ionicons name="pricetags-outline" size={11} color={INDIGO_600} />
                    <Text style={styles.counterText}>
                      {multi ? `OFFER ${idx + 1} OF ${offers.length}` : 'YOUR OFFER'}
                    </Text>
                  </View>
                </View>

                {/* HERO — gradient orb with pulsing gold glow */}
                <View style={styles.heroWrap}>
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.heroGlow,
                      {
                        opacity: heroGlowOpacity,
                        transform: [{ scale: heroGlowScale }],
                      },
                    ]}
                  />
                  <Animated.View style={[styles.heroOrb, { transform: [{ scale: heroOrbScale }] }]}>
                    <View style={styles.heroOrbLayerTop} />
                    <View style={styles.heroOrbLayerBot} />
                    <View style={styles.heroIconWell}>
                      <Ionicons name="gift" size={28} color="#FBBF24" />
                    </View>
                  </Animated.View>
                </View>

                {/* TITLE BLOCK */}
                <View style={styles.titleBlock}>
                  <Text style={styles.eyebrow}>
                    {o.eligible ? 'REWARD READY' : 'UNLOCK REWARD'}
                  </Text>
                  <Text style={styles.title} numberOfLines={3}>
                    {heading}
                  </Text>
                  {offerSubtitle ? (
                    <Text style={styles.subtitle} numberOfLines={2}>
                      {offerSubtitle}
                    </Text>
                  ) : null}
                </View>

                {/* PROGRESS CARD */}
                <View style={styles.progressCard}>
                  <View style={styles.progressHeaderRow}>
                    <View style={styles.progressIconWell}>
                      <Ionicons name="sparkles" size={13} color={INDIGO_600} />
                    </View>
                    <Text style={styles.progressHeader}>Your progress</Text>
                    {showTrack && sliceTotal > 0 ? (
                      <Text style={styles.progressFraction}>
                        {filledSlices}
                        <Text style={styles.progressFractionDim}>{` / ${sliceTotal}`}</Text>
                      </Text>
                    ) : null}
                  </View>

                  {loadingMe && sessionReady ? (
                    <Text style={styles.progressHint}>Updating progress…</Text>
                  ) : !sessionReady ? (
                    <Text style={styles.progressHint}>Sign in to see your progress.</Text>
                  ) : o.eligible ? (
                    <View style={styles.unlockedRow}>
                      <View style={styles.unlockedBadge}>
                        <Ionicons name="checkmark" size={13} color={COLORS.white} />
                      </View>
                      <Text style={styles.unlockedText} numberOfLines={2}>
                        {unlockedLabel}
                      </Text>
                    </View>
                  ) : o.threshold != null ? (
                    <>
                      <View style={styles.segmentsRow} accessibilityRole="progressbar">
                        {Array.from({ length: sliceTotal }).map((_, i) => {
                          const isFilled = i < filledSlices;
                          return (
                            <Animated.View
                              key={`m-seg-${i}`}
                              style={[
                                styles.segment,
                                isFilled
                                  ? {
                                      backgroundColor: PROGRESS_SEG_FILL,
                                      opacity: progressAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0.3, 1],
                                      }),
                                      transform: [
                                        {
                                          scaleY: progressAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0.6, 1],
                                          }),
                                        },
                                      ],
                                    }
                                  : styles.segmentEmpty,
                              ]}
                            />
                          );
                        })}
                      </View>
                      {progressLabel ? (
                        <Text style={styles.progressSubLabel} numberOfLines={2}>
                          {progressLabel}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.progressHint}>Progress updates as you complete trips.</Text>
                  )}
                </View>

                {/*
                 * PAGER — anchored at the bottom of the body, centered. Always on screen because
                 * the sheet is unscrollable, so users can reliably tap "<" / ">" or a dot to move
                 * between offers. Kept clear of the absolute close button because it sits below
                 * the progress card, well away from the sheet's top-right corner.
                 */}
                {multi ? (
                  <View style={styles.pagerRow}>
                    <Pressable
                      onPress={() => setIdx((i) => (i > 0 ? i - 1 : offers.length - 1))}
                      style={({ pressed }) => [styles.pagerArrow, pressed && styles.pagerArrowPressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Previous offer"
                      hitSlop={10}
                    >
                      <Ionicons name="chevron-back" size={18} color={INDIGO_600} />
                    </Pressable>
                    <View style={styles.pagerDots}>
                      {offers.map((_, i) => (
                        <Pressable
                          key={`p-${i}`}
                          onPress={() => setIdx(i)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Go to offer ${i + 1} of ${offers.length}`}
                        >
                          <View style={[styles.pagerDot, i === idx && styles.pagerDotActive]} />
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      onPress={() => setIdx((i) => (i < offers.length - 1 ? i + 1 : 0))}
                      style={({ pressed }) => [styles.pagerArrow, pressed && styles.pagerArrowPressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Next offer"
                      hitSlop={10}
                    >
                      <Ionicons name="chevron-forward" size={18} color={INDIGO_600} />
                    </Pressable>
                  </View>
                ) : null}
              </View>

              {/*
               * ACTIONS — Search (plain text button, top) → "or" divider → Publish (green primary,
               * bottom). The plain Search + tiny "or" pattern borrows from login / auth screens
               * (e.g. "Sign in with Google  — or —  Create account") so users read it as "two
               * paths, one hero action."
               */}
              <View style={styles.actions}>
                <Pressable
                  onPress={onSearchRides}
                  style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.btnPlainPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Search rides"
                  android_ripple={{ color: 'rgba(15, 23, 42, 0.05)' }}
                >
                  <Ionicons name="search" size={18} color={INK} />
                  <Text style={styles.btnPlainText}>Search rides</Text>
                </Pressable>

                <View style={styles.orDivider} pointerEvents="none">
                  <View style={styles.orLine} />
                  <Text style={styles.orText}>or</Text>
                  <View style={styles.orLine} />
                </View>

                <Pressable
                  onPress={onPublish}
                  style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Publish a ride now"
                  android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
                >
                  <Ionicons name="add-circle-outline" size={18} color={COLORS.white} />
                  <Text style={styles.btnPrimaryText}>Publish a ride</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const SHEET_RADIUS = 28;
const HERO_ORB_SIZE = 74;
const HERO_GLOW_SIZE = 150;

const styles = StyleSheet.create({
  flexFill: {
    flex: 1,
  },

  /** SHEET WRAPPER — pushes the sheet flush to the bottom of the screen. */
  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: SHEET_BORDER,
    overflow: 'hidden',
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#020617',
        shadowOffset: { width: 0, height: -12 },
        shadowOpacity: 0.2,
        shadowRadius: 28,
      },
      android: { elevation: 24 },
      default: {},
    }),
  },

  /** HANDLE BAR ────────────────────────────────────── */
  handleRow: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: HANDLE_COLOR,
  },

  /** CLOSE (absolute top-right) ─────────────────────── */
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CLOSE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 6,
  },

  /** SCROLL BODY ───────────────────────────────────── */
  /** BODY — single flex column, no ScrollView. */
  body: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 18,
  },

  /**
   * TOP ROW — just the counter chip, left-aligned. The pager lives at the bottom of the body
   * (see `pagerRow`) so it's always visible on a non-scrolling sheet without colliding with
   * the absolute × close button in the sheet's top-right corner.
   */
  topRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    /** Reserve space on the right so a long counter chip never bleeds under the × button. */
    paddingRight: 44,
  },

  /** COUNTER CHIP ──────────────────────────────────── */
  counterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: INDIGO_100,
    borderWidth: 1,
    borderColor: INDIGO_200,
  },
  counterText: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: INDIGO_600,
  },

  /** HERO ORB ──────────────────────────────────────── */
  heroWrap: {
    width: HERO_GLOW_SIZE,
    height: HERO_GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroGlow: {
    position: 'absolute',
    width: HERO_GLOW_SIZE,
    height: HERO_GLOW_SIZE,
    borderRadius: HERO_GLOW_SIZE / 2,
    backgroundColor: HERO_GLOW,
  },
  heroOrb: {
    width: HERO_ORB_SIZE,
    height: HERO_ORB_SIZE,
    borderRadius: HERO_ORB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: HERO_BG_TOP,
    borderWidth: 1,
    borderColor: HERO_INNER_RING,
    ...Platform.select({
      ios: {
        shadowColor: '#1E1B4B',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 18,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  heroOrbLayerTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: HERO_BG_TOP,
  },
  heroOrbLayerBot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    backgroundColor: HERO_BG_BOT,
    opacity: 0.9,
  },
  heroIconWell: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: HERO_ICON_WELL,
    borderWidth: 1,
    borderColor: HERO_INNER_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /** TITLE BLOCK ───────────────────────────────────── */
  titleBlock: {
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 18,
  },
  eyebrow: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: INDIGO_500,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: INK,
    lineHeight: 30,
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: INK_MUTED,
    lineHeight: 20,
    letterSpacing: -0.1,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },

  /** PROGRESS CARD ─────────────────────────────────── */
  progressCard: {
    width: '100%',
    backgroundColor: PROGRESS_CARD_BG,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PROGRESS_CARD_BORDER,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  progressIconWell: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: INDIGO_100,
    borderWidth: 1,
    borderColor: INDIGO_200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressHeader: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: INK,
    letterSpacing: -0.1,
  },
  progressFraction: {
    fontSize: 15,
    fontWeight: '900',
    color: INK,
    letterSpacing: -0.2,
  },
  progressFractionDim: {
    fontWeight: '700',
    color: INK_DIM,
  },
  progressHint: {
    fontSize: 13.5,
    fontWeight: '600',
    color: INK_DIM,
    lineHeight: 19,
  },
  unlockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  unlockedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockedText: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '800',
    color: INK,
    letterSpacing: -0.15,
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 10,
  },
  segment: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    minWidth: 3,
  },
  segmentEmpty: {
    backgroundColor: PROGRESS_SEG_EMPTY,
  },
  progressSubLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: INK_MUTED,
    letterSpacing: -0.05,
  },

  /**
   * PAGER (bottom-anchored) ────────────────────────────
   * Lives below the progress card, centered horizontally. The sheet never scrolls, so this
   * control is always on screen and discoverable without any hunting. Clear of the absolute
   * close button because it sits near the middle/bottom of the sheet, far from top-right.
   */
  pagerRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
  },
  pagerArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: INDIGO_100,
    borderWidth: 1,
    borderColor: INDIGO_200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerArrowPressed: {
    backgroundColor: INDIGO_200,
    transform: [{ scale: 0.94 }],
  },
  pagerDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  pagerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(99, 102, 241, 0.32)',
  },
  pagerDotActive: {
    width: 18,
    backgroundColor: INDIGO_600,
  },

  /** ACTIONS ───────────────────────────────────────── */
  actions: {
    alignSelf: 'stretch',
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.06)',
    backgroundColor: SHEET_BG,
  },
  btn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderRadius: 16,
    gap: 8,
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  btnPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.2,
  },
  /**
   * PLAIN BUTTON — truly bare text + icon, no fill, no border. Used for the softer alternate
   * action (Search rides) when paired with a bold primary CTA below. Press state is a very
   * subtle slate tint so the tap still feels responsive.
   */
  btnPlain: {
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  btnPlainPressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
  },
  btnPlainText: {
    fontSize: 15,
    fontWeight: '700',
    color: INK,
    letterSpacing: -0.15,
  },

  /**
   * "OR" DIVIDER ───────────────────────────────────────
   * Thin hairline to each side of a muted tiny "or" label, centered between the two buttons.
   * Reads as a clear soft break without stealing hierarchy from the green primary below.
   */
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    marginVertical: 2,
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.1)',
  },
  orText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: INK_DIM,
    textTransform: 'uppercase',
  },
});
