/**
 * Server-side query functions for the growth heatmap widget.
 *
 * Most functions query the pre-aggregated agg_h3_growth table (~50ms).
 * Hex detail queries (yearly medians, individual sales) scan the raw
 * fact_property_sale table and are slower (~200-500ms).
 *
 * This module is server-only. It is dynamically imported by server functions
 * in server-fns.ts to prevent bundling into the client.
 */

import { executeQuery } from './queries'
import type { DuckDBConnection } from '@duckdb/node-api'

/** Which price metric to visualise. */
export type GrowthMetric = 'median-price' | 'price-per-sqm'

/**
 * Growth computation method for heatmap cells.
 *
 * - `'endpoint'` — Compare 3-year start vs end window medians (CAGR).
 *   Simple but sensitive to noise in either window.
 * - `'trend-fit'` — Log-linear regression through ALL yearly medians.
 *   Robust to endpoint noise because every year contributes to the fit.
 *   Assumes monotonic exponential growth (can't capture reversals).
 * - `'loess'` — LOESS (Locally Estimated Scatterplot Smoothing).
 *   Fits local weighted regressions at the start and end years using a
 *   tricube kernel. Captures non-monotonic trajectories (peaks, reversals,
 *   flat periods). CAGR is computed from the smoothed endpoint values.
 */
export type GrowthMethod = 'endpoint' | 'trend-fit' | 'loess'

/**
 * Last fully completed quarter as a year-fraction.
 *
 * The current quarter is still in progress and has incomplete data.
 * This returns the previous quarter, which has a full 3 months of sales.
 *
 * In March 2026 (Q1 in progress): returns 2025.75 (Q4 2025).
 * In July 2026 (Q3 in progress): returns 2026.25 (Q2 2026).
 */
export function lastCompletedQuarter(): number {
  const now = new Date()
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) // 0=Q1, 1=Q2, 2=Q3, 3=Q4
  if (quarter === 0) return year - 1 + 0.75 // In Q1 → Q4 of previous year
  return year + (quarter - 1) * 0.25
}

/**
 * What the loaded database covers, read from the data rather than the clock.
 * A database built months ago still offers only the years it has.
 */
export interface DataCoverage {
  /** Latest whole year the precomputed LOESS curves reach (e.g. 2026), or null if none. */
  latestYear: number | null
  /** ISO date (YYYY-MM-DD) of the newest NSW VG weekly file loaded, or null if unknown. */
  dataTo: string | null
}

/**
 * Converts an `etl_loaded_file.week` folder name (YYYYMMDD) to an ISO date.
 * Returns null for anything that is not a plausible date.
 */
