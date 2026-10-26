/**
 * Type-safe DuckDB query builders for property sales analytics.
 *
 * All queries operate on the fact_property_sale table and dimension tables.
 * DuckDB-specific functions: MEDIAN(), EXTRACT(), FILTER().
 *
 * **Server-side only.** All query building and execution MUST remain in
 * server functions (via db.server.ts). This is enforced by dynamic imports
 * in server-fns.ts, and becomes critical when DuckDB moves to S3 remote
 * storage — only the server process will have network access to the database.
 * The client sends PropertyFilter parameters via RPC; the server resolves
 * everything and runs queries.
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import type { SpatialFilter } from '@/features/areas/types'

// --- Types ---

export type Granularity = 'year' | 'quarter' | 'month'

/** Filter by strata (units/apartments) vs freehold (houses/land). */
export type StrataFilter = 'all' | 'freehold' | 'strata'

/**
 * Which pool of sales to include in time series analysis.
 *
 * - `'all-sales'` — Every valid sale (default, current behaviour).
 * - `'repeat-sales'` — Only properties that have sold at least twice.
 *   This reduces composition bias: the same set of properties is being
 *   measured over time, so changes in the mix of what sold can't distort
 *   the trend.
 */
export type DataSource = 'all-sales' | 'repeat-sales'

export interface PropertyFilter {
  localities?: Array<string>
  districtCodes?: Array<string>
  zoneCategories?: Array<string>
  minPrice?: number
  maxPrice?: number
  dateFrom?: string // YYYY-MM-DD
  dateTo?: string // YYYY-MM-DD
  natureOfProperty?: Array<string>
  strataFilter?: StrataFilter

  /**
   * Spatial polygon filters for point-in-polygon queries.
   *
   * When present, queries JOIN to `dim_address` and add bounding box +
   * `ST_Within` predicates. Combined with localities via OR logic:
   * a property matches if it's in any locality OR inside any polygon.
   */
  spatialFilters?: Array<SpatialFilter>
}

export interface MedianPriceByPeriod {
  period: string
  locality: string
  medianPrice: number
  saleCount: number
}

export interface MedianPriceSqmByPeriod {
  period: string
  locality: string
  medianPriceSqm: number
  saleCount: number
}

export interface GrowthRate {
  locality: string
  medianFrom: number
  medianTo: number
  growthPercent: number
}

export interface SuburbSummary {
  locality: string
  postCode: string
  councilName: string
  totalSales: number
  medianPrice: number
  minPrice: number
  maxPrice: number
  earliestSale: string
  latestSale: string
}

export interface DatabaseStats {
  totalSales: number
  totalSuburbs: number
  yearRange: [number, number]
  totalDistricts: number
}

// --- Helpers ---

export function periodExpression(
  granularity: Granularity,
  options?: { prefix?: string },
): string {
  const p = options?.prefix ? `${options.prefix}.` : ''
  switch (granularity) {
    case 'year':
      return `CAST(EXTRACT(YEAR FROM ${p}contract_date) AS VARCHAR)`
    case 'quarter':
      return `CAST(EXTRACT(YEAR FROM ${p}contract_date) AS VARCHAR) || '-Q' || CAST(EXTRACT(QUARTER FROM ${p}contract_date) AS VARCHAR)`
    case 'month':
      return `strftime(${p}contract_date, '%Y-%m')`
  }
}

