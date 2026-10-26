/**
 * Geocoding coverage statistics.
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import type { GeocodeCoverage } from '../types/address.js'

/**
 * Query geocoding coverage breakdown from dim_address.
 */
export async function getGeocodeCoverage(conn: DuckDBConnection): Promise<GeocodeCoverage> {
  const reader = await conn.runAndReadAll(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE geocode_source = 'gnaf_exact') AS exact,
      COUNT(*) FILTER (WHERE geocode_source = 'gnaf_fuzzy') AS fuzzy,
      COUNT(*) FILTER (WHERE geocode_source = 'locality_centroid') AS centroid,
      COUNT(*) FILTER (WHERE latitude IS NULL) AS ungeocoded
    FROM dim_address;
  `)

  const rows = reader.getRows()
  const row = rows[0]

  return {
    totalAddresses: Number(row?.[0] ?? 0),
    geocodedExact: Number(row?.[1] ?? 0),
    geocodedFuzzy: Number(row?.[2] ?? 0),
    geocodedCentroid: Number(row?.[3] ?? 0),
    ungeocoded: Number(row?.[4] ?? 0),
  }
}

/** Format coverage stats for console output. */
export function formatCoverage(coverage: GeocodeCoverage): string {
  const { totalAddresses, geocodedExact, geocodedFuzzy, geocodedCentroid, ungeocoded } = coverage
  const pct = (n: number) => totalAddresses > 0 ? `(${((n / totalAddresses) * 100).toFixed(1)}%)` : ''
  const geocodedTotal = geocodedExact + geocodedFuzzy + geocodedCentroid

  const lines = [
    'Geocoding Status',
    '================',
    `Total distinct addresses: ${totalAddresses.toLocaleString()}`,
    `Geocoded total:          ${geocodedTotal.toLocaleString()} ${pct(geocodedTotal)}`,
    `  Exact (high):          ${geocodedExact.toLocaleString()} ${pct(geocodedExact)}`,
    `  Fuzzy (medium):        ${geocodedFuzzy.toLocaleString()} ${pct(geocodedFuzzy)}`,
    `  Centroid (low):        ${geocodedCentroid.toLocaleString()} ${pct(geocodedCentroid)}`,
    `Unmatched:               ${ungeocoded.toLocaleString()} ${pct(ungeocoded)}`,
  ]

  return lines.join('\n')
}
