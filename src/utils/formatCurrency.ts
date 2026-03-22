/**
 * Format number as INR currency. 50 → "₹50", 1234 → "₹1,234"
 */
export function formatCurrency(
  amount: number,
  options: { showDecimals?: boolean; locale?: string } = {}
): string {
  const { showDecimals = false, locale = 'en-IN' } = options;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amount);
}