export function buildWhereClause(
  filter: PropertyFilter,
  options?: { prefix?: string },
): { clause: string; params: Array<unknown> } {
  const p = options?.prefix ? `${options.prefix}.` : ''
  const conditions: Array<string> = [
    `${p}purchase_price > 0`,
    `${p}contract_date IS NOT NULL`,
    // Data quality flags — exclude flagged records from all analytical queries.
    // These mirror the heatmap WHERE clauses so all widgets use the same clean dataset.
    `${p}is_bulk_sale = FALSE`,
    `${p}is_price_outlier = FALSE`,
    `${p}is_nominal_transfer = FALSE`,
    `${p}is_partial_interest = FALSE`,
    `${p}is_multi_dealing_dup = FALSE`,
  ]
  const params: Array<unknown> = []

  if (filter.localities && filter.localities.length > 0) {
    const placeholders = filter.localities.map(() => '?').join(', ')
    conditions.push(`${p}locality IN (${placeholders})`)
    params.push(...filter.localities)
  }

  if (filter.districtCodes && filter.districtCodes.length > 0) {
    const placeholders = filter.districtCodes.map(() => '?').join(', ')
    conditions.push(`${p}district_code IN (${placeholders})`)
    params.push(...filter.districtCodes)
  }

  if (filter.minPrice != null) {
    conditions.push(`${p}purchase_price >= ?`)
    params.push(filter.minPrice)
  }

  if (filter.maxPrice != null) {
    conditions.push(`${p}purchase_price <= ?`)
    params.push(filter.maxPrice)
  }

  if (filter.dateFrom) {
    conditions.push(`${p}contract_date >= ?`)
    params.push(filter.dateFrom)
  }

  if (filter.dateTo) {
    conditions.push(`${p}contract_date <= ?`)
    params.push(filter.dateTo)
  }

  if (filter.natureOfProperty && filter.natureOfProperty.length > 0) {
    const placeholders = filter.natureOfProperty.map(() => '?').join(', ')
    conditions.push(`${p}nature_of_property IN (${placeholders})`)
    params.push(...filter.natureOfProperty)
  }

  // Strata/freehold split uses is_likely_strata to correctly classify
  // community-title and company-title apartments that the NSW VG records
  // with strata = NULL. See scripts/src/db/data-quality.ts:flagLikelyStrata().
  if (filter.strataFilter === 'strata') {
    conditions.push(`(${p}strata IS NOT NULL OR ${p}is_likely_strata)`)
  } else if (filter.strataFilter === 'freehold') {
    conditions.push(`${p}strata IS NULL AND NOT ${p}is_likely_strata`)
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/**
 * Build the OR clause combining locality-based and spatial polygon filters.
 *
 * Properties match if they are in ANY named locality OR inside ANY spatial
 * polygon. Returns empty string + empty params if neither filter is present.
 */
export function buildLocationOrClause(
  filter: PropertyFilter,
  spatial: { wherePredicate: string; params: Array<unknown> } | null,
  prefix: string,
): { clause: string; params: Array<unknown> } {
  const orParts: Array<string> = []
  const orParams: Array<unknown> = []

  if (filter.localities && filter.localities.length > 0) {
    const placeholders = filter.localities.map(() => '?').join(', ')
    orParts.push(`${prefix}.locality IN (${placeholders})`)
    orParams.push(...filter.localities)
  }

  if (spatial?.wherePredicate) {
    orParts.push(spatial.wherePredicate)
    orParams.push(...spatial.params)
  }

  if (orParts.length === 0) {
    return { clause: '', params: [] }
  }

  return {
    clause: `AND (${orParts.join(' OR ')})`,
    params: orParams,
  }
}

/**
 * Build a WHERE clause fragment that restricts to properties with 2+ sales.
 * Returns empty string when not needed.
 */
function repeatSalesClause(prefix: string, enabled?: boolean): string {
  if (!enabled) return ''
  const p = prefix ? `${prefix}.` : ''
  return `AND ${p}property_id IN (
    SELECT property_id FROM fact_property_sale
    WHERE purchase_price > 0
    GROUP BY property_id
    HAVING COUNT(*) >= 2
  )`
}

/**
 * Convert a DuckDB value to a plain JavaScript value.
 * Handles BigInt → Number conversion and DuckDBListValue → Array conversion.
 */
function convertDuckDBValue(val: unknown): unknown {
  if (typeof val === 'bigint') return Number(val)
  if (val !== null && typeof val === 'object' && 'items' in val) {
    return (val as { items: readonly unknown[] }).items.map(convertDuckDBValue)
  }
  return val
}

export async function executeQuery<T>(
  conn: DuckDBConnection,
  sql: string,
  params: Array<unknown>,
): Promise<Array<T>> {
  const prepared = await conn.prepare(sql)
  for (let i = 0; i < params.length; i++) {
    const val = params[i]
    if (val === null || val === undefined) {
      // Unbound params are treated as NULL by DuckDB
    } else if (typeof val === 'string') {
      prepared.bindVarchar(i + 1, val)
    } else if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        prepared.bindBigInt(i + 1, BigInt(val))
      } else {
        prepared.bindDouble(i + 1, val)
      }
    }
  }
  const reader = await prepared.runAndReadAll()
  const columns = reader.columnNames()
  const rows = reader.getRows()

  return rows.map((row) => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = convertDuckDBValue(row[i])
    }
    return obj as T
  })
}

// --- Query Functions ---

