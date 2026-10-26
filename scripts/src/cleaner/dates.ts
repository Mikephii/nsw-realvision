/**
 * Parse CCYYMMDD date strings from .DAT files into Date objects.
 */

/**
 * Earliest valid year for NSW Valuer General property sales data.
 *
 * The VG dataset begins in 1990 (archived format). Dates with years before
 * this are corrupt data entries — actual examples found in the data include
 * year 201, 222, and 1024 (likely truncated or malformed CCYYMMDD strings).
 * These are rejected at parse time and preserved in `contract_date_raw`.
 */
export const DATE_YEAR_MIN = 1990

/**
 * Parse a date string in CCYYMMDD format (e.g. "20241022") to a Date object.
 * Returns null for empty strings or invalid dates.
 *
 * Year range validation: rejects years before {@link DATE_YEAR_MIN} (1990,
 * when the VG dataset begins) and years more than 1 beyond the current year
 * (to allow settlement dates that cross a calendar year boundary).
 */
export function parseCCYYMMDD(s: string): Date | null {
  if (!s || s.trim() === '') return null

  const trimmed = s.trim()
  if (trimmed.length !== 8) return null

  const year = parseInt(trimmed.slice(0, 4), 10)
  const month = parseInt(trimmed.slice(4, 6), 10)
  const day = parseInt(trimmed.slice(6, 8), 10)

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null

  // NSW VG data starts in 1990. Years before this are corrupt entries
  // (e.g. year 201, 222, 1024). Allow currentYear + 1 for settlement
  // dates that cross a calendar year boundary.
  if (year < DATE_YEAR_MIN || year > new Date().getFullYear() + 1) return null

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  // Use UTC to avoid timezone issues
  const date = new Date(Date.UTC(year, month - 1, day))

  // Verify the date didn't roll over (e.g. Feb 30 → Mar 2)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}
