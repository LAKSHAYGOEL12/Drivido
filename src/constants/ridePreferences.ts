/**
 * Driver / ride comfort preferences shown on profile (edit + public view).
 * IDs are the contract with PATCH `/user/update` and GET `/auth/me` / ratings `user` embed.
 * Legacy stored `pets_ok` is normalized to `no_pets`.
 */
export const RIDE_PREFERENCE_OPTIONS = [
  { id: 'no_smoking', label: 'No smoking', icon: 'ban-outline' as const },
  { id: 'no_alcohol', label: 'No alcohol', icon: 'water-outline' as const },
  { id: 'music_welcome', label: 'Music OK', icon: 'musical-notes-outline' as const },
  { id: 'quiet_ride', label: 'Quiet ride', icon: 'volume-mute-outline' as const },
  { id: 'no_pets', label: 'No pets', icon: 'paw-outline' as const },
  { id: 'ac_on', label: 'AC on', icon: 'snow-outline' as const },
  { id: 'happy_to_chat', label: 'Happy to chat', icon: 'chatbubbles-outline' as const },
] as const;

export type RidePreferenceId = (typeof RIDE_PREFERENCE_OPTIONS)[number]['id'];

const ID_ORDER = new Map(RIDE_PREFERENCE_OPTIONS.map((o, i) => [o.id, i]));

export const RIDE_PREFERENCE_ID_SET = new Set<string>(RIDE_PREFERENCE_OPTIONS.map((o) => o.id));

/** Max tags per profile (backend should enforce the same). */
export const RIDE_PREFERENCES_MAX_SELECTED = 12;

/** Legacy API / stored id — treated as {@link RIDE_PREFERENCE_OPTIONS} `no_pets`. */
const LEGACY_PETS_OK_ID = 'pets_ok';

/**
 * Sanitize API / persisted values: only known IDs, unique, stable order (definition order).
 * Maps legacy `pets_ok` → `no_pets`.
 */
export function normalizeRidePreferenceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    let id = x.trim();
    if (id === LEGACY_PETS_OK_ID) id = 'no_pets';
    if (!RIDE_PREFERENCE_ID_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  out.sort((a, b) => (ID_ORDER.get(a) ?? 99) - (ID_ORDER.get(b) ?? 99));
  return out.slice(0, RIDE_PREFERENCES_MAX_SELECTED);
}
