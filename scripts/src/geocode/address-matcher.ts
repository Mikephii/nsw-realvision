/**
 * Three-tier address matching against G-NAF staging data.
 *
 * Matches addresses in dim_address (extracted from fact_property_sale)
 * against staging_gnaf (loaded from G-NAF NSW PSV files).
 *
 * Tier 1: Exact match on house_number + locality + postcode + street prefix
 * Tier 2: Fuzzy match using street type abbreviation expansion
 * Tier 3: Locality centroid fallback for remaining unmatched
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import type { GeocodeStats } from '../types/address.js'

/**
 * Run all three matching tiers against the staging_gnaf table.
 * Only updates dim_address rows where latitude IS NULL.
 *
 * @returns Statistics from the matching run
 */
export async function matchAddresses(conn: DuckDBConnection): Promise<GeocodeStats> {
  const start = Date.now()

  const totalAddresses = await countWhere(conn, '1=1')
  const unmatchedBefore = await countWhere(conn, 'latitude IS NULL')

  // Tier 1: Exact match
  const tier1 = await matchExact(conn)

  // Tier 2: Fuzzy street name match
  const tier2 = await matchFuzzyStreet(conn)

  // Tier 3: Locality centroid fallback
  const tier3 = await matchLocalityCentroid(conn)

  const unmatchedAfter = await countWhere(conn, 'latitude IS NULL')

  return {
    totalAddresses,
    newAddressesExtracted: 0, // caller sets this
    matchedExact: tier1,
    matchedFuzzy: tier2,
    matchedCentroid: tier3,
    unmatched: unmatchedAfter,
    elapsedMs: Date.now() - start,
  }
}

/**
 * Tier 1: Exact match.
 *
 * Matches on: house_number = number_first, locality = locality_name,
 * post_code = postcode, and street_name starts with GNAF street_name.
 *
 * For units, also matches flat_number.
 */
async function matchExact(conn: DuckDBConnection): Promise<number> {
  const before = await countWhere(conn, 'latitude IS NULL')

  await conn.run(`
    UPDATE dim_address da
    SET
      latitude = g.latitude,
      longitude = g.longitude,
      geocode_source = 'gnaf_exact',
      geocode_confidence = 'high',
      gnaf_pid = g.gnaf_pid,
      geocoded_at = current_timestamp
    FROM staging_gnaf g
    WHERE da.latitude IS NULL
      AND da.house_number != ''
      AND da.house_number = g.number_first
      AND UPPER(da.locality) = UPPER(g.locality_name)
      AND da.post_code = g.postcode
      AND UPPER(da.street_name) LIKE UPPER(g.street_name) || ' ' || UPPER(COALESCE(g.street_type, '')) || '%'
      AND (
        (da.unit_number = '' AND (g.flat_number IS NULL OR g.flat_number = ''))
        OR da.unit_number = COALESCE(g.flat_number, '')
      );
  `)

  const after = await countWhere(conn, 'latitude IS NULL')
  return before - after
}

/**
 * Tier 2: Fuzzy street name match.
 *
 * Handles VG abbreviated street names vs GNAF full types.
 * Creates a temporary lookup with both full and abbreviated street names
 * from GNAF, then matches dim_address street_name against either form.
 */
