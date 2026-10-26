/**
 * Date extraction utilities for ZIP extraction.
 * Converts various date formats found in ZIP file/folder names to YYYYMMDD.
 */

/** Pattern: {district}_SALES_DATA_NNME_{DDMMYYYY}.DAT */
const DAT_DATE_PATTERN = /\d{3}_SALES_DATA_NNME_(\d{2})(\d{2})(\d{4})\.DAT$/i

/** Pattern: ARCHIVE_SALES_{YYYY}.DAT */
const ARCHIVE_YEAR_PATTERN = /ARCHIVE_SALES_(\d{4})\.DAT$/i

/**
 * Extract year from an ARCHIVE_SALES_YYYY.DAT filename.
 * Returns the year number or null if the filename doesn't match.
 */
export function yearFromArchiveFilename(filename: string): number | null {
  const match = filename.match(ARCHIVE_YEAR_PATTERN)
  if (!match) return null
  return parseInt(match[1], 10)
}

/**
 * Extract YYYYMMDD string and year from a standard DAT filename.
 * Input: "001_SALES_DATA_NNME_18042005.DAT" → { yyyymmdd: "20050418", year: 2005 }
 */
export function dateFromDatFilename(filename: string): { yyyymmdd: string; year: number } | null {
  const match = filename.match(DAT_DATE_PATTERN)
  if (!match) return null

  const [, dd, mm, yyyy] = match
  return {
    yyyymmdd: `${yyyy}${mm}${dd}`,
    year: parseInt(yyyy, 10),
  }
}
