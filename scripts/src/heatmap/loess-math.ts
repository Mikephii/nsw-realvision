/**
 * Pure mathematical functions for the LOESS kernel and weighting.
 *
 * These are reference implementations of the same formulas used in the
 * SQL pipeline (`loess-curve-precompute.ts`). They serve two purposes:
 *
 * 1. **Testable specification** — unit tests verify correctness against
 *    known values, ensuring the SQL mirrors the intended algorithm.
 * 2. **Documentation** — the JSDoc on each function documents the
 *    mathematical derivation, properties, and references.
 *
 * The SQL pipeline is the production computation engine. These functions
 * are NOT called at runtime by the ETL or webapp — they exist solely
 * for testing and as a human-readable reference.
 *
 * @see loess-curve-precompute.ts — SQL implementation (Step 5: weighted CTE)
 * @see loess-config.ts — algorithm constants (bandwidth, min points, etc.)
 *
 * References:
 * - Cleveland, W.S. (1979). "Robust Locally Weighted Regression and
 *   Smoothing Scatterplots." JASA, 74(368), 829–836.
 * - Cleveland, W.S. and Devlin, S.J. (1988). "Locally Weighted Regression:
 *   An Approach to Regression Analysis by Local Fitting." JASA, 83(403), 596–610.
 */

/**
 * Tricube kernel weight function.
 *
 * The tricube kernel is the standard LOESS distance-decay function
 * introduced by Cleveland (1979). It produces smooth, continuously
 * differentiable weights with compact support (exactly zero at the
 * bandwidth boundary).
 *
 * **Formula:**
 * ```
 * w(u) = (1 - |u|³)³   for |u| ≤ 1
 * w(u) = 0              for |u| > 1
 * ```
 * where `u = distance / bandwidth` (normalised distance).
 *
 * **Properties:**
 * - Maximum weight (1.0) when distance = 0
 * - Exact zero at distance = bandwidth (compact support)
 * - Continuously differentiable (C¹) — smooth decay, no kinks
 * - Monotonically decreasing on [0, bandwidth]
 * - Non-negative everywhere
 *
 * **SQL equivalent** (in `loess-curve-precompute.ts`, Step 5):
 * ```sql
 * POWER(1.0 - POWER(CAST(ABS(distance) AS DOUBLE) / bandwidth, 3), 3)
 * ```
 *
 * @param distance - Absolute temporal distance from evaluation point to
 *   data point, in years. Must be non-negative.
 * @param bandwidth - Kernel half-width in years. Must be positive.
 * @returns Weight in [0, 1]. Returns 0 if distance ≥ bandwidth.
 */
export function tricubeWeight(distance: number, bandwidth: number): number {
  const u = Math.abs(distance) / bandwidth
  if (u >= 1) return 0
  return Math.pow(1 - Math.pow(u, 3), 3)
}

/**
 * Combined LOESS weight: case weight × tricube kernel weight.
 *
 * In standard LOESS with aggregated data (Cleveland 1979 §2), the total
 * weight for each observation is the product of all applicable weight
 * components:
 *
 * ```
 * w_total = w_case × w_tricube
 * ```
 *
 * **Case weight rationale (inverse-variance weighting):**
 *
 * Each "observation" in our pipeline is a yearly median aggregating
 * `saleCount` individual sales. Under the Gauss-Markov theorem, the
 * optimal weight for a mean (or median) of n independent observations
 * is proportional to n (the inverse of the variance):
 *
 * ```
 * Var(median of n) ≈ σ² × π / (2n)   →   w_case = n
 * ```
 *
 * This is the BLUE (Best Linear Unbiased Estimator) weight. A yearly
 * median from 50 sales receives 50× the weight of a median from 1 sale,
 * correctly reflecting the relative reliability of each estimate.
 *
 * **SQL equivalent** (in `loess-curve-precompute.ts`, Step 5):
 * ```sql
 * ym.sale_count * POWER(1.0 - POWER(..., 3), 3) AS w
 * ```
 *
 * @param distance - Absolute temporal distance (years). Must be non-negative.
 * @param bandwidth - Kernel half-width (years). Must be positive.
 * @param saleCount - Number of sales that produced the yearly median.
 *   Must be a non-negative integer. In practice, always ≥ 1 since
 *   the `yearly_medians` CTE only produces rows for cells with sales.
 * @returns Combined weight. Zero if outside bandwidth or saleCount is 0.
 */
