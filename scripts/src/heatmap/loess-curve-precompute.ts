/**
 * Quarterly LOESS curve precomputation engine.
 *
 * Computes a full LOESS-smoothed price curve (one fitted price per quarter,
 * 1990–present) for every H3 cell across all combinations of
 * (resolution, metric, strataFilter). Results are stored as BIGINT[] arrays
 * in the `agg_h3_loess_curve` table.
 *
 * Arrays span each cell's full data range [earliest_sale, latest_sale] and
 * may contain NULLs at positions where the local regression failed due to
 * insufficient kernel support. Query-time consumers validate that their
 * specific start/end quarters have non-NULL fitted values before computing
 * growth rates.
 *
 * Unlike the per-period LOESS in `h3-precompute.ts` (which evaluates at two
 * points per lookback period), this module evaluates at EVERY quarter with a
 * fixed bandwidth, enabling arbitrary period queries at read time.
 *
 * 18 combinations: 3 resolutions × 2 metrics × 3 strata filters.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Config:  scripts/src/heatmap/loess-config.ts (SINGLE SOURCE OF TRUTH)
 * Schema:  scripts/src/heatmap/schema.ts (agg_h3_loess_curve DDL)
 * Spec:    docs/research/full-curve-loess-architecture.md
 * ══════════════════════════════════════════════════════════════════════════
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import type {
  H3Resolution,
  GrowthMetric,
  StrataFilterValue,
  LoessCurvePrecomputeStats,
} from './types.js'
import {
  H3_RESOLUTIONS,
  GROWTH_METRICS,
  STRATA_FILTERS,
} from './types.js'
import {
  LOESS_BANDWIDTH,
  LOESS_MIN_WEIGHTED_POINTS,
  LOESS_PRICE_MIN,
  LOESS_PRICE_MAX,
  LOESS_EVAL_START_QUARTER,
  QUARTER_STEP,
} from './loess-config.js'
import { strataCondition, priceExpression, areaGuard } from './h3-precompute.js'
import { dropLoessCurveTable, initLoessCurveSchema, loadH3Extension } from './schema.js'

/**
 * Compute the current quarter as a year-fraction.
 *
 * Returns the quarter that is currently in progress. For example,
 * in March 2026, returns 2026.0 (Q1 2026).
 */
function currentQuarterFraction(): number {
  const now = new Date()
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3)
  return year + quarter * QUARTER_STEP
}

/**
 * Compute and insert LOESS curves for one (resolution, metric, strata) combo.
 *
 * Runs a single SQL INSERT with a CTE chain that:
 * 1. Computes quarterly medians per H3 cell from raw sales.
 * 2. Generates an evaluation grid of every quarter from 1990 to present.
 * 3. Cross-joins data × grid, computes case-weighted tricube kernel weights.
 *    Each yearly median's weight is sale_count × tricube(distance/bandwidth),
 *    giving higher influence to years with more sales (Cleveland 1979).
 * 4. Solves weighted OLS normal equations per (cell, eval quarter).
 * 5. Evaluates the local regression to get fitted prices.
 * 6. Aggregates fitted prices into a contiguous BIGINT[] array per cell.
 *
 * @returns Number of cells (rows) inserted for this combination.
 */
