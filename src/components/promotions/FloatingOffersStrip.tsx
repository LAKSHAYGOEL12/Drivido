import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { usePromotionCampaigns } from '../../contexts/PromotionCampaignsContext';
import { useAuth } from '../../contexts/AuthContext';
import { COLORS } from '../../constants/colors';
import {
  resolveOfferPrimaryLine,
  resolveTopOfferProgresses,
  type ResolvedOfferProgress,
} from '../../utils/promotionOfferCopy';
import { rulesUseDistinctCalendarDays } from '../../utils/promotionProgressDisplay';
import SearchOffersModal, { type OfferChipAnchor } from './SearchOffersModal';

/**
 * Floating "Zomato-style" coupon strip that lives above the bottom tab bar and follows the
 * user across every main-tab screen. It is a high-value, low-friction entry point into the
 * offers modal — not a full card, just a ticket-edge strip that swipes between live offers.
 *
 * Production behavior:
 * - Dismiss = hide for **this JS process only** (no persistence). The strip reappears on the
 *   next cold launch so users always get a fresh, non-intrusive reminder.
 * - Horizontal swipe between offers (FlatList paging) with a pagination dot row.
 * - Keyboard-aware: auto-hides when any text input is focused so it never covers form fields.
 * - Parent-gated visibility via `visible` (false during Publish flow, Location picker, etc.).
 * - One modal, anchored to the strip, matches the rest of the offers UX.
 */

const STUB_BG_TOP = '#1E1B4B';
const STUB_BG_BOT = '#312E81';
const STUB_GLOW = 'rgba(251, 191, 36, 0.22)';
const STUB_ICON_WELL = 'rgba(251, 191, 36, 0.2)';
const STUB_ICON_BORDER = 'rgba(251, 191, 36, 0.5)';

const CARD_BG = '#FFFFFF';
const CARD_BORDER = 'rgba(15, 23, 42, 0.08)';
const CARD_INNER_DIVIDER = 'rgba(15, 23, 42, 0.12)';
const EYEBROW_INK = '#4F46E5';
const BODY_INK = COLORS.text;
const CLOSE_BG = 'rgba(15, 23, 42, 0.05)';
const CLOSE_BG_PRESSED = 'rgba(15, 23, 42, 0.1)';
const CLOSE_FG = COLORS.textSecondary;

const DOT_DIM = 'rgba(99, 102, 241, 0.28)';
const DOT_ACTIVE = EYEBROW_INK;

/**
 * Session-scoped "dismissed" flag. Kept at module scope (not React state) so it survives
 * re-mounts of {@link FloatingOffersStrip} across tab navigation within the same process,
 * while still resetting on every cold launch (exactly what the product wants).
 */
let dismissedInSession = false;

/** Single flag (per JS process) so the offers modal auto-pops only once per cold start. */
let floatingStripAutoOpenedThisProcess = false;

type Props = {
  /** When false the strip is hidden regardless of offer state (e.g. Publish flow, modals, maps). */
  visible: boolean;
  /** Distance from the bottom of the screen to the bottom of the strip (above the tab pill). */
  bottomOffset: number;
  /** Horizontal inset (matches the tab pill side inset so the strip appears to "sit on" the pill). */
  sideInset: number;
};

function primaryLineFor(offer: ResolvedOfferProgress | undefined): string {
  if (!offer) return '';
  return resolveOfferPrimaryLine(offer).trim();
}

function headlineFor(offer: ResolvedOfferProgress | undefined): string {
  if (!offer) return '';
  const c = offer.campaignForCopy;
  const title =
    (typeof c.headline === 'string' && c.headline.trim()) ||
    (typeof c.title === 'string' && c.title.trim()) ||
    primaryLineFor(offer);
  return title || 'Unlock your next reward';
}

function progressMicroLabel(
  offer: ResolvedOfferProgress | undefined,
  sessionReady: boolean
): string {
  if (!offer) return '';
  if (!sessionReady) return 'Sign in to track progress';
  if (offer.eligible) return 'Reward ready · tap to redeem';
  if (offer.threshold == null || offer.threshold <= 0) return 'Tap to see details';
  const unit = rulesUseDistinctCalendarDays(offer.rules) ? 'days' : 'rides';
  const left = Math.max(0, offer.threshold - offer.effective);
  if (left <= 0) return `${offer.effective}/${offer.threshold} ${unit}`;
  return `${left} more ${unit} to unlock`;
}

