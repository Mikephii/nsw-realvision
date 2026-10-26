/**
 * Types for address geocoding via G-NAF integration.
 */

export type GeocodeSource = 'gnaf_exact' | 'gnaf_fuzzy' | 'locality_centroid'

export type GeocodeConfidence = 'high' | 'medium' | 'low'

/** A geocoded address record in dim_address. */
export interface GeocodedAddress {
  propertyId: string
  /** Empty string when no unit (NOT NULL in DB for PK) */
  unitNumber: string
  /** Empty string when no house number (NOT NULL in DB for PK) */
  houseNumber: string
  streetName: string | null
  locality: string | null
  postCode: string | null
  districtCode: string | null
  latitude: number | null
  longitude: number | null
  geocodeSource: GeocodeSource | null
  geocodeConfidence: GeocodeConfidence | null
  /** G-NAF ADDRESS_DETAIL_PID for auditing/cross-reference */
  gnafPid: string | null
  geocodedAt: Date | null
}

/** Statistics from a geocoding run. */
export interface GeocodeStats {
  totalAddresses: number
  newAddressesExtracted: number
  matchedExact: number
  matchedFuzzy: number
  matchedCentroid: number
  unmatched: number
  /** Elapsed time in milliseconds */
  elapsedMs: number
}

/** Summary of geocoding coverage for the status command. */
export interface GeocodeCoverage {
  totalAddresses: number
  geocodedExact: number
  geocodedFuzzy: number
  geocodedCentroid: number
  ungeocoded: number
}
