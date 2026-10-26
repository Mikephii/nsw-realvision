/**
 * Spatial query builder for DuckDB.
 *
 * Generates the SQL fragments needed to filter properties by geographic
 * polygon using DuckDB's spatial extension. Uses a two-stage approach:
 *
 * 1. **Bounding box pre-filter** — `WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
 *    Uses B-tree indexes on lat/lon columns to eliminate 95%+ of rows.
 *
 * 2. **Exact point-in-polygon** — `ST_Within(ST_Point(lon, lat), ST_GeomFromText(?))`
 *    Runs on the small candidate set surviving the bbox filter.
 *
 * This module sits at the query boundary: it accepts {@link SpatialFilter}
 * objects (from the state layer) and produces SQL fragments (for DuckDB).
 */

import type { SpatialFilter } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-filter SQL fragment for building UNION ALL queries.
 * Each fragment represents a single spatial polygon's WHERE predicate
 * and label, allowing callers to build independent subqueries per area.
 */
export interface SpatialFilterFragment {
  /** Human-readable area name (used as the locality label in results). */
  label: string
  /** bbox + ST_Within WHERE predicate for this single filter. */
  wherePredicate: string
  /** Bound parameters for the WHERE predicate (bbox bounds). */
  params: Array<unknown>
}

/**
 * SQL fragments returned by {@link buildSpatialJoin} for composing
 * into existing queries.
 */
export interface SpatialJoinResult {
  /**
   * JOIN clause to add after the FROM table.
   * Empty string if the query already JOINs dim_address.
   *
   * @example
   * ```sql
   * LEFT JOIN dim_address da
   *   ON fps.property_id = da.property_id
   *   AND fps.unit_number = da.unit_number
   *   AND fps.house_number = da.house_number
   * ```
   */
  joinClause: string

  /**
   * WHERE predicates for bbox + ST_Within filtering.
   * Multiple spatial filters are combined with OR (a property matches
   * if it's inside ANY of the polygons).
   *
   * Does NOT include a leading AND/WHERE — the caller must prepend it.
   *
   * @example
   * ```sql
   * (da.latitude BETWEEN ? AND ? AND da.longitude BETWEEN ? AND ?
   *   AND ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(?)))
   * ```
   */
  wherePredicate: string

  /** Bound parameters for the WHERE predicates (in order). */
  params: Array<unknown>

  /**
   * CASE expression that labels each row with its area name if it falls
   * inside a spatial filter, otherwise falls back to the row's locality.
   *
   * Used in GROUP BY for aggregation queries (e.g. median price time series)
   * so each area gets its own series in charts.
   *
   * @example
   * ```sql
   * CASE
   *   WHEN ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(?))
   *     THEN 'My Area'
   *   ELSE fps.locality
   * END
   * ```
   */
  labelExpression: string

  /** Parameters for the label CASE expression (separate from WHERE params). */
  labelParams: Array<unknown>

  /**
   * Per-filter fragments for UNION ALL queries.
   *
   * Time series queries use these to build one subquery per spatial area,
   * allowing overlapping polygons to independently aggregate their matching
   * rows (a sale inside two polygons contributes to both series).
   */
  filters: Array<SpatialFilterFragment>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * LEFT JOIN clause for connecting fact_property_sale to dim_address.
 * Uses the composite key (property_id, unit_number, house_number).
 *
 * LEFT JOIN (not INNER) so that locality-matched rows survive even without
 * a geocoded address. Spatial predicates (ST_Within, bbox BETWEEN) naturally
 * return FALSE/NULL when da columns are NULL, so non-geocoded rows can
 * never accidentally match a polygon.
 */
const DIM_ADDRESS_JOIN = `LEFT JOIN dim_address da
  ON fps.property_id = da.property_id
  AND COALESCE(fps.unit_number, '') = da.unit_number
  AND COALESCE(fps.house_number, '') = da.house_number`

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build SQL fragments for spatial polygon filtering.
 *
 * Generates a JOIN clause (if the query doesn't already join dim_address),
 * WHERE predicates with bbox + ST_Within, and a CASE expression for labelling
 * rows by area name.
 *
 * @param spatialFilters - One or more resolved spatial filters.
 * @param options.includeJoin - Whether to include the dim_address JOIN clause.
 *   Set to `false` if the query already JOINs dim_address (e.g. map-queries.ts).
 *   Defaults to `true`.
 *
 * @returns SQL fragments and their bound parameters.
 *
 * @example
 * ```ts
 * const spatial = buildSpatialJoin(filters)
 * const sql = `
 *   SELECT ... FROM fact_property_sale fps
 *   ${spatial.joinClause}
 *   WHERE ... AND (${spatial.wherePredicate})
 * `
 * const allParams = [...baseParams, ...spatial.params]
 * ```
 */
export function buildSpatialJoin(
  spatialFilters: Array<SpatialFilter>,
  options?: { includeJoin?: boolean },
): SpatialJoinResult {
  const includeJoin = options?.includeJoin ?? true

  const whereFragments: Array<string> = []
  const whereParams: Array<unknown> = []
  const labelCases: Array<string> = []
  const labelParams: Array<unknown> = []
  const filters: Array<SpatialFilterFragment> = []

  for (const filter of spatialFilters) {
    // WKT is inlined as a string literal rather than a bound parameter because
    // DuckDB's spatial extension doesn't support parameterized ST_GeomFromText(?).
    // This is safe: WKT is generated by polygonToWKT() from numeric coordinates
    // (format: "POLYGON((num num, num num, ...))"), not from user input.
    const wktLiteral = `'${filter.wkt}'`

    // Each filter generates: (bbox BETWEEN check AND ST_Within check)
    whereFragments.push(
      `(da.latitude BETWEEN ? AND ? AND da.longitude BETWEEN ? AND ? AND ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(${wktLiteral})))`,
    )
    whereParams.push(
      filter.bounds.minLat,
      filter.bounds.maxLat,
      filter.bounds.minLon,
      filter.bounds.maxLon,
    )

    // Label CASE branch for this filter
    labelCases.push(
      `WHEN ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(${wktLiteral})) THEN ?`,
    )
    labelParams.push(filter.label)

    // Per-filter fragment for UNION ALL queries
    filters.push({
      label: filter.label,
      wherePredicate: `da.latitude BETWEEN ? AND ? AND da.longitude BETWEEN ? AND ? AND ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(${wktLiteral}))`,
      params: [
        filter.bounds.minLat,
        filter.bounds.maxLat,
        filter.bounds.minLon,
        filter.bounds.maxLon,
      ],
    })
  }

  // Combine multiple filters with OR (property matches ANY polygon)
  const wherePredicate = whereFragments.join(' OR ')

  // Build CASE expression: check each area, fall back to locality
  const labelExpression =
    labelCases.length > 0
      ? `CASE ${labelCases.join(' ')} ELSE fps.locality END`
      : 'fps.locality'

  return {
    joinClause: includeJoin ? DIM_ADDRESS_JOIN : '',
    wherePredicate,
    params: whereParams,
    labelExpression,
    labelParams,
    filters,
  }
}
