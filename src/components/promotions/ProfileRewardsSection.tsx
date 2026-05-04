import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { usePromotionCampaigns } from '../../contexts/PromotionCampaignsContext';
import {
  resolveOfferProgressLine,
  resolveTopOfferProgresses,
  type ResolvedOfferProgress,
} from '../../utils/promotionOfferCopy';
import {
  promotionFilledSegments,
  promotionProgressRatio,
  promotionProgressSegmentCount,
} from '../../utils/promotionProgressDisplay';
import SearchOffersModal from './SearchOffersModal';

/**
 * Profile → Offers (quiet progress card).
 *
 * Intentionally minimal per the "reveal minimum things only" directive for the profile surface:
 *
 * What's shown per offer, and nothing more:
 *   1. One-line headline (clips to 2 lines max)
 *   2. Slim segmented progress bar (or a ✓ Unlocked chip when eligible)
 *   3. Tiny progress label ("3 of 5 rides")
 *
 * What was intentionally removed from the old card:
 *   - Left accent rail, `REWARDS` eyebrow, "Swipe the card to compare offers" hint text
 *   - Status chip ("In progress" / "Reward unlocked") — the bar / chip already encodes state
 *   - `shortDescription` / `subtitle` blurb
 *   - Bordered reward tile ("Save ₹200 off")
 *   - Engagement hint ("Each completed trip fills your momentum bar…")
 *
 * The richer presentation (hero orb, headline, subtitle, CTAs) now lives in SearchOffersModal;
 * tapping this card opens it, focused on the currently-visible offer.
 */

const INDIGO_600 = '#4F46E5';
const INDIGO_100 = 'rgba(99, 102, 241, 0.1)';
const INDIGO_200 = 'rgba(99, 102, 241, 0.22)';
const SEG_EMPTY = 'rgba(99, 102, 241, 0.14)';

type Props = {
  sessionReady: boolean;
};