export function weekFolderToIsoDate(week: string | null | undefined): string | null {
  if (!week || !/^\d{8}$/.test(week)) return null
  const iso = `${week.slice(0, 4)}-${week.slice(4, 6)}-${week.slice(6, 8)}`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

/**
 * The end year heatmap periods are measured to: the data's latest year when known,
 * otherwise the year of the last completed quarter.
 */
export function heatmapEndYear(coverage: DataCoverage | null | undefined): number {
  return coverage?.latestYear ?? Math.floor(lastCompletedQuarter())
}

/**
 * Reads the database's coverage. Each part is optional: a database built without
 * the heatmap step or the load log still answers with what it has.
 */
export async function queryDataCoverage(conn: DuckDBConnection): Promise<DataCoverage> {
  let latestYear: number | null = null
  let dataTo: string | null = null
  try {
    const rows = await executeQuery<{ latest_year: number | null }>(
      conn,
      'SELECT CAST(floor(max(max_quarter)) AS INTEGER) AS latest_year FROM agg_h3_loess_curve',
      [],
    )
    latestYear = rows[0]?.latest_year ?? null
  } catch {
    latestYear = null
  }
  try {
    const rows = await executeQuery<{ latest_week: string | null }>(
      conn,
      // Archived (1990-2001) files are logged with week 'archive', which sorts above any date.
      "SELECT max(week) AS latest_week FROM etl_loaded_file WHERE regexp_full_match(week, '[0-9]{8}')",
      [],
    )
    dataTo = weekFolderToIsoDate(rows[0]?.latest_week)
  } catch {
    dataTo = null
  }
  return { latestYear, dataTo }
}

/**
 * Request parameters for heatmap growth data.
 * Sent from the client widget via RPC to the server function.
 */
export interface HeatmapGrowthRequest {
  /** H3 resolution to query (7 = suburb, 8 = mid, 9 = neighbourhood). */
  resolution: 7 | 8 | 9

  /** Years to look back for growth calculation. */
  yearsBack: 5 | 10 | 15 | 20 | 25

  /** Which price metric. */
  metric: GrowthMetric

  /** Property type segmentation. */
  strataFilter: 'all' | 'freehold' | 'strata'

  /**
   * Which growth computation method to use.
   * Defaults to `'endpoint'` for backward compatibility.
   */
  growthMethod?: GrowthMethod

  /**
   * Optional viewport bounding box for spatial filtering.
   * At high resolutions (res 8), fetching all of NSW returns thousands of
   * points. Viewport filtering limits the result to visible cells only.
   */
  viewport?: {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  }
}

/**
 * A stored LOESS curve for a single H3 cell.
 *
 * Returned by the curve query for the hex detail dialog chart and for
 * query-time growth computation. The `fittedPrices` array contains one
 * LOESS-smoothed price per quarter from `minQuarter` to `maxQuarter`.
 *
 * Array indexing (0-indexed in TypeScript):
 *   index = Math.round((targetQuarter - minQuarter) / 0.25)
 *
 * Data source: `agg_h3_loess_curve` table (populated by ETL).
 * See: docs/methodology.md (sections 6 to 8) and docs/research/full-curve-loess-architecture.md
 */
export interface LoessCurveData {
  /** First quarter in the fitted_prices array (e.g. 1993.0). */
  minQuarter: number
  /** Last quarter in the fitted_prices array (e.g. 2025.75). */
  maxQuarter: number
  /** Bandwidth used for the LOESS fit, in years. */
  bandwidth: number
  /**
   * Array of fitted prices, one per quarter from minQuarter to maxQuarter.
   * May contain nulls at positions where the LOESS fit failed due to
   * insufficient kernel support (data gaps wider than the bandwidth window).
   */
  fittedPrices: Array<number | null>
  /** Total sales across all quarters for this cell. */
  totalSales: number
  /** Number of distinct quarters with raw sales data. */
  quarterCount: number
}

/**
 * Request parameters for heatmap growth computed from precomputed LOESS curves.
 *
 * Unlike {@link HeatmapGrowthRequest} (which reads from `agg_h3_growth` with
 * fixed yearsBack buckets), this reads from `agg_h3_loess_curve` and computes
 * growth between arbitrary quarter endpoints via array index lookups.
 */
export interface LoessHeatmapRequest {
  /** H3 resolution to query (7 = suburb, 8 = mid, 9 = neighbourhood). */
  resolution: 7 | 8 | 9
  /** Which price metric. */
  metric: GrowthMetric
  /** Property type segmentation. */
  strataFilter: 'all' | 'freehold' | 'strata'
  /** Start quarter as year-fraction (e.g. 2021.0 = Q1 2021). */
  startQuarter: number
  /** End quarter as year-fraction (e.g. 2026.0 = Q1 2026). */
  endQuarter: number
  /** Optional viewport bounding box for spatial filtering. */
  viewport?: {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  }
}

/** Request parameters for fetching a single cell's full LOESS curve. */
export interface LoessCurveRequest {
  /** H3 cell index as hex string. */
  h3Index: string
  /** H3 resolution. */
  resolution: number
  /** Which price metric. */
  metric: GrowthMetric
  /** Property type segmentation. */
  strataFilter: 'all' | 'freehold' | 'strata'
}

/**
 * A single data point returned to the client for IDW rendering.
 * Each point represents one H3 cell's centroid with its growth statistics.
 */
export interface HeatmapDataPoint {
  /** Latitude of H3 cell centroid (for IDW spatial position). */
  lat: number
  /** Longitude of H3 cell centroid (for IDW spatial position). */
  lng: number
  /** Annualized compound growth rate (decimal, e.g. 0.065 = 6.5% p.a.). */
  growth: number
  /** Total sales across both time windows. For confidence display. */
  saleCount: number
  /** Median price/value in the start window. For tooltip detail. */
  medianStart: number
  /** Median price/value in the end window. For tooltip detail. */
  medianEnd: number
  /** Most common suburb name in this H3 cell. For tooltip display. */
  locality: string | null
  /** H3 cell index as hex string. Used for cell boundary rendering on hover. */
  h3Index: string
  /** Metro-wide average growth for this combo (only present in relative query). */
  metroAvg?: number
  /** Regression-fitted price at display start year (trend-fit only). */
  trendFitStart?: number
  /** Regression-fitted price at display end year (trend-fit only). */
  trendFitEnd?: number
  /**
   * Log-linear regression intercept (ln-scale, trend-fit only).
   * The authoritative parameter for computing fitted values at any year:
   *   fitted_price(year) = exp(intercept + slope * year)
   * where slope = ln(1 + growth).
   */
  trendFitIntercept?: number
  /**
   * R-squared (coefficient of determination) for the log-linear regression.
   * Range 0.0 to 1.0. Measures how well the exponential growth model
   * fits the observed yearly medians. Displayed in tooltips and the hex
   * detail dialog as a confidence indicator.
   *
   * Interpretation: >= 0.7 good, >= 0.4 moderate, < 0.4 poor fit.
   * NULL/undefined when trend-fit data is not available for this cell.
   */
  trendFitR2?: number
  /** LOESS-smoothed price at display start year (LOESS method only). */
  loessStart?: number
  /** LOESS-smoothed price at display end year (LOESS method only). */
  loessEnd?: number
}

/**
 * Query pre-aggregated H3 growth data for the heatmap widget.
 *
 * Performs a simple indexed SELECT on the agg_h3_growth table.
 * Expected query time: ~50ms.
 *
 * @param conn - Active DuckDB connection.
 * @param request - Query parameters from the client.
 * @returns Array of data points for IDW rendering.
 */
export async function queryHeatmapGrowthData(
  conn: DuckDBConnection,
  request: HeatmapGrowthRequest,
): Promise<Array<HeatmapDataPoint>> {
  const conditions: Array<string> = [
    'resolution = ?',
    'years_back = ?',
    'metric = ?',
    'strata_filter = ?',
  ]
  const params: Array<unknown> = [
    request.resolution,
    request.yearsBack,
    request.metric,
    request.strataFilter,
  ]

  if (request.viewport) {
    conditions.push('centroid_lat BETWEEN ? AND ?')
    conditions.push('centroid_lng BETWEEN ? AND ?')
    params.push(request.viewport.minLat, request.viewport.maxLat)
    params.push(request.viewport.minLng, request.viewport.maxLng)
  }

  // Select the growth column for the chosen method.
  // COALESCE ensures cells without enough data for the advanced method
  // fall back to the endpoint CAGR value gracefully.
  let growthExpr = 'annualized_growth'
  if (request.growthMethod === 'trend-fit') {
    growthExpr = 'COALESCE(trend_fit_growth, annualized_growth)'
  }

  // Include method-specific columns for tooltip/dialog display.
  let extraColumns = ''
  if (request.growthMethod === 'trend-fit') {
    // trend_fit_r2 is the R² goodness-of-fit used as a confidence indicator.
    extraColumns =
      ', trend_fit_start, trend_fit_end, trend_fit_intercept, trend_fit_r2'
  }

  const sql = `
    SELECT
      centroid_lat,
      centroid_lng,
      ${growthExpr} AS growth_rate,
      sale_count_start + sale_count_end AS sale_count,
      median_start,
      median_end,
      locality,
      printf('%x', h3_cell::UBIGINT) AS h3_index
      ${extraColumns}
    FROM agg_h3_growth
    WHERE ${conditions.join(' AND ')}
  `

  const rows = await executeQuery<{
    centroid_lat: number
    centroid_lng: number
    growth_rate: number
    sale_count: number
    median_start: number
    median_end: number
    locality: string | null
    h3_index: string
    trend_fit_start?: number | null
    trend_fit_end?: number | null
    trend_fit_intercept?: number | null
    trend_fit_r2?: number | null
  }>(conn, sql, params)

  return rows.map((r) => ({
    lat: r.centroid_lat,
    lng: r.centroid_lng,
    growth: r.growth_rate,
    saleCount: r.sale_count,
    medianStart: r.median_start,
    medianEnd: r.median_end,
    locality: r.locality,
    h3Index: r.h3_index,
    ...(r.trend_fit_start != null && { trendFitStart: r.trend_fit_start }),
    ...(r.trend_fit_end != null && { trendFitEnd: r.trend_fit_end }),
    ...(r.trend_fit_intercept != null && {
      trendFitIntercept: r.trend_fit_intercept,
    }),
    ...(r.trend_fit_r2 != null && { trendFitR2: r.trend_fit_r2 }),
  }))
}

/**
 * Query relative performance data (growth minus metro average).
 *
 * Uses the pre-computed metro_avg_growth column. Returns the difference
 * as `growth` so the IDW renderer can visualise it directly with a
 * diverging color scale centered on zero.
 */
export async function queryRelativePerformanceData(
  conn: DuckDBConnection,
  request: HeatmapGrowthRequest,
): Promise<Array<HeatmapDataPoint>> {
  const conditions: Array<string> = [
    'resolution = ?',
    'years_back = ?',
    'metric = ?',
    'strata_filter = ?',
    'metro_avg_growth IS NOT NULL',
  ]
  const params: Array<unknown> = [
    request.resolution,
    request.yearsBack,
    request.metric,
    request.strataFilter,
  ]

  if (request.viewport) {
    conditions.push('centroid_lat BETWEEN ? AND ?')
    conditions.push('centroid_lng BETWEEN ? AND ?')
    params.push(request.viewport.minLat, request.viewport.maxLat)
    params.push(request.viewport.minLng, request.viewport.maxLng)
  }

  const sql = `
    SELECT
      centroid_lat,
      centroid_lng,
      annualized_growth - metro_avg_growth AS relative_growth,
      annualized_growth,
      metro_avg_growth,
      sale_count_start + sale_count_end AS sale_count,
      median_start,
      median_end,
      locality,
      printf('%x', h3_cell::UBIGINT) AS h3_index
    FROM agg_h3_growth
    WHERE ${conditions.join(' AND ')}
  `

  const rows = await executeQuery<{
    centroid_lat: number
    centroid_lng: number
    relative_growth: number
    annualized_growth: number
    metro_avg_growth: number
    sale_count: number
    median_start: number
    median_end: number
    locality: string | null
    h3_index: string
  }>(conn, sql, params)

  return rows.map((r) => ({
    lat: r.centroid_lat,
    lng: r.centroid_lng,
    growth: r.relative_growth,
    saleCount: r.sale_count,
    medianStart: r.median_start,
    medianEnd: r.median_end,
    locality: r.locality,
    h3Index: r.h3_index,
    metroAvg: r.metro_avg_growth,
  }))
}

// ---------------------------------------------------------------------------
// Hex detail queries — scan raw fact table for a single H3 cell
// ---------------------------------------------------------------------------

/** Request params for hex detail queries. */
export interface HexDetailRequest {
  h3Index: string
  resolution: number
  metric: GrowthMetric
  strataFilter: 'all' | 'freehold' | 'strata'
}

/** Yearly median data for a single H3 cell. */
export interface HexYearlyMedian {
  year: number
  medianPrice: number
  saleCount: number
}

/** Individual sale in a hex cell. */
export interface HexSale {
  propertyId: string
  address: string | null
  locality: string | null
  purchasePrice: number
  contractDate: string
  area: number | null
  areaType: string | null
  strata: string | null
  natureOfProperty: string | null
}

/** Build shared WHERE clause fragments for hex detail queries. */
function hexDetailClauses(metric: GrowthMetric, strataFilter: string) {
  const conditions = [
    'fps.purchase_price > 0',
    'fps.contract_date IS NOT NULL',
    'da.latitude IS NOT NULL',
    'da.longitude IS NOT NULL',
    // Data quality flags — same set used by buildWhereClause() and the ETL pipeline.
    'fps.is_bulk_sale = FALSE',
    'fps.is_price_outlier = FALSE',
    'fps.is_nominal_transfer = FALSE',
    'fps.is_partial_interest = FALSE',
    'fps.is_multi_dealing_dup = FALSE',
  ]

  // Strata/freehold split uses is_likely_strata for community-title apartments.
  if (strataFilter === 'freehold')
    conditions.push('fps.strata IS NULL AND NOT fps.is_likely_strata')
  else if (strataFilter === 'strata')
    conditions.push('(fps.strata IS NOT NULL OR fps.is_likely_strata)')

  if (metric === 'price-per-sqm') {
    conditions.push('fps.area > 0')
    conditions.push("fps.area_type IN ('M', 'H')")
  }

  return conditions
}

/**
 * Price expression matching the ETL pipeline.
 *
 * Must stay in sync with `scripts/src/heatmap/h3-precompute.ts:priceExpression()`.
 * Both functions produce the same SQL fragment for a given metric.
 */
function priceExpr(metric: GrowthMetric): string {
  if (metric === 'median-price') return 'fps.purchase_price'
  return "fps.purchase_price / (CASE WHEN fps.area_type = 'H' THEN fps.area * 10000 ELSE fps.area END)"
}

/** Shared FROM/JOIN fragment for hex detail queries. */
const HEX_JOIN = `
  FROM fact_property_sale fps
  JOIN dim_address da
    ON fps.property_id = da.property_id
    AND COALESCE(fps.unit_number, '') = da.unit_number
    AND COALESCE(fps.house_number, '') = da.house_number
`

/**
 * Query yearly median prices for a single H3 cell.
 * Used by the hex detail dialog to render the raw data scatter plot
 * alongside the precomputed LOESS curve.
 *
 * Returns ALL years (no year range filter) with the same WHERE clause
 * filters and price expression as the ETL pipeline.
 */
export async function queryHexYearlyMedians(
  conn: DuckDBConnection,
  request: HexDetailRequest,
): Promise<Array<HexYearlyMedian>> {
  const conditions = hexDetailClauses(request.metric, request.strataFilter)
  conditions.push(
    `h3_latlng_to_cell(da.latitude, da.longitude, ${request.resolution})::BIGINT = ('0x' || ?)::BIGINT`,
  )

  const sql = `
    SELECT
      EXTRACT(YEAR FROM fps.contract_date)::INT AS year,
      CAST(MEDIAN(${priceExpr(request.metric)}) AS BIGINT) AS median_price,
      COUNT(*) AS sale_count
    ${HEX_JOIN}
    WHERE ${conditions.join(' AND ')}
    GROUP BY year
    ORDER BY year
  `

  const rows = await executeQuery<{
    year: number
    median_price: number
    sale_count: number
  }>(conn, sql, [request.h3Index])

  return rows.map((r) => ({
    year: r.year,
    medianPrice: r.median_price,
    saleCount: r.sale_count,
  }))
}

/**
 * Query individual sales for a single H3 cell.
 * Used by the hex detail dialog to render the sales table.
 */
export async function queryHexSales(
  conn: DuckDBConnection,
  request: HexDetailRequest,
): Promise<Array<HexSale>> {
  const conditions = hexDetailClauses(request.metric, request.strataFilter)
  conditions.push(
    `h3_latlng_to_cell(da.latitude, da.longitude, ${request.resolution})::BIGINT = ('0x' || ?)::BIGINT`,
  )

  const sql = `
    SELECT
      fps.property_id,
      TRIM(CONCAT_WS(' ',
        NULLIF(fps.unit_number, ''),
        NULLIF(fps.house_number, ''),
        fps.street_name
      )) AS address,
      fps.locality,
      fps.purchase_price,
      CAST(fps.contract_date AS VARCHAR) AS contract_date,
      fps.area,
      fps.area_type,
      fps.strata,
      fps.nature_of_property
    ${HEX_JOIN}
    WHERE ${conditions.join(' AND ')}
    ORDER BY fps.contract_date DESC
  `

  const rows = await executeQuery<{
    property_id: string
    address: string | null
    locality: string | null
    purchase_price: number
    contract_date: string
    area: number | null
    area_type: string | null
    strata: string | null
    nature_of_property: string | null
  }>(conn, sql, [request.h3Index])

  return rows.map((r) => ({
    propertyId: r.property_id,
    address: r.address,
    locality: r.locality,
    purchasePrice: r.purchase_price,
    contractDate: r.contract_date,
    area: r.area,
    areaType: r.area_type,
    strata: r.strata,
    natureOfProperty: r.nature_of_property,
  }))
}

// ---------------------------------------------------------------------------
// Precomputed LOESS curve queries — read from agg_h3_loess_curve
// ---------------------------------------------------------------------------

/**
 * Query heatmap growth data computed from precomputed LOESS curves.
 *
 * Reads the `agg_h3_loess_curve` table and computes CAGR between two
 * arbitrary quarter endpoints via `list_extract` lookups into the stored
 * `fitted_prices` array. No LOESS computation at query time.
 *
 * @param conn - Active DuckDB connection.
 * @param request - Query parameters including start/end quarters.
 * @returns Array of data points for IDW rendering.
 */
export async function queryLoessHeatmapData(
  conn: DuckDBConnection,
  request: LoessHeatmapRequest,
): Promise<Array<HeatmapDataPoint>> {
  // WHERE conditions: require actual sales data spanning the full requested period.
  // Hexes without data at both ends are excluded — no extrapolated growth rates.
  // The final WHERE also filters out cells where the LOESS fit has NULLs at
  // either endpoint (data gaps wider than the bandwidth window).
  const conditions: Array<string> = [
    'resolution = ?',
    'metric = ?',
    'strata_filter = ?',
    'earliest_sale <= ?', // data exists at or before the start year
    'latest_sale >= ?',   // data exists at or after the end year
  ]
  const params: Array<unknown> = [
    request.resolution,
    request.metric,
    request.strataFilter,
    request.startQuarter,
    request.endQuarter,
  ]

  if (request.viewport) {
    conditions.push('centroid_lat BETWEEN ? AND ?')
    conditions.push('centroid_lng BETWEEN ? AND ?')
    params.push(request.viewport.minLat, request.viewport.maxLat)
    params.push(request.viewport.minLng, request.viewport.maxLng)
  }

  // Clamp the requested quarters to the curve's actual coverage.
  // We use the stored LOESS values directly — no reliable-interior clamping.
  // The adaptive bandwidth in the ETL already produces reasonable edge values.
  const sql = `
    WITH curve_data AS (
      SELECT *,
        GREATEST(min_quarter, ?::DOUBLE) AS actual_start,
        LEAST(max_quarter, ?::DOUBLE) AS actual_end
      FROM agg_h3_loess_curve
      WHERE ${conditions.join(' AND ')}
    )
    SELECT
      centroid_lat,
      centroid_lng,
      list_extract(fitted_prices, CAST((actual_end - min_quarter) / 0.25 + 1 AS INT)) AS loess_end,
      list_extract(fitted_prices, CAST((actual_start - min_quarter) / 0.25 + 1 AS INT)) AS loess_start,
      POWER(
        list_extract(fitted_prices, CAST((actual_end - min_quarter) / 0.25 + 1 AS INT))::DOUBLE
        / NULLIF(list_extract(fitted_prices, CAST((actual_start - min_quarter) / 0.25 + 1 AS INT))::DOUBLE, 0),
        1.0 / NULLIF(actual_end - actual_start, 0)
      ) - 1 AS growth_rate,
      total_sales AS sale_count,
      locality,
      printf('%x', h3_cell::UBIGINT) AS h3_index
    FROM curve_data
    WHERE actual_end > actual_start
      AND loess_start IS NOT NULL
      AND loess_end IS NOT NULL
  `

  // Parameter order:
  //   CTE: startQuarter (GREATEST), endQuarter (LEAST), then WHERE params
  //   No SELECT-level params — actual_start/actual_end are CTE column references
  const allParams = [
    request.startQuarter,
    request.endQuarter,
    ...params,
  ]

  const rows = await executeQuery<{
    centroid_lat: number
    centroid_lng: number
    loess_end: number
    loess_start: number
    growth_rate: number
    sale_count: number
    locality: string | null
    h3_index: string
  }>(conn, sql, allParams)

  return rows.map((r) => ({
    lat: r.centroid_lat,
    lng: r.centroid_lng,
    growth: r.growth_rate,
    saleCount: r.sale_count,
    medianStart: r.loess_start,
    medianEnd: r.loess_end,
    loessStart: r.loess_start,
    loessEnd: r.loess_end,
    locality: r.locality,
    h3Index: r.h3_index,
  }))
}

/**
 * Fetch the full precomputed LOESS curve for a single H3 cell.
 *
 * Used by the hex detail dialog to render the smoothed price trend chart
 * without re-computing LOESS client-side.
 *
 * @param conn - Active DuckDB connection.
 * @param request - Cell identifier and filter parameters.
 * @returns The curve data, or null if no curve exists for this combination.
 */
export async function queryLoessCurve(
  conn: DuckDBConnection,
  request: LoessCurveRequest,
): Promise<LoessCurveData | null> {
  const sql = `
    SELECT
      min_quarter, max_quarter, bandwidth,
      fitted_prices,
      total_sales, quarter_count
    FROM agg_h3_loess_curve
    WHERE h3_cell = ('0x' || ?)::BIGINT
      AND resolution = ?
      AND metric = ?
      AND strata_filter = ?
  `

  const rows = await executeQuery<{
    min_quarter: number
    max_quarter: number
    bandwidth: number
    fitted_prices: Array<number | bigint | null>
    total_sales: number
    quarter_count: number
  }>(conn, sql, [
    request.h3Index,
    request.resolution,
    request.metric,
    request.strataFilter,
  ])

  if (rows.length === 0) return null

  const row = rows[0]
  return {
    minQuarter: row.min_quarter,
    maxQuarter: row.max_quarter,
    bandwidth: row.bandwidth,
    fittedPrices: row.fitted_prices.map((v) => (v == null ? null : Number(v))),
    totalSales: row.total_sales,
    quarterCount: row.quarter_count,
  }
}
