/**
 * Short BCP-47 primary language tag for `GET /promotions/campaigns|me?locale=…` (backend merges translations).
 */
export function promotionsLocaleTag(): string {
  try {
    const full = Intl.DateTimeFormat().resolvedOptions().locale || 'en';
    const base = full.split(/[-_]/)[0]?.toLowerCase().trim();
    if (base && /^[a-z]{2,10}$/i.test(base)) return base.toLowerCase();
  } catch {
    /* ignore */
  }
  return 'en';
}

export function promotionsLocaleSearchParams(): string {
  const t = promotionsLocaleTag();
  return `locale=${encodeURIComponent(t)}`;
}
