/**
 * Shorten long addresses for list rows — single-line friendly, predictable ellipsis.
 * Full strings stay in storage; only the row label is clipped.
 */
export function briefRouteListLabel(full: string, maxLen = 54): string {
  const t = full.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(1, maxLen - 1)).trimEnd()}\u2026`;
}
