# LOESS Pipeline Holistic Audit

**Date:** 2026-03-04
**Trigger:** LOESS curve in hex detail dialog appears fundamentally wrong — curve starts at ~$9k/sqm when actual medians are ~$1–2k/sqm, and trends downward while medians trend upward.

**Resolution:** Refactored LOESS to fit individual sale prices at exact contract dates instead of quarterly medians. See R1 below and `loess-curve-precompute.ts`.

## 1. Full Data Pipeline

```
Raw sales (fact_property_sale)
  │
  ├── [ETL] quarterly_medians CTE
  │     GROUP BY h3_cell, quarter
  │     CAST(MEDIAN(price_expr) AS BIGINT)
  │     No minimum sale count per quarter
  │
  ├── [ETL] weighted CTE
  │     CROSS JOIN with eval_grid (every quarter 1990–present)
  │     Tricube kernel: w = (1 - |u|³)³, u = |distance| / bandwidth
  │     y = LN(quarterly_median)
  │     Only pairs within ±3 years (LOESS_BANDWIDTH)
  │
  ├── [ETL] agg CTE → slopes CTE → fitted CTE
  │     Weighted OLS normal equations per (cell, eval_quarter)
  │     HAVING COUNT(*) >= 3 weighted data points
  │     fitted_price = ROUND(EXP(intercept + slope * eval_quarter))
  │     Log-space guard: fitted log value must be in [0, 30]
  │
  ├── [ETL] gap_tagged → run_lengths → best_run → cell_curves
  │     Keep only longest contiguous run of quarters
  │     HAVING COUNT(*) >= 4 quarters in the run
  │
  └── [STORED] agg_h3_loess_curve
        fitted_prices BIGINT[] — one value per quarter
        min_quarter, max_quarter, bandwidth
        ─────────────────────────────────────
        │
        ├── [QUERY] queryLoessHeatmapData()
        │     list_extract to get start/end fitted prices
        │     Clamps to reliable interior (±bandwidth from edges)
        │     CAGR = POWER(end/start, 1/years) - 1
        │     → HeatmapDataPoint.growth (drives heatmap color)
        │
        ├── [QUERY] queryLoessCurve()
        │     Returns full fitted_prices[] array for one cell
        │     → LoessCurveData (used by dialog chart)
        │
        └── [DISPLAY] HexDetailDialog
              Charts LOESS curve via loessValueAt() (with edge extrapolation)
              Charts YEARLY medians via queryHexYearlyMedians()
                  GROUP BY EXTRACT(YEAR FROM contract_date)
                  CAST(MEDIAN(price_expr) AS BIGINT)
```

## 2. Root Cause Analysis

### Primary: Quarterly vs Yearly Aggregation Mismatch

The LOESS curve is fitted to **quarterly medians**, but the dialog chart overlays it against **yearly medians**. These are fundamentally different aggregations of the same raw data:

| Source | Aggregation | File | Line |
|--------|------------|------|------|
| LOESS input | `MEDIAN(price) GROUP BY cell, quarter` | `loess-curve-precompute.ts` | 113–123 |
| Chart display | `MEDIAN(price) GROUP BY year` | `heatmap-queries.ts` | 466–475 |

For cells with sparse data, these can diverge dramatically:

**Example scenario (price-per-sqm, one hex cell in one year):**
| Quarter | Sales | Individual $/sqm values | Quarterly Median |
|---------|-------|------------------------|-----------------|
| Q1 | 1 | $8,500 | $8,500 |
| Q2 | 0 | — | — |
| Q3 | 3 | $1,100, $1,400, $1,300 | $1,300 |
| Q4 | 1 | $1,200 | $1,200 |

- **Yearly median** (all 5 sales): $1,300 (this is what the chart shows)
- **Quarterly medians fed to LOESS**: $8,500, $1,300, $1,200 — the $8,500 outlier has equal weight

The LOESS kernel window (±3 years) sees ~24 quarterly medians. If a few of those are extreme outliers (from quarters with 1 sale), the weighted local regression will track them, producing a fitted curve that appears disconnected from the yearly medians shown on the chart.

