/**
 * Normalise suburb/locality names from .DAT files.
 */

/**
 * Normalise a locality (suburb) name to title case.
 * Returns null for empty strings.
 *
 * Examples:
 *   "KITCHENER" → "Kitchener"
 *   "KURRI KURRI" → "Kurri Kurri"
 *   "ST IVES" → "St Ives"
 */
export function normaliseLocality(s: string): string | null {
  if (!s || s.trim() === '') return null

  return s
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
}

/**
 * Return a non-empty trimmed string, or null.
 */
export function emptyToNull(s: string): string | null {
  if (!s || s.trim() === '') return null
  return s.trim()
}
