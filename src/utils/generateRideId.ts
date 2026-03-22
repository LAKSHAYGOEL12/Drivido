/**
 * Generate a short, unique ride ID (e.g. for share links or display).
 */

const CHARS = '23456789abcdefghjkmnpqrstuvwxyz';
const LENGTH = 8;

function randomChar(): string {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}

/**
 * Unique short ID: 8 chars, URL-safe, lowercase. e.g. "k7m2x9pq"
 */
export function generateRideId(): string {
  let id = '';
  for (let i = 0; i < LENGTH; i++) {
    id += randomChar();
  }
  return id;
}

/**
 * Optional: include timestamp for sortability. "m2x9pq" + time suffix
 */
export function generateRideIdWithTime(): string {
  const timePart = Date.now().toString(36).slice(-4);
  const randomPart = Array.from({ length: 4 }, () => randomChar()).join('');
  return (randomPart + timePart).slice(0, LENGTH);
}
