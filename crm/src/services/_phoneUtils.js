/**
 * Small helper: normalise Indian phone numbers to a 10-digit key
 * for comparison across various formats.
 *   '+91 98765 43210' → '9876543210'
 *   '9876543210'      → '9876543210'
 *   '91-98765-43210'  → '9876543210'
 */
function normalisePhoneKey(input) {
  if (!input) return '';
  const digits = String(input).replace(/\D/g, '');
  // Drop country code 91 if 12-digit
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  // Drop 0 prefix if 11-digit
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  // Last-10 fallback
  return digits.slice(-10);
}

module.exports = { normalisePhoneKey };