async function computeAndInsertLoessCurve(
  conn: DuckDBConnection,
  resolution: H3Resolution,
  metric: GrowthMetric,
  strataFilter: StrataFilterValue,
  evalEnd: number,
): Promise<number> {
  const strata = strataCondition(strataFilter, 'fps')
  const priceExpr = priceExpression(metric, 'fps')
  const areaFilter = areaGuard(metric, 'fps')

  // The standard FROM/JOIN for fact_property_sale × dim_address.
  // Shared between quarterly_medians and cell_meta CTEs.
  const fromJoin = `
    FROM fact_property_sale fps
    JOIN dim_address da
      ON fps.property_id = da.property_id
      AND COALESCE(fps.unit_number, '') = da.unit_number
      AND COALESCE(fps.house_number, '') = da.house_number`

  const baseWhere = `
    WHERE fps.purchase_price > 0
      AND fps.contract_date IS NOT NULL
      AND da.latitude IS NOT NULL
      AND da.longitude IS NOT NULL
      AND fps.is_bulk_sale = FALSE
      AND fps.is_price_outlier = FALSE
      AND fps.is_nominal_transfer = FALSE
      AND fps.is_partial_interest = FALSE
      AND fps.is_multi_dealing_dup = FALSE
      ${strata}
      ${areaFilter}`

  const sql = `
    INSERT INTO agg_h3_loess_curve (
      h3_cell, resolution, metric, strata_filter,
      min_quarter, max_quarter, bandwidth, fitted_prices,
      centroid_lat, centroid_lng, locality,
      total_sales, quarter_count, earliest_sale, latest_sale
    )
    WITH
    -- Step 1: Yearly medians per H3 cell.
    -- Each year's median absorbs property-specific variance (building quality,
    -- position, etc.) that would otherwise create steep local slopes in LOESS.
    -- Every sale contributes to its year's median — no data is culled.
    yearly_medians AS (
      SELECT
        h3_latlng_to_cell(da.latitude, da.longitude, ${resolution})::BIGINT AS cell,
        EXTRACT(YEAR FROM fps.contract_date)::INT AS sale_year,
        CAST(MEDIAN(${priceExpr}) AS BIGINT) AS median_val,
        COUNT(*) AS sale_count,
        COUNT(DISTINCT EXTRACT(QUARTER FROM fps.contract_date))::INT AS quarters_in_year
      ${fromJoin}
      ${baseWhere}
      GROUP BY cell, sale_year
    ),

    -- Step 2: Per-cell adaptive bandwidth based on data density.
    -- Dense cells (yearly data for 25 years): bandwidth stays at ${LOESS_BANDWIDTH}.
    -- Sparse cells (e.g. 15 years over 22 year span): bandwidth widens to ~5.
    -- Formula: MAX(${LOESS_BANDWIDTH}, ceil(year_range / num_years * 3))
    cell_bandwidth AS (
      SELECT
        cell,
        GREATEST(
          ${LOESS_BANDWIDTH}::DOUBLE,
          CEIL(
            (MAX(sale_year) - MIN(sale_year))::DOUBLE
            / GREATEST(COUNT(*), 1) * 3
          )
        ) AS bandwidth
      FROM yearly_medians
      WHERE median_val > 0
      GROUP BY cell
    ),

    -- Step 3: Per-cell metadata (centroid, coverage stats).
    cell_meta AS (
      SELECT
        ym.cell,
        h3_cell_to_lat(ym.cell) AS centroid_lat,
        h3_cell_to_lng(ym.cell) AS centroid_lng,
        SUM(ym.sale_count) AS total_sales,
        SUM(ym.quarters_in_year)::SMALLINT AS quarter_count,
        MIN(ym.sale_year) AS earliest_sale,
        MAX(ym.sale_year) AS latest_sale
      FROM yearly_medians ym
      WHERE ym.median_val > 0
      GROUP BY ym.cell
    ),

    -- Locality lookup: MODE(fps.locality) per cell from raw sales.
    cell_locality AS (
      SELECT
        h3_latlng_to_cell(da.latitude, da.longitude, ${resolution})::BIGINT AS cell,
        MODE(fps.locality) AS locality
      ${fromJoin}
      ${baseWhere}
      GROUP BY cell
    ),

    -- Step 4: Evaluation grid — every quarter from 1990 to present.
    eval_grid AS (
      SELECT ${LOESS_EVAL_START_QUARTER} + i * ${QUARTER_STEP} AS quarter_eval
      FROM (SELECT UNNEST(generate_series(
        0,
        CAST((${evalEnd} - ${LOESS_EVAL_START_QUARTER}) / ${QUARTER_STEP} AS BIGINT)
      )) AS i)
    ),

    -- Step 5: Cross-join yearly medians × eval grid with case-weighted tricube kernel.
    -- Weight = sale_count × tricube(|distance| / bandwidth).
    -- The sale_count case weight (Cleveland 1979) ensures yearly medians from
    -- more sales receive proportionally higher influence, reflecting lower
    -- variance of the median estimate. See: loess-math.ts:combinedWeight()
    weighted AS (
      SELECT
        ym.cell,
        eg.quarter_eval,
        ym.sale_year AS x,
        ym.median_val::DOUBLE AS y,
        -- Combined weight: sale_count × tricube kernel (Cleveland 1979).
        -- u = |distance| / bandwidth; tricube(u) = (1 - |u|^3)^3 for |u| <= 1
        ym.sale_count * POWER(
          1.0 - POWER(
            CAST(ABS(ym.sale_year - eg.quarter_eval) AS DOUBLE) / cb.bandwidth,
            3
          ),
          3
        ) AS w
      FROM yearly_medians ym
      CROSS JOIN eval_grid eg
      JOIN cell_bandwidth cb ON ym.cell = cb.cell
      WHERE ym.median_val > 0
        AND ABS(ym.sale_year - eg.quarter_eval) <= cb.bandwidth
    ),

    -- Step 6: Accumulate weighted OLS normal equation sums.
    -- HAVING gate ensures we have enough data for a stable local regression.
    agg AS (
      SELECT
        cell,
        quarter_eval,
        SUM(w) AS sw,
        SUM(w * x) AS swx,
        SUM(w * y) AS swy,
        SUM(w * x * x) AS swxx,
        SUM(w * x * y) AS swxy
      FROM weighted
      GROUP BY cell, quarter_eval
      HAVING COUNT(*) >= ${LOESS_MIN_WEIGHTED_POINTS}
    ),

    -- Step 7: Solve for the local regression slope at each eval point.
    -- b = (Σwxy - Σwx·Σwy/Σw) / (Σwx² - (Σwx)²/Σw)
    -- NULLIF guards against zero denominator (all data at same x).
    slopes AS (
      SELECT
        cell,
        quarter_eval,
        sw, swx, swy,
        (swxy - swx * swy / sw) / NULLIF(swxx - swx * swx / sw, 0) AS b
      FROM agg
    ),

    -- Step 8: Evaluate the local regression at each target quarter.
    -- fitted_price = ROUND(intercept + slope * quarter_eval)
    -- Linear-space LOESS: no exp() needed. Guard rejects nonsensical values.
    -- Capped to [earliest_sale, latest_sale] — no extrapolation beyond data.
    fitted AS (
      SELECT
        s.cell,
        s.quarter_eval,
        ROUND((s.swy - s.b * s.swx) / s.sw + s.b * s.quarter_eval)::BIGINT AS fitted_price
      FROM slopes s
      JOIN cell_meta cm ON s.cell = cm.cell
      WHERE s.b IS NOT NULL
        AND (s.swy - s.b * s.swx) / s.sw + s.b * s.quarter_eval BETWEEN ${LOESS_PRICE_MIN} AND ${LOESS_PRICE_MAX}
        AND s.quarter_eval >= cm.earliest_sale
        AND s.quarter_eval <= cm.latest_sale
    ),

    -- Step 9: Assemble fitted prices into an array spanning the cell's full
    -- data range [earliest_sale, latest_sale]. The array includes one slot per
    -- quarter in that range. Quarters where the LOESS fit succeeded get a
    -- BIGINT fitted price; quarters where it failed (insufficient kernel
    -- support within the bandwidth window) get NULL.
    --
    -- This gap-tolerant storage replaces the previous contiguous-run selection
    -- that discarded all fitted values outside the longest unbroken run. The
    -- new approach preserves all fitted values across the cell's full data
    -- range, allowing query-time consumers to validate their specific
    -- endpoints (start/end quarters must both be non-NULL for a valid CAGR).
    --
    -- DuckDB's LIST() aggregate includes NULLs from the LEFT JOIN, so gap
    -- positions appear as NULL elements in the stored BIGINT[] array.
    -- list_extract() returns NULL for NULL elements, which propagates through
    -- the POWER() CAGR calculation to naturally exclude cells with gaps at
    -- the requested query endpoints.
    cell_curves AS (
      SELECT
        cm.cell,
        cm.earliest_sale AS min_quarter,
        cm.latest_sale AS max_quarter,
        LIST(f.fitted_price ORDER BY eg.quarter_eval) AS fitted_prices
      FROM cell_meta cm
      CROSS JOIN eval_grid eg
      LEFT JOIN fitted f
        ON f.cell = cm.cell
        AND f.quarter_eval = eg.quarter_eval
      WHERE eg.quarter_eval >= cm.earliest_sale
        AND eg.quarter_eval <= cm.latest_sale
      GROUP BY cm.cell, cm.earliest_sale, cm.latest_sale
      HAVING COUNT(f.fitted_price) >= 4
    )

    -- Final INSERT: join curves with metadata and per-cell bandwidth.
    SELECT
      cc.cell AS h3_cell,
      ${resolution} AS resolution,
      '${metric}' AS metric,
      '${strataFilter}' AS strata_filter,
      cc.min_quarter,
      cc.max_quarter,
      cb.bandwidth,
      cc.fitted_prices,
      cm.centroid_lat,
      cm.centroid_lng,
      cl.locality,
      cm.total_sales,
      cm.quarter_count,
      cm.earliest_sale,
      cm.latest_sale
    FROM cell_curves cc
    JOIN cell_meta cm ON cc.cell = cm.cell
    JOIN cell_bandwidth cb ON cc.cell = cb.cell
    LEFT JOIN cell_locality cl ON cc.cell = cl.cell
  `

  await conn.run(sql)

  // Count the rows inserted for this combo
  const countResult = await conn.run(`
    SELECT COUNT(*) AS cnt FROM agg_h3_loess_curve
    WHERE resolution = ${resolution}
      AND metric = '${metric}'
      AND strata_filter = '${strataFilter}'
  `)
  const reader = await countResult.getRows()
  const count = reader.length > 0 ? Number(reader[0][0]) : 0
  return count
}