export default function ProfileRewardsSection({ sessionReady }: Props): React.JSX.Element | null {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { catalog, meRows, loadingMe, catalogLoadError, refreshMe, refreshCatalog } =
    usePromotionCampaigns();
  const [idx, setIdx] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  /** Page width is measured via `onLayout` so the card can live inside any padded parent. */
  const [pageW, setPageW] = useState(0);
  const listRef = useRef<FlatList<ResolvedOfferProgress>>(null);

  useFocusEffect(
    useCallback(() => {
      if (catalog.length === 0 || catalogLoadError) void refreshCatalog();
      if (sessionReady) void refreshMe();
    }, [sessionReady, refreshMe, refreshCatalog, catalog.length, catalogLoadError])
  );

  const { offers, lines } = useMemo(
    () => resolveTopOfferProgresses(catalog, meRows),
    [catalog, meRows]
  );

  const multi = offers.length > 1;

  const keyExtractor = useCallback((item: ResolvedOfferProgress, i: number): string => {
    const slug = item.campaignForCopy?.slug;
    return typeof slug === 'string' && slug ? slug : `offer-${i}`;
  }, []);

  const onListLayout = useCallback((e: LayoutChangeEvent) => {
    setPageW(Math.round(e.nativeEvent.layout.width));
  }, []);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageW <= 0) return;
      const next = Math.round(e.nativeEvent.contentOffset.x / pageW);
      const clamped = Math.max(0, Math.min(offers.length - 1, next));
      if (clamped !== idx) setIdx(clamped);
    },
    [pageW, offers.length, idx]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<ResolvedOfferProgress> | null | undefined, index: number) => ({
      length: pageW,
      offset: pageW * index,
      index,
    }),
    [pageW]
  );

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  /**
   * Programmatically move to a target page via `scrollToOffset` — animates the FlatList the
   * same way a finished swipe does, so tap-driven and swipe-driven pagination are
   * indistinguishable visually. Wraps around at both ends (prev from 0 → last, next from
   * last → 0) so users don't hit a dead end.
   */
  const goToPage = useCallback(
    (next: number) => {
      if (offers.length <= 1 || pageW <= 0) return;
      const total = offers.length;
      const wrapped = ((next % total) + total) % total;
      setIdx(wrapped);
      try {
        listRef.current?.scrollToOffset({
          offset: wrapped * pageW,
          animated: true,
        });
      } catch {
        /* silent — listRef not ready yet */
      }
    },
    [offers.length, pageW]
  );

  const renderPage = useCallback(
    ({ item, index }: { item: ResolvedOfferProgress; index: number }) => {
      const c = item.campaignForCopy;
      const headline =
        (typeof c?.headline === 'string' && c.headline.trim()) ||
        (typeof c?.title === 'string' && c.title.trim()) ||
        (lines[index] ?? '').trim() ||
        'Offer';

      const showTrack = Boolean(sessionReady && item.threshold != null && !item.eligible);
      const sliceTotal = promotionProgressSegmentCount(item.threshold);
      const ratio = promotionProgressRatio(item.progress, item.rules);
      const filledSlices = showTrack ? promotionFilledSegments(ratio, item.threshold) : 0;
      const progressLabel = resolveOfferProgressLine({
        campaign: c,
        sessionReady,
        effective: item.effective,
        threshold: item.threshold,
        eligible: item.eligible,
      });

      return (
        <Pressable
          onPress={openModal}
          /**
           * `delayPressIn` hands the responder to the horizontal FlatList first. Without it,
           * Pressable claims the touch on the first finger-down and users have to swipe a
           * large distance before the scroll wins — which felt "sticky" on this taller profile
           * page. 120ms is long enough for the FlatList to detect a pan, short enough that
           * stationary taps still feel instant.
           */
          delayPressIn={120}
          style={[styles.page, { width: pageW }]}
          accessibilityRole="button"
          accessibilityLabel={`Open offer ${index + 1} details`}
          accessibilityHint="Swipe left or right to browse offers"
          android_ripple={{ color: 'rgba(15, 23, 42, 0.04)' }}
        >
          <Text style={styles.headline} numberOfLines={2}>
            {headline}
          </Text>

          {item.eligible ? (
            <View style={styles.unlockedRow}>
              <View style={styles.unlockedDot}>
                <Ionicons name="checkmark" size={11} color={COLORS.white} />
              </View>
              <Text style={styles.unlockedText} numberOfLines={1}>
                Goal reached — tap to redeem
              </Text>
            </View>
          ) : showTrack ? (
            <>
              <View style={styles.momentumRow}>
                <Text style={styles.momentumLabel}>Your momentum</Text>
                {progressLabel ? (
                  <Text style={styles.momentumFraction} numberOfLines={1}>
                    {progressLabel}
                  </Text>
                ) : null}
              </View>
              <View style={styles.segmentsRow} accessibilityRole="progressbar">
                {Array.from({ length: sliceTotal }).map((_, i) => (
                  <View
                    key={`seg-${i}`}
                    style={[styles.segment, i < filledSlices ? styles.segmentFilled : styles.segmentEmpty]}
                  />
                ))}
              </View>
            </>
          ) : !sessionReady ? (
            <Text style={styles.microLabel} numberOfLines={1}>
              Sign in to track your momentum
            </Text>
          ) : loadingMe ? (
            <Text style={styles.microLabel} numberOfLines={1}>
              Updating your momentum…
            </Text>
          ) : (
            <Text style={styles.microLabel} numberOfLines={1}>
              Your momentum builds as you complete trips
            </Text>
          )}
        </Pressable>
      );
    },
    [lines, sessionReady, loadingMe, pageW, openModal]
  );

  if (!offers.length) return null;

  return (
    <>
      <View style={styles.card}>
        {/*
         * HEADER — title + tiny counter + chevron. Pressable as a whole so "tap on the header"
         * always opens details, matching the page area below (consistent tap region).
         */}
        <Pressable
          onPress={openModal}
          style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
          accessibilityRole="button"
          accessibilityLabel="Open offers"
          android_ripple={{ color: 'rgba(15, 23, 42, 0.04)' }}
        >
          <View style={styles.iconWell}>
            <Ionicons name="gift" size={15} color={INDIGO_600} />
          </View>
          <Text style={styles.title} numberOfLines={1}>
            Offers
          </Text>
          {multi ? (
            <Text style={styles.counter} accessibilityLabel={`Offer ${idx + 1} of ${offers.length}`}>
              {idx + 1}
              <Text style={styles.counterDim}>{` / ${offers.length}`}</Text>
            </Text>
          ) : null}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={COLORS.textMuted}
            style={styles.chevron}
          />
        </Pressable>

        {/* SWIPE BODY — horizontal paged list, one offer per page */}
        <View onLayout={onListLayout} style={styles.listHost}>
          {pageW > 0 ? (
            <FlatList
              ref={listRef}
              data={offers}
              keyExtractor={keyExtractor}
              renderItem={renderPage}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={pageW}
              snapToAlignment="start"
              onMomentumScrollEnd={onScrollEnd}
              getItemLayout={getItemLayout}
              /**
               * Pre-render every offer page so horizontal swipes feel instantaneous.
               * Offer lists are always small (top ~3-5), so the memory cost is negligible and it
               * eliminates the one-frame stutter that made the first swipe feel sluggish.
               */
              initialNumToRender={Math.max(offers.length, 3)}
              windowSize={Math.max(offers.length, 3)}
              maxToRenderPerBatch={offers.length}
              scrollEventThrottle={16}
              removeClippedSubviews={false}
            />
          ) : null}
        </View>

        {/*
         * PAGER — explicit "<" and ">" buttons flanking the dots. Added because the swipe
         * gesture on this narrow card fights with the outer scroll view of the Profile screen
         * and feels sticky on some devices. The buttons guarantee a reliable tap-driven path
         * while the FlatList's horizontal swipe stays as a bonus affordance for anyone who
         * prefers it. `goToPage` wraps around at both ends.
         */}
        {multi ? (
          <View style={styles.pagerRow}>
            <Pressable
              onPress={() => goToPage(idx - 1)}
              hitSlop={10}
              style={({ pressed }) => [styles.pagerArrow, pressed && styles.pagerArrowPressed]}
              accessibilityRole="button"
              accessibilityLabel="Previous offer"
            >
              <Ionicons name="chevron-back" size={16} color={INDIGO_600} />
            </Pressable>

            <View style={styles.dots}>
              {offers.map((_, i) => (
                <Pressable
                  key={`dot-${i}`}
                  onPress={() => goToPage(i)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to offer ${i + 1} of ${offers.length}`}
                >
                  <View style={[styles.dot, i === idx && styles.dotActive]} />
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => goToPage(idx + 1)}
              hitSlop={10}
              style={({ pressed }) => [styles.pagerArrow, pressed && styles.pagerArrowPressed]}
              accessibilityRole="button"
              accessibilityLabel="Next offer"
            >
              <Ionicons name="chevron-forward" size={16} color={INDIGO_600} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <SearchOffersModal
        visible={modalOpen}
        onClose={closeModal}
        offers={offers}
        lines={lines}
        sessionReady={sessionReady}
        loadingMe={loadingMe}
        focusOfferIndex={idx}
        navigation={navigation}
      />
    </>
  );
}

/**
 * Visual language matches `styles.statsCard` / `styles.vehicleInfoCard` in Profile.tsx so the
 * Offers card reads as a first-class hero surface — not a visually-inset afterthought.
 * Key alignment choices:
 *   - `borderRadius: 24` (same as stats / vehicle cards).
 *   - NO own horizontal margin — the Profile ScrollView provides `paddingHorizontal: 20` and
 *     `gap: 14`, so the card slots directly into that 20pt grid alongside its siblings.
 *   - Heavier shadow (`shadowRadius: 20, shadowOffset y: 8`) to match the elevation tier of
 *     the other hero cards, so the rewards card has visual weight equal to the stats card
 *     rather than reading as a secondary / smaller tile.
 */
const CARD_RADIUS = 24;
const SEGMENT_H = 7;
const DOT = 5;

const styles = StyleSheet.create({
  card: {
    borderRadius: CARD_RADIUS,
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 20,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },

  /** HEADER ───────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerPressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.025)',
  },
  iconWell: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: INDIGO_100,
    borderWidth: 1,
    borderColor: INDIGO_200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  counter: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  counterDim: {
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  chevron: {
    marginLeft: 2,
    marginRight: -2,
  },

  /** LIST / PAGES ─────────────────────────────── */
  listHost: {
    alignSelf: 'stretch',
  },
  page: {
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 14,
  },
  headline: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.2,
    marginBottom: 12,
  },

  /** PROGRESS ────────────────────────────────── */
  /**
   * Momentum label row — small uppercase "Your momentum" on the left with the fraction
   * ("3 of 5 rides") right-aligned. Gives the bar beneath it a clear, human caption without
   * stacking two separate lines of text the way the old card did.
   */
  momentumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  momentumLabel: {
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: INDIGO_600,
    textTransform: 'uppercase',
  },
  momentumFraction: {
    flexShrink: 1,
    marginLeft: 10,
    fontSize: 11.5,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.05,
    textAlign: 'right',
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    height: SEGMENT_H,
    borderRadius: SEGMENT_H / 2,
    minWidth: 3,
  },
  segmentFilled: {
    backgroundColor: COLORS.primary,
  },
  segmentEmpty: {
    backgroundColor: SEG_EMPTY,
  },
  microLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: -0.05,
  },

  /** UNLOCKED ────────────────────────────────── */
  unlockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  unlockedDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockedText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.1,
  },

  /** PAGER ROW — arrows + dots, centered at the bottom of the card. */
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 2,
    paddingBottom: 14,
  },
  pagerArrow: {
    width: 26,
    height: 26,
    borderRadius: 13,
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

  /** DOTS ────────────────────────────────────── */
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 2,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
  },
  dotActive: {
    width: DOT * 3,
    backgroundColor: INDIGO_600,
  },
});