/**
 * Median price time series by suburb (and/or custom area) and time period.
 *
 * When spatial filters are present, uses UNION ALL to independently
 * aggregate each filter's matching rows. This allows overlapping areas
 * (e.g. "Chatswood" locality + "Lower North Shore" polygon that contains
 * Chatswood) to each show their full dataset — a sale can contribute
 * to multiple series.
 */
export async function queryMedianPriceTimeSeries(
  conn: DuckDBConnection,
  filter: PropertyFilter,
  granularity: Granularity,
  options?: { repeatSalesOnly?: boolean },
): Promise<Array<MedianPriceByPeriod>> {
  const periodExpr = periodExpression(granularity)
  const hasSpatial = filter.spatialFilters && filter.spatialFilters.length > 0

  const repeatFilter = repeatSalesClause('', options?.repeatSalesOnly)

  if (!hasSpatial) {
    // Fast path: no spatial filters, use simple query (no JOIN needed)
    const { clause, params } = buildWhereClause(filter)

    const sql = `
      SELECT
        ${periodExpr} AS period,
        locality,
        CAST(MEDIAN(purchase_price) AS BIGINT) AS median_price,
        COUNT(*) AS sale_count
      FROM fact_property_sale
      ${clause}
        ${repeatFilter}
      GROUP BY period, locality
      ORDER BY period, locality
    `

    const rows = await executeQuery<{
      period: string
      locality: string
      median_price: number
      sale_count: number
    }>(conn, sql, params)

    return rows.map((r) => ({
      period: r.period,
      locality: r.locality,
      medianPrice: r.median_price,
      saleCount: r.sale_count,
    }))
  }

  // Spatial path: UNION ALL of independent subqueries per filter.
  // Each locality and each spatial area gets its own subquery so
  // overlapping polygons independently aggregate their matching rows.
  const { buildSpatialJoin } =
    await import('@/features/areas/spatial/spatial-queries')
  const spatial = buildSpatialJoin(filter.spatialFilters!)

  // Base WHERE (excluding localities and spatial — those go per-subquery)
  const baseFilter: PropertyFilter = {
    ...filter,
    localities: undefined,
    spatialFilters: undefined,
  }
  const { clause: baseClause, params: baseParams } = buildWhereClause(
    baseFilter,
    { prefix: 'fps' },
  )
  const periodExprPrefixed = periodExpression(granularity, { prefix: 'fps' })
  const repeatFilterPrefixed = repeatSalesClause(
    'fps',
    options?.repeatSalesOnly,
  )

  const subqueries: Array<string> = []
  const allParams: Array<unknown> = []

  // Locality subquery (no JOIN needed, localities can't overlap)
  if (filter.localities && filter.localities.length > 0) {
    const placeholders = filter.localities.map(() => '?').join(', ')
    subqueries.push(`
      SELECT
        ${periodExprPrefixed} AS period,
        fps.locality,
        CAST(MEDIAN(fps.purchase_price) AS BIGINT) AS median_price,
        COUNT(*) AS sale_count
      FROM fact_property_sale fps
      ${baseClause}
        AND fps.locality IN (${placeholders})
        ${repeatFilterPrefixed}
      GROUP BY 1, 2
    `)
    allParams.push(...baseParams, ...filter.localities)
  }

  // One subquery per spatial area (independent aggregation)
  for (const sf of spatial.filters) {
    subqueries.push(`
      SELECT
        ${periodExprPrefixed} AS period,
        ? AS locality,
        CAST(MEDIAN(fps.purchase_price) AS BIGINT) AS median_price,
        COUNT(*) AS sale_count
      FROM fact_property_sale fps
      ${spatial.joinClause}
      ${baseClause}
        AND ${sf.wherePredicate}
        ${repeatFilterPrefixed}
      GROUP BY 1, 2
    `)
    allParams.push(sf.label, ...baseParams, ...sf.params)
  }

  const sql = subqueries.join('\nUNION ALL\n') + '\nORDER BY 1, 2'

  const rows = await executeQuery<{
    period: string
    locality: string
    median_price: number
    sale_count: number
  }>(conn, sql, allParams)

  return rows.map((r) => ({
    period: r.period,
    locality: r.locality,
    medianPrice: r.median_price,
    saleCount: r.sale_count,
  }))
}

/**
 * Median price per square metre time series by suburb (and/or custom area).
 *
 * Normalises hectares to sqm and excludes rows without valid area data.
 * Otherwise follows the same fast/spatial dual-path pattern as
 * {@link queryMedianPriceTimeSeries}.
 */
