/**
 * Statistical and growth calculation utilities for property sale analysis.
 *
 * All smoothing functions are pure: no side effects, no React or UI deps.
 * They accept typed time series data and return transformed copies.
 * Widgets call these inside `useMemo` or `buildOption()` — never in effects.
 */

import Loess from 'loess'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single data point in a time series, pairing a numeric x-position
 * (e.g., year index, quarter index) with an observed y-value
 * (e.g., median price).
 *
 * Null y-values represent periods with no observations — smoothing
 * functions skip these and interpolate across gaps.
 */
export interface TimeSeriesPoint {
  /** Numeric position on the x-axis (e.g., 0, 1, 2 for sequential periods). */
  x: number
  /** Observed value, or null if no data for this period. */
  y: number | null
}

/**
 * Identifies which smoothing method is active on a widget.
 *
 * - `'none'` — Raw data lines (default, no transformation).
 * - `'loess'` — LOESS-smoothed curve replaces raw line.
 * - `'moving-average'` — Trailing moving average replaces raw line.
 */
export type TrendLineMethod = 'none' | 'loess' | 'moving-average'

/**
 * Options for {@link applySmoothingToSeries}.
 * Only the fields relevant to the active method are used.
 */
export interface SmoothingOptions {
  /**
   * LOESS bandwidth (span) parameter. Controls how much of the data
   * influences each smoothed point.
   *
   * - 0.1–0.2: Very responsive, shows short-term movements.
   * - 0.3–0.4: Balanced (recommended).
   * - 0.5–0.7: Smooth, shows long-term trend only.
   * - 0.8–0.9: Very smooth, nearly linear.
   *
   * @default {@link DEFAULT_LOESS_SPAN}
   */
  span?: number

  /**
   * Trailing window size for moving average, in number of periods.
   * E.g., 3 = average of the last 3 non-null values.
   *
   * @default {@link DEFAULT_MA_WINDOW}
   */
  window?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default LOESS bandwidth (span). 0.35 provides a good balance between
 * responsiveness to real market shifts and smoothing of sampling noise.
 */
export const DEFAULT_LOESS_SPAN = 0.35

/**
 * Minimum non-null data points required for LOESS to produce meaningful
 * output. Below this threshold, raw values are returned unchanged.
 */
export const MIN_LOESS_POINTS = 3

/**
 * Minimum number of sales in a period before we flag the data point
 * as potentially unreliable in tooltips.
 *
 * Based on statistical guidelines: medians from fewer than 25 observations
 * have wide confidence intervals and are sensitive to outliers.
 * @see {@link ../../../docs/research/price-smoothing-and-index-methods.md} §5.5
 */
export const LOW_SAMPLE_THRESHOLD = 25

/**
 * Default trailing window size for moving average (in periods).
 * With yearly data this is a 3-year trailing average.
 */
export const DEFAULT_MA_WINDOW = 3

/**
 * Minimum data points required for a meaningful log-linear regression.
 * With only one point there is no slope to compute.
 */
export const MIN_REGRESSION_POINTS = 2

/**
 * Default shrinkage strength parameter for empirical Bayes estimation.
 *
 * Controls how quickly the estimate transitions from reference-dominated
 * to locally-dominated as sample size increases:
 * - k=15: With 1 sale, w≈0.06 (94% reference). With 15 sales, w=0.50 (50/50).
 *   With 50 sales, w≈0.77 (mostly local).
 *
 * Validated against Australian suburban property markets where 15-25
 * sales/quarter is a "medium" sample.
 */
export const BAYES_SHRINKAGE_K = 15

// ---------------------------------------------------------------------------
// Growth Utilities
// ---------------------------------------------------------------------------

/**
 * Calculate the compound annual growth rate (CAGR) between two sales.
 *
 * Returns the annualized percentage change, e.g. 5.2 means +5.2% per year.
 * Returns null if dates are missing or the holding period is too short to
 * produce a meaningful annualized figure (< ~5 weeks).
 *
 * @param priceFrom - Earlier sale price
 * @param priceTo - Later sale price
 * @param dateFrom - Earlier sale date (ISO string)
 * @param dateTo - Later sale date (ISO string)
 */
export function annualizedGrowth(
  priceFrom: number,
  priceTo: number,
  dateFrom: string | null,
  dateTo: string | null,
): number | null {
  if (!dateFrom || !dateTo) return null
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000
  const years =
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / msPerYear
  if (years < 0.1) return null // less than ~5 weeks — annualizing is meaningless
  return (Math.pow(priceTo / priceFrom, 1 / years) - 1) * 100
}

/**
 * Calculate simple percentage change between two values.
 *
 * @param from - Starting value
 * @param to - Ending value
 * @returns Percentage change, e.g. 25.0 means +25%
 */
export function percentChange(from: number, to: number): number {
  return ((to - from) / from) * 100
}

/**
 * Compute annualized compound growth rate via log-linear regression.
 *
 * Fits `log(y) = a + b × x` through ALL valid observations, then derives
 * `CAGR = exp(b) - 1`. This is strictly better than endpoint comparison
 * (start vs end median) because it uses every data point, so a single
 * noisy year can't dominate the result.
 *
 * @param points - Array of `{ x: year/period index, y: price/value }`.
 *   Points with `y <= 0` or `y === null` are excluded before fitting.
 * @returns Annualized growth rate as a decimal (e.g., 0.065 = 6.5% p.a.),
 *   or `null` if fewer than {@link MIN_REGRESSION_POINTS} valid points remain.
 */
export function logLinearGrowthRate(points: Array<TimeSeriesPoint>): number | null {
  // Filter to positive, non-null values (can't take log of zero/negative)
  const valid = points.filter(
    (p): p is { x: number; y: number } => p.y !== null && p.y > 0,
  )

  if (valid.length < MIN_REGRESSION_POINTS) return null

  // Transform y to ln(y) for linear regression
  const xs = valid.map((p) => p.x)
  const ys = valid.map((p) => Math.log(p.y))

  // Compute means
  const n = xs.length
  const xMean = xs.reduce((s, v) => s + v, 0) / n
  const yMean = ys.reduce((s, v) => s + v, 0) / n

  // OLS slope: b = Σ((xi - x̄)(yi - ȳ)) / Σ((xi - x̄)²)
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean
    numerator += dx * (ys[i] - yMean)
    denominator += dx * dx
  }