/**
 * Rebuild the entire `agg_h3_loess_curve` table from scratch.
 *
 * Drops the existing table, recreates it, then loops over all 18
 * parameter combinations (3 resolutions × 2 metrics × 3 strata filters)
 * and inserts precomputed quarterly LOESS curves.
 *
 * @param conn - Active DuckDB connection.
 * @returns Statistics about the rebuild.
 */
export async function rebuildLoessCurves(
  conn: DuckDBConnection,
): Promise<LoessCurvePrecomputeStats> {
  const startTime = Date.now()
  const evalEnd = currentQuarterFraction()
  const totalCombos = H3_RESOLUTIONS.length * GROWTH_METRICS.length * STRATA_FILTERS.length

  // Ensure H3 extension is available
  await loadH3Extension(conn)

  // Drop and recreate
  await dropLoessCurveTable(conn)
  await initLoessCurveSchema(conn)

  let totalRows = 0
  let combinations = 0

  for (const resolution of H3_RESOLUTIONS) {
    for (const metric of GROWTH_METRICS) {
      for (const strataFilter of STRATA_FILTERS) {
        const count = await computeAndInsertLoessCurve(
          conn, resolution, metric, strataFilter, evalEnd,
        )

        totalRows += count
        combinations++
        process.stdout.write(
          `\r  Computed ${combinations}/${totalCombos} combinations (${totalRows} cells)`,
        )
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
