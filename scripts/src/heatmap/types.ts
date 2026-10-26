/**
 * TypeScript types for H3 heatmap precomputation.
 *
 * These types define the parameters and results of the growth heatmap
 * ETL pipeline, which pre-aggregates annualized growth rates per H3
 * hexagonal cell at multiple resolutions, time windows, metrics, and
 * strata filters.
 */

/** H3 grid resolution levels used for multi-scale heatmap rendering. */
export type H3Resolution = 7 | 8 | 9

/** Which price metric to compute growth for. */
export type GrowthMetric = 'median-price' | 'price-per-sqm'

/** Property type segmentation filter. */
export type StrataFilterValue = 'all' | 'freehold' | 'strata'

/** All valid "years back" lookback windows for growth calculation. */
export type YearsBack = 5 | 10 | 15 | 20 | 25

/**
 * A single precomputation combination.
 * The ETL loops over all combinations of these parameters.
 */
export interface PrecomputeCombo {
  resolution: H3Resolution
  yearsBack: YearsBack
  metric: GrowthMetric
  strataFilter: StrataFilterValue
}

/**
 * Statistics returned after a full heatmap precomputation run.
 * Used for CLI logging and verification.
 */
export interface PrecomputeStats {
  /** Total rows inserted into agg_h3_growth. */
  totalRows: number
  /** Number of parameter combinations processed (should be 60). */
  combinations: number
  /** Wall-clock time for the entire rebuild in milliseconds. */
  elapsedMs: number
}

/**
 * Statistics returned after a LOESS curve precomputation run.
 * Used for CLI logging and verification.
 *
 * The LOESS curve pipeline processes 18 combinations
 * (3 resolutions × 2 metrics × 3 strata filters) — no yearsBack
 * dimension because the full curve is period-independent.
 */
export interface LoessCurvePrecomputeStats {
  /** Total rows inserted into agg_h3_loess_curve. */
  totalRows: number
  /** Number of parameter combinations processed (should be 18). */
  combinations: number
  /** Wall-clock time for the entire rebuild in milliseconds. */
  elapsedMs: number
}

/** All H3 resolutions to precompute. */
export const H3_RESOLUTIONS: readonly H3Resolution[] = [7, 8, 9]

/** All lookback windows to precompute. */
export const YEARS_BACK_VALUES: readonly YearsBack[] = [5, 10, 15, 20, 25]

/** All growth metrics to precompute. */
export const GROWTH_METRICS: readonly GrowthMetric[] = ['median-price', 'price-per-sqm']

/** All strata filter values to precompute. */
export const STRATA_FILTERS: readonly StrataFilterValue[] = ['all', 'freehold', 'strata']

/**
 * Minimum sales required in BOTH start and end windows for an H3 cell
 * to be included in the precomputed results. Lower thresholds at finer
 * resolutions because smaller cells have fewer transactions.
 */
export const MIN_SALES_THRESHOLD: Record<H3Resolution, number> = {
  7: 7,
  8: 4,
  9: 2,
}
