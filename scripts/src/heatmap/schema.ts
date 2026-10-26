/**
 * DDL for the H3 growth heatmap precomputation table.
 *
 * The `agg_h3_growth` table stores pre-aggregated annualized growth rates
 * per H3 hexagonal cell. It is the sole data source for the growth heatmap
 * widget — the server performs simple indexed lookups (~50ms) instead of
 * computing growth from raw sales at request time (~2-5s).
 *
 * The table is fully rebuilt on every ETL load (~12s for 60 combinations
 * across 6.6M sales). No incremental update logic is needed.
 */

import type { DuckDBConnection } from '@duckdb/node-api'

const CREATE_AGG_H3_GROWTH = `
CREATE TABLE IF NOT EXISTS agg_h3_growth (
  /**
   * H3 cell index as a 64-bit integer.
   * Stored as BIGINT rather than VARCHAR for faster equality checks
   * and smaller storage footprint.
   */
  h3_cell BIGINT NOT NULL,

  /**
   * H3 grid resolution (4, 6, or 8).
   * Maps to zoom levels: res 4 -> zoom 0-6, res 6 -> zoom 7-10, res 8 -> zoom 11+.
   */
  resolution TINYINT NOT NULL,

  /**
   * Number of years to look back for growth calculation (5, 10, 15, 20, 25).
   */
  years_back TINYINT NOT NULL,

  /**
   * Which price metric was used for the growth calculation.
   * 'median-price' or 'price-per-sqm'.
   */
  metric VARCHAR NOT NULL,

  /**
   * Strata segmentation filter applied during aggregation.
   * 'all', 'freehold', or 'strata'.
   */
  strata_filter VARCHAR NOT NULL,

  /**
   * Annualized compound growth rate as a decimal (endpoint comparison).
   * Formula: POWER(median_end / median_start, 1.0 / years_back) - 1
   * Example: 0.065 = 6.5% per year.
   */
  annualized_growth DOUBLE NOT NULL,

  /**
   * Trend-fit annualized growth via log-linear regression through yearly
   * medians in the time window.
   *
   * Regression model: ln(median_price) = a + b * year
   *   => annualized_growth = exp(b) - 1
   *
   * More robust than endpoint comparison because every year's median
   * contributes to the slope, so a single noisy year can't dominate.
   *
   * Quality gates applied during precomputation:
   *   1. Each yearly median must be based on >= 2 sales (single-sale
   *      "medians" are excluded as they're just one property's price).
   *   2. The cell must have >= 4 distinct qualifying years of data.
   *      With fewer points the regression has too few degrees of freedom
   *      (a 2-point regression trivially yields R²=1.0 with unconstrained
   *      slope, producing absurd growth rates).
   *
   * NULL when insufficient qualifying data is available for regression.
   * When NULL, the query layer falls back to annualized_growth (endpoint CAGR)
   * via COALESCE(trend_fit_growth, annualized_growth).
   */
  trend_fit_growth DOUBLE,

  /**
   * Regression-fitted price at the display start year (currentYear - yearsBack).
   * Computed as exp(intercept + slope * startYear) from the log-linear regression.
   * NULL when trend_fit_growth is NULL.
   */
  trend_fit_start BIGINT,

  /**
   * Regression-fitted price at the display end year (currentYear).
   * Computed as exp(intercept + slope * currentYear) from the log-linear regression.
   * NULL when trend_fit_growth is NULL.
   */
  trend_fit_end BIGINT,

  /**
   * Log-linear regression intercept (ln-scale).
   * The authoritative parameter for computing fitted values at any year:
   *   fitted_price(year) = exp(intercept + slope * year)
   * where slope = ln(1 + trend_fit_growth).
   * NULL when trend_fit_growth is NULL.
   */
  trend_fit_intercept DOUBLE,

  /**
   * Coefficient of determination (R-squared) for the log-linear regression.
   * Range: 0.0 (no linear relationship in log-space) to 1.0 (perfect fit).
   *
   * Indicates how well the exponential growth model fits the observed yearly
   * medians. Displayed in the UI as a confidence indicator so users can judge
   * whether the trend line is trustworthy for a given cell.
   *
   * Interpretation guidelines:
   *   >= 0.7  Good fit: trend line closely tracks the yearly medians.
   *   >= 0.4  Moderate: general trend is visible but noisy.
   *   <  0.4  Poor: high volatility, trend line may be misleading.
   *           Often caused by compositional shifts (e.g. a mix of luxury
   *           and knockdown sales varying year to year).
   *
   * NULL when trend_fit_growth is NULL (insufficient data for regression).
   */
  trend_fit_r2 DOUBLE,

  /** Median price (or price/sqm) in the start window. */
  median_start BIGINT NOT NULL,

  /** Median price (or price/sqm) in the end window. */
  median_end BIGINT NOT NULL,

  /** Total sales in the start window that passed all filters. */
  sale_count_start INTEGER NOT NULL,

  /** Total sales in the end window that passed all filters. */
  sale_count_end INTEGER NOT NULL,

  /** Latitude of the H3 cell centroid. */
  centroid_lat DOUBLE NOT NULL,

  /** Longitude of the H3 cell centroid. */
  centroid_lng DOUBLE NOT NULL,

  /** Most common locality (suburb) name within this H3 cell. */
  locality VARCHAR,

  /** Metro-wide average annualized growth for this combo (resolution, years_back, metric, strata_filter). */
  metro_avg_growth DOUBLE,

  PRIMARY KEY (h3_cell, resolution, years_back, metric, strata_filter)
);

CREATE INDEX IF NOT EXISTS idx_h3_growth_lookup
  ON agg_h3_growth(resolution, years_back, metric, strata_filter);
`