export async function queryMedianPriceSqmTimeSeries(
  conn: DuckDBConnection,
  filter: PropertyFilter,
  granularity: Granularity,
  options?: { repeatSalesOnly?: boolean },
): Promise<Array<MedianPriceSqmByPeriod>> {
  const hasSpatial = filter.spatialFilters && filter.spatialFilters.length > 0
  const repeatFilter = repeatSalesClause('', options?.repeatSalesOnly)

  // Shared SQL fragment: normalise area to sqm, compute price/sqm
  const areaSqm = (p: string) =>
    `CASE WHEN ${p}area_type = 'H' THEN ${p}area * 10000 ELSE ${p}area END`
  const areaGuard = (p: string) =>
    `${p}area > 0 AND ${p}area_type IN ('M', 'H')`

  if (!hasSpatial) {
    const { clause, params } = buildWhereClause(filter)
    const periodExpr = periodExpression(granularity)

    const sql = `
      SELECT
        ${periodExpr} AS period,
        locality,
        CAST(MEDIAN(purchase_price / (${areaSqm('')})) AS BIGINT) AS median_price_sqm,
        COUNT(*) AS sale_count
      FROM fact_property_sale
      ${clause}
        AND ${areaGuard('')}
        ${repeatFilter}
      GROUP BY period, locality
      ORDER BY period, locality
    `

    const rows = await executeQuery<{
      period: string
      locality: string
      median_price_sqm: number
      sale_count: number
    }>(conn, sql, params)

    return rows.map((r) => ({
      period: r.period,
      locality: r.locality,
      medianPriceSqm: r.median_price_sqm,
      saleCount: r.sale_count,
    }))
  }

  // Spatial path: UNION ALL of independent subqueries (same approach
  // as queryMedianPriceTimeSeries — see its JSDoc for rationale).
  const { buildSpatialJoin } =
    await import('@/features/areas/spatial/spatial-queries')
  const spatial = buildSpatialJoin(filter.spatialFilters!)

  const baseFilter: PropertyFilter = {
    ...filter,
    localities: undefined,
    spatialFilters: undefined,
  }
  const { clause: baseClause, params: baseParams } = buildWhereClause(
    baseFilter,
    { prefix: 'fps' },
  )
  const periodExprPrefixed = periodExpression(granularity, { prefix: 'fps' })
  const repeatFilterPrefixed = repeatSalesClause(
    'fps',
    options?.repeatSalesOnly,
  )

  const subqueries: Array<string> = []
  const allParams: Array<unknown> = []

  // Locality subquery
  if (filter.localities && filter.localities.length > 0) {
    const placeholders = filter.localities.map(() => '?').join(', ')
    subqueries.push(`
      SELECT
        ${periodExprPrefixed} AS period,
        fps.locality,
        CAST(MEDIAN(fps.purchase_price / (${areaSqm('fps.')})) AS BIGINT) AS median_price_sqm,
        COUNT(*) AS sale_count
      FROM fact_property_sale fps
      ${baseClause}
        AND fps.locality IN (${placeholders})
        AND ${areaGuard('fps.')}
        ${repeatFilterPrefixed}
      GROUP BY 1, 2
    `)
    allParams.push(...baseParams, ...filter.localities)
  }

  // One subquery per spatial area
  for (const sf of spatial.filters) {
    subqueries.push(`
      SELECT
        ${periodExprPrefixed} AS period,
        ? AS locality,
        CAST(MEDIAN(fps.purchase_price / (${areaSqm('fps.')})) AS BIGINT) AS median_price_sqm,
        COUNT(*) AS sale_count
      FROM fact_property_sale fps
      ${spatial.joinClause}
      ${baseClause}
        AND ${sf.wherePredicate}
        AND ${areaGuard('fps.')}
        ${repeatFilterPrefixed}
      GROUP BY 1, 2
    `)
    allParams.push(sf.label, ...baseParams, ...sf.params)
  }

  const sql = subqueries.join('\nUNION ALL\n') + '\nORDER BY 1, 2'

  const rows = await executeQuery<{
    period: string
    locality: string
    median_price_sqm: number
    sale_count: number
  }>(conn, sql, allParams)

  return rows.map((r) => ({
    period: r.period,
    locality: r.locality,
    medianPriceSqm: r.median_price_sqm,
    saleCount: r.sale_count,
  }))
}