async function matchFuzzyStreet(conn: DuckDBConnection): Promise<number> {
  const before = await countWhere(conn, 'latitude IS NULL')

  // Build normalised GNAF street lookup with full and abbreviated forms
  await conn.run(`
    CREATE OR REPLACE TEMP TABLE gnaf_street_variants AS
    SELECT
      gnaf_pid,
      flat_number,
      number_first,
      locality_name,
      postcode,
      latitude,
      longitude,
      -- Full form: "MAIN STREET"
      street_name || CASE WHEN street_type IS NOT NULL AND street_type != ''
        THEN ' ' || street_type ELSE '' END AS full_street,
      -- Abbreviated form: "MAIN ST"
      street_name || CASE WHEN street_type IS NOT NULL AND street_type != ''
        THEN ' ' || CASE street_type
          WHEN 'STREET' THEN 'ST'
          WHEN 'ROAD' THEN 'RD'
          WHEN 'AVENUE' THEN 'AVE'
          WHEN 'DRIVE' THEN 'DR'
          WHEN 'PLACE' THEN 'PL'
          WHEN 'COURT' THEN 'CT'
          WHEN 'CRESCENT' THEN 'CR'
          WHEN 'LANE' THEN 'LN'
          WHEN 'PARADE' THEN 'PDE'
          WHEN 'TERRACE' THEN 'TCE'
          WHEN 'HIGHWAY' THEN 'HWY'
          WHEN 'BOULEVARD' THEN 'BVD'
          WHEN 'CIRCUIT' THEN 'CCT'
          WHEN 'CLOSE' THEN 'CL'
          WHEN 'GROVE' THEN 'GR'
          WHEN 'WAY' THEN 'WAY'
          WHEN 'TRAIL' THEN 'TRL'
          WHEN 'PARKWAY' THEN 'PKWY'
          WHEN 'SQUARE' THEN 'SQ'
          WHEN 'GARDENS' THEN 'GDNS'
          WHEN 'RISE' THEN 'RISE'
          WHEN 'VIEW' THEN 'VW'
          WHEN 'WALK' THEN 'WLK'
          ELSE street_type
        END
        ELSE '' END AS abbreviated_street
    FROM staging_gnaf;
  `)

  // Match on abbreviated or full street name
  await conn.run(`
    UPDATE dim_address da
    SET
      latitude = g.latitude,
      longitude = g.longitude,
      geocode_source = 'gnaf_fuzzy',
      geocode_confidence = 'medium',
      gnaf_pid = g.gnaf_pid,
      geocoded_at = current_timestamp
    FROM gnaf_street_variants g
    WHERE da.latitude IS NULL
      AND da.house_number != ''
      AND da.house_number = g.number_first
      AND UPPER(da.locality) = UPPER(g.locality_name)
      AND (
        UPPER(TRIM(da.street_name)) = UPPER(g.full_street)
        OR UPPER(TRIM(da.street_name)) = UPPER(g.abbreviated_street)
      )
      AND (
        (da.unit_number = '' AND (g.flat_number IS NULL OR g.flat_number = ''))
        OR da.unit_number = COALESCE(g.flat_number, '')
      );
  `)

  await conn.run('DROP TABLE IF EXISTS gnaf_street_variants;')

  const after = await countWhere(conn, 'latitude IS NULL')
  return before - after
}

/**
 * Tier 3: Locality centroid fallback.
 *
 * For addresses that couldn't be matched at the street level,
 * use the average lat/long of already-matched addresses in the same locality.
 */
async function matchLocalityCentroid(conn: DuckDBConnection): Promise<number> {
  const before = await countWhere(conn, 'latitude IS NULL')

  await conn.run(`
    UPDATE dim_address da
    SET
      latitude = lc.avg_lat,
      longitude = lc.avg_lng,
      geocode_source = 'locality_centroid',
      geocode_confidence = 'low',
      geocoded_at = current_timestamp
    FROM (
      SELECT
        UPPER(locality) AS locality_upper,
        AVG(latitude) AS avg_lat,
        AVG(longitude) AS avg_lng
      FROM dim_address
      WHERE latitude IS NOT NULL
        AND geocode_source IN ('gnaf_exact', 'gnaf_fuzzy')
      GROUP BY UPPER(locality)
    ) lc
    WHERE da.latitude IS NULL
      AND da.locality IS NOT NULL
      AND UPPER(da.locality) = lc.locality_upper;
  `)

  const after = await countWhere(conn, 'latitude IS NULL')
  return before - after
}

/** Count rows in dim_address matching a WHERE condition. */
async function countWhere(conn: DuckDBConnection, condition: string): Promise<number> {
  const reader = await conn.runAndReadAll(`SELECT COUNT(*) FROM dim_address WHERE ${condition};`)
  const rows = reader.getRows()
  return Number(rows[0]?.[0] ?? 0)
}
