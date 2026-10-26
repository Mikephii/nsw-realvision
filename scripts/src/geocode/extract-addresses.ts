/**
 * Extract distinct addresses from fact_property_sale into dim_address.
 *
 * Uses ARG_MAX to pick the most recent address fields per property group,
 * since address data may vary slightly across sales of the same property.
 */

import type { DuckDBConnection } from '@duckdb/node-api'

/**
 * Extract distinct addresses from the fact table into dim_address.
 * Only inserts addresses that don't already exist (ON CONFLICT DO NOTHING).
 *
 * @returns Number of new addresses inserted
 */
export async function extractAddresses(conn: DuckDBConnection): Promise<number> {
  const countBefore = await getAddressCount(conn)

  await conn.run(`
    INSERT INTO dim_address (
      property_id, unit_number, house_number,
      street_name, locality, post_code, district_code
    )
    SELECT
      property_id,
      COALESCE(unit_number, '') AS unit_number,
      COALESCE(house_number, '') AS house_number,
      ARG_MAX(street_name, COALESCE(contract_date, DATE '1900-01-01')) AS street_name,
      ARG_MAX(locality, COALESCE(contract_date, DATE '1900-01-01')) AS locality,
      ARG_MAX(post_code, COALESCE(contract_date, DATE '1900-01-01')) AS post_code,
      ARG_MAX(district_code, COALESCE(contract_date, DATE '1900-01-01')) AS district_code
    FROM fact_property_sale
    WHERE property_id IS NOT NULL
    GROUP BY property_id, COALESCE(unit_number, ''), COALESCE(house_number, '')
    ON CONFLICT DO NOTHING;
  `)

  const countAfter = await getAddressCount(conn)
  return countAfter - countBefore
}

/** Get the total number of rows in dim_address. */
export async function getAddressCount(conn: DuckDBConnection): Promise<number> {
  const reader = await conn.runAndReadAll('SELECT COUNT(*) FROM dim_address;')
  const rows = reader.getRows()
  return Number(rows[0]?.[0] ?? 0)
}