  // All x-values identical → no slope (flat line, zero growth)
  if (denominator === 0) return 0

  const slope = numerator / denominator

  // CAGR = exp(slope) - 1
  return Math.exp(slope) - 1
}

// ---------------------------------------------------------------------------
// Empirical Bayes Shrinkage
// ---------------------------------------------------------------------------

/**
 * Result of a single-period empirical Bayes shrinkage estimate.
 */
export interface BayesShrinkageResult {
  /** The blended estimate value. */
  estimate: number
  /** Percentage of the estimate that comes from the reference (0–100). */
  estimationPct: number
  /** Weight given to local data (0.0–1.0). */
  localWeight: number
}

/**
 * Compute empirical Bayes shrinkage estimate for a sparse local observation.
 *
 * Blends the local raw value with a broader reference trend value,
 * weighted by local sample size. With few local observations, the estimate
 * leans toward the reference. With many, it reflects the local data.
 *
 * Formula: `estimate = w × local + (1 - w) × reference`
 * where `w = n_local / (n_local + k)`.
 *
 * @param localValue - Raw local value for this period (null if no data).
 * @param referenceValue - Reference trend value for this period.
 * @param localSaleCount - Number of sales in the local area this period.
 * @param k - Shrinkage strength. Higher = more shrinkage toward reference.
 *   Default: {@link BAYES_SHRINKAGE_K}.
 */
export function bayesShrinkageEstimate(
  localValue: number | null,
  referenceValue: number,
  localSaleCount: number,
  k: number = BAYES_SHRINKAGE_K,
): BayesShrinkageResult {
  if (localValue === null || localSaleCount === 0) {
    return { estimate: referenceValue, estimationPct: 100, localWeight: 0 }
  }

  const w = localSaleCount / (localSaleCount + k)
  const estimate = w * localValue + (1 - w) * referenceValue
  const estimationPct = Math.round((1 - w) * 100)

  return { estimate, estimationPct, localWeight: w }
}

