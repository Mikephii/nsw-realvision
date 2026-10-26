/**
 * Autocomplete search functions using DuckDB.
 * Uses ILIKE prefix matching for fast type-ahead results.
 */

import { executeQuery } from './queries'
import type { DuckDBConnection } from '@duckdb/node-api'

export interface LocalitySuggestion {
  locality: string
  postCode: string
  councilName: string
  saleCount: number
}

export interface StreetSuggestion {
  streetName: string
  propertyCount: number
}

export interface PropertyResult {
  propertyId: string
  unitNumber: string | null
  houseNumber: string | null
  streetName: string
  locality: string
  postCode: string | null
  saleCount: number
  lastSaleYear: number | null
}

/**
 * Search for localities (suburbs) matching a prefix.
 * Returns results ordered by sale count (most popular first).
 *
 * @param conn - DuckDB connection
 * @param prefix - Search prefix (case-insensitive)
 * @param limit - Max results (default 20)
 */
export async function searchLocalities(
  conn: DuckDBConnection,
  prefix: string,
  limit: number = 20,
): Promise<Array<LocalitySuggestion>> {
  if (!prefix || prefix.length < 1) return []

  const sql = `
    SELECT
      fps.locality,
      ARG_MAX(fps.post_code, fps.contract_date) AS post_code,
      COALESCE(ARG_MAX(dd.council_name, fps.contract_date), 'Unknown') AS council_name,
      COUNT(*) AS sale_count
    FROM fact_property_sale fps
    LEFT JOIN dim_district dd ON fps.district_code = dd.district_code
    WHERE fps.locality ILIKE ? || '%'
      AND fps.locality IS NOT NULL
    GROUP BY fps.locality
    ORDER BY sale_count DESC
    LIMIT ?
  `

  const rows = await executeQuery<{
    locality: string
    post_code: string | null
    council_name: string
    sale_count: number
  }>(conn, sql, [prefix, limit])

  return rows.map((r) => ({
    locality: r.locality,
    postCode: r.post_code ?? '',
    councilName: r.council_name,
    saleCount: r.sale_count,
  }))
}

/**
 * Search for streets within a locality matching a prefix.
 * Returns results ordered by property count (most properties first).
 */
export async function searchStreets(
  conn: DuckDBConnection,
  locality: string,
  prefix: string,
  limit: number = 20,
): Promise<Array<StreetSuggestion>> {
  if (!prefix || prefix.length < 1) return []

  const sql = `
    SELECT
      street_name,
      COUNT(DISTINCT property_id) AS property_count
    FROM fact_property_sale
    WHERE locality = ?
      AND street_name ILIKE ? || '%'
      AND street_name IS NOT NULL
    GROUP BY street_name
    ORDER BY property_count DESC
    LIMIT ?
  `

  const rows = await executeQuery<{
    street_name: string
    property_count: number
  }>(conn, sql, [locality, prefix, limit])

  return rows.map((r) => ({
    streetName: r.street_name,
    propertyCount: r.property_count,
  }))
}

/**
 * Search for properties on a given street within a locality.
 * Returns distinct addresses ordered by most recent sale first.
 */
export async function searchProperties(
  conn: DuckDBConnection,
  locality: string,
  streetName: string,
  limit: number = 50,
): Promise<Array<PropertyResult>> {
  const sql = `
    SELECT
      property_id,
      unit_number,
      house_number,
      street_name,
      locality,
      post_code,
      COUNT(*) AS sale_count,
      CAST(EXTRACT(YEAR FROM MAX(contract_date)) AS INTEGER) AS last_sale_year
    FROM fact_property_sale
    WHERE locality = ?
      AND street_name = ?
      AND property_id IS NOT NULL
      AND purchase_price > 0
    GROUP BY property_id, unit_number, house_number, street_name, locality, post_code
    ORDER BY
      MAX(contract_date) DESC NULLS LAST
    LIMIT ?
  `

  const rows = await executeQuery<{
    property_id: string
    unit_number: string | null
    house_number: string | null
    street_name: string
    locality: string
    post_code: string | null
    sale_count: number
    last_sale_year: number | null
  }>(conn, sql, [locality, streetName, limit])

  return rows.map((r) => ({
    propertyId: r.property_id,
    unitNumber: r.unit_number,
    houseNumber: r.house_number,
    streetName: r.street_name,
    locality: r.locality,
    postCode: r.post_code,
    saleCount: r.sale_count,
    lastSaleYear: r.last_sale_year,
  }))
}
