# LOESS Methodology Improvements: Research & Recommendations

> **Date:** March 2026
> **Scope:** Critical review of the NSW RealVision LOESS heatmap pipeline (docs/methodology.md § 13)
> **Purpose:** Evaluate each known limitation, research standard approaches, and recommend action

## Table of Contents

1. [Sale-Count Weighting](#1-sale-count-weighting)
2. [CAGR from Two Endpoints](#2-cagr-from-two-endpoints)
3. [Adaptive Bandwidth Formula](#3-adaptive-bandwidth-formula)
4. [Minimum Points Threshold](#4-minimum-points-threshold)
5. [Edge Bias Correction](#5-edge-bias-correction)
6. [Price-per-sqm Ambiguity](#6-price-per-sqm-ambiguity)
7. [Quarterly Oversampling](#7-quarterly-oversampling)
8. [References](#references)

---

## 1. Sale-Count Weighting

**Current behaviour:** The `yearly_medians` CTE computes `sale_count` per H3 cell per year, but this value is never used. Every yearly median receives equal weight in the local regression, regardless of whether it represents 1 sale or 200.

**Problem:** A median derived from a single sale is far noisier than one derived from 50 sales. Treating them equally means a single anomalous transaction can anchor the LOESS curve just as firmly as a year of consistent data.

### What the literature says

Cleveland (1979) defines the total weight for observation _i_ in a local regression at point _x_ as the **product** of all applicable weight components:

```
w_total(i) = w_case(i) × w_tricube(i) × w_robust(i)
```

R's `loess()` accepts a `weights` argument for case weights, which are multiplied with the tricube kernel weights. This is standard practice — see Bioconductor's `limma::weightedLowess()` documentation: _"the weights used for local regressions are the product of the prior weights, tri-cube local weights and biweight robustifying weights."_

For **aggregated data** (group means summarising _n_ observations each), standard weighted least-squares (WLS) theory provides clear guidance on the correct weight:

| Aggregation type | Variance of observation | Optimal weight |
|---|---|---|
| Group means (our case) | σ² / n | **w = n** |
| Group totals | n · σ² | w = 1/n |
| Raw individual observations | σ² | w = 1 |

The inverse-variance weight `w = n` is the BLUE (Best Linear Unbiased Estimator) weight under Gauss-Markov assumptions. This is not a heuristic — it is the mathematically optimal choice when each observation is a mean of _n_ independent draws from a common-variance population.

### Alternative weighting functions

| Option | Formula | Rationale | Tradeoff |
|---|---|---|---|
| **Linear (n)** | `w = sale_count` | Theoretically optimal for means of equal-variance observations | Large cells may dominate if sale counts span orders of magnitude |
| **Square root** | `w = sqrt(sale_count)` | Dampens influence of very large groups | No clean statistical derivation; pragmatic compromise |
| **Logarithmic** | `w = log(sale_count)` | Aggressive dampening when counts span 1–500+ | Even less statistical justification; rarely used in literature |

### Assessment

Our yearly medians are means of _n_ sales. The variance of a median is approximately `σ² × π / (2n)` for normal data — proportional to `1/n`, same scaling as the mean. Therefore `w = n` is the correct weight.

Concern about large-count cells dominating is mitigated by two factors:

1. The tricube kernel already provides spatial locality — only years within ±bandwidth contribute.
2. Large count years are precisely the years we _should_ trust more. Giving a 200-sale median 200× the weight of a 1-sale median correctly reflects relative reliability.

If empirical testing shows instability from extreme count disparities, `sqrt(n)` is a reasonable fallback. But start with `n`.

### Recommendation: **Implement — weight by `sale_count`**

**Implementation:** In `loess-curve-precompute.ts`, Step 5 (tricube kernel weights), multiply the tricube weight by the sale count from `yearly_medians`:

```sql
-- Current
w AS (1.0 - POW(ABS(u), 3)) * (1.0 - POW(ABS(u), 3)) * (1.0 - POW(ABS(u), 3))

-- Proposed
w AS sale_count * POW(1.0 - POW(ABS(u), 3), 3)
```

The normal equations in Step 6 already use `w` throughout (`S_w`, `S_wx`, `S_wy`, `S_wxx`, `S_wxy`), so no changes are needed there. Add `LOESS_USE_CASE_WEIGHTS = true` to `loess-config.ts` for documentation clarity.

**Complexity:** Low. Single line change in the weight computation CTE.

---

## 2. CAGR from Two Endpoints

**Current behaviour:** Growth is measured as the CAGR between `fitted_prices[start]` and `fitted_prices[end]` — two point estimates from the LOESS curve.

**Concern:** If the start or end quarter coincides with a local peak or trough, the CAGR is distorted by endpoint sensitivity.

### Analysis

This concern applies to raw data but is substantially mitigated in our pipeline:

1. **LOESS smoothing already absorbs endpoint noise.** Each fitted value is a weighted average of multiple years of data. With `bandwidth = 5`, the fitted value at any point reflects data from approximately ±5 years.

2. **Bandwidth is the lever.** Increasing bandwidth produces smoother endpoints at the cost of reduced temporal resolution. The current minimum of 5 years is already conservative — each endpoint integrates a decade's worth of surrounding data.

3. **Data-range capping prevents extrapolation.** We only compute fitted values within `[earliest_sale, latest_sale]`, so endpoints are always backed by actual data. The cap `quarter_eval >= earliest_sale AND quarter_eval <= latest_sale` ensures we never rely on pure extrapolation.

4. **Alternative approaches are worse:**
   - Averaging over a window of fitted values (e.g., 2-year window at each end) adds complexity and still requires choosing a window size — just shifting the problem.
   - Using raw medians defeats the purpose of LOESS smoothing.
   - Confidence intervals on CAGR require the LOESS hat matrix, which our SQL implementation doesn't compute.

### Recommendation: **Document as acceptable — no change**

The two-endpoint CAGR is the natural way to measure growth from a smoothed curve. The smoothing _is_ the robustness mechanism. Users who want to assess sensitivity can adjust the bandwidth parameter.

Add a note to docs/methodology.md explaining why two-endpoint CAGR is reasonable given LOESS smoothing:

> _The LOESS curve already provides the endpoint robustness that alternatives (e.g., averaging a window of fitted values) attempt to achieve. Each fitted value integrates data over ±bandwidth years via the tricube kernel, making it a locally-weighted trend estimate rather than a point observation. Bandwidth is the natural lever for controlling endpoint sensitivity._

---

## 3. Adaptive Bandwidth Formula

**Current behaviour:**

```
bandwidth = MAX(5, CEIL((max_year - min_year) / num_years * 3))
```

The multiplier of 3 has no statistical justification. The formula attempts to widen the bandwidth for sparse cells (few observed years over a long span) while maintaining a minimum of 5 years.

### What the literature says

Standard LOESS does not use a fixed bandwidth. It uses a **nearest-neighbour span** — a fraction α of the total data points:

| Implementation | Default α | Default degree |
|---|---|---|
| R `loess()` | **0.75** | 2 (quadratic) |
| R `lowess()` | **0.667** (2/3) | 1 (linear) |
| Python statsmodels `lowess()` | **0.667** | 1 (linear) |
| Cleveland (1979) | **0.667** | 1 |

With nearest-neighbour bandwidth:
- The neighbourhood for fitting at point _x_ comprises the `floor(α × n)` nearest observations.
- The bandwidth _h(x)_ is the distance to the farthest included point — **adaptive by construction**.
- Dense regions get smaller bandwidths (higher resolution); sparse regions get larger bandwidths (more smoothing).

This is exactly the behaviour our ad-hoc formula attempts to achieve, but the nearest-neighbour approach does it with a single, interpretable, well-studied parameter (α) instead of our empirical multiplier.

### Automatic span selection

More sophisticated methods exist for choosing α:

| Method | How it works | Pros | Cons |
|---|---|---|---|
| **AICc** (Hurvich et al. 1998) | Penalised likelihood: balances fit vs complexity using trace of smoother matrix | Data-driven, no manual tuning; SAS default | Requires smoother matrix trace; assumes independent obs |
| **GCV** | Approximates leave-one-out CV: `mean(resid²) / (1 - tr(S)/n)²` | Also data-driven; computationally efficient | Can undersmooth with correlated data |
| **Fixed α** | User-specified fraction | Simple, interpretable, reproducible | Requires domain knowledge to choose |
| **Visual / M-plot** | Cleveland & Devlin's (1988) graphical Cp adaptation | Handles nuance well | Not automatable |

For our use case (tens of thousands of cells, no interactive tuning possible), AICc/GCV are attractive but impractical in a SQL-based pipeline — they require the trace of the smoothing matrix, which our CTE-based approach doesn't compute.

A fixed α is the pragmatic choice for a precomputed pipeline. The question is: **what value of α?**

### Translating between α and our current formula

Our data typically has 10–30 yearly observations per cell. With α = 0.75 (R default) and n = 20 years: the local neighbourhood includes 15 years, giving an effective bandwidth of ~7–8 years. With α = 0.667 (Cleveland's LOWESS default) and n = 20: 13 years, bandwidth ~6–7 years.

Our current minimum bandwidth of 5 years is roughly equivalent to α ≈ 0.5 for a 20-year cell, which is reasonable but on the aggressive (lower-smoothing) end. The NIST handbook recommends α in the range 0.25–0.50 for most applications, but notes this assumes large datasets; our per-cell datasets of 10–30 points benefit from higher α.

### Options

| Option | Formula | Pros | Cons |
|---|---|---|---|
| **A. Nearest-neighbour α** | `k = MAX(p+1, CEIL(α × n))`; bandwidth = distance to k-th nearest | Standard, well-understood, adaptive, single parameter | Requires sorting distances per eval point; more SQL complexity |
| **B. Reframe current as α** | `α = 3 / year_range × n_years`... (doesn't simplify) | Minimal code change | The current formula doesn't cleanly map to α |
| **C. Fixed bandwidth with higher minimum** | `bandwidth = MAX(7, ...)` | Simplest change | Still ad-hoc; doesn't adapt to data density |
| **D. Pure nearest-neighbour count** | `k = MAX(5, CEIL(0.75 × n))`; bandwidth = distance to k-th point | Standard, interpretable | Need to restructure the SQL to find k-th nearest year |

### Recommendation: **Implement Option D — nearest-neighbour span with α = 0.75**

Replace the ad-hoc formula with the standard nearest-neighbour approach:

1. For each cell with _n_ observed years, compute `k = MAX(5, CEIL(0.75 × n))`.
2. For each evaluation point, the bandwidth is the distance to the _k_-th nearest observed year.
3. The tricube kernel weight uses this per-evaluation-point bandwidth.

This is the standard LOESS approach. It:
- Eliminates the unjustified multiplier of 3
- Uses a single, well-studied parameter (α = 0.75, R's default)
- Is naturally adaptive — dense cells get narrower bandwidths, sparse cells get wider ones
- Has a floor of 5 nearest points (matching our current `LOESS_MIN_WEIGHTED_POINTS` intent, though that constant controls a different threshold — see Issue 4)

**Implementation complexity:** Moderate. The CTE structure needs to change: instead of precomputing a single bandwidth per cell, compute it per (cell, evaluation point) by ranking observed years by distance and taking the k-th nearest distance as the bandwidth. This is achievable with a `ROW_NUMBER()` window function.

**Config change:** Replace `LOESS_BANDWIDTH = 5` with `LOESS_SPAN = 0.75` and `LOESS_MIN_NEIGHBOURS = 5` in `loess-config.ts`.

---

## 4. Minimum Points Threshold

**Current behaviour:** `HAVING COUNT(*) >= 3` — requires at least 3 years with non-zero tricube weight within the bandwidth window. With degree 1 (2 parameters: intercept + slope), this leaves 1 residual degree of freedom.

### What the literature says

A degree-_p_ univariate local polynomial has _p + 1_ coefficients:

| Degree | Form | Coefficients | Absolute minimum points |
|---|---|---|---|
| 0 (constant) | β₀ | 1 | 1 |
| 1 (linear) | β₀ + β₁x | 2 | 2 |
| 2 (quadratic) | β₀ + β₁x + β₂x² | 3 | 3 |

With exactly _p + 1_ points, the polynomial interpolates (passes exactly through all points) — no smoothing occurs. With _p + 2_ points, there is 1 residual degree of freedom — technically solvable but no capacity for goodness-of-fit assessment.

The NIST Engineering Statistics Handbook states that LOESS _"requires fairly large, densely sampled data sets in order to produce good models"_ and recommends spans of 0.25–0.50, implying at least 4–10+ points per neighbourhood for meaningful fits.

R's `loess()` does not enforce a hard minimum in its interface, but will produce warnings or errors when local fits fail. SAS PROC LOESS warns of _"numerically singular"_ local SSCP matrices when neighbourhoods have insufficient linearly independent observations.

### Analysis of our situation

With 3 points and degree 1:
- 1 residual degree of freedom
- The fit is nearly interpolating — dominated by noise in any one of the 3 points
- No capacity to detect or correct for outliers
- The normal equations are solvable but the result is fragile

With 4 points: 2 residual DoF — marginally better.

With 5 points: 3 residual DoF — the fit can absorb one outlier without collapsing.

### Interaction with Issue 1 (sale-count weighting)

If we implement sale-count weighting (Issue 1), the minimum-points threshold becomes less critical. A cell with 3 observed years but 50+ sales per year has more information than 3 years × 1 sale. The case weights give the solver more to work with, even with few unique x-values.

However, regardless of case weights, 3 unique x-values means the degree-1 fit is determined by only 3 points in x-space. Weighting adjusts the _influence_ of each point but doesn't add positional diversity. For a local linear fit to be meaningfully "local" (i.e., detect a slope), you need spatial spread across x.

### Options

| Minimum | Residual DoF (degree 1) | Cells excluded | Stability |
|---|---|---|---|
| 3 (current) | 1 | Fewest | Fragile |
| 4 | 2 | Some additional | Marginal |
| **5** | **3** | **Moderate** | **Adequate** |
| 6 | 4 | More | Good |

### Recommendation: **Increase to 5**

A minimum of 5 provides 3 residual degrees of freedom, sufficient for a basic sanity check on fit quality and resilience to a single outlier year. This is the minimum at which LOESS begins to behave like a genuine smoother rather than an interpolator.

The tradeoff is excluding some additional cells — but cells with fewer than 5 years of data within the bandwidth window are precisely the cells where LOESS provides the least value. Returning no fitted value is better than returning a fragile one.

**Implementation:** Change `LOESS_MIN_WEIGHTED_POINTS = 5` in `loess-config.ts`, and update the `HAVING COUNT(*) >= 3` clause in `loess-curve-precompute.ts` to use this constant (it should already reference it — verify).

**Important interaction:** If we implement the nearest-neighbour span (Issue 3) with `LOESS_MIN_NEIGHBOURS = 5`, this minimum-points threshold becomes partially redundant — the span already guarantees at least 5 neighbours. However, keeping the HAVING clause as a safety net is reasonable: the span guarantees 5 nearest _data points_, but after tricube weighting, some may receive negligible weight.

---

## 5. Edge Bias Correction

**Current behaviour:** We use degree 1 (local linear) regression and cap fitted values to the data range (`quarter_eval >= earliest_sale AND quarter_eval <= latest_sale`). No explicit edge bias correction is applied.

### What the literature says

Fan and Gijbels (1996) established the definitive theory of boundary bias for local polynomial estimators:

| Degree _p_ | Interior bias | Boundary bias | Key property |
|---|---|---|---|
| 0 (Nadaraya-Watson) | O(h²) | **O(h)** | Boundary bias one order worse |
| **1 (local linear)** | **O(h²)** | **O(h²)** | **Same rate — automatic boundary correction** |
| 2 (local quadratic) | O(h⁴) | O(h³) | Boundary bias one order worse than interior |

The critical insight: **local linear regression (degree 1) achieves automatic boundary correction.** The bias at boundaries is the same order — O(h²) — as in the interior. This is because the linear fit can reproduce a linear trend at the boundary, naturally adapting to the asymmetric kernel support.

Fan and Gijbels recommend odd _p − v_ (where _v_ is the derivative order being estimated; for function estimation, _v = 0_). So degree 1 and degree 3 achieve same-order boundary bias as interior bias. Degree 0 and degree 2 do not.

### Why degree 2 is not necessarily better

R's `loess()` defaults to degree 2, giving O(h⁴) interior bias — better than degree 1's O(h²). But:

1. Degree 2 boundary bias is O(h³), worse than its interior rate (though still better than degree 1's O(h²) overall).
2. Degree 2 requires 3 parameters per local fit, demanding more data per neighbourhood.
3. Degree 2 has higher variance than degree 1, especially with sparse data.
4. R's own documentation notes: _"Lower degree (i.e. 1, linear) has more bias but pulls back variance at the boundaries."_

For our data characteristics (10–30 observations per cell, moderate noise), degree 1 is the appropriate choice. The variance reduction matters more than the improved interior bias of degree 2.

### Other boundary correction methods

| Method | Description | Applicability |
|---|---|---|
| **Boundary kernels** | Modified kernel shapes near boundaries | Unnecessary with degree ≥ 1 (automatic correction) |
| **Reflection** (Schuster 1985) | Reflect data across boundary | Designed for density estimation, not regression. Still biased unless first derivative is zero at boundary. |
| **Empirical translation** | Shift kernel to maintain symmetry | Complex, rarely used for LOESS |
| **Data range capping** (our approach) | Don't evaluate outside observed data range | Prevents extrapolation but doesn't reduce edge bias within the range |

### Assessment

We already have the two most important edge bias mitigations:

1. **Degree 1 (local linear)** — automatic boundary correction with same O(h²) bias order at boundaries as interior.
2. **Data range capping** — no extrapolation beyond the observed data range.

Switching to degree 2 would improve interior bias from O(h²) to O(h⁴) but worsen boundary bias relative to its own interior rate, increase variance, and require more data per neighbourhood. With our sparse-to-moderate cell data, this tradeoff is unfavourable.

### Recommendation: **No change — current approach is already best practice**

Our degree 1 + data range capping is the textbook recommendation for boundary-robust local regression with moderate-sized datasets. Document this in docs/methodology.md as an intentional design choice:

> _Local linear regression (degree 1) provides automatic boundary correction — the bias at boundaries is the same order O(h²) as in the interior (Fan & Gijbels 1996). Combined with data-range capping that prevents extrapolation beyond observed years, our pipeline implements the standard approach for edge-robust LOESS._

---

## 6. Price-per-sqm Ambiguity

**Current behaviour:** The `price_per_sqm` metric divides purchase price by the `area` field. For freehold properties, `area` is typically lot size (land area). For strata properties, `area` is typically unit floor area. These represent fundamentally different quantities, but the pipeline treats them identically.

### Analysis

This is a data-source limitation, not an algorithm limitation:

1. The NSW Valuer General data provides a single `area` field with an `area_type` indicator (M = square metres, H = hectares). There is no separate field for lot area vs floor area.
2. The `strata` column allows segmentation into freehold and strata subsets, and we already compute separate LOESS curves for each (`strata_filter` in `agg_h3_loess_curve`). Within each segment, the `area` interpretation is _mostly_ consistent.
3. Some edge cases remain: a freehold property might have floor area recorded instead of lot area, or vice versa for strata. Without a cross-reference dataset (e.g., land title records with explicit lot and floor areas), there is no way to disambiguate programmatically.

### Options

| Option | Description | Feasibility |
|---|---|---|
| **A. Accept and document** | Note the ambiguity in methodology docs | Trivial |
| **B. Cross-reference with external data** | Match against NSW Spatial Services cadastral data for lot areas | Possible but large scope; a separate project |
| **C. Heuristic filtering** | Exclude properties where area seems inconsistent (e.g., freehold with area < 50 m²) | Could help but risks removing valid data (inner-city terraces are small) |
| **D. Only show price-per-sqm for strata** | Hide metric for freehold where lot area is less meaningful for price comparison | Reduces functionality |

### Recommendation: **Accept and document — no change**

The strata segmentation already provides the primary mitigation. Within the freehold segment, $/sqm reflects $/land area, which is a valid (if different) metric. Within the strata segment, $/sqm reflects $/floor area, which is the standard unit pricing metric.

Document the interpretation difference clearly in docs/methodology.md and in the UI (tooltip or info panel on the heatmap settings).

---

## 7. Quarterly Oversampling

**Current behaviour:** The evaluation grid uses quarterly steps (0.25 year increments) from 1990.0 to the present. With yearly input data, this means 4 fitted values are computed between each pair of actual observations.

### Analysis

These intermediate quarterly values contain **no new information**. A LOESS fit is fully determined by the input data and parameters. Evaluating at quarterly intervals produces 4× the storage of yearly evaluation, with each quarterly value being a smooth interpolation of the same underlying yearly points.

The quarterly grid was originally chosen to support arbitrary period queries at sub-year precision. But:

1. All actual analysis uses year-boundary quarters (Q1 = .0, Q2 = .25, Q3 = .5, Q4 = .75) — which align with yearly evaluation points.
2. For the rare case where sub-year precision is needed, **linear interpolation between yearly fitted values** is mathematically equivalent to the LOESS fit at the same point (since the LOESS fit is already a smooth curve, and yearly spacing captures all the curvature that yearly input data can support).

### Storage impact

Current quarterly storage:
- Typical cell: 35 years × 4 quarters = 140 BIGINT values per curve
- With 18 combinations × ~50,000 cells = ~900,000 rows × 140 values = ~126M values

Yearly storage:
- Same cell: 35 years × 1 = 35 BIGINT values per curve
- ~900,000 rows × 35 values = ~31.5M values

**4× reduction** in array storage with equivalent analytical value.

### Query-time interpolation

When a query requests a non-integer quarter (e.g., 2020.5), interpolate between the two nearest yearly fitted values:

```sql
-- Given target_quarter = 2020.5
-- floor_year = 2020, ceil_year = 2021
-- fraction = 0.5
fitted_at_target = fitted_at_floor + fraction * (fitted_at_ceil - fitted_at_floor)
```

This is a trivial computation and adds negligible query-time cost.

### Options

| Option | Storage | Query complexity | Precision |
|---|---|---|---|
| **A. Quarterly (current)** | 4× | Direct array lookup | Exact LOESS evaluation |
| **B. Yearly** | 1× | Linear interpolation for sub-year queries | Negligible difference (yearly input data) |
| **C. Semi-annual** | 2× | Interpolation for sub-half-year queries | Compromise |

### Recommendation: **Implement — switch to yearly evaluation grid**

**Implementation changes:**

1. **`loess-config.ts`**: Change `QUARTER_STEP = 0.25` to `EVAL_STEP = 1.0`. Rename for clarity.
2. **`loess-curve-precompute.ts`**: Update the evaluation grid CTE to generate yearly points instead of quarterly.
3. **`schema.ts`**: Update `agg_h3_loess_curve` DDL comments. The array now stores yearly values.
4. **`heatmap-queries.ts`**: Update array indexing:
   ```sql
   -- Current (quarterly)
   list_extract(fitted_prices, CAST((target_quarter - min_quarter) / 0.25 + 1 AS INT))

   -- New (yearly with interpolation)
   -- For integer years: direct lookup
   list_extract(fitted_prices, CAST((target_year - min_year) + 1 AS INT))

   -- For fractional years: interpolate
   ```
5. **TypeScript consumers**: Update `queryLoessCurve()` to reconstruct quarterly points from yearly via interpolation if needed for chart rendering (or render yearly points directly — cleaner).
6. **Gap detection** (Step 9): Change from consecutive-quarter detection to consecutive-year detection. The minimum contiguous run changes from 4 quarters to 2 years (or keep at 4 years for consistency with the current 4-quarter minimum).

**Complexity:** Moderate. Touches ETL, schema, and query code, but each change is mechanical.

---

## Summary of Recommendations

| # | Issue | Action | Complexity | Impact |
|---|---|---|---|---|
| 1 | Sale-count weighting | **Implement** — weight by `sale_count` | Low | High — directly improves fit reliability |
| 2 | CAGR from two endpoints | **Document** — LOESS smoothing is the robustness mechanism | Trivial | N/A |
| 3 | Adaptive bandwidth | **Implement** — nearest-neighbour span (α = 0.75) | Moderate | High — replaces ad-hoc formula with standard approach |
| 4 | Minimum points | **Increase to 5** | Low | Moderate — excludes fragile fits |
| 5 | Edge bias | **No change** — degree 1 already provides automatic correction | None | N/A |
| 6 | Price-per-sqm ambiguity | **Document** — data source limitation | Trivial | N/A |
| 7 | Quarterly oversampling | **Implement** — switch to yearly evaluation grid | Moderate | Moderate — 4× storage reduction |

### Suggested implementation order

1. **Sale-count weighting** (Issue 1) — lowest complexity, highest impact, no dependencies
2. **Minimum points increase** (Issue 4) — trivial change, improves stability
3. **Yearly evaluation grid** (Issue 7) — moderate complexity, clean storage improvement
4. **Nearest-neighbour bandwidth** (Issue 3) — most complex, but highest methodological improvement

Issues 1 and 4 can be implemented independently. Issue 3 (nearest-neighbour span) subsumes some of Issue 4's intent but they are complementary. Issue 7 is fully independent.

---

## References

### Primary Sources

- Cleveland, W.S. (1979). "Robust Locally Weighted Regression and Smoothing Scatterplots." _Journal of the American Statistical Association_, 74(368), 829–836.
- Cleveland, W.S. and Devlin, S.J. (1988). "Locally Weighted Regression: An Approach to Regression Analysis by Local Fitting." _Journal of the American Statistical Association_, 83(403), 596–610.
- Fan, J. and Gijbels, I. (1996). _Local Polynomial Modelling and Its Applications_. Chapman and Hall.
- Hurvich, C.M., Simonoff, J.S., and Tsai, C.-L. (1998). "Smoothing Parameter Selection in Nonparametric Regression Using an Improved Akaike Information Criterion." _Journal of the Royal Statistical Society, Series B_, 60(2), 271–293.
- Schuster, E.F. (1985). "Incorporating Support Constraints into Non-parametric Estimators of Densities." _Communications in Statistics — Theory and Methods_, 14, 1123–1136.

### Software Documentation

- R `loess()` documentation: https://stat.ethz.ch/R-manual/R-devel/library/stats/html/loess.html
- R `lowess()` documentation: https://www.rdocumentation.org/packages/stats/versions/3.6.2/topics/lowess
- Bioconductor `limma::weightedLowess()`: https://rdrr.io/bioc/limma/man/weightedLowess.html
- SAS PROC LOESS: https://support.sas.com/documentation/cdl/en/statug/63347/HTML/default/statug_loess_sect024.htm
- R `fANCOVA::loess.as()` (automated span selection): https://www.rdocumentation.org/packages/fANCOVA/versions/0.5-1/topics/loess.as
- NIST Engineering Statistics Handbook — LOESS: https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd144.htm

### Textbooks and Guides

- Penn State STAT 501 — Weighted Least Squares: https://online.stat.psu.edu/stat501/lesson/13/13.1
- Wikipedia — Local regression: https://en.wikipedia.org/wiki/Local_regression
