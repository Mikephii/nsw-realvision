/**
 * DuckDB query for map point data.
 * Joins fact_property_sale with dim_address to get coordinates + sale data.
 * Returns GeoJSON FeatureCollection built server-side.
 *
 * Supports two modes:
 * - **Locality-only** (fast path): CTE filters fact_property_sale first,
 *   then JOINs dim_address for coordinates.
 * - **Spatial** (when spatialFilters present): JOINs dim_address up front
 *   so both locality and polygon filters can be applied together with OR logic.
 */

import {
  buildLocationOrClause,
  buildWhereClause,
  executeQuery,
} from './queries'
import type { DuckDBConnection } from '@duckdb/node-api'
import type { PropertyFilter } from './queries'
import type {
  MapGeoJSON,
  MapPointProperties,
} from '@/features/dashboard/widgets/property-map/types'

const MAP_POINT_LIMIT = 50_000

interface MapPointRow {
  latitude: number
  longitude: number
  purchase_price: number
  contract_date: string
  contract_year: number
  zone_code: string | null
  locality: string
  nature_of_property: string | null
  geocode_confidence: string | null
  property_id: string
  unit_number: string | null
  house_number: string | null
  street_name: string | null
}

export async function queryMapPoints(
  conn: DuckDBConnection,
  filter: PropertyFilter,
): Promise<MapGeoJSON> {
  const hasSpatial = filter.spatialFilters && filter.spatialFilters.length > 0

  let rows: Array<MapPointRow>

  if (!hasSpatial) {
    // Fast path: no spatial filters, use CTE approach
    rows = await queryMapPointsLocality(conn, filter)
  } else {
    // Spatial path: JOIN up front, apply both locality + polygon filters
    rows = await queryMapPointsSpatial(conn, filter)
  }

  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [r.longitude, r.latitude] as [number, number],
      },
      properties: {
        purchasePrice: r.purchase_price,
        contractDate: r.contract_date,
        contractYear: r.contract_year,
        zoneCode: r.zone_code,
        locality: r.locality,
        natureOfProperty: r.nature_of_property,
        geocodeConfidence: r.geocode_confidence,
        propertyId: r.property_id,
        address: formatAddress(r.unit_number, r.house_number, r.street_name),
      } satisfies MapPointProperties,
    })),
  }
}

/**
 * Fast path: locality-only query using CTE for pre-filtering.
 */
async function queryMapPointsLocality(
  conn: DuckDBConnection,
  filter: PropertyFilter,
): Promise<Array<MapPointRow>> {
  const { clause, params } = buildWhereClause(filter)

  const sql = `
    WITH filtered_sales AS (
      SELECT
        property_id,
        COALESCE(unit_number, '') AS unit_number,
        COALESCE(house_number, '') AS house_number,
        purchase_price,
        contract_date,
        zone_code,
        locality,
        nature_of_property,
        street_name
      FROM fact_property_sale
      ${clause}
      ORDER BY contract_date DESC NULLS LAST
      LIMIT ${MAP_POINT_LIMIT}
    )
    SELECT
      da.latitude,
      da.longitude,
      fs.purchase_price,
      CAST(fs.contract_date AS VARCHAR) AS contract_date,
      CAST(EXTRACT(YEAR FROM fs.contract_date) AS INTEGER) AS contract_year,
      fs.zone_code,
      fs.locality,
      fs.nature_of_property,
      da.geocode_confidence,
      fs.property_id,
      fs.unit_number,
      fs.house_number,
      fs.street_name
    FROM filtered_sales fs
    INNER JOIN dim_address da
      ON fs.property_id = da.property_id
      AND fs.unit_number = da.unit_number
      AND fs.house_number = da.house_number
    WHERE da.latitude IS NOT NULL
      AND da.longitude IS NOT NULL
  `

  return executeQuery<MapPointRow>(conn, sql, params)
}

/**
 * Spatial path: JOIN dim_address up front so both locality IN (...)
 * and ST_Within polygon checks can be applied with OR logic.
 */
async function queryMapPointsSpatial(
  conn: DuckDBConnection,
  filter: PropertyFilter,
): Promise<Array<MapPointRow>> {
  const { buildSpatialJoin } =
    await import('@/features/areas/spatial/spatial-queries')
  const spatial = buildSpatialJoin(filter.spatialFilters!, {
    includeJoin: false,
  })

  // Base WHERE with table prefix (no regex needed)
  const baseFilter: PropertyFilter = {
    ...filter,
    localities: undefined,
    spatialFilters: undefined,
  }
  const { clause: baseClause, params: baseParams } = buildWhereClause(
    baseFilter,
    { prefix: 'fps' },
  )
  const baseConditions = baseClause.replace(/^WHERE /, '')

  // OR clause: locality IN (...) OR spatial polygon
  const locationOr = buildLocationOrClause(filter, spatial, 'fps')

  const sql = `
    SELECT
      da.latitude,
      da.longitude,
      fps.purchase_price,
      CAST(fps.contract_date AS VARCHAR) AS contract_date,
      CAST(EXTRACT(YEAR FROM fps.contract_date) AS INTEGER) AS contract_year,
      fps.zone_code,
      fps.locality,
      fps.nature_of_property,
      da.geocode_confidence,
      fps.property_id,
      COALESCE(fps.unit_number, '') AS unit_number,
      COALESCE(fps.house_number, '') AS house_number,
      fps.street_name
    FROM fact_property_sale fps
    INNER JOIN dim_address da
      ON fps.property_id = da.property_id
      AND COALESCE(fps.unit_number, '') = da.unit_number
      AND COALESCE(fps.house_number, '') = da.house_number
    WHERE ${baseConditions}
    ${locationOr.clause}
    AND da.latitude IS NOT NULL AND da.longitude IS NOT NULL
    ORDER BY fps.contract_date DESC NULLS LAST
    LIMIT ${MAP_POINT_LIMIT}
  `

  const allParams = [...baseParams, ...locationOr.params]
  return executeQuery<MapPointRow>(conn, sql, allParams)
}

function formatAddress(
  unit: string | null,
  house: string | null,
  street: string | null,
): string {
  const parts: Array<string> = []
  if (unit) parts.push(`${unit}/`)
  if (house) parts.push(house)
  if (street) parts.push(street)
  return parts.join(' ').trim() || 'Unknown'
}
