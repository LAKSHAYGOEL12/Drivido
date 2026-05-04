/**
 * Production-standard helper that scrolls a focused field to a comfortable
 * position near the top of a ScrollView's visible area — exactly the pattern
 * `EditProfileScreen` uses for vehicle / phone fields, which has been the
 * one in the app that the user explicitly identified as "production
 * standard" for keyboard handling.
 *
 * Why so simple:
 *   - Earlier attempts tried to be smart (measure ScrollView height,
 *     subtract keyboard height, subtract footer height, only scroll on
 *     overlap). They kept failing because:
 *       a) `measureInWindow` on a ScrollView ref isn't a reliable host
 *          measurement on Android.
 *       b) Keyboard event timing on Android with `adjustResize` is
 *          inconsistent — sometimes height arrives as 0.
 *       c) Multiple coordinate systems made off-by-padding bugs easy.
 *   - Edit Profile sidesteps all of that by just measuring the focused
 *     anchor against an inner content view, then scrolling so it sits at
 *     `FOCUS_SCROLL_TOP_MARGIN` below the top of the visible scroll area.
 *     Simple, deterministic, works.
 *
 * Behavior:
 *   - On focus, the field is scrolled to ~`topMargin` (default 96) below
 *     the top of the visible scroll area.
 *   - If the field is already higher than that, `scrollTo` is clamped at 0
 *     and no visible motion occurs.
 *   - Three attempts (raf + 200ms + 420ms) handle the "onFocus fires
 *     before keyboard / before layout settles" race deterministically.
 */
import { ScrollView, View } from 'react-native';

/**
 * Default top margin in pixels — matches `FOCUS_SCROLL_TOP_MARGIN` in
 * EditProfileScreen. Keep in sync.
 */
const DEFAULT_TOP_MARGIN = 96;

export function bumpFieldAboveKeyboard(args: {
  scrollRef: React.RefObject<ScrollView | null>;
  anchorRef: React.RefObject<View | null>;
  /** Inner content View of the ScrollView; `measureLayout` is taken against it. */
  scrollContentRef: React.RefObject<View | null>;
  /** Pixels to leave between the top of the visible scroll area and the focused field. */
  topMargin?: number;
}): void {
  const { scrollRef, anchorRef, scrollContentRef, topMargin = DEFAULT_TOP_MARGIN } = args;
  const run = (): void => {
    const anchor = anchorRef.current;
    const content = scrollContentRef.current;
    const scroller = scrollRef.current;
    if (!anchor || !content || !scroller) return;
    anchor.measureLayout(
      content as unknown as number,
      (_x, y) => {
        if (typeof y !== 'number') return;
        scroller.scrollTo({
          y: Math.max(0, y - topMargin),
          animated: true,
        });
      },
      () => {
        /** measureLayout failure callback — ignore, no scroll. */
      }
    );
  };
  /**
   * Three attempts:
   *   - rAF: try as soon as the focus paint completes.
   *   - 200ms: covers the case where the keyboard hadn't shown yet on
   *     the first attempt (Android `keyboardDidShow` lags `onFocus`).
   *   - 420ms: final safety net for slower devices / longer keyboard
   *     animations. All attempts compute the same target so they're idempotent.
   */
  requestAnimationFrame(run);
  setTimeout(run, 200);
  setTimeout(run, 420);
}
