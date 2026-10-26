/**
 * Parse purchase price strings from .DAT files into numbers.
 */

/**
 * Parse a purchase price string to a number.
 * Returns null for empty strings or non-numeric values.
 * Returns the number as-is (including 0).
 */
export function parsePrice(s: string): number | null {
  if (!s || s.trim() === '') return null

  const num = Number(s.trim())
  if (isNaN(num)) return null

  return num
}

/**
 * Parse an area size string to a number.
 * Format in data: 7777777.333
 * Returns null for empty strings or non-numeric values.
 */
export function parseArea(s: string): number | null {
  if (!s || s.trim() === '') return null

  const num = Number(s.trim())
  if (isNaN(num)) return null
  if (num <= 0) return null

  return num
}

/**
 * Parse percent interest string to a number.
 * Empty or "0" means 100% interest (returns null to indicate full interest).
 */
export function parsePercentInterest(s: string): number | null {
  if (!s || s.trim() === '' || s.trim() === '0') return null

  const num = Number(s.trim())
  if (isNaN(num)) return null

  return num
}