export function combinedWeight(
  distance: number,
  bandwidth: number,
  saleCount: number,
): number {
  return saleCount * tricubeWeight(distance, bandwidth)
}

/**
 * Accumulate weighted OLS normal equation sums.
 *
 * Given a set of weighted observations {(x_i, y_i, w_i)}, computes the
 * five accumulated sums needed to solve a local linear (degree 1)
 * regression via the normal equations.
 *
 * The returned sums can be used to compute slope and intercept:
 * ```
 * b = (swxy - swx * swy / sw) / (swxx - swx² / sw)
 * a = (swy - b * swx) / sw
 * fitted = a + b * x_eval
 * ```
 *
 * This mirrors the `agg` CTE (Step 6) in `loess-curve-precompute.ts`.
 *
 * @param observations - Array of {x, y, w} tuples where w is the
 *   combined weight (sale_count × tricube).
 * @returns The five accumulated sums, or null if fewer than `minPoints`
 *   observations have non-zero weight.
 */
export function accumulateNormalEquations(
  observations: ReadonlyArray<{ readonly x: number; readonly y: number; readonly w: number }>,
  minPoints: number = 3,
): NormalEquationSums | null {
  let sw = 0
  let swx = 0
  let swy = 0
  let swxx = 0
  let swxy = 0
  let count = 0

  for (const { x, y, w } of observations) {
    if (w <= 0) continue
    sw += w
    swx += w * x
    swy += w * y
    swxx += w * x * x
    swxy += w * x * y
    count++
  }

  if (count < minPoints) return null

  return { sw, swx, swy, swxx, swxy }
}

/**
 * Solve the weighted OLS normal equations for slope and intercept.
 *
 * Given the accumulated sums from {@link accumulateNormalEquations},
 * solves for the local linear regression coefficients.
 *
 * Returns null if the denominator is zero (all data at the same x-value,
 * producing a singular system). This mirrors the `NULLIF(..., 0)` guard
 * in the `slopes` CTE (Step 7) of `loess-curve-precompute.ts`.
 *
 * @param sums - Accumulated normal equation sums.
 * @returns Slope and intercept, or null if singular.
 */
export function solveNormalEquations(
  sums: NormalEquationSums,
): { slope: number; intercept: number } | null {
  const { sw, swx, swy, swxx, swxy } = sums
  const denom = swxx - (swx * swx) / sw
  if (denom === 0) return null

  const slope = (swxy - (swx * swy) / sw) / denom
  const intercept = (swy - slope * swx) / sw

  return { slope, intercept }
}

/**
 * Evaluate a local linear regression at a target point.
 *
 * Combines {@link accumulateNormalEquations} and {@link solveNormalEquations}
 * to produce a fitted value at `xEval`. This is the complete local
 * regression pipeline for a single evaluation point, mirroring
 * Steps 5–8 of the SQL CTE chain.
 *
 * @param xEval - The x-coordinate at which to evaluate the fit.
 * @param observations - Array of {x, y, w} tuples.
 * @param minPoints - Minimum non-zero-weight observations required.
 * @returns The fitted y-value, or null if insufficient data or singular.
 */
export function evaluateLocalRegression(
  xEval: number,
  observations: ReadonlyArray<{ readonly x: number; readonly y: number; readonly w: number }>,
  minPoints: number = 3,
): number | null {
  const sums = accumulateNormalEquations(observations, minPoints)
  if (!sums) return null

  const solution = solveNormalEquations(sums)
  if (!solution) return null

  return solution.intercept + solution.slope * xEval
}

/**
 * Accumulated sums for the weighted OLS normal equations.
 *
 * These five sums are sufficient to solve a degree-1 (local linear)
 * weighted least squares problem. They correspond directly to the
 * columns computed in the `agg` CTE (Step 6) of the SQL pipeline.
 */
export interface NormalEquationSums {
  /** Sum of weights: Σw_i */
  readonly sw: number
  /** Sum of weighted x: Σ(w_i × x_i) */
  readonly swx: number
  /** Sum of weighted y: Σ(w_i × y_i) */
  readonly swy: number
  /** Sum of weighted x²: Σ(w_i × x_i²) */
  readonly swxx: number
  /** Sum of weighted xy: Σ(w_i × x_i × y_i) */
  readonly swxy: number
}
