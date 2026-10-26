/**
 * H3 heatmap precomputation engine.
 *
 * Computes annualized growth rates per H3 hexagonal cell across all
 * combinations of (resolution, yearsBack, metric, strataFilter). The
 * results are stored in the `agg_h3_growth` table for fast server-side
 * lookups by the growth heatmap widget.
 *
 * Performance: ~200ms per combination, ~12s total for all 60 combinations
 * against 6.6M sales with 99.2% geocoding coverage.
 *
 * Growth formula (CAGR):
 *   annualized_growth = POWER(median_end / median_start, 1.0 / years_back) - 1
 *
 * Time windows use 3-year smoothing to reduce single-year noise:
 *   Start: [currentYear - yearsBack - 1, currentYear - yearsBack + 1]
 *   End:   [currentYear - 2, currentYear]
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import type {
  H3Resolution,
  YearsBack,
  GrowthMetric,
  StrataFilterValue,
  PrecomputeStats,
} from './types.js'
import {
  H3_RESOLUTIONS,
  YEARS_BACK_VALUES,
  GROWTH_METRICS,
  STRATA_FILTERS,
  MIN_SALES_THRESHOLD,
} from './types.js'
import { dropHeatmapTable, initHeatmapSchema, loadH3Extension } from './schema.js'

/**
 * Build the SQL WHERE clause fragment for a strata filter.
 * Returns an empty string for 'all' (no filtering).
 *
 * Uses `is_likely_strata` to correctly classify community-title and
 * company-title apartments that the NSW VG records with `strata = NULL`.
 * See `scripts/src/db/data-quality.ts:flagLikelyStrata()` for detection logic.
 */
export function strataCondition(strata: StrataFilterValue, prefix: string): string {
  switch (strata) {
    case 'freehold': return `AND ${prefix}.strata IS NULL AND NOT ${prefix}.is_likely_strata`
    case 'strata': return `AND (${prefix}.strata IS NOT NULL OR ${prefix}.is_likely_strata)`
    case 'all': return ''
  }
}

/**
 * Build the price expression for the given metric.
 * For 'median-price', this is just purchase_price.
 * For 'price-per-sqm', it normalises hectares to sqm and guards against zero/null area.
 */
export function priceExpression(metric: GrowthMetric, prefix: string): string {
  if (metric === 'median-price') {
    return `${prefix}.purchase_price`
  }
  // price-per-sqm: normalise hectares to sqm
  return `${prefix}.purchase_price / (CASE WHEN ${prefix}.area_type = 'H' THEN ${prefix}.area * 10000 ELSE ${prefix}.area END)`
}

/**
 * Build extra WHERE conditions for the price-per-sqm metric.
 * Excludes rows without valid area data.
 */
export function areaGuard(metric: GrowthMetric, prefix: string): string {
  if (metric === 'median-price') return ''
  return `AND ${prefix}.area > 0 AND ${prefix}.area_type IN ('M', 'H')`
}

/**
 * Build and execute the INSERT query for one (resolution, yearsBack, metric, strata) combination.
 *
 * The query uses two CTEs:
 * 1. `start_window`: sales in the 3-year window around (currentYear - yearsBack)
 * 2. `end_window`: sales in the 3-year window ending at currentYear
 *
 * Both are grouped by H3 cell and compute MEDIAN price and sale count.
 * The final SELECT joins them and computes the CAGR growth rate.
 *
 * @returns Number of rows inserted for this combination.
 */