export default function FloatingOffersStrip({
  visible,
  bottomOffset,
  sideInset,
}: Props): React.JSX.Element | null {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { isAuthenticated, needsProfileCompletion } = useAuth();
  const sessionReady = isAuthenticated && !needsProfileCompletion;
  const { catalog, meRows, loadingMe } = usePromotionCampaigns();

  /** Mirror of {@link dismissedInSession} so state changes still trigger re-renders. */
  const [dismissed, setDismissed] = useState<boolean>(dismissedInSession);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [offerAnchor, setOfferAnchor] = useState<OfferChipAnchor | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [containerW, setContainerW] = useState(0);

  const stripMeasureRef = useRef<View>(null);
  const lastAnchorRef = useRef<OfferChipAnchor | null>(null);
  const listRef = useRef<FlatList<ResolvedOfferProgress> | null>(null);

  const enterAnim = useRef(new Animated.Value(0)).current;

  const { offers, lines } = useMemo(
    () => resolveTopOfferProgresses(catalog, meRows),
    [catalog, meRows]
  );

  const multi = offers.length > 1;

  /** First non-eligible — land the user on "what to do next" rather than already-unlocked. */
  const focusOfferIndex = useMemo(() => {
    const i = offers.findIndex((o) => !o.eligible);
    return i >= 0 ? i : 0;
  }, [offers]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const subHide = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  /** Clamp pageIdx whenever offers length changes (avoids out-of-range after a refresh). */
  useEffect(() => {
    setPageIdx((prev) => {
      if (offers.length === 0) return 0;
      return Math.min(Math.max(0, prev), offers.length - 1);
    });
  }, [offers.length]);

  /** Jump pager to the focus offer the first time offers + layout arrive. */
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    if (offers.length === 0 || containerW === 0) return;
    didInitialFocusRef.current = true;
    setPageIdx(focusOfferIndex);
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({
          offset: focusOfferIndex * containerW,
          animated: false,
        });
      } catch {
        /* silent — FlatList may not be ready mid-layout */
      }
    });
  }, [offers.length, focusOfferIndex, containerW]);

  const shouldRender = visible && !keyboardVisible && !dismissed && offers.length > 0;

  /** Entry / exit slide-fade — mirrors the tab pill so the two feel like one unit. */
  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: shouldRender ? 1 : 0,
      duration: shouldRender ? 320 : 220,
      easing: shouldRender ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [shouldRender, enterAnim]);

  /** One-shot: open the offers modal the first time the strip becomes visible in a session. */
  useEffect(() => {
    if (!shouldRender) return;
    if (floatingStripAutoOpenedThisProcess) return;
    floatingStripAutoOpenedThisProcess = true;
    const t = setTimeout(() => {
      setOfferAnchor(lastAnchorRef.current);
      setModalOpen(true);
    }, 500);
    return () => clearTimeout(t);
  }, [shouldRender]);

  const syncAnchor = useCallback(() => {
    stripMeasureRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) lastAnchorRef.current = { x, y, width: w, height: h };
    });
  }, []);

  const openModal = useCallback(() => {
    const node = stripMeasureRef.current;
    if (!node) {
      setOfferAnchor(lastAnchorRef.current);
      setModalOpen(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      const next = w > 0 && h > 0 ? { x, y, width: w, height: h } : lastAnchorRef.current;
      if (next) lastAnchorRef.current = next;
      setOfferAnchor(next);
      setModalOpen(true);
    });
  }, []);

  const onDismiss = useCallback(() => {
    dismissedInSession = true;
    setDismissed(true);
  }, []);

  const translateY = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (containerW <= 0) return;
      const i = Math.round(e.nativeEvent.contentOffset.x / containerW);
      const clamped = Math.max(0, Math.min(offers.length - 1, i));
      if (clamped !== pageIdx) setPageIdx(clamped);
    },
    [containerW, pageIdx, offers.length]
  );

  const keyExtractor = useCallback(
    (item: ResolvedOfferProgress, i: number): string => {
      const slug = item.campaignForCopy?.slug;
      return typeof slug === 'string' && slug ? slug : `offer-${i}`;
    },
    []
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<ResolvedOfferProgress> | null | undefined, index: number) => ({
      length: containerW,
      offset: containerW * index,
      index,
    }),
    [containerW]
  );

  /**
   * Each page is its OWN {@link Pressable} inside the FlatList so the FlatList owns horizontal
   * drag gestures (swipe between offers) and the Pressable only fires for stationary taps
   * (opens the modal). An outer Pressable would win the responder and make swiping unreliable
   * — that was the previous bug. Keep this structure.
   */
  const renderPage = useCallback(
    (offer: ResolvedOfferProgress) => {
      const itemHeadline = headlineFor(offer);
      const sub = progressMicroLabel(offer, sessionReady);
      const itemEligible = Boolean(offer.eligible);

      return (
        <Pressable
          onPress={openModal}
          accessibilityRole="button"
          accessibilityLabel={`Offer: ${itemHeadline}`}
          accessibilityHint={
            multi ? 'Swipe to see more offers, tap to open details' : 'Opens your offers and progress'
          }
          android_ripple={{ color: 'rgba(99, 102, 241, 0.09)', borderless: false }}
          style={({ pressed }) => [
            styles.page,
            { width: containerW },
            pressed && styles.pagePressed,
          ]}
        >
          {/* LEFT STUB — indigo coupon butt with gold gift icon */}
          <View style={styles.stub}>
            <View style={styles.stubLayerTop} />
            <View style={styles.stubLayerBot} />
            <View style={styles.stubGlow} pointerEvents="none" />
            <View style={styles.stubIconWell}>
              <Ionicons name="gift" size={16} color="#FBBF24" />
            </View>
          </View>

          {/* DASHED INTERNAL DIVIDER between the stub and the main body */}
          <View style={styles.dashWrap} pointerEvents="none">
            {Array.from({ length: 9 }).map((_, i) => (
              <View key={`sdash-${i}`} style={styles.dashSeg} />
            ))}
          </View>

          <View style={styles.body}>
            <View style={styles.bodyTextCol}>
              <View style={styles.eyebrowRow}>
                <Text style={styles.eyebrow} numberOfLines={1}>
                  {itemEligible ? 'REWARD READY' : 'OFFER'}
                </Text>
                {multi ? (
                  <View style={styles.countPill}>
                    <Text style={styles.countPillText}>{`${pageIdx + 1}/${offers.length}`}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.headline} numberOfLines={1}>
                {itemHeadline}
              </Text>
              {sub ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
            </View>
            <View style={styles.bodyChevron}>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
            </View>
          </View>
        </Pressable>
      );
    },
    [containerW, multi, offers.length, openModal, pageIdx, sessionReady]
  );

  /**
   * Keep the view mounted while {@link enterAnim} plays the exit — only unmount once nothing
   * is left on-screen so dismiss / re-open transitions stay smooth.
   */
  const keepMounted = shouldRender || modalOpen;
  if (!keepMounted) return null;

  return (
    <>
      <Animated.View
        pointerEvents={shouldRender ? 'box-none' : 'none'}
        style={[
          styles.anchor,
          {
            bottom: bottomOffset,
            left: sideInset,
            right: sideInset,
            opacity: enterAnim,
            transform: [{ translateY }],
          },
        ]}
      >
        <View
          ref={stripMeasureRef}
          collapsable={false}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - containerW) > 0.5) setContainerW(w);
            requestAnimationFrame(() => syncAnchor());
          }}
          style={styles.measureHost}
        >
          <View style={styles.ticket}>
            {containerW > 0 ? (
              multi ? (
                <FlatList
                  ref={listRef}
                  data={offers}
                  keyExtractor={keyExtractor}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={containerW}
                  decelerationRate="fast"
                  bounces
                  initialScrollIndex={focusOfferIndex}
                  getItemLayout={getItemLayout}
                  onMomentumScrollEnd={onMomentumEnd}
                  renderItem={({ item }) => renderPage(item)}
                />
              ) : (
                renderPage(offers[0])
              )
            ) : null}

            {/* TEAR NOTCHES — fixed to the outer ticket so they never slide with pages */}
            <View style={[styles.notch, styles.notchLeftMid]} pointerEvents="none" />
            <View style={[styles.notch, styles.notchRightMid]} pointerEvents="none" />

            {/*
             * CLOSE — absolute-positioned ABOVE the FlatList so the dismiss tap is always
             * reachable and never steals horizontal swipe gestures from the pager underneath.
             */}
            <Pressable
              onPress={onDismiss}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss offers"
              accessibilityHint="Hides this offer strip for now"
              android_ripple={{ color: 'rgba(15, 23, 42, 0.08)', borderless: true, radius: 16 }}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && { backgroundColor: CLOSE_BG_PRESSED },
              ]}
            >
              <Ionicons name="close" size={13} color={CLOSE_FG} />
            </Pressable>
          </View>

          {multi ? (
            <View style={styles.dotsRow} pointerEvents="box-none">
              {offers.map((o, i) => {
                const active = i === pageIdx;
                return (
                  <Pressable
                    key={keyExtractor(o, i)}
                    onPress={() => {
                      setPageIdx(i);
                      try {
                        listRef.current?.scrollToOffset({
                          offset: i * containerW,
                          animated: true,
                        });
                      } catch {
                        /* silent */
                      }
                    }}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to offer ${i + 1} of ${offers.length}`}
                  >
                    <View style={[styles.dot, active && styles.dotActive]} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </Animated.View>

      <SearchOffersModal
        visible={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setOfferAnchor(null);
        }}
        offers={offers}
        lines={lines}
        sessionReady={sessionReady}
        loadingMe={loadingMe}
        focusOfferIndex={pageIdx}
        navigation={navigation}
        offerAnchor={offerAnchor}
      />
    </>
  );
}

const STUB_W = 56;
const STRIP_H = 52;
const NOTCH_D = 14;
const CARD_RADIUS = 14;
const CLOSE_BTN_SIZE = 26;
const CLOSE_BTN_INSET_R = 8;

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
  },
  measureHost: {
    alignSelf: 'stretch',
  },
  ticket: {
    height: STRIP_H,
    backgroundColor: CARD_BG,
    borderRadius: CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },

  /** PAGE (one per offer) ──────────────────────────── */
  page: {
    height: STRIP_H,
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** Tiny darken-on-press for tap feedback without scaling (scaling fights with FlatList paging). */
  pagePressed: {
    opacity: 0.94,
  },

  /** LEFT STUB ─────────────────────────────────────── */
  stub: {
    width: STUB_W,
    height: '100%',
    backgroundColor: STUB_BG_TOP,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  stubLayerTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: STUB_BG_TOP,
  },
  stubLayerBot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    backgroundColor: STUB_BG_BOT,
    opacity: 0.75,
  },
  stubGlow: {
    position: 'absolute',
    top: -10,
    left: -10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: STUB_GLOW,
  },
  stubIconWell: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: STUB_ICON_WELL,
    borderWidth: 1,
    borderColor: STUB_ICON_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /** TEAR NOTCHES ──────────────────────────────────── */
  notch: {
    position: 'absolute',
    width: NOTCH_D,
    height: NOTCH_D,
    borderRadius: NOTCH_D / 2,
    /** Matches the bottom-tab scene background so it reads as a real cut. */
    backgroundColor: COLORS.backgroundSecondary,
    top: STRIP_H / 2 - NOTCH_D / 2,
    zIndex: 3,
  },
  notchLeftMid: {
    left: -NOTCH_D / 2,
  },
  notchRightMid: {
    right: -NOTCH_D / 2,
  },

  /** DASHED DIVIDER BETWEEN STUB AND BODY ──────────── */
  dashWrap: {
    position: 'absolute',
    left: STUB_W - 0.5,
    top: 8,
    bottom: 8,
    width: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  dashSeg: {
    width: 1,
    height: 3,
    backgroundColor: CARD_INNER_DIVIDER,
  },

  /** BODY ──────────────────────────────────────────── */
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    /** Right padding leaves room for the absolute close button so text doesn't run under it. */
    paddingRight: CLOSE_BTN_SIZE + CLOSE_BTN_INSET_R + 4,
    minWidth: 0,
  },
  bodyTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eyebrow: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: EYEBROW_INK,
  },
  countPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  countPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: EYEBROW_INK,
  },
  headline: {
    fontSize: 13.5,
    fontWeight: '800',
    color: BODY_INK,
    letterSpacing: -0.2,
    lineHeight: 17,
    marginTop: 1,
  },
  sub: {
    fontSize: 10.5,
    fontWeight: '600',
    color: COLORS.textSecondary,
    letterSpacing: -0.05,
    marginTop: 1,
  },
  bodyChevron: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /** CLOSE (absolute, stays put while pages swipe) ─── */
  closeBtn: {
    position: 'absolute',
    top: (STRIP_H - CLOSE_BTN_SIZE) / 2,
    right: CLOSE_BTN_INSET_R,
    width: CLOSE_BTN_SIZE,
    height: CLOSE_BTN_SIZE,
    borderRadius: CLOSE_BTN_SIZE / 2,
    backgroundColor: CLOSE_BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },

  /** PAGINATION DOTS ───────────────────────────────── */
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    gap: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: DOT_DIM,
  },
  dotActive: {
    width: 14,
    backgroundColor: DOT_ACTIVE,
  },
});

/** Used by the parent (`BottomTabs`) to reserve scroll clearance so the last row never hides under the strip. */
export const FLOATING_OFFERS_STRIP_HEIGHT = STRIP_H;
/**
 * Vertical gap between the strip's bottom edge and the top of the bottom-tab assembly
 * (which already includes the publish FAB rise). Kept tight (8pt) so the strip reads as
 * "attached to" the tab bar — production-standard sticky-banner placement (Zomato / Swiggy
 * / Uber Eats) — but a hair above so the FAB's circle and shadow never bleed up into the
 * strip's bottom edge.
 */
export const FLOATING_OFFERS_STRIP_GAP = 14;