// ---------------------------------------------------------------------------
// agg_h3_loess_curve — precomputed full-range quarterly LOESS curves
// ---------------------------------------------------------------------------

const CREATE_AGG_H3_LOESS_CURVE = `
CREATE TABLE IF NOT EXISTS agg_h3_loess_curve (
  /**
   * H3 cell index as a 64-bit integer.
   * Same encoding as agg_h3_growth.h3_cell.
   */
  h3_cell BIGINT NOT NULL,

  /** H3 grid resolution (7, 8, or 9). */
  resolution TINYINT NOT NULL,

  /** Which price metric: 'median-price' or 'price-per-sqm'. */
  metric VARCHAR NOT NULL,

  /** Strata segmentation: 'all', 'freehold', or 'strata'. */
  strata_filter VARCHAR NOT NULL,

  /**
   * Start of the fitted_prices array (year-fraction), equal to the
   * cell's earliest sale year. The array spans [min_quarter, max_quarter].
   * Format: Q1 = year.0, Q2 = year.25, Q3 = year.5, Q4 = year.75.
   * Example: 1993.0 means Q1 1993.
   */
  min_quarter DOUBLE NOT NULL,

  /**
   * End of the fitted_prices array (year-fraction), equal to the
   * cell's latest sale year. The array spans [min_quarter, max_quarter].
   * Example: 2025.75 means Q4 2025.
   */
  max_quarter DOUBLE NOT NULL,

  /**
   * LOESS bandwidth in years used for this computation.
   * Stored per-row so future bandwidth changes don't invalidate
   * query-time assumptions about the curve's smoothness.
   */
  bandwidth DOUBLE NOT NULL,

  /**
   * Array of LOESS-fitted prices, one per quarter from min_quarter
   * to max_quarter (inclusive). May contain NULLs at positions where
   * the local regression failed due to insufficient kernel support
   * (e.g. a data gap wider than the bandwidth window).
   *
   * Array length = (max_quarter - min_quarter) / 0.25 + 1.
   *
   * Indexing (1-based for DuckDB list_extract):
   *   list_extract(fitted_prices, CAST((target_quarter - min_quarter) / 0.25 + 1 AS INT))
   *
   * NULL elements: list_extract returns NULL for NULL positions,
   * which propagates through CAGR calculations to naturally exclude
   * cells with gaps at the requested query endpoints.
   *
   * Each value is ROUND(fitted_linear_price)::BIGINT.
   */
  fitted_prices BIGINT[] NOT NULL,

  /** Latitude of the H3 cell centroid. */
  centroid_lat DOUBLE NOT NULL,

  /** Longitude of the H3 cell centroid. */
  centroid_lng DOUBLE NOT NULL,

  /** Most common locality (suburb) name within this H3 cell. */
  locality VARCHAR,

  /** Total sales across all quarters for this cell (all time). */
  total_sales INTEGER NOT NULL,

  /** Number of distinct quarters with at least one sale. */
  quarter_count SMALLINT NOT NULL,

  /** Earliest quarter with raw sales data (before LOESS smoothing). */
  earliest_sale DOUBLE NOT NULL,

  /** Latest quarter with raw sales data. */
  latest_sale DOUBLE NOT NULL,

  PRIMARY KEY (h3_cell, resolution, metric, strata_filter)
);

CREATE INDEX IF NOT EXISTS idx_loess_curve_lookup
  ON agg_h3_loess_curve(resolution, metric, strata_filter);
`

/**
 * Install and load the H3 community extension.
 * Must be called before any H3 functions (h3_latlng_to_cell, etc.).
 */
export async function loadH3Extension(conn: DuckDBConnection): Promise<void> {
  await conn.run('INSTALL h3 FROM community')
  await conn.run('LOAD h3')
}

/** Create the agg_h3_growth table if it doesn't exist. */
export async function initHeatmapSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(CREATE_AGG_H3_GROWTH)
}

/** Drop the agg_h3_growth table (used before rebuild). */
export async function dropHeatmapTable(conn: DuckDBConnection): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS agg_h3_growth')
}

/** Create the agg_h3_loess_curve table if it doesn't exist. */
export async function initLoessCurveSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(CREATE_AGG_H3_LOESS_CURVE)
}

/** Drop the agg_h3_loess_curve table (used before rebuild). */
export async function dropLoessCurveTable(conn: DuckDBConnection): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS agg_h3_loess_curve')
}
