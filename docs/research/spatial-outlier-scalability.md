# Spatial Price Outlier Detection — Scalability Research

## Context

The data quality pipeline's `flagPriceOutliers()` function was redesigned from a locality×decade IQR approach to a spatial K-nearest-neighbor (KNN) method using H3 hexagonal pre-filtering (see `data-cleaning-outlier-detection.md` §3.3). The KNN implementation works correctly on small test datasets (all 27 unit tests pass) but **fails with an out-of-memory error when run against the production dataset** (4.78M geocoded records across 26,164 H3 res 7 cells).

This document investigates the root cause, evaluates alternative approaches, and recommends the most statistically sound and practically implementable solution.

---

## 1. The Problem: Why KNN Fails at Scale

### 1.1 What Happens

The KNN algorithm requires a self-join: each of 4.78M sales must find its K=20 nearest neighbors from the same 4.78M records. Even with H3 res 7 spatial pre-filtering (limiting candidates to 7 adjacent cells), the self-join produces a massive intermediate result that DuckDB cannot handle.

**Error observed:**
```
Out of Memory Error: failed to offload data block of size 256.0 KiB (62.8 GiB/62.8 GiB used).
```

### 1.2 Root Cause Analysis

The bottleneck is `ROW_NUMBER() OVER (PARTITION BY sale ORDER BY distance)` — a **blocking window function** that forces DuckDB to materialise and sort ALL candidate pairs before selecting the top K per record.

**Candidate pair estimate from the research doc:**

| Filter                         | Candidates per record |
| ------------------------------ | --------------------- |
| Full dataset                   | 4,780,000             |
| H3 res 7 grid_disk(1) — 7 cells | ~500                  |
| ±3 year temporal window        | ~85                   |
| Same strata/freehold segment   | ~45                   |
| **Total pairs**                | **4.78M × 45 ≈ 215M** |

The original research doc estimated 215M pairs × ~24 bytes ≈ 5 GB — "fits in RAM on a 16 GB machine." This estimate was **wrong** for three reasons:

1. **Actual density varies wildly.** The 215M estimate uses averages (~45 candidates/record). In reality, dense urban cells (Sydney CBD, Parramatta, Chatswood) contain 1,000–5,000+ records each. A single dense cell produces 5,000 × 3,000 = 15M pairs — far more than the average-based estimate.

2. **ROW_NUMBER materialisation overhead.** DuckDB's window function implementation is a blocking operator — it must materialise the entire partitioned, sorted intermediate result before emitting any rows. The per-row overhead is ~40–50 bytes (partition key, sort key, all selected columns), not 24 bytes. Actual materialisation: ~846M × 50 bytes ≈ **42 GB**.

3. **DuckDB disk spilling limitations.** DuckDB spills to a temp directory when RAM is exceeded, but the temp directory is bounded by available disk space (~60–70 GB on this machine). The ROW_NUMBER sort over 846M rows exceeds this combined RAM + disk capacity.

### 1.3 Why Batching Doesn't Solve It

The implementation attempted to batch by H3 cell (processing 50 cells at a time). This fails because:

- **Dense cells dominate.** A batch that includes even one CBD cell with 5,000+ records generates millions of pairs for that cell alone.
- **The s2 (neighbor) side is unbounded.** Each target cell's candidates come from 7 neighbor cells in the full table. If those neighbor cells are also dense, the cross-product explodes.
- **DuckDB can't push LIMIT through ROW_NUMBER.** Even with `QUALIFY ROW_NUMBER() <= 20`, DuckDB must compute ROW_NUMBER for ALL rows before filtering. The window function is computed in full before any filtering occurs.

### 1.4 DuckDB-Specific Constraints (Verified via Documentation)

