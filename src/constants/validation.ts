/**
 * Validation rules and regexes (password, email, profile fields, etc.)
 */

/** Simple email */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ISO date YYYY-MM-DD */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;

export type GenderValue = (typeof GENDER_OPTIONS)[number]['value'];

/**
 * Identity verification documents.
 *
 * - `aadhaar` — Indian 12-digit national ID.
 * - `pan` — Indian 10-char tax ID.
 * - `driver_license` — 7–20 alphanumeric.
 * - `other` — fallback for passport / voter ID / foreign national ID. The
 *   number is validated permissively and the admin verifies the actual
 *   document kind from the uploaded photo during manual review.
 */
export const IDENTITY_DOCUMENT_OPTIONS = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'driver_license', label: 'Driver License' },
  { value: 'other', label: 'Other' },
] as const;

export type IdentityDocumentValue = (typeof IDENTITY_DOCUMENT_OPTIONS)[number]['value'];

const AADHAAR_REGEX = /^\d{12}$/;
const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;
const DRIVER_LICENSE_REGEX = /^[A-Z0-9]{7,20}$/;
/**
 * Permissive — accepts any uppercase alphanumeric 5–30 chars. Covers Indian
 * passports (1 letter + 7 digits), US/UK passports (9 digits), voter IDs, and
 * most foreign national IDs. Authoritative verification still happens from
 * the uploaded photo on the backend.
 */
const OTHER_DOCUMENT_REGEX = /^[A-Z0-9]{5,30}$/;

/** Strip spaces / dashes from user input for identity number storage + validation. */
export function normalizeIdentityNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Normalize phone to 10 digits (strip all non-digits, remove leading 91 or 0).
 * Kept for legacy profiles / display.
 */
export function normalizePhoneForValidation(value: string): string {
  return value.replace(/\D/g, '').replace(/^91(?=\d{10})/, '').replace(/^0+/, '').slice(-10);
}

/**
 * Input for +91 national field: digits only, max 10. If user pastes `91` + 10 digits, strips `91`.
 */
export function clampPhoneNationalInput(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('91') && d.length > 10) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d.slice(0, 10);
}

function ageYearsFromIsoDate(isoDate: string): number {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return NaN;
  const now = new Date();
  let years = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) years -= 1;
  return years;
}

export const validation = {
  email: (value: string): boolean => EMAIL_REGEX.test(value.trim()),

  /** Min 8 chars, at least one letter and one number */
  password: (value: string): boolean =>
    value.length >= 8 && /[a-zA-Z]/.test(value) && /\d/.test(value),

  name: (value: string): boolean => value.trim().length >= 2 && value.length <= 100,

  /** YYYY-MM-DD; must be valid, not future, age 13–120 */
  dateOfBirth: (value: string): boolean => {
    const t = value.trim();
    if (!ISO_DATE_REGEX.test(t)) return false;
    const [y, mo, da] = t.split('-').map((n) => Number(n));
    const d = new Date(Date.UTC(y, mo - 1, da));
    if (
      d.getUTCFullYear() !== y ||
      d.getUTCMonth() !== mo - 1 ||
      d.getUTCDate() !== da
    ) {
      return false;
    }
    const now = new Date();
    if (d.getTime() > now.getTime()) return false;
    const age = ageYearsFromIsoDate(t);
    return age >= 13 && age <= 120;
  },

  gender: (value: string): value is GenderValue =>
    GENDER_OPTIONS.some((g) => g.value === value),

  otp: (value: string, length = 6): boolean =>
    new RegExp(`^\\d{${length}}$`).test(value),

  /** Exactly 10 national digits (same rules as {@link clampPhoneNationalInput}). */
  phoneNational: (value: string): boolean => /^\d{10}$/.test(clampPhoneNationalInput(value)),

  /** Public profile tagline / about text (optional). */
  profileBio: (value: string): boolean => value.trim().length <= 300,

  /** Optional ride notes from publisher (POST /rides `description`). */
  rideDescription: (value: string): boolean => value.trim().length <= 500,

  /** Identity number — format depends on the chosen document type. */
  identityNumber: (value: string, type: IdentityDocumentValue): boolean => {
    const v = normalizeIdentityNumber(value);
    if (type === 'aadhaar') return AADHAAR_REGEX.test(v);
    if (type === 'pan') return PAN_REGEX.test(v);
    if (type === 'driver_license') return DRIVER_LICENSE_REGEX.test(v);
    if (type === 'other') return OTHER_DOCUMENT_REGEX.test(v);
    return false;
  },

  /**
   * User-supplied label that names the document when `type === 'other'`
   * (e.g., "Passport", "Voter ID"). Required only for the `other` flow;
   * surfaced to the reviewing admin alongside the photo and number.
   */
  identityLabel: (value: string): boolean => {
    const t = value.trim();
    if (t.length < 2 || t.length > 40) return false;
    return /^[A-Za-z0-9 ()\-/&.]+$/.test(t);
  },
} as const;

export const validationErrors = {
  email: 'Enter a valid email address',
  password: 'Password must be 8+ characters with at least one letter and one number',
  name: 'Name must be 2–100 characters',
  dateOfBirth: 'Enter date of birth as YYYY-MM-DD (you must be at least 13)',
  gender: 'Select a gender option',
  phone: 'Enter a valid 10-digit mobile number',
  otp: (length: number) => `Enter ${length} digit OTP`,
  profileBio: 'Description must be 300 characters or less',
  rideDescription: 'Ride description must be 500 characters or less',
  identityAadhaar: 'Enter a 12-digit Aadhaar number',
  identityPan: 'Enter a valid PAN (e.g., ABCDE1234F)',
  identityDriverLicense: 'Enter a valid Driver License number',
  identityOther: 'Enter a valid document number (5–30 letters or digits)',
  identityLabel: 'Enter the document name (e.g., Passport)',
  identityIncomplete: 'Select a document type and enter its number',
} as const;
