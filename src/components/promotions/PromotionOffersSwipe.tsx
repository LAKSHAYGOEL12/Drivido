import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent, NativeSyntheticEvent } from 'react-native';
import {
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
} from 'react-native';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { resolveOfferProgressLine, type ResolvedOfferProgress } from '../../utils/promotionOfferCopy';
import {
  promotionFilledSegments,
  promotionProgressRatio,
  promotionProgressSegmentCount,
} from '../../utils/promotionProgressDisplay';

type Variant = 'search' | 'profile';

type LayoutMode = 'bodyOnly' | 'fullCardSearch';

type Props = {
  offers: ResolvedOfferProgress[];
  lines: string[];
  sessionReady: boolean;
  loadingMe: boolean;
  variant: Variant;
  /** Fires when user lands on a page (swipe). */
  onPageChange?: (index: number) => void;
  /** Search: each page is header + divider + body so the whole card swipes; shows `i / n` in the header row. */
  layoutMode?: LayoutMode;
  /** When `layoutMode` is `fullCardSearch`, opens the offers modal (whole card when set; chevron still pages). */
  onHeaderPress?: () => void;
  /** When false, hide dots + bottom `1 / n` (e.g. parent shows count beside “Offers”). */
  showFooterIndicator?: boolean;
  /** Profile: parent renders the primary offer line under “Offers”; hide duplicate body headline here. */
  headlineInParent?: boolean;
  /** Profile: show pill momentum segments + count (engagement; parent often passes with `headlineInParent`). */
  showProfileMomentum?: boolean;
  /**
   * Profile: render this **inside** each horizontal page above momentum so status, copy, and bar swipe together.
   */
  profilePageLead?: (offer: ResolvedOfferProgress, index: number) => ReactNode;
  /** Search page compact mode: keeps offer card informative but visually lighter. */
  compactSearch?: boolean;
};

