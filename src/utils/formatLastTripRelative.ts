/** Human-readable relative time since last trip (for Trips / profile modals). */
export function formatLastTripRelative(atMs: number): string {
  if (!atMs) return '—';
  const diff = Date.now() - atMs;
  if (diff < 0) return '—';
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return years <= 1 ? 'Over a year ago' : `${years} years ago`;
}