async function computeAndInsertCombo(
  conn: DuckDBConnection,
  resolution: H3Resolution,
  yearsBack: YearsBack,
  metric: GrowthMetric,
  strataFilter: StrataFilterValue,
  currentYear: number,
): Promise<number> {
  const minSales = MIN_SALES_THRESHOLD[resolution]
  const strata = strataCondition(strataFilter, 'fps')
  const priceExpr = priceExpression(metric, 'fps')
  const areaFilter = areaGuard(metric, 'fps')

  // 3-year smoothed windows
  const startYearFrom = currentYear - yearsBack - 1
  const startYearTo = currentYear - yearsBack + 1
  const endYearFrom = currentYear - 2
  const endYearTo = currentYear

  const sql = `
    INSERT INTO agg_h3_growth (h3_cell, resolution, years_back, metric, strata_filter, annualized_growth, median_start, median_end, sale_count_start, sale_count_end, centroid_lat, centroid_lng, locality)
    WITH start_window AS (
      SELECT
        h3_latlng_to_cell(da.latitude, da.longitude, ${resolution})::BIGINT AS cell,
        CAST(MEDIAN(${priceExpr}) AS BIGINT) AS median_val,
        COUNT(*) AS sale_count,
        MODE(fps.locality) AS top_locality
      FROM fact_property_sale fps
      JOIN dim_address da
        ON fps.property_id = da.property_id
        AND COALESCE(fps.unit_number, '') = da.unit_number
        AND COALESCE(fps.house_number, '') = da.house_number
      WHERE fps.purchase_price > 0
        AND fps.contract_date IS NOT NULL
        AND da.latitude IS NOT NULL
        AND da.longitude IS NOT NULL
        AND fps.is_bulk_sale = FALSE
        AND fps.is_price_outlier = FALSE
        AND fps.is_nominal_transfer = FALSE
        AND fps.is_partial_interest = FALSE
        AND fps.is_multi_dealing_dup = FALSE
        AND EXTRACT(YEAR FROM fps.contract_date) BETWEEN ${startYearFrom} AND ${startYearTo}
        ${strata}
        ${areaFilter}
      GROUP BY cell
      HAVING COUNT(*) >= ${minSales}
    ),
    end_window AS (
      SELECT
        h3_latlng_to_cell(da.latitude, da.longitude, ${resolution})::BIGINT AS cell,
        CAST(MEDIAN(${priceExpr}) AS BIGINT) AS median_val,
        COUNT(*) AS sale_count,
        MODE(fps.locality) AS top_locality
      FROM fact_property_sale fps
      JOIN dim_address da
        ON fps.property_id = da.property_id
        AND COALESCE(fps.unit_number, '') = da.unit_number
        AND COALESCE(fps.house_number, '') = da.house_number
      WHERE fps.purchase_price > 0
        AND fps.contract_date IS NOT NULL
        AND da.latitude IS NOT NULL
        AND da.longitude IS NOT NULL
        AND fps.is_bulk_sale = FALSE
        AND fps.is_price_outlier = FALSE
        AND fps.is_nominal_transfer = FALSE
        AND fps.is_partial_interest = FALSE
        AND fps.is_multi_dealing_dup = FALSE
        AND EXTRACT(YEAR FROM fps.contract_date) BETWEEN ${endYearFrom} AND ${endYearTo}
        ${strata}
        ${areaFilter}
      GROUP BY cell
      HAVING COUNT(*) >= ${minSales}
    )
    SELECT
      s.cell AS h3_cell,
      ${resolution} AS resolution,
      ${yearsBack} AS years_back,
      '${metric}' AS metric,
      '${strataFilter}' AS strata_filter,
      POWER(e.median_val::DOUBLE / s.median_val::DOUBLE, 1.0 / ${yearsBack}) - 1 AS annualized_growth,
      s.median_val AS median_start,
      e.median_val AS median_end,
      s.sale_count AS sale_count_start,
      e.sale_count AS sale_count_end,
      h3_cell_to_lat(s.cell) AS centroid_lat,
      h3_cell_to_lng(s.cell) AS centroid_lng,
      COALESCE(e.top_locality, s.top_locality) AS locality
    FROM start_window s
    JOIN end_window e ON s.cell = e.cell
    WHERE s.median_val > 0 AND e.median_val > 0
  `

  // Run the INSERT and count affected rows via a separate query
  await conn.run(sql)

  // ---------------------------------------------------------------------------
  // Trend-fit: log-linear regression through yearly medians
  // ---------------------------------------------------------------------------
  //
  // Model: ln(median_price) = a + b * year
  //   => fitted_price(year) = exp(a + b * year)
  //   => annualized_growth  = exp(b) - 1
  //
  // This is strictly more robust than endpoint comparison because every
  // year's median contributes to the slope. A single noisy year can shift
  // the endpoints but barely moves a 10-point regression.
  //
  // Quality gates (see schema.ts for rationale):
  //   1. yearly_medians CTE: HAVING COUNT(*) >= 2
  //      Excludes yearly medians based on a single sale. In the raw data,
  //      46% of cell-year combinations have only 1 sale — that's just one
  //      property's price, not a representative median. Including them
  //      introduces massive noise into the regression.
  //
  //   2. trend_slopes CTE: HAVING COUNT(DISTINCT yr) >= 4
  //      Requires at least 4 distinct years of qualifying data. A 2-point
  //      regression has zero degrees of freedom (R² is trivially 1.0) and
  //      produces unconstrained slopes — analysis showed 10,500+ cells
  //      with ~2.7 avg years producing 157% avg growth. A 3-point
  //      regression is only marginally better. 4+ points allow the model
  //      to meaningfully average out year-to-year noise.
  //
  // R² (coefficient of determination) is computed and stored as a
  // confidence indicator for the UI. No hard gate is applied — the
  // query layer always returns the trend-fit when available, and the
  // client displays R² so users can judge fit quality themselves.
  // ---------------------------------------------------------------------------
  const startYear = currentYear - yearsBack // Display start year (not startYearFrom)
  const trendFitSql = `
    WITH yearly_medians AS (
      SELECT
        h3_latlng_to_cell(da.latitude, da.longitude, ${resolution})::BIGINT AS cell,
        EXTRACT(YEAR FROM fps.contract_date)::INT AS yr,
        MEDIAN(${priceExpr}) AS median_val
      FROM fact_property_sale fps
      JOIN dim_address da
        ON fps.property_id = da.property_id
        AND COALESCE(fps.unit_number, '') = da.unit_number
        AND COALESCE(fps.house_number, '') = da.house_number
      WHERE fps.purchase_price > 0
        AND fps.contract_date IS NOT NULL
        AND da.latitude IS NOT NULL
        AND da.longitude IS NOT NULL
        AND fps.is_bulk_sale = FALSE
        AND fps.is_price_outlier = FALSE
        AND fps.is_nominal_transfer = FALSE
        AND fps.is_partial_interest = FALSE
        AND fps.is_multi_dealing_dup = FALSE
        AND EXTRACT(YEAR FROM fps.contract_date) BETWEEN ${startYearFrom} AND ${endYearTo}
        ${strata}
        ${areaFilter}
      GROUP BY cell, yr
      HAVING COUNT(*) >= 2  -- Gate 1: exclude single-sale yearly medians
    ),
    trend_slopes AS (
      SELECT
        cell,
        -- Core regression outputs (OLS on log-transformed prices)
        EXP(REGR_SLOPE(LN(median_val), yr)) - 1 AS trend_growth,
        REGR_INTERCEPT(LN(median_val), yr) AS intercept,
        REGR_SLOPE(LN(median_val), yr) AS slope,
        -- Goodness-of-fit: how well the exponential model fits the data.
        -- Range 0-1. Low values indicate noisy data where the trend line
        -- may be misleading (e.g. compositional shifts in property types).
        REGR_R2(LN(median_val), yr) AS r2
      FROM yearly_medians
      WHERE median_val > 0
      GROUP BY cell
      HAVING COUNT(DISTINCT yr) >= 4  -- Gate 2: require 4+ years for meaningful regression
    )
    UPDATE agg_h3_growth g
    SET trend_fit_growth = t.trend_growth,
        trend_fit_intercept = t.intercept,
        trend_fit_r2 = t.r2,
        trend_fit_start = ROUND(EXP(t.intercept + t.slope * ${startYear}))::BIGINT,
        trend_fit_end = ROUND(EXP(t.intercept + t.slope * ${endYearTo}))::BIGINT
    FROM trend_slopes t
    WHERE g.h3_cell = t.cell
      AND g.resolution = ${resolution}
      AND g.years_back = ${yearsBack}
      AND g.metric = '${metric}'
      AND g.strata_filter = '${strataFilter}'
  `
  await conn.run(trendFitSql)

  // Count the rows just inserted for this combo
  const countResult = await conn.run(`
    SELECT COUNT(*) AS cnt FROM agg_h3_growth
    WHERE resolution = ${resolution}
      AND years_back = ${yearsBack}
      AND metric = '${metric}'
      AND strata_filter = '${strataFilter}'
  `)
  const reader = await countResult.getRows()
  const count = reader.length > 0 ? Number(reader[0][0]) : 0
  return count
}

