/**
 * Street name normalization for matching VG data against G-NAF.
 *
 * VG data concatenates street name + type + suffix into a single field
 * (e.g. "MAIN ROAD", "HIGH ST", "PRINCES HWY EAST").
 *
 * G-NAF separates these into STREET_NAME, STREET_TYPE, and STREET_SUFFIX.
 * This module provides maps to expand abbreviations and match between formats.
 */

/**
 * Map of abbreviated street types to their full forms.
 * Used when VG data has "HIGH ST" and GNAF has STREET_TYPE="STREET".
 */
export const STREET_TYPE_ABBREVIATIONS: Record<string, string> = {
  ST: 'STREET',
  RD: 'ROAD',
  AVE: 'AVENUE',
  DR: 'DRIVE',
  PL: 'PLACE',
  CT: 'COURT',
  CR: 'CRESCENT',
  CRS: 'CRESCENT',
  CRES: 'CRESCENT',
  LN: 'LANE',
  PDE: 'PARADE',
  TCE: 'TERRACE',
  HWY: 'HIGHWAY',
  BVD: 'BOULEVARD',
  CCT: 'CIRCUIT',
  CL: 'CLOSE',
  GR: 'GROVE',
  WAY: 'WAY',
  TRL: 'TRAIL',
  PKWY: 'PARKWAY',
  RDG: 'RIDGE',
  SQ: 'SQUARE',
  ARC: 'ARCADE',
  GDNS: 'GARDENS',
  MEWS: 'MEWS',
  RISE: 'RISE',
  LOOP: 'LOOP',
  PASS: 'PASS',
  RDGE: 'RIDGE',
  RUN: 'RUN',
  VW: 'VIEW',
  WLK: 'WALK',
  ALLY: 'ALLEY',
  GRN: 'GREEN',
}

/**
 * Map of full street types to their common abbreviations.
 * Used when GNAF has STREET_TYPE="STREET" and VG data has "ST".
 */
export const STREET_TYPE_FULL_TO_ABBREV: Record<string, string> = Object.fromEntries(
  Object.entries(STREET_TYPE_ABBREVIATIONS).map(([abbr, full]) => [full, abbr]),
)

/**
 * Build a normalised full street name from GNAF components.
 * Returns both the full form and abbreviated form for matching.
 *
 * @example
 * buildGnafStreetVariants('MAIN', 'STREET', 'EAST')
 * // { full: 'MAIN STREET EAST', abbreviated: 'MAIN ST EAST' }
 */
export function buildGnafStreetVariants(
  streetName: string,
  streetType: string | null,
  streetSuffix: string | null,
): { full: string; abbreviated: string } {
  const parts = [streetName]
  const abbrParts = [streetName]

  if (streetType) {
    parts.push(streetType)
    abbrParts.push(STREET_TYPE_FULL_TO_ABBREV[streetType] ?? streetType)
  }

  if (streetSuffix) {
    parts.push(streetSuffix)
    abbrParts.push(streetSuffix)
  }

  return {
    full: parts.join(' '),
    abbreviated: abbrParts.join(' '),
  }
}

/**
 * Expand any abbreviated street type in a VG street name to its full form.
 * Used for matching VG "HIGH ST" against GNAF "HIGH STREET".
 *
 * @example
 * expandStreetAbbreviation('HIGH ST') // 'HIGH STREET'
 * expandStreetAbbreviation('MAIN ROAD') // 'MAIN ROAD' (already full)
 * expandStreetAbbreviation('PRINCES HWY EAST') // 'PRINCES HIGHWAY EAST'
 */
export function expandStreetAbbreviation(streetName: string): string {
  const words = streetName.trim().toUpperCase().split(/\s+/)
  if (words.length < 2) return streetName.trim().toUpperCase()

  // Try expanding each word (except the first, which is the actual street name)
  return words
    .map((word, i) => (i > 0 && STREET_TYPE_ABBREVIATIONS[word]) ? STREET_TYPE_ABBREVIATIONS[word] : word)
    .join(' ')
}