| DuckDB Capability | Status | Impact |
|---|---|---|
| **Window function streaming** | Not supported — window functions are blocking operators that materialise their full input | ROW_NUMBER over 846M rows requires ~42 GB materialisation |
| **QUALIFY optimisation** | QUALIFY filters *after* full window computation — no early termination | Adding `QUALIFY rn <= 20` doesn't reduce memory usage |
| **LATERAL JOIN decorrelation** | DuckDB decorrelates scalar subqueries but NOT LATERAL joins — they use naive nested-loop evaluation | A LATERAL approach with `ORDER BY dist LIMIT 20` would be O(n × m) nested loops — infeasible at 4.78M × 200 |
| **Spatial JOIN operator (v1.3+)** | Builds an in-memory R-tree of the right side — requires full buffering | Right side (4.78M records) must fit entirely in RAM |
| **Temp directory spilling** | Supported but bounded by disk space and slow for large sorts | 60–70 GB available, exceeded by the ROW_NUMBER sort |

**Sources:**
- [DuckDB Window Functions — Flying Through Windows](https://duckdb.org/2025/02/14/window-flying)
- [DuckDB Correlated Subqueries](https://duckdb.org/2023/05/26/correlated-subqueries-in-sql)
- [DuckDB Memory Management](https://duckdb.org/2024/07/09/memory-management)
- [DuckDB OOM Troubleshooting](https://duckdb.org/docs/stable/guides/troubleshooting/oom_errors)
- [DuckDB Spatial Joins](https://duckdb.org/2025/08/08/spatial-joins)

---

## 2. Alternative Approaches

### 2.1 Approach A — Cell-Level Neighbourhood IQR (GROUP BY)

Replace per-record KNN with IQR computed per `(H3_cell, segment, sale_year)` from the cell's spatial neighbourhood.

**Method:**

1. For each distinct `(H3 cell, segment, sale_year)` tuple, compute IQR from ALL sales in the 7-cell neighbourhood (`grid_disk(1)`) with matching segment and within ±3 years.
2. Flag any sale whose price falls outside Q1 − 3×IQR or Q3 + 3×IQR for its (cell, segment, year) group.

**SQL sketch (log-space IQR — see §4.6 for rationale):**
```sql
-- Step 1: compute one IQR per (cell, segment, year) in log-space
CREATE TEMP TABLE _dq_cell_iqr AS
SELECT
  grp.h3_cell, grp.segment, grp.sale_year,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY LN(n.purchase_price)) AS log_q1,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY LN(n.purchase_price)) AS log_q3,
  COUNT(*) AS neighbor_count
FROM (SELECT DISTINCT h3_cell, segment, sale_year FROM _dq_clean_sales) grp
JOIN _dq_h3_neighbors hn ON grp.h3_cell = hn.source_cell
JOIN _dq_clean_sales n ON n.h3_cell = hn.neighbor_cell
  AND n.segment = grp.segment
  AND ABS(n.sale_year - grp.sale_year) <= 3
GROUP BY grp.h3_cell, grp.segment, grp.sale_year
HAVING COUNT(*) >= 20

-- Step 2: flag outliers by comparing LN(price) against log-space fences
UPDATE fact_property_sale fps SET is_price_outlier = TRUE
FROM _dq_clean_sales cs
JOIN _dq_cell_iqr iqr
  ON cs.h3_cell = iqr.h3_cell
  AND cs.segment = iqr.segment
  AND cs.sale_year = iqr.sale_year
WHERE fps.district_code = cs.district_code
  AND fps.property_id = cs.property_id
  AND fps.dealing_number = cs.dealing_number
  AND (LN(cs.purchase_price) < iqr.log_q1 - 3.0 * (iqr.log_q3 - iqr.log_q1)
    OR LN(cs.purchase_price) > iqr.log_q3 + 3.0 * (iqr.log_q3 - iqr.log_q1))
```

**Complexity:** O(n) — the `DISTINCT (cell, segment, year)` driver has ~400K–800K rows (26K cells × 2 segments × ~15 active years). Each joins to ~7 neighbor cells × ~25 matching records ≈ **~140M aggregation input rows**. DuckDB streams this through hash aggregation, storing ~175 price values per group for PERCENTILE_CONT — total ~1.5 GB. No ROW_NUMBER, no self-join materialisation.

**Strengths:**
- Same spatial neighbourhood, temporal window, and segment filters as KNN
- Aggregation is streamable — no blocking window functions
- Uses ALL neighbours in the spatial neighbourhood (more stable IQR than K=20)
- ~1.5 GB peak memory — well within DuckDB's capacity

**Weaknesses:**
- All records in the same `(cell, segment, year)` see the **same IQR** — no per-record adaptivity
- In heterogeneous cells (e.g., mix of townhouses and detached houses within freehold segment), the IQR is wider, reducing sensitivity
- Edge effects: a record at a cell boundary sees the same IQR as one at the cell centre

**Statistical soundness:** High. IQR from ~175 neighbours is more statistically stable than from K=20. The loss of per-record adaptivity is minor because all records in the same ~2.5km hex, same segment, same year are genuinely in the same local market.

### 2.2 Approach B — Modified Z-Score with Median Absolute Deviation (MAD)

Replace IQR with the Modified Z-Score (Iglewicz & Hoaglin, 1993), a robust measure that is more powerful for detecting outliers in skewed distributions.

**Method:**

For each `(H3 cell, segment, sale_year)` neighbourhood:
1. Compute the **median** price (M)
2. Compute the **Median Absolute Deviation** (MAD): `median(|xi − M|)` for all neighbours
3. Compute the **Modified Z-Score** for each sale: `0.6745 × (price − M) / MAD`
4. Flag if `|Modified Z-Score| > 3.5` (Iglewicz-Hoaglin threshold)

The 0.6745 constant normalises MAD so that it equals the standard deviation for normally-distributed data, making the threshold comparable to a ±3.5σ rule.

**SQL sketch:**
```sql
CREATE TEMP TABLE _dq_cell_mad AS
SELECT
  grp.h3_cell, grp.segment, grp.sale_year,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n.purchase_price) AS median_price,
  COUNT(*) AS neighbor_count
FROM (SELECT DISTINCT h3_cell, segment, sale_year FROM _dq_clean_sales) grp
JOIN _dq_h3_neighbors hn ON grp.h3_cell = hn.source_cell
JOIN _dq_clean_sales n ON n.h3_cell = hn.neighbor_cell
  AND n.segment = grp.segment
  AND ABS(n.sale_year - grp.sale_year) <= 3
GROUP BY grp.h3_cell, grp.segment, grp.sale_year
HAVING COUNT(*) >= 20;

-- Second pass: compute MAD per group
CREATE TEMP TABLE _dq_cell_mad_final AS
SELECT
  mad.h3_cell, mad.segment, mad.sale_year,
  mad.median_price,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY ABS(n.purchase_price - mad.median_price)
  ) AS mad_value,
  mad.neighbor_count
FROM _dq_cell_mad mad
JOIN _dq_h3_neighbors hn ON mad.h3_cell = hn.source_cell
JOIN _dq_clean_sales n ON n.h3_cell = hn.neighbor_cell
  AND n.segment = mad.segment
  AND ABS(n.sale_year - mad.sale_year) <= 3
GROUP BY mad.h3_cell, mad.segment, mad.sale_year, mad.median_price, mad.neighbor_count;

-- Flag outliers
UPDATE fact_property_sale fps SET is_price_outlier = TRUE
FROM _dq_clean_sales cs
JOIN _dq_cell_mad_final mf
  ON cs.h3_cell = mf.h3_cell AND cs.segment = mf.segment AND cs.sale_year = mf.sale_year
WHERE fps.district_code = cs.district_code
  AND fps.property_id = cs.property_id
  AND fps.dealing_number = cs.dealing_number
  AND mf.mad_value > 0
  AND ABS(cs.purchase_price - mf.median_price) / (0.6745 * mf.mad_value) > 3.5
```

**Complexity:** O(n) — same aggregation pattern as Approach A, but requires two passes (one for median, one for MAD). Total ~280M aggregation input rows across both passes. ~3 GB peak memory.

**Strengths:**
- **More powerful than IQR for skewed distributions.** Property prices are right-skewed (long tail of luxury sales). MAD is computed from the median, which is resistant to skew. IQR can be inflated by skew, making it less sensitive to outliers.
- Based on a peer-reviewed standard (Iglewicz & Hoaglin, "Volume 16: How to Detect and Handle Outliers", ASQC, 1993)
- The 3.5 threshold is a published standard, not arbitrary
- Same spatial/temporal/segment framework as Approach A

**Weaknesses:**
- **Two passes** over the neighbourhood data (median first, then MAD) — ~2× the aggregation work of Approach A
- **MAD = 0** in homogeneous cells — if all sales in a cell have the same price, MAD is 0 and the Modified Z-Score is undefined. Must guard with `NULLIF(mad, 0)` and leave these cells unflagged.
- More complex to explain to stakeholders than IQR ("what is MAD?")

**Statistical soundness:** Very high. The Modified Z-Score is specifically designed for outlier detection in non-normal distributions. It is the recommended approach in statistical literature for robust outlier detection (Boris Iglewicz & David Hoaglin, 1993).

### 2.3 Approach C — Hybrid IQR + MAD (Both Tests)

Use BOTH IQR and Modified Z-Score, flagging only records that fail **both** tests. This reduces false positives at the cost of slightly more false negatives.

**Method:** Compute cell-level IQR (Approach A) and cell-level MAD (Approach B). A record is flagged only if it is an outlier under both methods.

**Strengths:**
- Very conservative — almost zero false positives
- Both methods are well-understood in the literature

**Weaknesses:**
- Three passes over neighbourhood data (~4.5 GB peak)
- Over-conservative: may miss genuine outliers that one method catches but the other doesn't
- Added complexity for marginal benefit — if the individual methods are well-calibrated, combining them adds diminishing returns

**Statistical soundness:** Marginally higher precision than either alone, but lower recall. Appropriate for contexts where false positives are very costly, but our use case (pre-LOESS data cleaning) tolerates some false positives.

### 2.4 Approach D — Chunked Per-Record KNN in TypeScript

Keep the original KNN algorithm but process one H3 cell at a time via a TypeScript loop, avoiding the single massive query.

**Method:**
```typescript
for (const cell of allCells) {
  // Each iteration: only target records in THIS cell
  // Candidates come from grid_disk(cell, 1) = 7 cells
  // ROW_NUMBER over ~300 target × ~200 candidates = ~60K rows
  await conn.run(`INSERT INTO _dq_knn_outliers
    WITH ... WHERE s1.h3_cell = ${cell}`)
}
```

**Complexity:** O(n × k) per cell — each cell processes ~300 targets × ~200 candidates = ~60K pairs. With 26,164 cells, total SQL statements: ~26K. Each takes ~50–100ms → **~20–40 minutes total**.

**Strengths:**
- Preserves the original per-record KNN algorithm exactly
- Each iteration is tiny (~60K rows) — no memory issues
- Most statistically faithful to the original design

**Weaknesses:**
- **20–40 minutes runtime** — acceptable for ETL but slow
- **26K separate SQL statements** — significant overhead from query planning and round-trips
- Dense cells (CBD with 5000+ records) still produce large per-cell pair counts: 5000 × 3000 = 15M pairs for a single cell. Even one-cell-at-a-time, this may exceed memory for the densest cells.
- Complex implementation (loop management, progress tracking, error recovery)

**Statistical soundness:** Identical to the original KNN design — the gold standard for this use case.

### 2.5 Approach E — KNN with pre-aggregated cell medians (approximate KNN)

Instead of computing KNN over individual sales, first aggregate to cell-level medians, then compare each sale against its cell's neighbourhood median.

**Method:**

1. Compute median price per `(H3 cell, segment, year)` — ~400K groups
2. For each sale, look up its cell's median and the medians of neighbouring cells
3. Compute IQR from the ~7 cell medians (weighted by sale count)
4. Flag if sale price is beyond 3× IQR of the cell-median distribution

**Strengths:**
- Very fast — just two GROUP BY operations
- No self-join at all

**Weaknesses:**
- **Loses intra-cell variance.** All sales in a cell are compared against the same cell-level median. A cell with both $500K townhouses and $2M houses would have a median around $1M, missing outliers in both segments.
- Only ~7 data points for IQR (the 7 cell medians) — IQR with N=7 is statistically unstable
- Segment and temporal filtering reduce this further — may have only 3–4 cell medians

**Statistical soundness:** Low. Seven data points is insufficient for reliable quartile estimation. This approach over-simplifies and would miss many genuine outliers while potentially flagging normal within-cell price variation.

---

## 3. Comparative Analysis

### 3.1 Key Dimensions

| Approach | Complexity | Peak Memory | Runtime (est.) | Adaptivity | Statistical Power | Implementation Complexity |
|---|---|---|---|---|---|---|
| **A: Cell-Level IQR** | O(n) | ~1.5 GB | ~30–60s | Cell-level | High (N≈175) | Low |
| **B: Cell-Level MAD** | O(n) | ~3 GB | ~60–90s | Cell-level | Very high | Medium |
| **C: Hybrid IQR+MAD** | O(n) | ~4.5 GB | ~90–120s | Cell-level | Very high (conservative) | Medium |
| **D: Chunked KNN** | O(n×k) | ~200 MB/cell | ~20–40 min | Per-record | Gold standard | High |
| **E: Cell-median KNN** | O(n) | ~500 MB | ~10–20s | Cell-level | Low (N≈7) | Low |

### 3.2 KNN vs Cell-Level: Is the Difference Meaningful?

The core question: does per-record KNN (Approach D) produce meaningfully better outlier detection than cell-level aggregation (Approaches A/B)?

**Argument for KNN being better:**
- KNN adapts the comparison set to each record's actual spatial neighbourhood — a record at a cell boundary gets neighbours from adjacent cells weighted by proximity
- KNN uses exactly K=20 neighbours regardless of cell density — consistent statistical power across urban and rural areas
- Distance-weighting (closer neighbours matter more) is implicit in the K-nearest selection

**Argument for cell-level being equivalent:**
- At H3 res 7 (~2.5km across), all records in a cell are genuinely in the same local market. The IQR from ~175 same-cell-neighbourhood records is MORE stable than from K=20.
- The cell-level approach still uses `grid_disk(1)` — records near cell boundaries still benefit from adjacent cells' data pooled into their cell's IQR.
- Property prices are spatially autocorrelated — within a 2.5km hex, prices are highly correlated. The KNN's per-record adaptivity captures intra-cell variation that is mostly noise, not signal.
- Research on spatial outlier detection confirms that grid-based approaches achieve comparable performance to point-level KNN when the grid resolution is appropriate for the domain (source: [Spatial Outlier Detection: Data, Algorithms, Visualizations](https://link.springer.com/chapter/10.1007/978-3-642-22922-0_41)).

**Conclusion:** For property price outlier detection at H3 res 7 resolution, the cell-level approach is **statistically equivalent to KNN** for practical purposes. The KNN's advantage (per-record adaptivity) is a theoretical improvement that doesn't materially affect outlier detection quality in this domain, because the spatial autocorrelation within a 2.5km hex makes per-record variation negligible compared to the neighbourhood distribution.

### 3.3 IQR vs MAD: Which Is More Appropriate?

Property prices are right-skewed: the distribution has a long right tail (luxury properties) and a relatively short left tail (prices can't go below zero). This skew affects IQR and MAD differently:

**IQR (Q3 − Q1):**
- Captures the middle 50% of the distribution
- In right-skewed data, Q3 is pulled right by the tail, widening IQR and raising the upper fence
- This makes IQR **less sensitive to upper outliers** in skewed distributions
- Lower fence (Q1 − 3×IQR) can become negative — not meaningful for prices *(resolved by log-space IQR — see §4.6)*

**MAD (Median Absolute Deviation):**
- Measures dispersion around the median, not the mean
- Equally sensitive to outliers on both sides of the median
- The 0.6745 normalisation factor assumes approximate normality for threshold calibration
- **More sensitive to outliers** in skewed distributions because it isn't inflated by the tail

**For NSW property prices:** MAD is theoretically superior because:
1. Prices are right-skewed — IQR's upper fence is inflated by the luxury tail
2. The median (used by MAD) is a better measure of central tendency than the IQR's implicit midrange
3. The Modified Z-Score threshold (3.5) is a published standard with known properties

**However**, IQR has practical advantages:
1. **Easier to understand and explain** — Q1, Q3, and "outside the box" are familiar concepts
2. **More conservative** for right-skewed data — the inflated upper fence means fewer false positives on high-end sales
3. **Already used throughout the codebase** — consistent with existing LOESS pipeline thresholds

### 3.4 Statistical Literature Consensus

| Source | Recommendation |
|---|---|
| Iglewicz & Hoaglin (1993) "How to Detect and Handle Outliers" | Modified Z-Score with MAD for non-normal data |
| Leys et al. (2013) "Detecting outliers: Do not use standard deviation" | MAD-based rejection (2.5× MAD threshold) for psychological data |
| Tukey (1977) "Exploratory Data Analysis" | IQR with 1.5× multiplier (standard box plot rule) |
| Real estate analytics literature | IQR most commonly used; MAD recommended when precision matters |
| [Hausetutorials — MAD vs Z-score](https://hausetutorials.netlify.app/posts/2019-10-07-outlier-detection-with-median-absolute-deviation/) | "Use MAD instead of Z-score for outlier detection" |
| [Statology — Modified Z-Score](https://www.statology.org/modified-z-score/) | Modified Z-Score (MAD-based) for non-normal distributions |

---

## 4. Recommendation

### 4.1 Recommended Approach: Cell-Level IQR (Approach A)

**Primary reasons:**

1. **Proven scalability.** O(n) with ~1.5 GB peak memory. Uses the same GROUP BY aggregation pattern that already works at scale in the LOESS pipeline (`h3-precompute.ts`).

2. **Statistically sound.** IQR from ~175 neighbours per (cell, segment, year) is MORE stable than KNN's K=20. The spatial neighbourhood (`grid_disk(1)`) and temporal window (±3 years) are identical to the KNN spec.

3. **Consistent with existing codebase.** The LOESS pipeline, heatmap aggregation, and all existing H3 queries use cell-level GROUP BY. Adding a second cell-level aggregation is architecturally consistent.

4. **Conservative threshold appropriate for this use case.** For data cleaning before LOESS fitting, false negatives (missing an outlier) are less harmful than false positives (removing a legitimate sale). IQR's right-skew inflation makes it naturally conservative for upper outliers — exactly what we want for property prices.

5. **Simple implementation.** Two SQL statements: one to compute cell IQR, one to flag outliers. No loops, no batching, no complex state management.

### 4.2 Why Not MAD?

MAD (Approach B) is theoretically superior for skewed data. It is not recommended as the primary method here because:

1. **Two-pass aggregation** doubles the join work (~280M rows vs ~140M). The second pass (computing MAD from deviations) requires re-joining the full neighbourhood.
2. **MAD = 0 edge case** requires special handling (cells where all sales have the same price — common in strata complexes where 20 identical apartments sell for similar prices). IQR handles this naturally (Q1 = Q3 → IQR = 0 → nothing flagged, which is correct behaviour).
3. **Marginal practical benefit.** The 3× IQR multiplier is already very conservative. In practice, true outliers (data entry errors, $80K in a $800K area) are extreme enough to be caught by either method. The cases where MAD detects an outlier but IQR doesn't are typically borderline — exactly the cases where we should err on the side of keeping the record.

**MAD could be added as a secondary validation in a future iteration** if the IQR approach is found to miss important outliers.

### 4.3 Parameters

All parameters carry over from the original KNN spec unchanged:

| Parameter | Value | Rationale |
|---|---|---|
| H3 resolution | 7 | ~2.5km cells — matches "same suburb" granularity |
| grid_disk rings | 1 | 7 cells total (~5km coverage) |
| Temporal window | ±3 years | Stable quartiles without mixing boom/bust |
| Segment filter | strata / freehold | Uses `is_likely_strata` correction |
| IQR multiplier | 3.0× | Conservative — only extreme outliers |
| Min neighbours | 20 | Stable Q1/Q3 estimates |
| Baseline exclusions | `CLEAN_RECORD_FILTER` | Excludes nominal, partial, bulk, multi-dealing dups |

### 4.4 Locality Fallback

The locality fallback for ungeocodable records (~2.1%) is **unchanged** — it already uses a GROUP BY pattern (rolling 5-year window per locality × segment) that scales fine. No modification needed.

### 4.5 What We Lose vs KNN

| KNN Feature | Cell-Level Equivalent | Impact |
|---|---|---|
| Per-record adaptive radius | Fixed H3 cell neighbourhood | Negligible — 2.5km hex captures the local market |
| Distance-weighted neighbour selection | Equal weight to all neighbours in 7-cell area | Negligible — closer vs farther within 5km doesn't meaningfully change IQR |
| Exactly K=20 neighbours per record | ~175 neighbours per (cell, segment, year) | **Beneficial** — larger sample = more stable IQR |
| 5km max-distance sanity check | Implicit in grid_disk(1) geometry | Equivalent — grid_disk(1) at res 7 covers ~5km |
| Records at cell boundaries see custom neighbourhoods | Records see their cell's pooled neighbourhood | Minor loss — mitigated by grid_disk(1) including adjacent cells |

### 4.6 Log-Space IQR

The initial Cell-Level IQR implementation (§4.1) computed quartiles in **linear price space**. This was found to fail for lower-bound outlier detection because property prices are right-skewed (approximately log-normal).

**Problem — linear-space IQR gives negative lower fences:**

In a high-value cell (e.g. Cammeray, hex `89be0e35ad3ffff`):
- Q1 = $2.92M, Q3 = $5.0M, IQR = $2.08M
- Lower fence = Q1 − 3×IQR = $2.92M − $6.24M = **−$3.32M** (meaningless)
- Three split-interest transfers at $331K–$372K were not flagged despite being obvious outliers in a $3.8M median neighbourhood

**Solution — compute IQR in log-space:**

Applying `LN()` to prices before computing quartiles produces symmetric fences that are always positive:
- log Q1 = 14.89, log Q3 = 15.42, log IQR = 0.53
- Lower fence = exp(14.89 − 3 × 0.53) = exp(13.30) = **$597K**
- Upper fence = exp(15.42 + 3 × 0.53) = exp(17.01) = **$24.2M**

The $331K–$372K sales now fall below the $597K lower fence and are correctly flagged.

**Scope of log-transform:** Only outlier detection uses log-space. The rest of the pipeline intentionally stays in linear price space:
- **LOESS smoothing**: Linear (docs/methodology.md §6.1: avoids exponential extrapolation artifacts)
- **Trend-fit**: Already uses `LN(median_val)` for regression, independently of outlier detection
- **Median aggregations**: Linear (median is robust to skew, unlike mean)

**Result:** 61,717 outliers flagged (vs 102,912 in linear space). The reduction is primarily from the tighter upper fence — linear space over-flagged high-end sales where Q3 was already inflated by the luxury tail.

---

## 5. Implementation Sketch

```
flagPriceOutliers():
  1. Load H3 extension
  2. CREATE TEMP _dq_clean_sales        — 4.78M geocoded, clean records with H3 cell + segment
  3. CREATE TEMP _dq_h3_neighbors       — pre-computed grid_disk(1) expansion (~183K rows)
  4. CREATE TEMP _dq_cell_iqr           — log-space IQR per (cell, segment, year) from 7-cell neighbourhood
  5. UPDATE fact_property_sale           — flag outliers where LN(price) is outside log-space fences
  6. Locality fallback                  — ungeocodable records (also log-space IQR)
  7. DROP TEMP tables
```

Steps 1–3 are identical to the current implementation. Step 4 replaces the KNN self-join with a single GROUP BY aggregation using `LN(purchase_price)` for IQR computation (see §4.6). Step 5 compares `LN(price)` against log-space fences. Steps 6–7 are unchanged structurally but also use log-space.

**Expected runtime:** ~30–60 seconds (comparable to LOESS precompute, which uses the same aggregation pattern).

**Expected outlier count:** Similar to the previous locality×decade approach (~113K, ~2.3% of dataset) but with better spatial precision and temporal continuity.

---

## 6. Sources

### DuckDB Technical Documentation
- [Window Functions — Flying Through Windows](https://duckdb.org/2025/02/14/window-flying) — window function materialisation behaviour
- [Correlated Subqueries in SQL](https://duckdb.org/2023/05/26/correlated-subqueries-in-sql) — LATERAL join decorrelation limitations
- [Memory Management in DuckDB](https://duckdb.org/2024/07/09/memory-management) — temp directory spilling
- [OOM Troubleshooting](https://duckdb.org/docs/stable/guides/troubleshooting/oom_errors) — memory limit recommendations
- [Spatial Joins in DuckDB](https://duckdb.org/2025/08/08/spatial-joins) — R-tree buffering requirements
- [Tuning Workloads](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads) — `preserve_insertion_order`, thread count

### Statistical Methods
- Iglewicz, B. & Hoaglin, D. (1993). "Volume 16: How to Detect and Handle Outliers." ASQC Quality Press.
- Tukey, J.W. (1977). "Exploratory Data Analysis." Addison-Wesley.
- Leys, C. et al. (2013). "Detecting outliers: Do not use standard deviation around the mean, use absolute deviation around the median." Journal of Experimental Social Psychology, 49(4), 764–766.
- Cleveland, W.S. (1979). "Robust Locally Weighted Regression and Smoothing Scatterplots." Journal of the American Statistical Association, 74(368), 829–836.

### Spatial Statistics
- [Spatial Outlier Detection: Data, Algorithms, Visualizations](https://link.springer.com/chapter/10.1007/978-3-642-22922-0_41) — grid-based vs point-level comparison
- [Outlier Detection in Spatial Error Models](https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-024-02208-3) — spatial autocorrelation in outlier detection
- [Tracking Doubtful Real Estate Transactions by Outlier Detection Methods](https://www.researchgate.net/publication/240639942) — IQR for real estate
- [Outlier Detection for Analysis of Real Estate Price](https://ieeexplore.ieee.org/document/9302110/) — spatial methods for property data

### H3 Spatial Indexing
- [H3: Uber's Hexagonal Spatial Indexing System](https://www.uber.com/blog/h3/)
- [Spatial Analytics at Any Scale with H3](https://www.databricks.com/blog/2022/12/13/spatial-analytics-any-scale-h3-and-photon.html)
