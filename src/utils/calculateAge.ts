/**
 * Calculate age in years from a date of birth string (ISO 8601 format).
 * @param dateOfBirth - ISO 8601 date string (e.g., "1990-05-15")
 * @returns Age in years, or null if invalid
 */
export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth || typeof dateOfBirth !== 'string') {
    return null;
  }

  try {
    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) {
      return null;
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    // If birthday hasn't occurred this year yet, subtract 1
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age -= 1;
    }

    return age >= 0 ? age : null;
  } catch {
    return null;
  }
}
