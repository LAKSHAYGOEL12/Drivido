/**
 * Format ISO date strings for display.
 */

/**
 * "2025-03-14T07:00:00Z" → "7:00 AM"
 */
export function formatTime(isoString: string, locale = 'en-IN'): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * "2025-03-14T07:00:00Z" → "14 Mar 2025"
 */
export function formatDate(isoString: string, locale = 'en-IN'): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * "2025-03-14T07:00:00Z" → "14 Mar 2025, 7:00 AM"
 */
export function formatDateTime(isoString: string, locale = 'en-IN'): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Relative time: "in 2 hours", "yesterday"
 */
export function formatRelative(isoString: string, base = new Date()): string {
  const date = new Date(isoString);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffMs = date.getTime() - base.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  if (Math.abs(diffDay) < 7) return rtf.format(diffDay, 'day');
  return formatDate(isoString);
}
