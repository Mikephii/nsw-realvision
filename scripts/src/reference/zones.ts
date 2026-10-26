/**
 * Zone code lookups and mappings.
 * Source: Property_Sales_Data_File_Zone_Codes_and_Descriptions_V2.pdf
 *
 * Two systems:
 * - Pre-2011: single-character codes (A, B, I, R, etc.)
 * - Post-2011: LEP codes (R1-R5, B1-B7, IN1-IN4, etc.)
 */

export interface ZoneInfo {
  code: string
  name: string
  category: string
}

/** Pre-2011 single-character zone codes */
const LEGACY_ZONES: Record<string, ZoneInfo> = {
  A: { code: 'A', name: 'Residential', category: 'residential' },
  B: { code: 'B', name: 'Business', category: 'business' },
  C: { code: 'C', name: 'Sydney Commercial / Business', category: 'business' },
  D: { code: 'D', name: '10(a) Sustainable Mixed Use Development', category: 'mixed' },
  E: { code: 'E', name: 'Employment', category: 'employment' },
  I: { code: 'I', name: 'Industrial', category: 'industrial' },
  M: { code: 'M', name: '9(a) Mixed Residential / Business', category: 'mixed' },
  N: { code: 'N', name: 'National Parks', category: 'environment' },
  O: { code: 'O', name: 'Open Space', category: 'recreation' },
  P: { code: 'P', name: 'Protection', category: 'environment' },
  R: { code: 'R', name: 'Non-Urban', category: 'rural' },
  S: { code: 'S', name: 'Special Uses', category: 'special' },
  T: { code: 'T', name: 'North Sydney Commercial / Business', category: 'business' },
  U: { code: 'U', name: 'Community Uses', category: 'special' },
  V: { code: 'V', name: 'Comprehensive Centre', category: 'business' },
  W: { code: 'W', name: 'Reserve Open Space', category: 'recreation' },
  X: { code: 'X', name: 'Reserved Roads', category: 'special' },
  Y: { code: 'Y', name: 'Reserved Special Uses', category: 'special' },
  Z: { code: 'Z', name: 'Undetermined or Village', category: 'other' },
}

/** Post-2011 LEP zone codes */
const LEP_ZONES: Record<string, ZoneInfo> = {
  // Rural
  RU1: { code: 'RU1', name: 'Primary Production', category: 'rural' },
  RU2: { code: 'RU2', name: 'Rural Landscape', category: 'rural' },
  RU3: { code: 'RU3', name: 'Forestry', category: 'rural' },
  RU4: { code: 'RU4', name: 'Rural Small Holdings', category: 'rural' },
  RU5: { code: 'RU5', name: 'Village', category: 'rural' },
  RU6: { code: 'RU6', name: 'Transition', category: 'rural' },
  // Residential
  R1: { code: 'R1', name: 'General Residential', category: 'residential' },
  R2: { code: 'R2', name: 'Low Density Residential', category: 'residential' },
  R3: { code: 'R3', name: 'Medium Density Residential', category: 'residential' },
  R4: { code: 'R4', name: 'High Density Residential', category: 'residential' },
  R5: { code: 'R5', name: 'Large Lot Residential', category: 'residential' },
  // Business
  B1: { code: 'B1', name: 'Neighbourhood Centre', category: 'business' },
  B2: { code: 'B2', name: 'Local Centre', category: 'business' },
  B3: { code: 'B3', name: 'Commercial Core', category: 'business' },
  B4: { code: 'B4', name: 'Mixed Use', category: 'business' },
  B5: { code: 'B5', name: 'Business Development', category: 'business' },
  B6: { code: 'B6', name: 'Enterprise Corridor', category: 'business' },
  B7: { code: 'B7', name: 'Business Park', category: 'business' },
  // Industrial
  IN1: { code: 'IN1', name: 'General Industrial', category: 'industrial' },
  IN2: { code: 'IN2', name: 'Light Industrial', category: 'industrial' },
  IN3: { code: 'IN3', name: 'Heavy Industrial', category: 'industrial' },
  IN4: { code: 'IN4', name: 'Working Waterfront', category: 'industrial' },
  // Special Purpose
  SP1: { code: 'SP1', name: 'Special Activities', category: 'special' },
  SP2: { code: 'SP2', name: 'Infrastructure', category: 'special' },
  SP3: { code: 'SP3', name: 'Tourist', category: 'special' },
  // Recreation
  RE1: { code: 'RE1', name: 'Public Recreation', category: 'recreation' },
  RE2: { code: 'RE2', name: 'Private Recreation', category: 'recreation' },
  // Environment Protection
  E1: { code: 'E1', name: 'National Parks and Nature Reserves', category: 'environment' },
  E2: { code: 'E2', name: 'Environmental Conservation', category: 'environment' },
  E3: { code: 'E3', name: 'Environmental Management', category: 'environment' },
  E4: { code: 'E4', name: 'Environmental Living', category: 'environment' },
  // Waterway
  W1: { code: 'W1', name: 'Natural Waterways', category: 'waterway' },
  W2: { code: 'W2', name: 'Recreational Waterways', category: 'waterway' },
  W3: { code: 'W3', name: 'Working Waterways', category: 'waterway' },
}

/** Get zone info for any zone code (legacy or LEP). Returns undefined if not found. */
export function getZoneInfo(code: string): ZoneInfo | undefined {
  return LEP_ZONES[code] ?? LEGACY_ZONES[code]
}

/** Get all LEP zone codes and info. */
export function getAllLepZones(): ZoneInfo[] {
  return Object.values(LEP_ZONES)
}

/** Get all legacy zone codes and info. */
export function getAllLegacyZones(): ZoneInfo[] {
  return Object.values(LEGACY_ZONES)
}

/** Check if a zone code is a legacy (pre-2011) single-character code */
export function isLegacyZoneCode(code: string): boolean {
  return code.length === 1 && code in LEGACY_ZONES
}
