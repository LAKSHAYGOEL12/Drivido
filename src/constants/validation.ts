/**
 * Validation rules and regexes (phone, password, etc.)
 */

/** Indian mobile: 10 digits, optional +91 / 0 prefix */
export const PHONE_REGEX = /^(\+91|0)?[6-9]\d{9}$/;

/** Strip non-digits for phone comparison */
export const PHONE_DIGITS_ONLY = /\D/g;

/** Simple email */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize phone to 10 digits (strip all non-digits, remove leading 91 or 0).
 */
export function normalizePhoneForValidation(value: string): string {
  return value.replace(/\D/g, '').replace(/^91(?=\d{10})/, '').replace(/^0+/, '').slice(-10);
}

export const validation = {
  /** Accepts any format: 9876543210, +91 98765 43210, 09876543210, spaces/dashes, etc. */
  phone: (value: string): boolean => {
    const digits = normalizePhoneForValidation(value);
    return digits.length === 10 && /^[6-9]/.test(digits);
  },

  email: (value: string): boolean => EMAIL_REGEX.test(value.trim()),

  /** Min 8 chars, at least one letter and one number */
  password: (value: string): boolean =>
    value.length >= 8 && /[a-zA-Z]/.test(value) && /\d/.test(value),

  name: (value: string): boolean => value.trim().length >= 2 && value.length <= 100,

  otp: (value: string, length = 6): boolean =>
    new RegExp(`^\\d{${length}}$`).test(value),
} as const;

export const validationErrors = {
  phone: 'Enter a valid 10-digit mobile number',
  email: 'Enter a valid email address',
  password: 'Password must be 8+ characters with at least one letter and one number',
  name: 'Name must be 2–100 characters',
  otp: (length: number) => `Enter ${length} digit OTP`,
} as const;
