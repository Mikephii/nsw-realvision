/**
 * Zone code cleaning — normalise and validate zone codes.
 */

import { getZoneInfo } from '../reference/zones.js'

/**
 * Clean a zone code from the .DAT file.
 * Returns the code as-is if it's a known zone (legacy or LEP), or null if empty/unknown.
 */
export function cleanZoneCode(code: string): string | null {
  if (!code || code.trim() === '') return null

  const trimmed = code.trim()
  const info = getZoneInfo(trimmed)
  if (info) return trimmed

  // Unknown zone code — return as-is (data may contain codes not in our reference)
  return trimmed
}