This is the most likely explanation for why the curve starts at ~$9k when yearly medians are ~$1–2k.

### Secondary: No Quality Gate on Quarterly Medians

The trend-fit method has explicit quality gates:
- Each yearly median must be based on **≥2 sales** (`HAVING COUNT(*) >= 2`)
- The cell must have **≥4 distinct qualifying years**

LOESS has **no equivalent gate**:
- Any quarter with ≥1 sale produces a valid quarterly median
- `HAVING COUNT(*) >= 3` in the `agg` CTE requires 3 data points within the bandwidth window, not 3 sales per quarter
- A cell could have 20 quarters of data where 15 quarters each have only 1 sale — every single-sale quarter gets equal influence

### Tertiary: Log-Space Bias

LOESS operates in log-space: `y = LN(median_val)`. The fitted value is `EXP(weighted_mean_of_ln_values)`, which is the **geometric mean**, not the arithmetic mean or median. For right-skewed distributions:

- Geometric mean < arithmetic mean
- Geometric mean ≈ median for log-normal data (property prices are roughly log-normal)

This doesn't explain the magnitude of the discrepancy (~5-9x), but it contributes a systematic downward bias in some cells.

### Tertiary: BIGINT Truncation

`CAST(MEDIAN(...) AS BIGINT)` truncates to integers. For price-per-sqm values like $1,234.56/sqm, this rounds to $1,235. The error is <0.1% and not a significant contributor.

## 3. Data Culling Behaviors

Every step where data is filtered, bucketed, or transformed — answering the question "Is there some data culling leading to side effects?"

### 3.1 Base Filters (shared by all methods)

Applied in both ETL and webapp queries:

```sql
fps.purchase_price > 0
fps.contract_date IS NOT NULL
da.latitude IS NOT NULL       -- must be geocoded
da.longitude IS NOT NULL
fps.is_bulk_sale = FALSE       -- excludes portfolio sales
fps.is_price_outlier = FALSE   -- excludes statistical outliers
```

For price-per-sqm, additional filters:
```sql
fps.area > 0
fps.area_type IN ('M', 'H')   -- must have valid area measurement
```

**Side effect:** Properties without geocoded addresses or without area data are silently excluded. If these are systematically different in price (e.g., rural properties less likely to be geocoded), the medians are biased.

### 3.2 Quarterly Bucketing

Sales are assigned to quarters via:
```sql
EXTRACT(YEAR FROM fps.contract_date) + (EXTRACT(QUARTER FROM ...) - 1) * 0.25
```

**Side effect:** Quarter boundaries (Jan 1, Apr 1, Jul 1, Oct 1) are hard cutoffs. A cluster of sales straddling a boundary gets split, reducing the effective sample size in both quarters.

### 3.3 Median per Quarter (LOESS) vs Median per Year (Chart)

This is the critical mismatch documented in Section 2.

The LOESS sees quarterly medians as independent data points. The chart shows yearly medians. When a year has uneven distribution across quarters (e.g., most sales in Q3-Q4, one outlier in Q1), the quarterly view gives the outlier quarter equal representation, while the yearly median marginalizes it.

### 3.4 Quarterly Median → LN() Transform

The LOESS fits in log-space: `y = LN(quarterly_median)`. This is correct for multiplicative/percentage-based trends (property prices grow exponentially). But it means:

- High-valued outlier quarters (like the $8,500/sqm example) have a smaller effect in log-space ($8,500 → ln = 9.05) compared to linear space
- Low-valued outlier quarters have a proportionally larger effect
- The back-transform `EXP()` amplifies any bias in the log-space fit

### 3.5 Tricube Kernel Weighting

The tricube kernel gives highest weight to data points closest to the evaluation point and zero weight beyond the bandwidth (3 years):

```
w(u) = (1 - |u|³)³    where u = distance/bandwidth
```

