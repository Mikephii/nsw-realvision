/**
 * Load G-NAF NSW PSV files into a DuckDB staging table.
 *
 * The full G-NAF uses a multi-table relational schema. We JOIN four tables:
 * - ADDRESS_DETAIL (core address record: flat_number, number_first, postcode)
 * - ADDRESS_DEFAULT_GEOCODE (latitude, longitude)
 * - STREET_LOCALITY (street_name, street_type_code, street_suffix_code)
 * - LOCALITY (locality_name)
 *
 * Filters to NSW principal addresses with valid geocodes only.
 */

import type { DuckDBConnection } from '@duckdb/node-api'

/**
 * Load G-NAF NSW PSV files into a staging_gnaf table.
 *
 * The staging table contains one row per principal NSW address with:
 * - Address components (flat_number, number_first, street_name, street_type, etc.)
 * - Geocode (latitude, longitude, geocode_type)
 * - GNAF PID for cross-referencing
 *
 * @param conn - DuckDB connection
 * @param addressDetailPath - Path to NSW_ADDRESS_DETAIL_psv.psv
 * @param geocodePath - Path to NSW_ADDRESS_DEFAULT_GEOCODE_psv.psv
 * @param streetLocalityPath - Path to NSW_STREET_LOCALITY_psv.psv
 * @param localityPath - Path to NSW_LOCALITY_psv.psv
 * @returns Number of NSW addresses loaded
 */
export async function loadGnafStaging(
  conn: DuckDBConnection,
  addressDetailPath: string,
  geocodePath: string,
  streetLocalityPath: string,
  localityPath: string,
): Promise<number> {
  // Drop any existing staging table
  await conn.run('DROP TABLE IF EXISTS staging_gnaf;')

  // JOIN four G-NAF tables into a flat staging table:
  // ADDRESS_DETAIL → STREET_LOCALITY (on STREET_LOCALITY_PID) for street_name, street_type
  // ADDRESS_DETAIL → LOCALITY (on LOCALITY_PID) for locality_name
  // ADDRESS_DETAIL → ADDRESS_DEFAULT_GEOCODE (on ADDRESS_DETAIL_PID) for lat/long
  await conn.run(`
    CREATE TABLE staging_gnaf AS
    SELECT
      ad.ADDRESS_DETAIL_PID AS gnaf_pid,
      TRIM(ad.FLAT_NUMBER) AS flat_number,
      TRIM(ad.NUMBER_FIRST) AS number_first,
      TRIM(sl.STREET_NAME) AS street_name,
      TRIM(sl.STREET_TYPE_CODE) AS street_type,
      TRIM(sl.STREET_SUFFIX_CODE) AS street_suffix,
      TRIM(loc.LOCALITY_NAME) AS locality_name,
      TRIM(ad.POSTCODE) AS postcode,
      geo.LATITUDE AS latitude,
      geo.LONGITUDE AS longitude,
      TRIM(geo.GEOCODE_TYPE_CODE) AS geocode_type
    FROM read_csv(
      '${escapeSql(addressDetailPath)}',
      delim='|',
      header=true,
      all_varchar=true
    ) ad
    INNER JOIN read_csv(
      '${escapeSql(geocodePath)}',
      delim='|',
      header=true,
      auto_detect=true
    ) geo ON ad.ADDRESS_DETAIL_PID = geo.ADDRESS_DETAIL_PID
    INNER JOIN read_csv(
      '${escapeSql(streetLocalityPath)}',
      delim='|',
      header=true,
      all_varchar=true
    ) sl ON ad.STREET_LOCALITY_PID = sl.STREET_LOCALITY_PID
    INNER JOIN read_csv(
      '${escapeSql(localityPath)}',
      delim='|',
      header=true,
      all_varchar=true
    ) loc ON ad.LOCALITY_PID = loc.LOCALITY_PID
    WHERE ad.ALIAS_PRINCIPAL = 'P'
      AND geo.LATITUDE IS NOT NULL
      AND geo.LONGITUDE IS NOT NULL;
  `)

  // Get count
  const reader = await conn.runAndReadAll('SELECT COUNT(*) FROM staging_gnaf;')
  const rows = reader.getRows()
  return Number(rows[0]?.[0] ?? 0)
}

/** Drop the GNAF staging table. */
export async function dropGnafStaging(conn: DuckDBConnection): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS staging_gnaf;')
}

/** Escape single quotes in a string for use in SQL literals. */
function escapeSql(s: string): string {
  return s.replace(/'/g, "''")
}