/**
 * Growth rate comparison between two years.
 */
export async function queryGrowthRates(
  conn: DuckDBConnection,
  filter: PropertyFilter,
  yearFrom: number,
  yearTo: number,
): Promise<Array<GrowthRate>> {
  const { clause, params } = buildWhereClause(filter)

  const sql = `
    WITH periods AS (
      SELECT
        locality,
        CAST(MEDIAN(purchase_price) FILTER (WHERE EXTRACT(YEAR FROM contract_date) = ?) AS BIGINT) AS median_from,
        CAST(MEDIAN(purchase_price) FILTER (WHERE EXTRACT(YEAR FROM contract_date) = ?) AS BIGINT) AS median_to
      FROM fact_property_sale
      ${clause}
      GROUP BY locality
    )
    SELECT
      locality,
      median_from,
      median_to,
      ROUND((median_to - median_from) * 100.0 / median_from, 2) AS growth_percent
    FROM periods
    WHERE median_from > 0 AND median_to > 0
    ORDER BY growth_percent DESC
  `

  const allParams = [yearFrom, yearTo, ...params]
  const rows = await executeQuery<{
    locality: string
    median_from: number
    median_to: number
    growth_percent: number
  }>(conn, sql, allParams)

  return rows.map((r) => ({
    locality: r.locality,
    medianFrom: r.median_from,
    medianTo: r.median_to,
    growthPercent: r.growth_percent,
  }))
}

/**
 * Summary statistics per suburb.
 */
export async function querySuburbSummary(
  conn: DuckDBConnection,
  filter: PropertyFilter,
): Promise<Array<SuburbSummary>> {
  const { clause, params } = buildWhereClause(filter, { prefix: 'fps' })

  const sql = `
    SELECT
      fps.locality,
      fps.post_code,
      COALESCE(dd.council_name, 'Unknown') AS council_name,
      COUNT(*) AS total_sales,
      CAST(MEDIAN(fps.purchase_price) AS BIGINT) AS median_price,
      MIN(fps.purchase_price) AS min_price,
      MAX(fps.purchase_price) AS max_price,
      CAST(MIN(fps.contract_date) AS VARCHAR) AS earliest_sale,
      CAST(MAX(fps.contract_date) AS VARCHAR) AS latest_sale
    FROM fact_property_sale fps
    LEFT JOIN dim_district dd ON fps.district_code = dd.district_code
    ${clause}
      AND fps.locality IS NOT NULL
    GROUP BY fps.locality, fps.post_code, dd.council_name
    ORDER BY total_sales DESC
  `

  const rows = await executeQuery<{
    locality: string
    post_code: string
    council_name: string
    total_sales: number
    median_price: number
    min_price: number
    max_price: number
    earliest_sale: string
    latest_sale: string
  }>(conn, sql, params)

  return rows.map((r) => ({
    locality: r.locality,
    postCode: r.post_code,
    councilName: r.council_name,
    totalSales: r.total_sales,
    medianPrice: r.median_price,
    minPrice: r.min_price,
    maxPrice: r.max_price,
    earliestSale: r.earliest_sale,
    latestSale: r.latest_sale,
  }))
}

/**
 * Overall database statistics for the dashboard header.
 */
export async function queryDatabaseStats(
  conn: DuckDBConnection,
): Promise<DatabaseStats> {
  const sql = `
    SELECT
      COUNT(*) AS total_sales,
      COUNT(DISTINCT locality) AS total_suburbs,
      CAST(MIN(EXTRACT(YEAR FROM contract_date)) AS INTEGER) AS year_min,
      CAST(MAX(EXTRACT(YEAR FROM contract_date)) AS INTEGER) AS year_max,
      COUNT(DISTINCT district_code) AS total_districts
    FROM fact_property_sale
    WHERE purchase_price > 0 AND contract_date IS NOT NULL
      AND EXTRACT(YEAR FROM contract_date) >= 1980
  `

  const rows = await executeQuery<{
    total_sales: number
    total_suburbs: number
    year_min: number
    year_max: number
    total_districts: number
  }>(conn, sql, [])

  const row = rows[0]
  return {
    totalSales: row?.total_sales ?? 0,
    totalSuburbs: row?.total_suburbs ?? 0,
    yearRange: [row?.year_min ?? 0, row?.year_max ?? 0],
    totalDistricts: row?.total_districts ?? 0,
  }
}