At u=0 (same quarter): w = 1.0
At u=0.5 (1.5 years away): w = 0.67
At u=0.9 (2.7 years away): w = 0.028
At u=1.0 (3 years, the boundary): w = 0.0

**Side effect:** Quarterly medians very close to the evaluation point dominate. If the nearest quarter has 1 sale at an extreme price, that single data point has massive influence on the fitted value.

### 3.6 Contiguous Run Selection

The ETL keeps only the "longest contiguous run" of quarters (`best_run` CTE). If a cell has a gap (a quarter where the LOESS couldn't produce a fitted value), the curve is split and only the longest segment is stored.

**Side effect:** Data before or after a gap is discarded. A cell with strong recent data but a gap in 2005 might lose all pre-2005 fitted values.

### 3.7 Edge Zone Clamping (Query Time)

`queryLoessHeatmapData()` clamps to the "reliable interior" — `[min_quarter + bandwidth, max_quarter - bandwidth]`. This avoids edge artifacts but reduces the effective time range.

**Side effect:** For a cell whose curve spans 1995–2025, the reliable interior is 1998–2022. If the user selects a 5-year period (2020–2025), the actual growth is computed over 2020–2022 (only 2 years), which may not be representative.

### 3.8 loessValueAt() Edge Extrapolation (Display Time)

The dialog chart uses `loessValueAt()` to extrapolate beyond the reliable interior using the annual growth rate at the boundary. This is a simple exponential projection.

**Side effect:** If the boundary rate is anomalous (a brief spike or dip), the extrapolation amplifies it across multiple years.

## 4. Verification Queries

Run these against the DuckDB database to inspect a specific hex cell. Replace `<H3_INDEX>` with the hex string from the dialog (e.g., `872830828ffffff`).

### 4.1 Compare Quarterly vs Yearly Medians

```sql
-- Quarterly medians (what LOESS fits to)
SELECT
  EXTRACT(YEAR FROM fps.contract_date)
    + (EXTRACT(QUARTER FROM fps.contract_date) - 1) * 0.25 AS quarter,
  CAST(MEDIAN(fps.purchase_price / (
    CASE WHEN fps.area_type = 'H' THEN fps.area * 10000 ELSE fps.area END
  )) AS BIGINT) AS quarterly_median,
  COUNT(*) AS sale_count
FROM fact_property_sale fps
JOIN dim_address da
  ON fps.property_id = da.property_id
  AND COALESCE(fps.unit_number, '') = da.unit_number
  AND COALESCE(fps.house_number, '') = da.house_number
WHERE fps.purchase_price > 0
  AND fps.contract_date IS NOT NULL
  AND da.latitude IS NOT NULL
  AND fps.is_bulk_sale = FALSE
  AND fps.is_price_outlier = FALSE
  AND fps.area > 0
  AND fps.area_type IN ('M', 'H')
  AND h3_latlng_to_cell(da.latitude, da.longitude, 8)::BIGINT
      = ('0x' || '<H3_INDEX>')::BIGINT
GROUP BY quarter
ORDER BY quarter;
```

### 4.2 Yearly Medians (what the chart shows)

```sql
-- Same filters, grouped by year
SELECT
  EXTRACT(YEAR FROM fps.contract_date)::INT AS year,
  CAST(MEDIAN(fps.purchase_price / (
    CASE WHEN fps.area_type = 'H' THEN fps.area * 10000 ELSE fps.area END
  )) AS BIGINT) AS yearly_median,
  COUNT(*) AS sale_count
FROM fact_property_sale fps
JOIN dim_address da
  ON fps.property_id = da.property_id
  AND COALESCE(fps.unit_number, '') = da.unit_number
  AND COALESCE(fps.house_number, '') = da.house_number
WHERE fps.purchase_price > 0
  AND fps.contract_date IS NOT NULL
  AND da.latitude IS NOT NULL
  AND fps.is_bulk_sale = FALSE
  AND fps.is_price_outlier = FALSE
  AND fps.area > 0
  AND fps.area_type IN ('M', 'H')
  AND h3_latlng_to_cell(da.latitude, da.longitude, 8)::BIGINT
      = ('0x' || '<H3_INDEX>')::BIGINT
GROUP BY year
ORDER BY year;
```

### 4.3 Inspect Stored LOESS Curve

```sql
-- Stored fitted values
SELECT
  min_quarter, max_quarter, bandwidth,
  fitted_prices,
  total_sales, quarter_count,
  LEN(fitted_prices) AS array_length,
  fitted_prices[1] AS first_fitted,
  fitted_prices[LEN(fitted_prices)] AS last_fitted
FROM agg_h3_loess_curve
WHERE h3_cell = ('0x' || '<H3_INDEX>')::BIGINT
  AND resolution = 8
  AND metric = 'price-per-sqm'
  AND strata_filter = 'all';
```

### 4.4 Find Single-Sale Quarters (Outlier Candidates)

```sql
-- Quarters with only 1 sale — these produce unreliable medians
WITH qm AS (
  SELECT
    EXTRACT(YEAR FROM fps.contract_date)
      + (EXTRACT(QUARTER FROM fps.contract_date) - 1) * 0.25 AS quarter,
    fps.purchase_price / (
      CASE WHEN fps.area_type = 'H' THEN fps.area * 10000 ELSE fps.area END
    ) AS price_sqm,
    COUNT(*) OVER (PARTITION BY
      EXTRACT(YEAR FROM fps.contract_date),
      EXTRACT(QUARTER FROM fps.contract_date)
    ) AS quarter_sale_count
  FROM fact_property_sale fps
  JOIN dim_address da
    ON fps.property_id = da.property_id
    AND COALESCE(fps.unit_number, '') = da.unit_number
    AND COALESCE(fps.house_number, '') = da.house_number
  WHERE fps.purchase_price > 0
    AND fps.contract_date IS NOT NULL
    AND da.latitude IS NOT NULL
    AND fps.is_bulk_sale = FALSE
    AND fps.is_price_outlier = FALSE
    AND fps.area > 0
    AND fps.area_type IN ('M', 'H')
    AND h3_latlng_to_cell(da.latitude, da.longitude, 8)::BIGINT
        = ('0x' || '<H3_INDEX>')::BIGINT
)
SELECT quarter, ROUND(price_sqm)::INT AS price_sqm, quarter_sale_count
FROM qm
WHERE quarter_sale_count = 1
ORDER BY quarter;
```

### 4.5 Systemic Check: How Many Quarters Have ≤2 Sales?

```sql
-- Across all cells at resolution 8, price-per-sqm
WITH qm AS (
  SELECT
    h3_latlng_to_cell(da.latitude, da.longitude, 8)::BIGINT AS cell,
    EXTRACT(YEAR FROM fps.contract_date)
      + (EXTRACT(QUARTER FROM fps.contract_date) - 1) * 0.25 AS quarter,
    COUNT(*) AS sale_count
  FROM fact_property_sale fps
  JOIN dim_address da
    ON fps.property_id = da.property_id
    AND COALESCE(fps.unit_number, '') = da.unit_number
    AND COALESCE(fps.house_number, '') = da.house_number
  WHERE fps.purchase_price > 0
    AND fps.contract_date IS NOT NULL
    AND da.latitude IS NOT NULL
    AND fps.is_bulk_sale = FALSE
    AND fps.is_price_outlier = FALSE
    AND fps.area > 0
    AND fps.area_type IN ('M', 'H')
  GROUP BY cell, quarter
)
SELECT
  CASE
    WHEN sale_count = 1 THEN '1 sale'
    WHEN sale_count = 2 THEN '2 sales'
    WHEN sale_count <= 5 THEN '3-5 sales'
    ELSE '6+ sales'
  END AS bucket,
  COUNT(*) AS quarter_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM qm
GROUP BY bucket
ORDER BY MIN(sale_count);
```

## 5. Recommendations

### R1: Add Quality Gate to Quarterly Medians (High Priority)

**Problem:** Single-sale quarters produce unreliable medians that dominate the LOESS fit.

**Fix:** In `loess-curve-precompute.ts`, add `HAVING COUNT(*) >= 2` to the `quarterly_medians` CTE (line 122):

```sql
GROUP BY cell, quarter
HAVING COUNT(*) >= 2    -- ← add this
```

This excludes quarters where the "median" is just one property's price. It mirrors the trend-fit's quality gate philosophy.

**Trade-off:** Cells with very sparse data will have fewer data points for the LOESS fit, potentially losing curve coverage. But the remaining data points will be more representative.

### R2: Show Quarterly Medians on Chart (Medium Priority)

**Problem:** The chart currently shows yearly medians, but the LOESS is fitted to quarterly medians. The user sees a mismatch because they're comparing the curve to the wrong data.

**Fix:** Add a second scatter series to the chart showing the quarterly medians that the LOESS was actually fitted to. This makes the LOESS fit visually interpretable — the curve should track the quarterly points even if it diverges from the yearly ones.

Alternatively, or additionally, add a toggle to switch between quarterly and yearly medians on the chart.

### R3: Consider Fitting LOESS to Yearly Medians (Medium Priority, Alternative to R1)

**Problem:** Quarterly granularity is noisy for sparse cells.

**Fix:** Change the ETL `quarterly_medians` CTE to compute yearly medians instead:

```sql
GROUP BY cell, EXTRACT(YEAR FROM fps.contract_date)
```

The LOESS curve would then have ~30 data points (1990–2025) instead of ~120 quarterly points. With bandwidth=3, the kernel window would cover ±3 data points instead of ±12, so the bandwidth would need adjustment.

**Trade-off:** Loses quarterly granularity. For dense cells where quarterly data is meaningful, this is a step backward. Better suited as an option for sparse cells only.

### R4: Weight Quarterly Medians by Sale Count (Medium Priority)

**Problem:** A quarter with 1 sale has the same influence as a quarter with 50 sales.

**Fix:** In the `weighted` CTE, multiply the kernel weight by the sale count:

```sql
POWER(1.0 - POWER(ABS(...) / bandwidth, 3), 3)
  * qm.sale_count  -- weight by reliability
  AS w
```

This gives high-volume quarters proportionally more influence. Quarters with 1 sale are downweighted but not excluded.

**Trade-off:** This changes the statistical interpretation — it's no longer pure LOESS on medians but rather a sale-count-weighted variant. The mathematical properties (consistency, bias) need analysis.

### R5: Add Confidence Indicator for LOESS (Low Priority)

**Problem:** The user has no way to know whether a cell's LOESS fit is reliable.

**Fix:** Store a quality metric alongside the curve — e.g., the average sale count per quarter, or the percentage of quarters with ≥3 sales. Display this in the tooltip/dialog similar to the R² badge for trend-fit.

## 6. Source File Reference

| File | Role | Key Lines |
|------|------|-----------|
| `scripts/src/heatmap/loess-curve-precompute.ts` | ETL: computes LOESS curves | L113–123 (quarterly_medians), L168–186 (weighted), L219–227 (fitted) |
| `scripts/src/heatmap/loess-config.ts` | Algorithm constants | LOESS_BANDWIDTH=3, LOESS_MIN_WEIGHTED_POINTS=3 |
| `scripts/src/heatmap/schema.ts` | Table DDL | agg_h3_loess_curve (L155–231) |
| `webapp/src/lib/heatmap-queries.ts` | Query-time growth computation | queryLoessHeatmapData (L563–659), queryLoessCurve (L671–712), queryHexYearlyMedians (L457–488) |
| `webapp/src/features/dashboard/widgets/growth-heatmap/HexDetailDialog.tsx` | Dialog chart rendering | loessValueAt (L96–124), buildChartOption (L127–315) |
| `webapp/src/lib/heatmap-stats.ts` | Client-side hex fill | fillAdjacentHexes (no LOESS involvement) |
