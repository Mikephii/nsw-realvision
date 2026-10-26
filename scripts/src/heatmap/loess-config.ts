/**
 * Canonical LOESS configuration constants for the full-curve architecture.
 *
 * This module is the SINGLE SOURCE OF TRUTH for all LOESS algorithm
 * parameters used by the ETL precompute pipeline. The precomputed curve
 * architecture stores fitted prices at every quarter, so the webapp reads
 * stored arrays rather than re-computing LOESS — these constants are
 * ETL-only.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Changing any value here changes the algorithm for all future ETL runs.
 * After changes: re-run `pnpm etl recompute-loess` to rebuild curves.
 * Update golden-value tests in `scripts/tests/heatmap/loess-config.test.ts`.
 *
 * Spec:  docs/research/full-curve-loess-architecture.md
 * ETL:   scripts/src/heatmap/loess-curve-precompute.ts (Phase 1)
 * ══════════════════════════════════════════════════════════════════════════
 */

/**
 * Fixed LOESS bandwidth in years.
 *
 * The bandwidth controls how many years of data around each evaluation
 * point receive non-zero tricube kernel weight. A bandwidth of 5 means
 * data within ±5 years contributes, with closer data weighted more heavily.
 *
 * The total weight for each observation is:
 *   `w = sale_count × tricube(|distance| / bandwidth)`
 *
 * The `sale_count` case weight (Cleveland 1979) ensures yearly medians
 * from more sales receive proportionally higher influence, reflecting
 * lower variance of the median estimate. See `loess-math.ts` for the
 * reference implementation.
 *
 * **Why 5:** Sydney property market cycles are approximately 2–4 years
 * (peak-to-trough). Bandwidth 5 smooths over short-term cycles while
 * preserving longer-term trends. With yearly input data, ±5 years
 * provides up to 10 data points in the kernel window — well above the
 * minimum for stable weighted OLS.
 *
 * **Previous architecture:** Used `ceil(yearsBack / 2)` (variable 3–13).
 * The full-curve architecture decouples smoothing from display period,
 * using a single fixed bandwidth for all queries.
 *
 * See: full-curve-loess-architecture.md §5 "The Bandwidth Question"
 */
export const LOESS_BANDWIDTH = 5

/**
 * Minimum number of weighted data points required for a valid local
 * regression at any single evaluation point.
 *
 * With fewer than 3 points, the weighted OLS normal equations become
 * under-determined or numerically unstable. Evaluation points that
 * don't meet this threshold produce NULL fitted values (excluded from
 * the stored curve array).
 *
 * In the ETL SQL, this appears as: `HAVING COUNT(*) >= 3`
 */
export const LOESS_MIN_WEIGHTED_POINTS = 3

/**
 * Lower bound for fitted price values (linear space).
 *
 * LOESS operates in linear price space — fitted values below $1 are
 * nonsensical for property sales and indicate extrapolation failure.
 *
 * In the ETL SQL: `... BETWEEN 1 AND 1000000000`
 */
export const LOESS_PRICE_MIN = 1

/**
 * Upper bound for fitted price values (linear space).
 *
 * A fitted price above $1 billion is clearly an extrapolation artefact.
 * Such values are rejected.
 *
 * In the ETL SQL: `... BETWEEN 1 AND 1000000000`
 */
export const LOESS_PRICE_MAX = 1_000_000_000

/**
 * Earliest quarter at which to begin LOESS evaluation.
 *
 * NSW Valuer General archived data exists from 1990 onwards. The eval
 * grid starts here; cells without data this early will simply have no
 * fitted values for these quarters (the array starts at their earliest
 * valid fit).
 *
 * Format: year-fraction where Q1=.0, Q2=.25, Q3=.5, Q4=.75.
 */
export const LOESS_EVAL_START_QUARTER = 1990.0

/**
 * Quarter step size for the evaluation grid.
 *
 * 0.25 = quarterly: Q1 = year.0, Q2 = year.25, Q3 = year.5, Q4 = year.75.
 *
 * The fitted_prices array in `agg_h3_loess_curve` stores one value per
 * quarter step. Array indexing formula (1-indexed for DuckDB `list_extract`):
 *   index = (target_quarter - min_quarter) / QUARTER_STEP + 1
 */
export const QUARTER_STEP = 0.25