/**
 * A time series data point augmented with Bayes shrinkage metadata.
 * Used by chart tooltip formatters to display estimation percentages.
 */
export interface BayesSeriesPoint {
  /** Numeric x-position matching the original TimeSeriesPoint. */
  x: number
  /** The Bayes-shrunk estimate value, or null if no reference available. */
  y: number | null
  /** Percentage of the estimate from the reference trend (0–100). Null when y is null. */
  estimationPct: number | null
  /** Raw local value before shrinkage. Null if no local observations. */
  rawLocalValue: number | null
}

/**
 * Input data for a single series in the Bayes shrinkage computation.
 */
export interface BayesSeriesInput {
  /** Series label (locality or area name). */
  label: string
  /** Raw values per period (same length as the shared periods array). */
  points: Array<TimeSeriesPoint>
  /** Sale count per period (same length as points). */
  saleCounts: Array<number>
}

/**
 * Compute empirical Bayes shrinkage series for multiple data series.
 *
 * 1. Computes a sale-count-weighted average across all series per period.
 * 2. Applies LOESS smoothing to the weighted average to get a stable reference.
 * 3. For each series, blends each period's local value toward the reference
 *    based on local sample size.
 *
 * When only one series is present, the reference is that series' own LOESS
 * (self-smoothing mode — sparse periods smooth toward the series' own trend).
 *
 * @param inputs - Array of series, each with label, points, and saleCounts.
 * @param k - Shrinkage strength parameter. Default: {@link BAYES_SHRINKAGE_K}.
 * @param loessSpan - LOESS span for the reference trend. Default: {@link DEFAULT_LOESS_SPAN}.
 * @returns Map from series label to its BayesSeriesPoint array.
 */
export function computeBayesSeries(
  inputs: Array<BayesSeriesInput>,
  k: number = BAYES_SHRINKAGE_K,
  loessSpan: number = DEFAULT_LOESS_SPAN,
): Map<string, Array<BayesSeriesPoint>> {
  if (inputs.length === 0) return new Map()

  const numPeriods = inputs[0].points.length

  // Step 1: sale-count-weighted average across all series per period
  const weightedAvgPoints: Array<TimeSeriesPoint> = []
  for (let i = 0; i < numPeriods; i++) {
    let totalWeight = 0
    let weightedSum = 0
    for (const input of inputs) {
      const val = input.points[i].y
      const count = input.saleCounts[i]
      if (val !== null && count > 0) {
        weightedSum += val * count
        totalWeight += count
      }
    }
    weightedAvgPoints.push({
      x: i,
      y: totalWeight > 0 ? weightedSum / totalWeight : null,
    })
  }

  // Step 2: LOESS smooth the weighted average → reference trend
  const referenceTrend = loessSmooth(weightedAvgPoints, loessSpan)

  // Step 3: for each series, compute Bayes estimates
  const result = new Map<string, Array<BayesSeriesPoint>>()

  for (const input of inputs) {
    const bayesPoints: Array<BayesSeriesPoint> = []

    for (let i = 0; i < numPeriods; i++) {
      const refValue = referenceTrend[i].y
      const localValue = input.points[i].y
      const localCount = input.saleCounts[i]

      if (refValue === null) {
        // No reference available — pass through raw value
        bayesPoints.push({
          x: i,
          y: localValue,
          estimationPct: localValue !== null ? 0 : null,
          rawLocalValue: localValue,
        })
      } else {
        const { estimate, estimationPct } = bayesShrinkageEstimate(
          localValue,
          refValue,
          localCount,
          k,
        )
        bayesPoints.push({
          x: i,
          y: estimate,
          estimationPct,
          rawLocalValue: localValue,
        })
      }
    }

    result.set(input.label, bayesPoints)
  }

  return result
}

// ---------------------------------------------------------------------------
// Smoothing Functions
// ---------------------------------------------------------------------------

