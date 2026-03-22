/**
 * Validate Indian mobile number. "9999" → false, "9876543210" → true
 */
const PHONE_REGEX = /^(\+91|0)?[6-9]\d{9}$/;

export function validatePhone(value: string): boolean {
  const digits = value.replace(/\s/g, '');
  return PHONE_REGEX.test(digits);
}

/**
 * Normalize to 10 digits (strip +91, leading 0, spaces)
 */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '').replace(/^91(?=\d{10})/, '').replace(/^0+/, '').slice(-10);
}
