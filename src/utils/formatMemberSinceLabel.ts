/** "Jan 2024" style for profile "Since" — returns em dash when missing or invalid. */
export function formatMemberSinceLabel(iso: string | undefined | null): string {
  const raw = typeof iso === 'string' ? iso.trim() : '';
  if (!raw) return '—';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