/**
 * Apply LOESS (Locally Weighted Scatterplot Smoothing) to a time series.
 *
 * LOESS fits a local polynomial regression at each point, weighted by
 * proximity. Unlike a global polynomial, it naturally captures regime
 * changes (growth → flat → decline) without oscillating at boundaries.
 *
 * Null y-values are excluded from the fit, and their positions in the
 * output remain null. If fewer than {@link MIN_LOESS_POINTS} non-null
 * points exist, returns the input unchanged (LOESS can't fit meaningfully).
 *
 * @param points - Time series with sequential x-positions and nullable y-values.
 * @param span - Bandwidth parameter (0.1–0.9). Lower = more responsive, higher = smoother.
 * @returns New array with the same x-positions. Non-null y-values are replaced
 *   with their LOESS-smoothed equivalents; null y-values remain null.
 */
export function loessSmooth(
  points: Array<TimeSeriesPoint>,
  span: number = DEFAULT_LOESS_SPAN,
): Array<TimeSeriesPoint> {
  // Separate non-null points for fitting
  const valid = points.filter(
    (p): p is { x: number; y: number } => p.y !== null,
  )

  if (valid.length < MIN_LOESS_POINTS) {
    return points.map((p) => ({ ...p }))
  }

  const model = new Loess(
    { x: valid.map((p) => p.x), y: valid.map((p) => p.y) },
    { span, degree: 1 },
  )
  const { fitted } = model.predict()

  // Build a lookup from x-position to fitted value
  const fittedMap = new Map<number, number>()
  for (let i = 0; i < valid.length; i++) {
    fittedMap.set(valid[i].x, fitted[i])
  }

  // Map back to original positions, preserving nulls
  return points.map((p) => ({
    x: p.x,
    y: p.y === null ? null : (fittedMap.get(p.x) ?? p.y),
  }))
}

/**
 * Apply a trailing moving average to a time series.
 *
 * For each point, averages the most recent `window` non-null y-values
 * (including the current point). Returns null for positions where fewer
 * than `ceil(window / 2)` non-null values are available — this avoids
 * misleading partial-window averages at the start of the series.
 *
 * Null y-values in the input are skipped (they don't count toward the
 * window) and remain null in the output.
 *
 * @param points - Time series with sequential x-positions and nullable y-values.
 * @param window - Number of trailing periods to average. Must be >= 1.
 * @returns New array with the same x-positions and smoothed y-values.
 */
export function movingAverageSmooth(
  points: Array<TimeSeriesPoint>,
  window: number = DEFAULT_MA_WINDOW,
): Array<TimeSeriesPoint> {
  const minRequired = Math.ceil(window / 2)

  return points.map((point, idx) => {
    if (point.y === null) return { x: point.x, y: null }

    // Collect the most recent `window` non-null values up to and including idx
    const windowValues: Array<number> = []
    for (let i = idx; i >= 0 && windowValues.length < window; i--) {
      if (points[i].y !== null) {
        windowValues.push(points[i].y!)
      }
    }

    // Not enough data for a reliable average
    if (windowValues.length < minRequired) {
      return { x: point.x, y: null }
    }

    const avg =
      windowValues.reduce((sum, v) => sum + v, 0) / windowValues.length
    return { x: point.x, y: avg }
  })
}

/**
 * Apply a smoothing method to a time series.
 *
 * This is the single entry point that widgets call. It dispatches to the
 * correct smoothing function based on the method parameter, or returns
 * the input unchanged for `'none'`.
 *
 * @param points - Time series data.
 * @param method - Which smoothing method to apply.
 * @param options - Method-specific parameters (span for LOESS, window for MA).
 * @returns Smoothed time series. For `'none'`, returns the input array
 *   by reference (no copy).
 */
export function applySmoothingToSeries(
  points: Array<TimeSeriesPoint>,
  method: TrendLineMethod,
  options?: SmoothingOptions,
): Array<TimeSeriesPoint> {
  switch (method) {
    case 'none':
      return points
    case 'loess':
      return loessSmooth(points, options?.span ?? DEFAULT_LOESS_SPAN)
    case 'moving-average':
      return movingAverageSmooth(points, options?.window ?? DEFAULT_MA_WINDOW)
  }
}