export default function PromotionOffersSwipe({
  offers,
  lines,
  sessionReady,
  loadingMe,
  variant,
  onPageChange,
  layoutMode = 'bodyOnly',
  onHeaderPress,
  showFooterIndicator,
  headlineInParent = false,
  showProfileMomentum = false,
  profilePageLead,
  compactSearch = false,
}: Props): React.JSX.Element | null {
  /** Non-zero default so pager renders before onLayout (avoids empty card if layout is late). */
  const [pageWidth, setPageWidth] = useState(() => {
    try {
      /** Card uses `marginHorizontal: 16` on Search — match viewport so paging aligns before onLayout. */
      return Math.max(200, Dimensions.get('window').width - 32);
    } catch {
      return 320;
    }
  });
  const [pageIndex, setPageIndex] = useState(0);
  const scrollRef = useRef<React.ElementRef<typeof GHScrollView>>(null);
  const slugKey = offers.map((o) => String(o.campaignForCopy?.slug ?? '')).join('\0');

  useEffect(() => {
    setPageIndex(0);
    onPageChange?.(0);
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [slugKey, onPageChange]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setPageWidth(w);
  }, []);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const w = e.nativeEvent.layoutMeasurement.width;
      if (w <= 0) return;
      const x = e.nativeEvent.contentOffset.x;
      const next = Math.min(offers.length - 1, Math.max(0, Math.round(x / w)));
      setPageIndex(next);
      onPageChange?.(next);
    },
    [offers.length, onPageChange]
  );

  const scrollToOfferIndex = useCallback(
    (target: number) => {
      if (offers.length < 2) return;
      const i = Math.min(offers.length - 1, Math.max(0, target));
      const w = pageWidth;
      if (w <= 0) return;
      scrollRef.current?.scrollTo({ x: i * w, animated: true });
      setPageIndex(i);
      onPageChange?.(i);
    },
    [offers.length, pageWidth, onPageChange]
  );

  const footerOn =
    showFooterIndicator !== false && offers.length > 1 && layoutMode === 'bodyOnly';
  const fullCard = layoutMode === 'fullCardSearch' && variant === 'search';
  const compactSearchCard = fullCard && compactSearch;
  const multi = offers.length > 1;
  const showSwipeDots = multi && !footerOn;
  const innerLift = fullCard || (variant === 'profile' && multi);
  const profileChromePack = variant === 'profile' && typeof profilePageLead === 'function';

  const v = useMemo(
    () =>
      variant === 'search'
        ? {
            bodyPad: styles.searchBodyPad,
            line: styles.searchLine,
            progressPad: styles.searchProgressPad,
            segH: 3,
            segGap: 3,
            segRadius: 2,
            progressLabel: styles.searchProgressLabel,
            pill: styles.searchPill,
            dot: styles.searchDot,
            dotActive: styles.searchDotActive,
          }
        : {
            bodyPad: styles.profileBodyPad,
            line: styles.profileLine,
            progressPad: styles.profileProgressPad,
            segH: 5,
            segGap: 4,
            segRadius: 999,
            progressLabel: styles.profileProgressLabel,
            pill: styles.profilePill,
            dot: styles.profileDot,
            dotActive: styles.profileDotActive,
          },
    [variant]
  );

  if (!offers.length || !lines.length) return null;

  return (
    <View style={styles.root}>
      <GHScrollView
          style={styles.hScroll}
          ref={scrollRef}
          onLayout={onLayout}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          bounces={multi}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          directionalLockEnabled
          onMomentumScrollEnd={onMomentumEnd}
          onScroll={(e) => {
            const w = pageWidth;
            if (w <= 0 || offers.length < 2) return;
            const x = e.nativeEvent.contentOffset.x;
            const next = Math.min(offers.length - 1, Math.max(0, Math.round(x / w)));
            if (next !== pageIndex) setPageIndex(next);
          }}
          scrollEventThrottle={32}
          accessibilityLabel={`Offers, ${pageIndex + 1} of ${offers.length}`}
        >
          {offers.map((o, idx) => {
            const rowLine = lines[idx] ?? '';
            const sliceTotal = promotionProgressSegmentCount(o.threshold);
            const ratio = promotionProgressRatio(o.progress, o.rules);
            /** Filled segments for the bar: full when eligible so the “momentum” read completes visually. */
            const filledForBar =
              o.threshold == null ? 0 : o.eligible ? sliceTotal : promotionFilledSegments(ratio, o.threshold);
            const progressLabel = resolveOfferProgressLine({
              campaign: o.campaignForCopy,
              sessionReady,
              effective: o.effective,
              threshold: o.threshold,
              eligible: o.eligible,
            });
            const unlockedLabel = String(o.campaignForCopy?.reward?.title ?? '').trim() || 'Reward unlocked';
            const offerHeadline =
              (typeof o.campaignForCopy?.headline === 'string' && o.campaignForCopy.headline.trim()) ||
              (typeof o.campaignForCopy?.reward?.title === 'string' && o.campaignForCopy.reward.title.trim()) ||
              rowLine;
            const compactStatusLine =
              !sessionReady
                ? 'Sign in to track progress'
                : loadingMe
                  ? 'Syncing your progress...'
                  : o.eligible
                    ? unlockedLabel
                    : progressLabel || 'Progress updates after completed rides';

            const showPrimaryHeadline =
              !headlineInParent ||
              variant !== 'profile' ||
              (loadingMe && sessionReady && idx === 0);
            const compactProfileBody =
              headlineInParent &&
              variant === 'profile' &&
              !(loadingMe && sessionReady && idx === 0);
            /** Hide bar on search full card and on profile unless `showProfileMomentum`. */
            const hideInlineProgress = (variant === 'profile' && !showProfileMomentum) || fullCard;

            const bodyAndProgress = (
              <>
                {showPrimaryHeadline ? (
                  <View style={[v.bodyPad, compactSearchCard ? styles.searchBodyPadCompact : null]}>
                    <Text
                      style={[styles.offerHeadline, variant === 'search' ? styles.offerHeadlineSearch : null]}
                      numberOfLines={compactSearchCard ? 1 : 2}
                    >
                      {loadingMe && sessionReady && idx === 0 ? 'Syncing your offer progress...' : offerHeadline}
                    </Text>
                    {!compactSearchCard ? (
                      <Text
                        style={[
                          v.line,
                          loadingMe && sessionReady && idx === 0
                            ? styles.offerLineSyncing
                            : styles.offerLineAccent,
                        ]}
                        numberOfLines={variant === 'search' ? 2 : 5}
                      >
                        {loadingMe && sessionReady && idx === 0 ? 'Syncing your offer progress…' : rowLine}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {fullCard ? (
                  <View style={[styles.fullCardStatusRow, compactSearchCard ? styles.fullCardStatusRowCompact : null]}>
                    <Ionicons
                      name={o.eligible ? 'checkmark-circle' : 'trending-up'}
                      size={14}
                      color={o.eligible ? COLORS.primary : COLORS.secondary}
                    />
                    <Text
                      style={[
                        styles.fullCardStatusText,
                        compactSearchCard ? styles.fullCardStatusTextCompact : null,
                        o.eligible ? styles.fullCardStatusEligible : null,
                      ]}
                      numberOfLines={1}
                    >
                      {compactStatusLine}
                    </Text>
                  </View>
                ) : null}
                {sessionReady && !loadingMe ? (
                  <>
                    {o.eligible ? (
                      <View
                        style={[
                          styles.unlockedRow,
                          variant === 'profile' && styles.unlockedRowProfile,
                          compactProfileBody && styles.unlockedRowTightTop,
                        ]}
                      >
                        <Ionicons name="checkmark-circle" size={15} color={COLORS.error} />
                        <Text style={styles.unlockedText}>{unlockedLabel}</Text>
                      </View>
                    ) : null}
                    {!hideInlineProgress && o.threshold != null ? (
                      <>
                        {showProfileMomentum && variant === 'profile' ? (
                          <View
                            style={[
                              styles.profileMomentumIntro,
                              compactProfileBody && styles.profileMomentumIntroTight,
                            ]}
                          >
                            <Ionicons
                              name={o.eligible ? 'trophy' : 'pulse'}
                              size={15}
                              color={o.eligible ? COLORS.warning : COLORS.primary}
                            />
                            <Text style={styles.profileMomentumIntroText}>
                              {o.eligible ? 'Goal reached' : 'Your momentum'}
                            </Text>
                          </View>
                        ) : null}
                        <View
                          style={[
                            v.progressPad,
                            {
                              marginTop:
                                showProfileMomentum && variant === 'profile' ? 2 : compactProfileBody ? 4 : 6,
                            },
                          ]}
                        >
                          <View
                            style={[styles.segmentsRow, { gap: v.segGap }]}
                            accessibilityRole="progressbar"
                            accessibilityValue={{
                              now: filledForBar,
                              min: 0,
                              max: sliceTotal,
                            }}
                          >
                            {Array.from({ length: sliceTotal }).map((_, i) => (
                              <View
                                key={`seg-${idx}-${i}`}
                                style={[
                                  styles.segment,
                                  {
                                    height: v.segH,
                                    borderRadius: v.segRadius,
                                    minWidth: 3,
                                  },
                                  i < filledForBar
                                    ? styles.segmentFilled
                                    : styles.segmentEmpty,
                                  i >= filledForBar &&
                                  showProfileMomentum &&
                                  variant === 'profile'
                                    ? styles.segmentEmptyProfile
                                    : null,
                                ]}
                              />
                            ))}
                          </View>
                        </View>
                        {progressLabel ? (
                          <Text
                            style={[
                              v.progressLabel,
                              showProfileMomentum && variant === 'profile' && styles.profileMomentumCount,
                            ]}
                          >
                            {progressLabel}
                          </Text>
                        ) : o.eligible && showProfileMomentum && variant === 'profile' ? (
                          <Text style={[v.progressLabel, styles.profileMomentumCount]}>
                            {`${o.effective} of ${o.threshold ?? 0} — reward ready`}
                          </Text>
                        ) : null}
                      </>
                    ) : !hideInlineProgress && o.threshold == null && !o.eligible ? (
                      <Text style={styles.fallbackMuted}>
                        Your progress appears here after completed trips.
                      </Text>
                    ) : null}
                  </>
                ) : null}
                {fullCard && !compactSearchCard ? (
                  <View style={styles.fullCardCtaHintRow}>
                    <Ionicons name="information-circle-outline" size={14} color={COLORS.textSecondary} />
                    <Text style={styles.fullCardCtaHintText}>Open details to choose your next step</Text>
                  </View>
                ) : null}
              </>
            );

            const cardPressOpensModal = Boolean(fullCard && onHeaderPress);
            const searchHeaderInner = (
              <>
                <View style={[styles.searchIconWrap, compactSearchCard ? styles.searchIconWrapCompact : null]}>
                  <Ionicons name="sparkles" size={compactSearchCard ? 12 : 14} color={COLORS.secondary} />
                </View>
                <Text style={styles.searchHeaderTitle}>Offers</Text>
                {multi && !compactSearchCard ? (
                  <Text style={styles.searchHeaderPageCount}>
                    {idx + 1} / {offers.length}
                  </Text>
                ) : null}
                <View style={styles.searchHeaderSpacer} />
              </>
            );
            const searchHeaderMainEl =
              !cardPressOpensModal && onHeaderPress ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.searchCardHeaderMain,
                    compactSearchCard ? styles.searchCardHeaderMainCompact : null,
                    pressed && styles.searchCardHeaderPressed,
                  ]}
                  onPress={onHeaderPress}
                  accessibilityRole="button"
                  accessibilityLabel={`Offers, ${idx + 1} of ${offers.length}`}
                  accessibilityHint="Opens tips for finding and publishing rides"
                >
                  {searchHeaderInner}
                </Pressable>
              ) : (
                <View
                  style={[styles.searchCardHeaderMain, compactSearchCard ? styles.searchCardHeaderMainCompact : null]}
                  accessibilityRole={cardPressOpensModal ? 'none' : 'header'}
                >
                  {searchHeaderInner}
                </View>
              );

            const innerLifted = (
              <>
                {fullCard ? (
                  <>
                    <View style={[styles.searchCardHeader, compactSearchCard ? styles.searchCardHeaderCompact : null]}>
                      {searchHeaderMainEl}
                      {multi ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.searchCardChevronBtn,
                            pressed && styles.searchCardChevronBtnPressed,
                          ]}
                          onPress={() =>
                            scrollToOfferIndex(idx < offers.length - 1 ? idx + 1 : idx - 1)
                          }
                          accessibilityRole="button"
                          accessibilityLabel={
                            idx < offers.length - 1 ? 'Next offer' : 'Previous offer'
                          }
                          accessibilityHint="Switches between offers"
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          {...Platform.select({
                            android: {
                              android_ripple: {
                                color: COLORS.primaryRipple,
                                borderless: true,
                                radius: 22,
                              },
                            },
                            default: {},
                          })}
                        >
                          <Ionicons
                            name={idx < offers.length - 1 ? 'chevron-forward' : 'chevron-back'}
                            size={18}
                            color={COLORS.warning}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={[styles.searchFullCardDivider, compactSearchCard ? styles.searchFullCardDividerCompact : null]} />
                  </>
                ) : null}
                {/** Profile + `headlineInParent`: parent shows page count; inner chevron row looked empty / redundant. Swipe still changes offers. */}
                {variant === 'profile' && multi && !headlineInParent ? (
                  <View style={styles.profilePagerChevronRow}>
                    <View style={styles.profilePagerChevronSpacer} />
                    <Pressable
                      style={({ pressed }) => [
                        styles.searchCardChevronBtn,
                        pressed && styles.searchCardChevronBtnPressed,
                      ]}
                      onPress={() =>
                        scrollToOfferIndex(idx < offers.length - 1 ? idx + 1 : idx - 1)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={
                        idx < offers.length - 1 ? 'Next offer' : 'Previous offer'
                      }
                      accessibilityHint="Switches between offers"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      {...Platform.select({
                        android: {
                          android_ripple: {
                            color: COLORS.primaryRipple,
                            borderless: true,
                            radius: 22,
                          },
                        },
                        default: {},
                      })}
                    >
                      <Ionicons
                        name={idx < offers.length - 1 ? 'chevron-forward' : 'chevron-back'}
                        size={18}
                        color={variant === 'profile' ? COLORS.primaryDark : COLORS.warning}
                      />
                    </Pressable>
                  </View>
                ) : null}
                {bodyAndProgress}
              </>
            );

            return (
              <View
                key={`offer-page-${String(o.campaignForCopy?.slug ?? idx)}`}
                style={[
                  styles.page,
                  { width: pageWidth },
                  fullCard ? styles.pageFullCardSearch : null,
                  compactSearchCard ? styles.pageFullCardSearchCompact : null,
                ]}
              >
                {profileChromePack ? (
                  <View
                    style={[
                      styles.pageInner,
                      variant === 'profile' && styles.pageInnerProfile,
                    ]}
                  >
                    <View style={styles.profilePageLeadWrap}>{profilePageLead(o, idx)}</View>
                    {innerLift ? innerLifted : bodyAndProgress}
                  </View>
                ) : innerLift ? (
                  <View
                    style={[
                      styles.pageInner,
                      fullCard ? styles.pageInnerSearch : null,
                      variant === 'profile' && multi ? styles.pageInnerProfile : null,
                    ]}
                  >
                    {cardPressOpensModal ? (
                      <Pressable
                        style={styles.fullCardPressable}
                        onPress={onHeaderPress}
                        accessibilityRole="button"
                        accessibilityLabel={`Offers, ${idx + 1} of ${offers.length}`}
                        accessibilityHint="Opens tips for finding and publishing rides"
                        {...Platform.select({
                          android: {
                            android_ripple: { color: COLORS.primaryRipple },
                          },
                          default: {},
                        })}
                      >
                        {innerLifted}
                      </Pressable>
                    ) : (
                      innerLifted
                    )}
                  </View>
                ) : (
                  bodyAndProgress
                )}
              </View>
            );
          })}
        </GHScrollView>
      {showSwipeDots ? (
        <View style={styles.swipeDotsWrap} accessibilityLabel={`Page ${pageIndex + 1} of ${offers.length}`}>
          {offers.map((o, i) => (
            <View
              key={`swipe-dot-${String(o.campaignForCopy?.slug ?? i)}`}
              style={[styles.swipeDot, i === pageIndex ? styles.swipeDotActive : null]}
            />
          ))}
        </View>
      ) : null}
      {footerOn ? (
        <View style={styles.metaRow}>
          <View style={styles.dotsRow}>
            {offers.map((o, i) => (
              <View
                key={`dot-${String(o.campaignForCopy?.slug ?? i)}`}
                style={[v.dot, i === pageIndex ? v.dotActive : null]}
              />
            ))}
          </View>
          <Text style={v.pill} accessibilityLiveRegion="polite">
            {pageIndex + 1} / {offers.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
  hScroll: {
    width: '100%',
  },
  page: {
    flexShrink: 0,
    paddingHorizontal: 2,
  },
  pageFullCardSearch: {
    minHeight: 84,
    paddingBottom: 0,
  },
  pageFullCardSearchCompact: {
    minHeight: 54,
  },
  pageInner: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  pageInnerSearch: {
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.tabBarPillBorder,
    overflow: 'visible',
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
      default: {},
    }),
  },
  pageInnerProfile: {
    backgroundColor: COLORS.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 0,
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 6,
  },
  profilePageLeadWrap: {
    marginBottom: 4,
  },
  searchCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  searchCardHeaderCompact: {
    paddingVertical: 1,
  },
  searchCardHeaderMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
  },
  searchCardHeaderMainCompact: {
    minHeight: 21,
  },
  searchCardChevronBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 2,
  },
  searchCardChevronBtnPressed: {
    opacity: 0.75,
  },
  searchCardHeaderPressed: {
    opacity: 0.75,
  },
  profilePagerChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 2,
    paddingHorizontal: 0,
  },
  profilePagerChevronSpacer: {
    flex: 1,
  },
  searchIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIconWrapCompact: {
    width: 20,
    height: 20,
    borderRadius: 6,
  },
  searchHeaderTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.warning,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  searchHeaderPageCount: {
    marginLeft: 2,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.error,
    letterSpacing: 0.2,
  },
  searchHeaderSpacer: {
    flex: 1,
  },
  searchFullCardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: 10,
  },
  searchFullCardDividerCompact: {
    marginHorizontal: 8,
  },
  searchBodyPad: {
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 4,
  },
  searchBodyPadCompact: {
    paddingTop: 1,
    paddingBottom: 1,
  },
  profileMomentumIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 2,
  },
  profileMomentumIntroTight: {
    marginTop: 2,
  },
  profileMomentumIntroText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: -0.12,
  },
  segmentEmptyProfile: {
    backgroundColor: 'rgba(29, 185, 84, 0.1)',
  },
  profileMomentumCount: {
    color: COLORS.primaryDark,
  },
  profileBodyPad: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  offerLineAccent: {
    color: COLORS.secondary,
    fontWeight: '600',
  },
  offerLineSyncing: {
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  offerHeadline: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.2,
    color: COLORS.text,
    fontWeight: '800',
    marginBottom: 3,
  },
  offerHeadlineSearch: {
    fontSize: 15,
    lineHeight: 21,
  },
  searchLine: {
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: -0.15,
  },
  profileLine: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.15,
  },
  searchProgressPad: {
    paddingHorizontal: 10,
    paddingBottom: 4,
  },
  profileProgressPad: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  segmentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  segment: {
    flex: 1,
  },
  segmentEmpty: {
    backgroundColor: 'rgba(15, 23, 42, 0.07)',
  },
  segmentFilled: {
    backgroundColor: COLORS.primary,
  },
  searchProgressLabel: {
    marginTop: 5,
    marginHorizontal: 10,
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.error,
    letterSpacing: -0.1,
  },
  profileProgressLabel: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.error,
    letterSpacing: -0.1,
  },
  unlockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 10,
  },
  unlockedRowProfile: {
    paddingHorizontal: 0,
  },
  unlockedRowTightTop: {
    marginTop: 2,
  },
  unlockedText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.warning,
  },
  fullCardPressable: {
    alignSelf: 'stretch',
    flexGrow: 1,
  },
  fullCardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 10,
    marginBottom: 2,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
  },
  fullCardStatusRowCompact: {
    marginHorizontal: 8,
    marginBottom: 5,
    paddingVertical: 3,
  },
  fullCardStatusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  fullCardStatusTextCompact: {
    fontSize: 11,
  },
  fullCardStatusEligible: {
    color: COLORS.primaryDark,
  },
  fullCardCtaHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginHorizontal: 10,
    marginTop: 5,
    marginBottom: 8,
  },
  fullCardCtaHintText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  fallbackMuted: {
    marginTop: 6,
    marginHorizontal: 10,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  fallbackMutedProfile: {
    marginHorizontal: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 2,
    paddingBottom: 2,
    paddingHorizontal: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  searchDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(15, 23, 42, 0.1)',
  },
  searchDotActive: {
    width: 16,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  profileDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
  },
  profileDotActive: {
    width: 16,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  searchPill: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.2,
  },
  profilePill: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.2,
  },
  swipeDotsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 2,
    paddingBottom: 0,
  },
  swipeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
  },
  swipeDotActive: {
    width: 18,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
});
