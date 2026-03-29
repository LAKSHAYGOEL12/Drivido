/** First letter/digit in a segment (skips leading punctuation). */
function firstSignificantChar(segment: string): string {
  const t = segment.trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (/[a-zA-Z0-9]/.test(c)) return c;
  }
  return '';
}

/**
 * Display initials when a profile has no photo: "John Doe" → "JD", "Ada" → "A", "" → "?".
 */
export function avatarInitialsFromName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '?';
  const parts = cleaned.split(' ').filter((p) => p.length > 0);
  if (parts.length >= 2) {
    const a = firstSignificantChar(parts[0]);
    const b = firstSignificantChar(parts[parts.length - 1]);
    if (a && b) return `${a}${b}`.toUpperCase();
    const one = a || b;
    return one ? one.toUpperCase() : '?';
  }
  const c = firstSignificantChar(parts[0]);
  return c ? c.toUpperCase() : '?';
}
