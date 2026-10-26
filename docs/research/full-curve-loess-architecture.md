# Full-Curve LOESS Architecture — Research & Feasibility

> Should we compute the LOESS-smoothed price curve once across the full data range (1990–present), store the entire curve, and sample it at query time for any arbitrary period — rather than computing separate LOESS fits per lookback period?

---

## Table of Contents

1. [The Problem with Per-Period Bandwidth](#1-the-problem-with-per-period-bandwidth)
2. [The Full-Curve Proposal](#2-the-full-curve-proposal)
3. [Mathematical Validity](#3-mathematical-validity)
4. [Quarterly vs Yearly Granularity](#4-quarterly-vs-yearly-granularity)
5. [The Bandwidth Question](#5-the-bandwidth-question)
6. [Storage Architecture](#6-storage-architecture)
7. [ETL Computation Analysis](#7-etl-computation-analysis)
8. [Query-Time Flexibility](#8-query-time-flexibility)
9. [Consistency Benefits](#9-consistency-benefits)
10. [UI/UX Implications](#10-uiux-implications)
11. [Edge Effects, Sparse Data & 1990 Coverage](#11-edge-effects-sparse-data--1990-coverage)
12. [Concrete Schema Proposal](#12-concrete-schema-proposal)
13. [Migration Path](#13-migration-path)
14. [Recommendation](#14-recommendation)

---

## 1. The Problem with Per-Period Bandwidth

### Current Architecture

The ETL precomputes LOESS growth for each combination of `(resolution, yearsBack, metric, strataFilter)` — **90 combinations** total (3 × 5 × 2 × 3). For each combination, the LOESS bandwidth is tied to the lookback period:

```
bandwidth = ceil(yearsBack / 2)
```

| yearsBack | bandwidth | Kernel window |
|-----------|-----------|---------------|
| 5         | 3         | ±3 years      |
| 10        | 5         | ±5 years      |
| 15        | 8         | ±8 years      |
| 20        | 10        | ±10 years     |
| 25        | 13        | ±13 years     |

The LOESS fit is evaluated at exactly **two points** per cell: `startYear` and `endYear`. Growth is the CAGR between those two fitted values.

### The Short-Period Volatility Problem

For `yearsBack = 5` with `bandwidth = 3`:

- The kernel window at each evaluation point spans only ±3 years.
- For a start year of 2021, only data from [2018, 2024] receives non-zero weight.
- For sparse cells (H3 resolution 9), this might be 2–3 yearly medians — barely above the minimum-data gate of 3 weighted points.
- A single unusual median (one large development settling, one foreclosure year) can swing the fitted value by 20–30%.
- Result: 5-year LOESS growth is nearly as noisy as raw endpoint CAGR for sparse cells.

Meanwhile, `yearsBack = 25` with `bandwidth = 13` uses ±13 years of data — 20+ yearly medians contributing to each fit point. This produces a smooth, stable curve that rides through compositional noise.

**The core insight:** Short periods are volatile not because LOESS is wrong, but because the bandwidth is artificially narrow. The smoothing window is chained to the display period, which conflates two independent concerns:

1. **How much history to show** (a display/UI concern)
2. **How much data to use for smoothing** (a statistical concern)

There's no mathematical reason these should be the same.

---

## 2. The Full-Curve Proposal

### Concept

1. **Compute once:** For each `(resolution, metric, strataFilter)` combination (18 total, not 90), compute the LOESS-smoothed price at every year from the earliest available data through the present.

2. **Store the full curve:** Persist fitted prices for every year as a per-cell array or row-per-year table.

3. **Sample at query time:** To get growth for any period `[startYear, endYear]`:
   ```
   CAGR = (fittedPrice[endYear] / fittedPrice[startYear]) ^ (1 / (endYear - startYear)) - 1
   ```

4. **Use a single, appropriate bandwidth:** Choose a bandwidth that reflects the data density and desired smoothness — independent of the display period.

### What Changes

| Aspect | Current | Proposed |
|--------|---------|----------|
| ETL combinations | 90 (res × yearsBack × metric × strata) | 18 (res × metric × strata) |
| Temporal granularity | Yearly | **Quarterly** |
| LOESS evaluation points per cell | 2 (start, end) | ~144 (every quarter 1990–2026) |
| Bandwidth | Varies by `yearsBack` (3–13) | **Fixed: 3 years** |
| Queryable periods | Fixed: 5, 10, 15, 20, 25 years | Any arbitrary period, including **1–2 years** |
| Shortest meaningful period | 5 years | **12 months** |
| Client-side LOESS | Required (for dialog chart curve) | Eliminated (read stored curve) |
| `yearsBack` in PK | Yes | No — derived at query time |
| Data range | Current period only | **Full history from ~1990** |

---

## 3. Mathematical Validity

### Is Sampling a Precomputed Curve Equivalent?

**Yes.** LOESS at any evaluation point `x0` is a pure function of three inputs:

1. The data points `{(xi, yi)}`
2. The bandwidth `h`
3. The target point `x0`

These inputs are independent. The LOESS fit at year 2016 does not depend on whether you also compute the fit at year 2026. Each evaluation is a standalone weighted regression using whatever data falls within the bandwidth window.

Therefore, computing `loessAt(data, 2016, h)` and `loessAt(data, 2026, h)` and taking their CAGR is mathematically identical to computing the full curve first and then reading off the values at 2016 and 2026 — **as long as the same data, bandwidth, and kernel are used.**

The proposal does change the bandwidth from `ceil(yearsBack / 2)` to a fixed value. This means the fitted values at 2016 and 2026 will be different from the current system. But the curve is still a valid LOESS fit — just with a different smoothing parameter.

### What About the Log-Space Regression?

Both the current and proposed approaches work in log-space:

```
y = ln(median_price)
fitted(year) = exp(a + b * year)    // local to each evaluation point
```

This is fine. The log-space LOESS naturally produces a curve in price space via `exp()`. The sampling approach reads `exp(fitted)` at each year, which is the same as evaluating the LOESS at that year.

### Degree-1 (Local Linear) vs Degree-0 (Local Constant)

Our implementation uses degree-1 LOESS (local linear regression: `a + b * year`). This is important because:

- Degree-0 (Nadaraya-Watson) estimates bias high at peaks and low at troughs.
- Degree-1 corrects for this bias by fitting a local slope, which provides better estimates at the edges of data coverage and at inflection points.
- The full-curve approach preserves this — each evaluation point still gets its own local linear fit.

---

## 4. Quarterly vs Yearly Granularity

### The Case for Quarterly

The question of temporal resolution interacts directly with bandwidth choice. With yearly data points, a narrow bandwidth (3 years) only has ~6 data points in the kernel window — borderline unstable for sparse cells. But quarterly data fundamentally changes this equation:

| Granularity | Bandwidth 3 years | Data points in kernel | Stability |
|-------------|-------------------|----------------------|-----------|
| Yearly      | ±3 years          | ~6 yearly medians    | Marginal for sparse cells |
| **Quarterly** | **±3 years**    | **~24 quarterly medians** | **Robust** |

Quarterly granularity means a narrow bandwidth can be used without sacrificing regression stability, because there are 4x as many data points per unit of time.

### LOESS Handles Sparse Quarters Naturally

A concern with quarterly data: do we have enough sales per quarter per H3 cell? The answer is that LOESS doesn't require data at every quarter. It works with non-uniform x-spacing:

- If a cell has sales in Q1 and Q3 but not Q2, the LOESS interpolates through the gap.
- Empty quarters simply have no data point — they don't produce a zero or a NaN.
- The fitted curve is evaluated at every quarter regardless of whether there's raw data there.

At resolution 7 (suburb-level), a typical metro cell might have 50+ sales per year → ~12 per quarter → meaningful quarterly medians. At resolution 9 (fine), a cell might have 5 sales per year → 1–2 per quarter → noisy quarterly medians, but with bandwidth 3 years the kernel pulls from ~24 quarters of data, so the regression is still well-conditioned.

### What About Yearly for the Heatmap, Quarterly for the Chart?

We could store yearly for the precomputed growth table and quarterly for the detail dialog chart. But this reintroduces the dual-granularity problem (different data → potential for different fitted values at the same year). Better to commit to one granularity everywhere. Quarterly is strictly more flexible — yearly values can be derived from quarterly by evaluating at Q4 or averaging.

### Storage Impact

| Granularity | Values per cell (1990–2026) | Array column size |
|-------------|----------------------------|-------------------|
| Yearly      | ~36 values                 | 36 × 8 bytes = 288 bytes |
| Quarterly   | ~144 values                | 144 × 8 bytes = 1,152 bytes |

The 4x increase is modest in absolute terms. For ~10K cells × 18 combos = 180K rows, the total storage difference is ~150 MB vs ~37 MB. Both are negligible for DuckDB.

### Recommendation

**Use quarterly granularity.** The 4x data density is what unlocks narrow bandwidths and short-period heatmaps. The storage cost is negligible, and the implementation complexity is the same (just change the x-axis from years to year-fractions).

The x-axis values for LOESS become year-fractions: `2020.0, 2020.25, 2020.5, 2020.75, 2021.0, ...`. The bandwidth is still measured in years (e.g., 3 years). The `loessAt()` function and SQL kernel formula are unchanged — only the input data density changes.

---

## 5. The Bandwidth Question

This is the single most important design decision in the proposal. The bandwidth controls the smoothness of the curve and, consequently, the character of the growth values derived from it.

### What Does Bandwidth Mean?

A bandwidth of `h` years means:
- Data points within `h` years of the evaluation point receive non-zero weight.
- The closest points get weight ≈ 1.0 (tricube at `u = 0`).
- Points at distance `h` get weight = 0 (tricube at `u = 1`).
- The transition is smooth (cubic), not a hard cutoff.
- With the tricube kernel, most of the effective weight is concentrated within approximately `h/2` years — points near the edge contribute very little.

### Sydney Property Market Cycles

Looking at actual Sydney price movements over the last 25 years:

| Period | Event | Duration |
|--------|-------|----------|
| 2001–2004 | Post-dotcom boom | ~3 years |
| 2004–2006 | Flat/correction | ~2 years |
| 2008–2009 | GFC dip | ~1.5 years |
| 2009–2012 | Recovery | ~3 years |
| 2013–2017 | Major boom | ~4 years |
| 2017–2019 | APRA-driven correction | ~2 years |
| 2020–2022 | COVID boom | ~2 years |
| 2022–2023 | Rate hike correction | ~1.5 years |
| 2024–present | Recovery | ongoing |

**Cycles are approximately 2–4 years** from peak-to-trough or trough-to-peak. The full peak-to-peak cycle is roughly 5–7 years.

### Bandwidth Selection Principle

In LOESS, the bandwidth determines which features are preserved vs smoothed away:
- Features with period **shorter than the bandwidth** are smoothed out.
- Features with period **longer than the bandwidth** are preserved.

To preserve 3-year market cycles (boom/bust movements), the bandwidth must be **at most ~3 years**. A bandwidth of 7 would average through two full cycles, producing a near-linear trend that misses all the interesting market dynamics.

### Revised Bandwidth Recommendation

**Bandwidth = 3 years** with quarterly data.

This is a fundamental revision from the initial bandwidth-7 recommendation. The key insight: quarterly granularity provides enough data density to use a narrow bandwidth responsibly.

| Factor | Bandwidth 3 | Bandwidth 5 | Bandwidth 7 |
|--------|-------------|-------------|-------------|
| Data points in kernel (quarterly) | ~24 | ~40 | ~56 |
| Preserves 3-year cycles | Yes | Partially | No |
| 1-year growth meaningful | Yes | Marginally | No |
| 2-year growth meaningful | Yes | Yes | Marginally |
| Compositional noise | Smoothed (quarterly → yearly noise is averaged) | Well smoothed | Over-smoothed |
| Edge stability | Good with quarterly data | Better | Best |

**Why bandwidth 3 works with quarterly data but was problematic with yearly:**

With yearly data:
- Bandwidth 3 → 6 data points in kernel → unstable for sparse cells (the original problem).

With quarterly data:
- Bandwidth 3 → ~24 data points in kernel → well above the minimum for stable weighted OLS.
- Even sparse cells with 1–2 sales per quarter have 6–8 data points within ±3 years.

### What Bandwidth 3 Gives You

- **1-year heatmaps:** The curve changes meaningfully over 12 months because the local regression is fitted to ±3 years of data. A 1-year growth reading reflects "which direction is the local market heading?"
- **2-year heatmaps:** Captures genuine boom/bust phases. A cell that boomed in 2020–2022 and corrected in 2022–2023 will show this clearly.
- **5+ year heatmaps:** The CAGR between two well-separated curve points averages through cycles, giving a stable long-term growth signal.
- **The full dialog chart:** Shows the actual market trajectory — booms, corrections, recoveries — not a smoothed-to-boredom trend line.

### Bandwidth Sensitivity (Revised)

| Bandwidth | With quarterly data | Character |
|-----------|-------------------|-----------|
| 1.5–2     | ~12–16 points | Very responsive, follows individual year movements. Good for "what's happening right now" but noisy for growth calculations. |
| **2.5–3** | **~20–24 points** | **Tracks 3-year market cycles. Smooths quarterly noise. Sweet spot for short-period analysis.** |
| 4–5       | ~32–40 points | Smooths through short cycles. Good for medium-term growth. Misses recent turning points. |
| 7+        | ~56+ points | Near-linear. Good only for very long-term trend extraction. Inappropriate for short-period heatmaps. |

### Should We Support Multiple Bandwidths?

**Recommendation: Start with one bandwidth (3).** Reasons:
- Bandwidth 3 works well across all use cases (1-year through 25-year periods).
- Short periods sample curve points that are close together → captures recent dynamics.
- Long periods sample curve points that are far apart → the CAGR naturally averages through cycle noise.
- If we later want a "smoothness" toggle, adding a second bandwidth (e.g., 5 for "smoother") is additive — no schema migration, just more rows.

---

## 6. Storage Architecture

### Option A: Row-Per-Quarter Table

```sql
CREATE TABLE agg_h3_loess_curve (
  h3_cell        BIGINT NOT NULL,
  resolution     TINYINT NOT NULL,
  metric         VARCHAR NOT NULL,
  strata_filter  VARCHAR NOT NULL,
  quarter        DOUBLE NOT NULL,        -- Year-fraction: 2020.0, 2020.25, 2020.5, 2020.75
  fitted_price   BIGINT NOT NULL,        -- exp(loess_value), rounded
  PRIMARY KEY (h3_cell, resolution, metric, strata_filter, quarter)
);
```

**Characteristics:**
- ~144 rows per cell per `(resolution, metric, strata)` combination (1990–2026).
- Standard relational model — easy to query, join, filter.
- Growth query requires a self-join to get start and end values.

**Growth query example (last 2 years):**
```sql
SELECT
  s.h3_cell,
  POWER(e.fitted_price::DOUBLE / s.fitted_price::DOUBLE, 1.0 / 2) - 1 AS loess_growth,
  s.fitted_price AS loess_start,
  e.fitted_price AS loess_end
FROM agg_h3_loess_curve s
JOIN agg_h3_loess_curve e
  ON s.h3_cell = e.h3_cell
  AND s.resolution = e.resolution
  AND s.metric = e.metric
  AND s.strata_filter = e.strata_filter
WHERE s.resolution = ?
  AND s.metric = ?
  AND s.strata_filter = ?
  AND s.quarter = 2024.0    -- start: Q1 2024
  AND e.quarter = 2026.0    -- end: Q1 2026
```

### Option B: Array Column (Recommended)

```sql
CREATE TABLE agg_h3_loess_curve (
  h3_cell        BIGINT NOT NULL,
  resolution     TINYINT NOT NULL,
  metric         VARCHAR NOT NULL,
  strata_filter  VARCHAR NOT NULL,
  min_quarter    DOUBLE NOT NULL,        -- First quarter with valid fit (e.g., 1992.0)
  max_quarter    DOUBLE NOT NULL,        -- Last quarter with valid fit (e.g., 2026.0)
  bandwidth      DOUBLE NOT NULL,        -- Bandwidth in years (e.g., 3.0)
  fitted_prices  BIGINT[] NOT NULL,      -- One element per quarter, min_quarter to max_quarter
  centroid_lat   DOUBLE NOT NULL,
  centroid_lng   DOUBLE NOT NULL,
  locality       VARCHAR,
  total_sales    INTEGER NOT NULL,
  quarter_count  SMALLINT NOT NULL,      -- Number of quarters with raw data
  PRIMARY KEY (h3_cell, resolution, metric, strata_filter)
);
```

**Characteristics:**
- 1 row per cell per combination — maximally compact.
- Array indexing: `fitted_prices[(quarter - min_quarter) * 4 + 1]`.
- No self-join needed for growth queries.
- DuckDB has excellent array support including `list_extract()`.

**Growth query example (last 12 months, Q1 2025 to Q1 2026):**
```sql
SELECT
  h3_cell,
  centroid_lat, centroid_lng, locality,
  list_extract(fitted_prices, CAST((:end_q - min_quarter) * 4 + 1 AS INT)) AS loess_end,
  list_extract(fitted_prices, CAST((:start_q - min_quarter) * 4 + 1 AS INT)) AS loess_start,
  POWER(
    list_extract(fitted_prices, CAST((:end_q - min_quarter) * 4 + 1 AS INT))::DOUBLE
    / list_extract(fitted_prices, CAST((:start_q - min_quarter) * 4 + 1 AS INT))::DOUBLE,
    1.0 / (:end_q - :start_q)
  ) - 1 AS loess_growth
FROM agg_h3_loess_curve
WHERE resolution = :resolution
  AND metric = :metric
  AND strata_filter = :strata_filter
  AND min_quarter <= :start_q
  AND max_quarter >= :end_q
```

### Recommendation: Option B (Array Column)

- **One row per cell per combo** makes bulk heatmap queries fast (no self-join).
- **Array indexing** is O(1) in DuckDB and evaluates per-row during the scan.
- **Simpler schema** — the centroid, locality, and other metadata live on the same row.
- **Compact storage** — 144 BIGINTs in an array (~1.1 KB) vs 144 rows with repeated key columns.
- **Natural fit for the UI** — when the dialog asks "give me the full curve for this cell," it's a single row fetch returning the entire price trajectory.
- **Sub-year precision** — quarterly array enables 12-month, 6-month, and even single-quarter growth readings.

---

## 7. ETL Computation Analysis

### Current Approach

```
90 combinations × ~200ms each = ~18s total
```

Each combination runs:
1. **Yearly medians CTE** — Full fact table scan with H3 cell computation, GROUP BY. This is the expensive part (~150ms of the ~200ms).
2. **LOESS evaluation** — Cross join with 2 eval points, kernel weights, OLS. Relatively cheap (~50ms).

The yearly medians scan is nearly identical across all `yearsBack` values for the same `(resolution, metric, strata)` — the only difference was formerly a year-range filter (now removed). **The same 6.6M-row fact table scan is repeated 5 times** for each (resolution, metric, strata) combination, once per `yearsBack`.

### Proposed Approach (Quarterly)

```
18 combinations × ~350ms each = ~6.3s total
```

For each `(resolution, metric, strata)` combination:
1. **Quarterly medians CTE** — Same fact table scan, run **once**. GROUP BY cell and year-quarter instead of cell and year. Slightly more expensive due to finer grouping. ~200ms.
2. **LOESS evaluation** — Cross join with ~144 eval points (quarterly from 1990–2026) instead of 2. With bandwidth 3 years, each eval point only processes ~24 data points in the kernel. ~150ms.

**Estimated speedup: ~3x** (18s → 6s). Still a major improvement despite the 4x increase in evaluation points, because we eliminate 72 redundant fact table scans.

### Additional Savings

- **No UPDATE pass for LOESS:** Currently, LOESS runs as a separate UPDATE after the INSERT. In the proposed architecture, fitted values are written directly — one pass, no UPDATE.
- **No `years_back` loop:** The innermost two loops (`yearsBack`, then the endpoint/trend-fit/LOESS sequence) are eliminated entirely.
- **Quarterly medians are more cacheable:** The quarterly medians CTE is identical across all 18 combinations for a given resolution. DuckDB's query optimizer may reuse the scan across consecutive queries.

---

## 8. Query-Time Flexibility

### Currently Possible

Growth queries are restricted to the 5 precomputed `yearsBack` values: 5, 10, 15, 20, 25. The UI presents these as a dropdown. Any other period requires a code change to the ETL + schema.

### Newly Possible with Full-Curve Storage

- **Arbitrary lookback periods:** "How much has this area grown in the last 7 years?" Just sample the curve at `[currentYear - 7, currentYear]`.
- **Arbitrary date ranges:** "What was the growth between 2003 and 2015?" Sample at `[2003, 2015]`.
- **Year-over-year analysis:** Read adjacent years from the curve to get annual growth rates across the full time range.
- **Peak-to-trough analysis:** Find the maximum and minimum of the stored curve to identify boom/bust cycles.
- **Relative performance:** Compare a cell's curve shape to the metro average curve — not just a single growth number, but the full trajectory.

### Impact on the `agg_h3_growth` Table

The `agg_h3_growth` table would no longer need:
- `loess_growth`, `loess_start`, `loess_end` columns (derived at query time from the curve table).
- The `years_back` dimension in the PK could be simplified — the endpoint CAGR and trend-fit columns still need it, but LOESS is period-independent.

Two options for handling the existing table:
1. **Keep `agg_h3_growth` for endpoint CAGR and trend-fit**, and query the new curve table for LOESS.
2. **Migrate everything** to the curve-based architecture. Endpoint CAGR and trend-fit could also be stored as full curves (or just simplified endpoint calculations derived from the curve).

Option 1 is the safer migration path — no existing functionality changes.

---

## 9. Consistency Benefits

This is arguably the strongest argument for the full-curve approach.

### Current Dual-Implementation Problem

The LOESS algorithm is implemented in two places:

1. **ETL SQL** (`scripts/src/heatmap/h3-precompute.ts`) — Computes `loess_start` and `loess_end` at two evaluation points. Results stored in `agg_h3_growth`.
2. **Client TypeScript** (`webapp/src/lib/heatmap-stats.ts:loessAt()`) — Re-evaluates the LOESS curve at every year for the detail dialog chart.

These must produce identical results. Two bugs have already been found from divergence (see `docs/research/heatmap-value-consistency.md`). We've implemented extensive documentation and cross-referencing (see `docs/research/heatmap-consistency-enforcement.md`) to mitigate this, but the fundamental problem remains: **two independent implementations of the same algorithm is an ongoing maintenance risk.**

### How the Full-Curve Approach Eliminates This

If the ETL stores the full fitted curve (one price per year per cell), the client-side `loessAt()` function becomes **unnecessary**:

| UI Element | Current Data Source | Proposed Data Source |
|------------|--------------------|-----------------------|
| Heatmap tile color | ETL `loess_growth` | Query-time CAGR from curve table |
| Tooltip start/end prices | ETL `loess_start`, `loess_end` | Array lookup from curve table |
| Dialog chart smooth curve | Client-side `loessAt()` re-evaluation | Direct read of stored curve array |
| Dialog summary values | Client-side `loessAt()` at start/end | Array lookup from curve table |

**Every display location reads the same precomputed curve.** There is no second implementation to diverge. The `loessAt()` function in `heatmap-stats.ts` can be deleted entirely (or retained only for edge cases like computing curves for cells not in the precomputed table).

### Remaining Parity Concern

The only remaining parity requirement is between:
- The ETL LOESS SQL (which computes the curve)
- The stored curve values (which the UI reads)

This is trivially satisfied — the ETL writes the values, and the UI reads them. There's no re-computation anywhere. The "Memento problem" is eliminated at the architectural level, not just mitigated with documentation.

---

## 10. UI/UX Implications

### Current UI Flow

1. User selects a fixed lookback period (5/10/15/20/25 years).
2. Heatmap shows growth for that period.
3. Click a hex → dialog fetches yearly medians, recomputes the LOESS curve client-side, shows it as a chart line.
4. The chart only shows the selected period's range.

### Proposed UI Flow

1. User selects any lookback period — including **1 year, 2 years**, or arbitrary ranges.
2. Heatmap shows growth for that period (sampled from stored quarterly curve).
3. Click a hex → dialog reads the stored curve directly. **No client-side LOESS computation needed.**
4. The chart shows the **full price history** with quarterly LOESS smoothing from ~1990 to present, with the selected period highlighted.

### New UI Capabilities

**"Live market read" heatmap (1–2 year periods):**
- Select "Last 12 months" or "Last 24 months" to see where the market is moving right now.
- With quarterly LOESS and bandwidth 3, the curve tracks genuine recent shifts — rate hike corrections, recovery phases, boom areas.
- This is the most impactful new capability: turning a long-term analysis tool into a current-market intelligence tool.

**Full-range chart in detail dialog:**
- Show the complete LOESS-smoothed price trajectory from ~1990 (where data exists).
- Highlight the selected period with a shaded region.
- Users can visually see how the current growth phase compares to historical cycles.
- Raw quarterly medians (scatter points) overlaid on the smooth curve show the noise the LOESS is cutting through.
- Quarterly resolution reveals intra-year dynamics (spring boom, winter correction) for data-rich cells.

**Period slider:**
- Replace the fixed 5/10/15/20/25 dropdown with a continuous slider (or expanded options: 1, 2, 3, 5, 7, 10, 15, 20, 25, 30).
- Or two independent year/quarter pickers for start and end.
- The heatmap updates dynamically as the user drags.

**Year-over-year growth:**
- Compute annual growth rates from the quarterly curve: `curve[Q] / curve[Q - 4 quarters] - 1`.
- Display as a secondary chart axis in the dialog.
- Reveals acceleration/deceleration patterns — "growth was 8% last year but slowing to 3% this year."

**Peak/trough markers:**
- Algorithmically find local maxima and minima of the stored curve.
- Display as markers on the chart ("Q2 2017 peak: $1.2M", "Q4 2019 trough: $1.05M").
- Enable "peak-to-current" and "trough-to-current" growth calculations.

---

## 11. Edge Effects, Sparse Data & 1990 Coverage

### Can We Show Data From 1990?

**Yes.** The curve can extend back to wherever data exists. The ETL already ingests archived format data from 1990–2001 (see CLAUDE.md: "1990–2001 (archived): Simpler format, only Records A, B, Z"). The quarterly medians CTE will naturally produce medians for any quarter with sales data.

What determines whether a cell has 1990s data:

| Factor | Impact |
|--------|--------|
| **Data availability** | Archived files exist from 1990 onwards. Coverage improves over time. |
| **Geocoding coverage** | G-NAF matching quality for older addresses may be lower — some sales won't map to an H3 cell. |
| **Cell resolution** | Resolution 7 (large cells) aggregates more sales → more likely to have early data. Resolution 9 (small cells) may have no data before 2005 in many areas. |
| **Location** | Established metro suburbs have continuous data from 1990. New development areas may start in the 2000s or 2010s. |

The `min_quarter` field in the schema captures when each cell's curve begins. A cell with data from 1993 will have `min_quarter = 1993.0` (or wherever the LOESS fit first has enough data). A cell with data only from 2010 will start there.

**In the UI:** The dialog chart shows each cell's full available history — some cells will show 35 years of data, others will show 15. This is a feature, not a bug — it honestly represents data availability.

### Short-Period Heatmaps (1–2 Years)

**With quarterly data and bandwidth 3, yes — 12-month and 24-month heatmaps are viable.**

How it works: sample the LOESS curve at `[2025.0, 2026.0]` for 12-month growth, or `[2024.0, 2026.0]` for 24-month growth. With bandwidth 3, the LOESS fit at 2026.0 reflects the local trend over the preceding ±3 years (so roughly 2023–2026 data), which is responsive enough to show genuine recent market shifts.

What this means in practice:

- **12-month heatmap:** "Where are prices moving right now?" The LOESS curve value changes quarter-to-quarter based on the local trend. A cell where prices rose sharply in 2025 will show positive 12-month growth, while a cell where prices flatlined will show near-zero.
- **24-month heatmap:** Captures a full boom/bust phase. The 2022–2024 rate hike correction, for instance, would show clearly as negative growth on a 24-month heatmap centered on that period.
- **6-month heatmap:** Possible but pushing the limits — the change between two quarterly curve points 2 quarters apart will be small. Useful for "hot right now" analysis but growth numbers will be noisy because of annualization (`(ratio)^(1/0.5) - 1` amplifies small differences).

**Quality gate for short periods:** If the LOESS-fitted values at both endpoints are close to each other (e.g., within 1% for a 12-month period), the annualized CAGR is meaningful. But if a cell has sparse data, the fitted values may not have changed much between quarters, and the growth reading is essentially noise. Consider a minimum data density gate for short-period heatmaps (e.g., "cell must have at least N sales within the bandwidth window of both endpoints").

### LOESS Edge Bias

LOESS has known boundary effects:
- At the first and last quarters of available data, the kernel only has data on one side.
- This causes the fitted value to be pulled toward the one-sided data, potentially creating artificial trends at the boundaries.
- Degree-1 LOESS (our implementation) mitigates this better than degree-0, but doesn't eliminate it.

**Mitigation with bandwidth 3:** The edge zone is ~1.5 years (half the bandwidth). So the reliable curve starts ~6 quarters after the first observation and ends ~6 quarters before the last raw data point.

**Practical impact:** For a cell with data from Q1 2001 through Q1 2026, reliable LOESS values span approximately Q3 2002 through Q3 2024. The `min_quarter` and `max_quarter` stored in the table should already exclude the unreliable edge zone.

For short-period heatmaps (e.g., "last 12 months ending Q1 2026"), the end point falls within the edge zone. This is acceptable because:
1. The most recent quarters have the most data (more sales are recorded recently).
2. The one-sided bias actually helps — it weights heavily toward the known recent data rather than extrapolating into the future.
3. The current system has the same issue (the LOESS fit at `currentYear` is always at the data boundary).

### The Partial-Quarter Problem

The current quarter (Q1 2026 if we're in March 2026) may have only a few months of data. The quarterly median for the current quarter is based on a partial sample.

**With bandwidth 3:** The LOESS fit at 2026.0 is influenced by all data from Q1 2023 through Q1 2026 (±3 years). The partial Q1 2026 data is just one of ~24 data points, and the tricube kernel gives it slightly less weight than data from nearby completed quarters. This is naturally robust — far better than any system that relies heavily on the most recent data point.

---

## 12. Concrete Schema Proposal

### New Table: `agg_h3_loess_curve`

```sql
CREATE TABLE agg_h3_loess_curve (
  -- Composite key: one row per cell per (resolution, metric, strata)
  h3_cell        BIGINT NOT NULL,
  resolution     TINYINT NOT NULL,       -- 7, 8, or 9
  metric         VARCHAR NOT NULL,       -- 'median-price' or 'price-per-sqm'
  strata_filter  VARCHAR NOT NULL,       -- 'all', 'freehold', or 'strata'

  -- The stored LOESS curve (quarterly)
  min_quarter    DOUBLE NOT NULL,        -- First quarter with valid fit (e.g., 1993.0)
  max_quarter    DOUBLE NOT NULL,        -- Last quarter with valid fit (e.g., 2025.75)
  bandwidth      DOUBLE NOT NULL,        -- Bandwidth in years (e.g., 3.0)
  fitted_prices  BIGINT[] NOT NULL,      -- Fitted prices, one per quarter from min_quarter to max_quarter

  -- Spatial metadata (same as current agg_h3_growth)
  centroid_lat   DOUBLE NOT NULL,
  centroid_lng   DOUBLE NOT NULL,
  locality       VARCHAR,

  -- Data coverage stats
  total_sales    INTEGER NOT NULL,       -- Total sales across all quarters for this cell
  quarter_count  SMALLINT NOT NULL,      -- Number of distinct quarters with raw sales data
  earliest_sale  DOUBLE NOT NULL,        -- Earliest quarter with raw data (before LOESS)
  latest_sale    DOUBLE NOT NULL,        -- Latest quarter with raw data

  PRIMARY KEY (h3_cell, resolution, metric, strata_filter)
);

CREATE INDEX idx_loess_curve_lookup
  ON agg_h3_loess_curve(resolution, metric, strata_filter);
```

**Array indexing:** To get the fitted price at quarter `q`:
```sql
list_extract(fitted_prices, CAST((q - min_quarter) * 4 + 1 AS INT))
```
For example, if `min_quarter = 1993.0` and we want Q3 2020 (`q = 2020.5`):
- Index = `(2020.5 - 1993.0) * 4 + 1 = 27.5 * 4 + 1 = 111`

### Changes to `agg_h3_growth`

Keep the existing table for endpoint CAGR and trend-fit (no migration risk). Remove the LOESS columns:

```sql
-- Remove these columns from agg_h3_growth:
-- loess_growth DOUBLE,
-- loess_start BIGINT,
-- loess_end BIGINT,
```

The LOESS growth calculation moves to query time:

```sql
-- Server query for LOESS heatmap data (e.g., last 2 years: 2024.0 to 2026.0):
SELECT
  c.h3_cell,
  c.centroid_lat,
  c.centroid_lng,
  c.locality,
  c.total_sales,
  list_extract(c.fitted_prices, CAST((:end_q - c.min_quarter) * 4 + 1 AS INT)) AS loess_end,
  list_extract(c.fitted_prices, CAST((:start_q - c.min_quarter) * 4 + 1 AS INT)) AS loess_start,
  POWER(
    list_extract(c.fitted_prices, CAST((:end_q - c.min_quarter) * 4 + 1 AS INT))::DOUBLE
    / list_extract(c.fitted_prices, CAST((:start_q - c.min_quarter) * 4 + 1 AS INT))::DOUBLE,
    1.0 / (:end_q - :start_q)
  ) - 1 AS loess_growth
FROM agg_h3_loess_curve c
WHERE c.resolution = :resolution
  AND c.metric = :metric
  AND c.strata_filter = :strata_filter
  AND c.min_quarter <= :start_q
  AND c.max_quarter >= :end_q
```

Note: This query is self-contained — no JOIN to `agg_h3_growth` needed for the LOESS method. The curve table has its own centroid, locality, and sale count fields.

### For the Dialog Chart (Full Curve Fetch)

```sql
SELECT fitted_prices, min_quarter, max_quarter, total_sales, quarter_count
FROM agg_h3_loess_curve
WHERE h3_cell = :cell
  AND resolution = :resolution
  AND metric = :metric
  AND strata_filter = :strata_filter
```

The client receives the entire quarterly curve array and renders it directly — no `loessAt()` needed. For a cell with data from 1993–2026, this is a single row returning ~132 fitted prices.

---

## 13. Migration Path

### Phase 1: Add Curve Table (Additive)

1. Create `agg_h3_loess_curve` table and populate it during ETL rebuild.
2. Keep `agg_h3_growth` unchanged — LOESS columns remain for backward compatibility.
3. Add a server function to query the curve table.
4. Wire up the dialog chart to use the stored curve instead of client-side `loessAt()`.
5. **Verify:** Existing heatmap behavior unchanged. Dialog chart shows stored curve.

### Phase 2: Switch Heatmap to Curve-Based Queries

1. Update `queryHeatmapGrowthData()` to compute LOESS growth from the curve table when `growthMethod === 'loess'`.
2. Add a `startYear`/`endYear` parameter alongside `yearsBack` (initially derived: `startYear = currentYear - yearsBack`).
3. **Verify:** Heatmap tile colors match before/after (within acceptable tolerance from bandwidth change).

### Phase 3: Expand UI Capabilities

1. Add arbitrary period selection (slider, year pickers).
2. Show full-range chart in dialog.
3. Remove `loess_growth`, `loess_start`, `loess_end` columns from `agg_h3_growth`.
4. Delete `loessAt()` from `heatmap-stats.ts`.
5. **Verify:** All display locations use stored curve values.

### Value Differences During Migration

The switch from variable bandwidth (`ceil(yearsBack/2)`) to fixed bandwidth (7) means LOESS values will change:

| Period | Current bandwidth | Proposed bandwidth | Expected impact |
|--------|------------------|--------------------|-----------------|
| 5 years | 3 | 7 | Significantly smoother. Less volatile. Some cells will show materially different growth. |
| 10 years | 5 | 7 | Moderately smoother. Most values similar. |
| 15 years | 8 | 7 | Slightly less smooth. Minor differences. |
| 20 years | 10 | 7 | More local detail preserved. Growth rates will change for cells with non-monotonic trajectories. |
| 25 years | 13 | 7 | Noticeably more local detail. Cells that went boom→bust→boom will show different growth than with the heavily-smoothed bandwidth-13 curve. |

The largest impact is on 5-year readings (which become much more stable — this is the desired outcome) and 25-year readings (which become less smoothed — which is arguably more honest, revealing real trajectory changes rather than averaging them away).

---

## 14. Recommendation

**Proceed with the full-curve architecture, using quarterly granularity and bandwidth 3.**

| Dimension | Assessment |
|-----------|------------|
| **Mathematical validity** | Sound. Sampling a precomputed LOESS curve is equivalent to computing at query time. |
| **Short-period heatmaps** | Enabled. 12-month and 24-month growth heatmaps become viable with quarterly resolution and bandwidth 3. |
| **Market cycle visibility** | Major improvement. Bandwidth 3 preserves 3-year market cycles instead of smoothing them away. |
| **1990 data** | Yes. The curve extends back to wherever data exists. Some cells will show 35 years of history. |
| **ETL performance** | ~3x faster (18 combos × ~350ms vs 90 × ~200ms). |
| **Query flexibility** | Unlocks arbitrary date ranges, year-over-year analysis, peak/trough detection. |
| **Consistency** | Eliminates the dual-implementation problem entirely. One curve, one truth. |
| **UI/UX** | Enables full-range charts from 1990, period sliders, sub-annual precision. |
| **Code complexity** | Net reduction — `loessAt()` deleted, no cross-referencing needed. |
| **Storage cost** | Modest (~144 values per cell vs 2, but far fewer total rows). |
| **Risk** | Low with phased migration. Existing table untouched in Phase 1. |

### Key Design Decisions

1. **Quarterly granularity** — provides the data density needed for narrow bandwidths and short-period analysis.
2. **Bandwidth = 3 years** — preserves 3-year market cycles, enables 1–2 year heatmaps, and remains stable with ~24 quarterly data points in the kernel window.
3. **Array column** storage (Option B) for compact, join-free queries.
4. **Phased migration** — additive first, then switchover, then cleanup.
5. **Keep `agg_h3_growth`** for endpoint CAGR and trend-fit. Only LOESS moves to the curve table.

### Open Questions for Implementation Planning

1. **Bandwidth tuning:** A/B compare bandwidth 2, 3, and 4 on real data before committing. Visual comparison of the curves against raw quarterly medians would validate the choice. Consider 2.5 as a compromise.
2. **Metro average curve:** Currently `metro_avg_growth` is stored per combo. With arbitrary periods, this should also be stored as a LOESS curve — one "metro aggregate" row per `(resolution, metric, strata)` combo computed from all cells. The UI can then show a cell's curve vs the metro average curve.
3. **`fillAdjacentHexes()`:** The spatial interpolation in `heatmap-stats.ts` uses growth values from neighbors. With curve-based queries, neighbor growth is computed at query time — this still works but the function signature changes.
4. **Performance regression risk:** The heatmap bulk query (all cells in viewport) adds array indexing per row. Benchmarking needed, but likely negligible since DuckDB handles array operations natively.
5. **Minimum data gate for short periods:** For 12-month heatmaps, should we require a minimum number of sales in the recent window to ensure the LOESS fit is meaningful? Or trust the LOESS quality gates (>= 3 weighted points) already in place?

---

## Related Documents

- `docs/research/heatmap-value-consistency.md`: Historical LOESS consistency bugs
- `docs/research/heatmap-consistency-enforcement.md`: Enforcement techniques (many become unnecessary with single-curve architecture)
- `docs/research/price-smoothing-and-index-methods.md`: LOESS theory, bandwidth selection, comparison with other smoothing methods
- `docs/notes/heatmap-loess.md`: Current implementation pitfalls and cross-references