/**
 * Rebuild the entire `agg_h3_growth` table from scratch.
 *
 * Drops the existing table, recreates it, then loops over all 90
 * parameter combinations and inserts pre-aggregated growth data.
 *
 * This is designed to be called:
 * - At the end of `pnpm etl load` (after geocoding)
 * - Standalone via `pnpm etl recompute-heatmap`
 *
 * @param conn - Active DuckDB connection with H3 extension loaded.
 * @returns Statistics about the rebuild (row count, combo count, elapsed time).
 */
export async function rebuildHeatmapAggregates(
  conn: DuckDBConnection,
): Promise<PrecomputeStats> {
  const startTime = Date.now()
  const currentYear = new Date().getFullYear()

  // Ensure H3 extension is available
  await loadH3Extension(conn)

  // Drop and recreate
  await dropHeatmapTable(conn)
  await initHeatmapSchema(conn)

  let totalRows = 0
  let combinations = 0

  for (const resolution of H3_RESOLUTIONS) {
    for (const yearsBack of YEARS_BACK_VALUES) {
      for (const metric of GROWTH_METRICS) {
        for (const strataFilter of STRATA_FILTERS) {
          const count = await computeAndInsertCombo(
            conn, resolution, yearsBack, metric, strataFilter, currentYear,
          )

          // Compute and store the metro-wide average growth for this combo
          await conn.run(`
            UPDATE agg_h3_growth SET metro_avg_growth = (
              SELECT AVG(annualized_growth) FROM agg_h3_growth
              WHERE resolution = ${resolution}
                AND years_back = ${yearsBack}
                AND metric = '${metric}'
                AND strata_filter = '${strataFilter}'
            )
            WHERE resolution = ${resolution}
              AND years_back = ${yearsBack}
              AND metric = '${metric}'
              AND strata_filter = '${strataFilter}'
          `)

          totalRows += count
          combinations++
          process.stdout.write(`\r  Computed ${combinations}/60 combinations (${totalRows} rows)`)
        }
      }
    }
  }

  process.stdout.write('\n')

  return {
    totalRows,
    combinations,
    elapsedMs: Date.now() - startTime,
  }
}
