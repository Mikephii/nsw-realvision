# Growth Heatmap Methodology

## 1. Overview

This document describes the complete methodology for computing spatially-smoothed property price growth rates across New South Wales, Australia. The system produces a continuous heatmap of annualised compound growth rates (CAGR) from individual property sales transactions, using locally estimated scatterplot smoothing (LOESS) with a tricube kernel on Uber's H3 hexagonal spatial index.

The pipeline consists of four stages:

1. **Data preparation** — filtering, geocoding, and spatial assignment of raw sales to H3 cells
2. **LOESS curve fitting** — per-cell price smoothing using adaptive-bandwidth local linear regression in linear price space
3. **Query-time evaluation** — extracting growth rates between arbitrary time periods from precomputed curves
4. **Visualisation** — inverse distance weighting (IDW) interpolation to produce a continuous surface from discrete cell values

All algorithmic parameters, filtering rules, and formulas are documented below to enable independent replication.

---

## 2. Data Source

### 2.1 Raw Data

Sales transactions are sourced from the NSW Valuer General's Property Sales Information (PSI) bulk data files. These are semicolon-delimited flat ASCII files containing:

- **Contract date** (CCYYMMDD format)
- **Purchase price** (integer, AUD)
- **Property address** (street number, street name, locality/suburb, postcode)
- **Area** (numeric, in square metres or hectares)
- **Area type** (`M` = square metres, `H` = hectares)
- **Strata indicator** (non-null for strata-titled properties; null for freehold)
- **Nature of property** (`V` = vacant, `R` = residence, `3` = other)
- **Zoning code** (pre-2011 single-character or post-2011 LEP codes)

Data spans 1990 to present, with weekly incremental updates.

### 2.2 Geocoding

Addresses are matched against the Geocoded National Address File (G-NAF) to obtain latitude and longitude coordinates. Only successfully geocoded properties (non-null coordinates in `dim_address`) participate in spatial analysis.

### 2.3 Database Schema

Cleaned data resides in two DuckDB tables:

- **`fact_property_sale`** — one row per sale transaction (property_id, contract_date, purchase_price, area, area_type, strata, is_bulk_sale, is_price_outlier, locality, etc.)
- **`dim_address`** — one row per unique address (property_id, unit_number, house_number, latitude, longitude)

Tables are joined on `(property_id, unit_number, house_number)` with COALESCE null-handling.

---

## 3. Data Filtering

### 3.1 Base Exclusion Criteria

Every query applies the following filters to `fact_property_sale` (alias `fps`):

| Condition | Rationale |
|-----------|-----------|
| `fps.purchase_price > 0` | Exclude non-arm's-length transfers ($0 or negative) |
| `fps.contract_date IS NOT NULL` | Cannot assign to a time period without a date |
| `da.latitude IS NOT NULL AND da.longitude IS NOT NULL` | Cannot assign to spatial cell without coordinates |
| `fps.is_bulk_sale = FALSE` | Bulk portfolio sales distort per-property price signals |
| `fps.is_price_outlier = FALSE` | Flagged during ETL cleaning (statistical outliers) |

### 3.2 Property Type Segmentation (Strata Filter)

Three mutually exclusive segmentations are computed independently:

| Filter Value | SQL Condition | Description |
|-------------|---------------|-------------|
| `'all'` | *(no filter)* | All property types combined |
| `'freehold'` | `AND fps.strata IS NULL` | Houses, land, and other non-strata properties |
| `'strata'` | `AND fps.strata IS NOT NULL` | Units, apartments, and other strata-titled properties |

### 3.3 Price Metrics

Two price metrics are supported:

**Median price** (`median-price`):
```
value = fps.purchase_price
```

**Price per square metre** (`price-per-sqm`):
```
value = fps.purchase_price / area_sqm
where area_sqm = CASE
  WHEN fps.area_type = 'H' THEN fps.area * 10000
  ELSE fps.area
END
```

An additional area guard is applied for price-per-sqm:
```
AND fps.area > 0
AND fps.area_type IN ('M', 'H')
```

This excludes records with zero/null area or unrecognised area types.

---

## 4. Spatial Indexing

### 4.1 H3 Hexagonal Grid

Properties are assigned to Uber H3 hexagonal cells using their geocoded coordinates:

```
cell = h3_latlng_to_cell(latitude, longitude, resolution)
```

Three resolution levels are computed:

| Resolution | Approximate Cell Area | Edge Length | Use Case |
|------------|----------------------|-------------|----------|
| 7 | ~5.16 km^2 | ~1.22 km | Suburb-scale patterns |
| 8 | ~0.74 km^2 | ~0.46 km | Neighbourhood scale |
| 9 | ~0.11 km^2 | ~0.17 km | Street-level detail |

### 4.2 Combination Matrix

Curves are precomputed for all combinations of spatial resolution, price metric, and property type segmentation:

```
3 resolutions x 2 metrics x 3 strata filters = 18 combinations
```

Each combination is computed independently in a single SQL INSERT statement.

---

## 5. Temporal Aggregation

### 5.1 Yearly Medians

Individual sales are aggregated to yearly medians per H3 cell:

```sql
SELECT
  cell,
  EXTRACT(YEAR FROM contract_date) AS sale_year,
  CAST(MEDIAN(price_value) AS BIGINT) AS median_val,
  COUNT(*) AS sale_count
GROUP BY cell, sale_year
```

**Design rationale:** Yearly medians absorb intra-year property-specific variance (building quality, position within cell, renovations) that would otherwise create steep local slopes in the LOESS regression. Every sale contributes to its year's median — no data is discarded at this stage.

The median (not mean) is used to provide robustness against individual outlier transactions that pass the base filters.

---

## 6. LOESS Curve Fitting

### 6.1 Algorithm Overview

For each H3 cell, a locally estimated scatterplot smoothing (LOESS) curve is fitted to the yearly median price series. The algorithm evaluates a local weighted linear regression at every quarter from the cell's earliest to latest sale year, using a tricube kernel for distance weighting.

**Key properties of the implementation:**

- **Linear price space** — regression is performed on raw prices, not log-transformed prices. This ensures that extrapolation beyond the data range produces linear (not exponential) projections.
- **Adaptive bandwidth** — each cell's bandwidth is computed from its data density, with a minimum floor.
- **Quarterly evaluation grid** — fitted values are stored at quarterly resolution (Q1 = year.0, Q2 = year.25, Q3 = year.5, Q4 = year.75), enabling arbitrary-period queries at read time.
- **Data range capping** — curves are only stored for quarters within the cell's actual data range `[earliest_sale, latest_sale]`, preventing extrapolation beyond observed data.

### 6.2 Adaptive Bandwidth

Each cell's bandwidth is computed as:

```
bandwidth_cell = max(B_min, ceil((Y_max - Y_min) / N_years * 3))
```

Where:
- **B_min = 5** — minimum bandwidth in years (fixed constant)
- **Y_max, Y_min** — latest and earliest sale years for the cell
- **N_years** — number of distinct years with at least one sale

**Interpretation:** Dense cells (e.g. 25 years of annual data over a 25-year span) use the minimum bandwidth of 5. Sparse cells (e.g. 8 years of data spread over a 20-year span) automatically receive a wider bandwidth of ~8 years, ensuring sufficient kernel support for stable local regression.

### 6.3 Evaluation Grid

A global evaluation grid is generated at quarterly intervals:

```
quarters = {1990.0, 1990.25, 1990.5, 1990.75, 1991.0, ..., current_quarter}
```

This grid is cross-joined with each cell's yearly medians. The per-cell fitted curve only retains values within `[earliest_sale, latest_sale]` (Section 6.7).

### 6.4 Tricube Kernel Weights

For each (cell, evaluation quarter) pair, kernel weights are assigned to all yearly medians within the cell's bandwidth:

```
u = |sale_year - quarter_eval| / bandwidth_cell

w(u) = (1 - |u|^3)^3    for |u| <= 1
w(u) = 0                 for |u| > 1
```

**Properties of the tricube kernel:**
- Maximum weight (w = 1) at the evaluation point's year
- Smooth, continuously differentiable decay
- Exact zero at the bandwidth boundary (no discontinuities)
- Compact support (only data within ±bandwidth contributes)

### 6.4.1 Sale-Count Case Weighting

The total weight for each yearly median incorporates the number of sales that produced it, following standard LOESS case weighting (Cleveland 1979):

```
w_total = sale_count × w_tricube(u)
```

**Rationale:** Each yearly median is an aggregate of _n_ individual sales. The variance of a median of _n_ independent draws is approximately `σ² × π / (2n)`, which is inversely proportional to _n_. The optimal inverse-variance weight (Gauss-Markov BLUE) is therefore `w = n`.

This ensures that a yearly median based on 50 sales receives 50× the weight of a median based on 1 sale, correctly reflecting relative reliability. Without case weighting, a single anomalous transaction could anchor the LOESS curve as firmly as a year of consistent data.

The normal equations (Section 6.5) use the combined weight `w_total` throughout, so case weights flow automatically into all accumulated sums.

**Reference implementation:** `scripts/src/heatmap/loess-math.ts:combinedWeight()`

### 6.5 Weighted Ordinary Least Squares

At each evaluation point, a local linear regression is solved via the weighted normal equations. Given n data points {(x_i, y_i)} with combined weights {w_i} (where w_i = sale_count_i × tricube_i, per Section 6.4.1):

**Accumulated sums:**
```
S_w   = sum(w_i)
S_wx  = sum(w_i * x_i)
S_wy  = sum(w_i * y_i)
S_wxx = sum(w_i * x_i^2)
S_wxy = sum(w_i * x_i * y_i)
```

**Slope:**
```
b = (S_wxy - S_wx * S_wy / S_w) / (S_wxx - S_wx^2 / S_w)
```

**Intercept:**
```
a = (S_wy - b * S_wx) / S_w
```

**Fitted value:**
```
fitted_price = round(a + b * quarter_eval)
```

**Quality gate:** A minimum of 3 weighted data points is required at each evaluation point (`HAVING COUNT(*) >= 3`). Evaluation points with fewer contributing years produce no fitted value.

**Singularity guard:** If all data points share the same x-value (denominator = 0), the slope is undefined and the evaluation point is excluded.

### 6.6 Fitted Value Guards

Fitted prices are bounded to reject nonsensical extrapolations:

```
1 <= fitted_price <= 1,000,000,000
```

Values below $1 or above $1 billion are discarded as extrapolation artefacts.

### 6.7 Data Range Capping

Fitted values are restricted to the cell's actual data range:

```
quarter_eval >= earliest_sale_year
quarter_eval <= latest_sale_year
```

If a cell has sales from 2002 to 2023, the stored curve spans only 2002.0 to 2023.0. No fitted values are stored before the first sale or after the last sale, regardless of kernel support. This prevents unreliable edge extrapolation.

### 6.8 Gap-Tolerant Array Storage

The fitted_prices array spans the cell's full data range `[earliest_sale, latest_sale]` with one slot per quarter. Positions where the LOESS fit failed — due to insufficient kernel support within the bandwidth window (typically caused by data gaps wider than the bandwidth) — are stored as NULL.

This gap-tolerant design replaces the previous contiguous-run selection, which discarded all fitted values outside the longest unbroken sequence. The previous approach caused cells with sparse but long-spanning data (e.g. sales in 2002-2009 and 2025) to have their curves truncated, orphaning recent data clusters.

Query-time endpoint validation replaces ETL-time gap detection:
- Cells are included in heatmap results only if `list_extract()` returns non-NULL at both the requested start and end quarters.
- NULL propagates through the POWER() CAGR calculation, naturally excluding cells with gaps at query endpoints.
- The hex detail chart uses `connectNulls: false` for the LOESS series, rendering gaps as natural breaks in the dashed line.

A minimum of 4 non-NULL fitted values is required per cell.

---

## 7. Storage Schema

Precomputed curves are stored in the `agg_h3_loess_curve` table:

| Column | Type | Description |
|--------|------|-------------|
| h3_cell | BIGINT | H3 cell index (64-bit integer) |
| resolution | TINYINT | H3 resolution (7, 8, or 9) |
| metric | VARCHAR | Price metric (`median-price` or `price-per-sqm`) |
| strata_filter | VARCHAR | Property type (`all`, `freehold`, or `strata`) |
| min_quarter | DOUBLE | Start of array, equal to earliest_sale (year-fraction) |
| max_quarter | DOUBLE | End of array, equal to latest_sale (year-fraction) |
| bandwidth | DOUBLE | Adaptive bandwidth used for this cell (years) |
| fitted_prices | BIGINT[] | Array of fitted prices (may contain NULLs at gap positions) |
| centroid_lat | DOUBLE | H3 cell centroid latitude |
| centroid_lng | DOUBLE | H3 cell centroid longitude |
| locality | VARCHAR | Most frequent suburb name (MODE) |
| total_sales | INTEGER | Total sale count across all years |
| quarter_count | SMALLINT | Count of distinct quarters with sales |
| earliest_sale | DOUBLE | Year of first sale (integer) |
| latest_sale | DOUBLE | Year of last sale (integer) |

**Primary key:** (h3_cell, resolution, metric, strata_filter)

**Array indexing convention (1-indexed, DuckDB):**
```
index = (target_quarter - min_quarter) / 0.25 + 1
```

---

## 8. Query-Time Evaluation

### 8.1 Period Selection

The user selects a lookback period in integer years (e.g. 5, 10, 15, 20, 25). The evaluation endpoints are:

```
end_year   = floor(last_completed_quarter)
start_year = end_year - years_back
```

Where `last_completed_quarter` is the most recent fully elapsed calendar quarter (e.g. Q4 2025 = 2025.75 when queried in Q1 2026).

### 8.2 Data Coverage Requirement

Only cells with actual sales data spanning the requested period are included:

```sql
WHERE earliest_sale <= start_year
  AND latest_sale   >= end_year
```

Cells whose data does not cover both the start and end year are excluded. This ensures every displayed growth rate is supported by observed data at both endpoints — no extrapolated values contribute to the heatmap.

### 8.3 Growth Rate Computation

For each qualifying cell, the compound annual growth rate is:

```
actual_start = max(min_quarter, start_year)
actual_end   = min(max_quarter, end_year)

loess_start = fitted_prices[index(actual_start)]
loess_end   = fitted_prices[index(actual_end)]

CAGR = (loess_end / loess_start) ^ (1 / (actual_end - actual_start)) - 1
```

The CAGR formula produces an annualised rate regardless of the exact period length.

---

## 9. Neighbour Fill (Spatial Estimation)

To reduce visual gaps in areas where some H3 cells lack sufficient sales data, an optional neighbour-fill algorithm estimates values for empty cells adjacent to observed cells.

### 9.1 Algorithm

1. Build a set of all observed cells (cells with computed growth rates).
2. For each observed cell, enumerate its immediate H3 neighbours via `gridDisk(cell, 1)`.
3. Identify neighbours that are **not** in the observed set.
4. For each empty neighbour with **at least 2** observed neighbours:
   - Compute a sale-count-weighted average growth rate:

```
growth_estimated = sum(growth_i * sale_count_i) / sum(sale_count_i)
```

5. Return estimated cells with their centroid coordinates.

**Constraints:**
- Minimum 2 observed neighbours required (prevents single-neighbour extrapolation).
- No cascading — estimated cells do not seed further estimation.
- Estimated cells are visually distinguished (e.g. dashed borders) from observed cells.

---

## 10. Visualisation: Inverse Distance Weighting

The discrete H3 cell growth rates are interpolated into a continuous heatmap surface using inverse distance weighting (IDW).

### 10.1 IDW Formula

For a target pixel at screen position **p**, the interpolated value is:

```
v(p) = sum(w_i * v_i) / sum(w_i)

where w_i = 1 / d(p, p_i)^k
```

- **v_i** — growth rate at cell centroid i
- **d(p, p_i)** — screen-space Euclidean distance between pixel and cell centroid
- **k = 3** — distance exponent (cubic falloff)

### 10.2 GPU Implementation

The IDW interpolation is implemented as a multi-pass WebGL shader pipeline integrated with MapLibre GL:

**Pass 1 (N draw calls, additive blending):** For each data point, render a full-screen quad. The fragment shader computes `w_i = 1 / dist^3` and outputs `(value * w_i, w_i)` to a floating-point framebuffer (RGBA32F). Additive blending accumulates the weighted sums across all points.

**Pass 2 (display):** Read the accumulated framebuffer. Compute `value = sum_weighted_value / sum_weights`. Map the value to a colour via a 1D colour ramp texture. Apply a zoom-invariant opacity falloff based on accumulated weight density.

### 10.3 Zoom-Invariant Falloff

IDW weights depend on screen-space distance, which changes with zoom level. A correction term maintains consistent visual density:

```
zoom_invariant = log2(avg_weight) + zoom * 3
fade = smoothstep(threshold - band, threshold, zoom_invariant)
```

The `+ zoom * 3` term cancels the cubic distance exponent's zoom dependency, ensuring the heatmap's visual extent remains stable across zoom levels.

### 10.4 Colour Mapping

Growth rates are mapped to colours via user-configurable colour stops. The default palette transitions from red (negative growth) through yellow (neutral) to green (positive growth). The mapping is linear between stop points:

```
t = clamp((value - color_min) / (color_max - color_min), 0, 1)
color = sample_color_ramp(t)
```

### 10.5 Rendering Constraints

The WebGL custom layer implementation observes several platform constraints:

- **NEAREST texture filtering** on RGBA32F framebuffers (LINEAR requires the `OES_texture_float_linear` extension, which silently returns zeros on unsupported hardware)
- **No vertex array objects (VAOs)** — MapLibre's internal VAO state interferes with custom layers
- **Explicit GL state management** — depth test, stencil test, and scissor test are disabled before drawing
- **Explicit FBO initialisation** — uninitialized RGBA32F textures may contain NaN; `mix(NaN, x, 1.0) = NaN` due to IEEE 754 semantics

---

## 11. Configuration Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| LOESS_BANDWIDTH | 5 years | Minimum tricube kernel half-width |
| Case weighting | w = sale_count × tricube | Inverse-variance reliability weighting per Cleveland (1979) |
| LOESS_MIN_WEIGHTED_POINTS | 3 | Minimum data points for valid local regression |
| LOESS_PRICE_MIN | $1 | Lower guard on fitted prices |
| LOESS_PRICE_MAX | $1,000,000,000 | Upper guard on fitted prices |
| LOESS_EVAL_START_QUARTER | 1990.0 | Earliest evaluation quarter |
| QUARTER_STEP | 0.25 | Evaluation grid spacing (quarterly) |
| MIN_OBSERVED_NEIGHBORS | 2 | Minimum neighbours for spatial estimation |
| IDW_POWER | 3 | Distance exponent for IDW interpolation |
| H3_RESOLUTIONS | [7, 8, 9] | Spatial index resolution levels |
| Adaptive bandwidth formula | max(5, ceil(year_range / n_years * 3)) | Per-cell bandwidth |

---

## 12. Pipeline Summary

```
Raw NSW VG .DAT files
  |
  v
ETL: Parse -> Clean -> Geocode -> Load to DuckDB
  |
  v
fact_property_sale + dim_address
  |
  v
For each (resolution, metric, strata_filter):
  |
  +-- Assign sales to H3 cells
  +-- Compute yearly medians per cell
  +-- Compute adaptive bandwidth per cell
  +-- Generate quarterly evaluation grid (1990-present)
  +-- Cross-join medians x grid with tricube weights
  +-- Solve weighted OLS at each (cell, quarter)
  +-- Cap fitted values to [earliest_sale, latest_sale]
  +-- Assemble gap-tolerant BIGINT[] array (NULLs where fit fails)
  +-- Store in agg_h3_loess_curve
  |
  v
Query time:
  |
  +-- User selects period (e.g. 2020-2025), metric, strata, resolution
  +-- Filter: earliest_sale <= start AND latest_sale >= end
  +-- Extract fitted prices at start/end from stored arrays
  +-- Compute CAGR = (end/start)^(1/years) - 1
  +-- Optional: fill adjacent empty cells via neighbour averaging
  |
  v
Rendering:
  |
  +-- IDW interpolation (GPU, multi-pass WebGL)
  +-- Colour mapping via configurable gradient stops
  +-- Multiply-blend onto basemap
```

---

## 13. Known Limitations and Methodological Considerations

The following issues have been identified through internal review. They are organised by potential impact on the reliability and interpretability of results.

### 13.1 Serious — Could Produce Misleading Results

**13.1.1 Compositional bias in the "all" strata filter (Simpson's paradox)**

When `strata_filter = 'all'`, yearly medians mix houses and apartments within each H3 cell. If the composition of sales shifts over time (e.g. increased apartment construction in 2015–2025 in a cell that was historically dominated by houses), the computed "growth rate" partially reflects the transition from house prices to apartment prices rather than genuine price appreciation. This is a classic instance of Simpson's paradox. The `freehold` and `strata` filters avoid this conflation, but the `all` filter remains susceptible to compositional shifts.

**13.1.2 Linear-space LOESS introduces heteroscedastic bias**

Property prices are roughly log-normally distributed and grow multiplicatively. In linear price space, the weighted OLS minimises absolute dollar residuals — a $1M data point in 2020 exerts approximately 10× the regression influence of a $100k point in 2000, simply because its absolute residual is larger. This biases the fitted curve toward recent high-value observations. Log-space LOESS would weight proportional residuals equally, but was rejected due to exponential extrapolation blowout at data boundaries. The heteroscedasticity cost of the linear-space approach is an accepted tradeoff.

**13.1.3 ~~No sale-count weighting on yearly medians~~ (Resolved)**

~~A year with 1 sale and a year with 50 sales contribute equally as LOESS input points.~~

**Resolved.** Each yearly median's LOESS weight is now `sale_count × tricube(distance/bandwidth)`, where `sale_count` is the number of sales that produced the median. This is the standard LOESS case weighting approach per Cleveland (1979). Years with more sales receive proportionally higher influence, correctly reflecting the lower variance of their median estimate. See Section 6.4.1.

### 13.2 Moderate — Methodologically Questionable

**13.2.1 CAGR from exactly two point estimates**

Growth is computed from two LOESS-fitted values: `fitted_prices[start]` and `fitted_prices[end]`. If either endpoint coincides with a local peak or trough in the smoothed curve, the CAGR for the entire period is distorted. This is analogous to the well-known problem of measuring investment returns from peak-to-trough versus trough-to-peak. A more robust approach would fit a log-linear trend to the full curve segment between start and end, or average over a small window around each endpoint.

**13.2.2 Adaptive bandwidth formula is ad hoc**

The formula `max(5, ceil(year_range / n_years * 3))` contains a multiplier of 3 with no statistical justification — it is an empirical tuning constant. The methodology presents it as a derived formula, but it should be understood as a heuristic. Ideally, a sensitivity analysis would demonstrate how results vary with different multiplier values.

**13.2.3 HAVING COUNT >= 3 provides near-zero degrees of freedom**

A local linear regression fits 2 parameters (slope and intercept). With exactly 3 weighted data points, there is only 1 residual degree of freedom. The fit is effectively determined by 3 observations with no capacity to assess goodness-of-fit. Standard LOESS implementations typically require a higher minimum point count relative to the polynomial degree for numerical stability.

**13.2.4 Edge bias at data range boundaries**

Capping curves at `[earliest_sale, latest_sale]` prevents extrapolation but does not address LOESS edge bias. At the boundaries, the tricube kernel has one-sided support — all contributing data lies on one side of the evaluation point. LOESS is well-known to exhibit increased bias at boundaries. Fitted values near the first and last few years of each cell's curve are less reliable than interior values, but they receive no special treatment or flagging.

**13.2.5 Price-per-sqm ambiguity for improved properties**

For freehold properties, the recorded "area" is typically the lot area, not the building floor area. A 150 sqm house on a 600 sqm lot produces a very different $/sqm than a 300 sqm house on a 300 sqm lot at the same purchase price. For strata properties, area is usually the unit's internal floor area (a more meaningful denominator). The metric's interpretation differs fundamentally by property type, but both are treated equivalently.

### 13.3 Minor — Worth Documenting

**13.3.1 Quarterly evaluation oversamples yearly input data**

The evaluation grid has 4× the resolution of the input data (quarterly versus yearly medians). Between consecutive yearly data points, the LOESS curve is pure interpolation — no new information is introduced. This quadruples storage requirements without adding analytical precision. Yearly evaluation with quarterly interpolation at query time would produce equivalent results with reduced storage.

**13.3.2 No hedonic adjustment**

The methodology does not control for property characteristics (bedrooms, land size, building age, renovations). Observed "growth" conflates genuine market appreciation with changes in the quality composition of properties sold in each cell over time. This is inherent to any median-based repeat-observation approach but should be understood when interpreting results.

**13.3.3 Geocoding coverage bias**

Properties that fail G-NAF geocoding are excluded from all spatial analysis. If geocoding success rates vary geographically (e.g. rural versus urban areas, old versus new address formats), certain regions may be systematically underrepresented in the heatmap.

**13.3.4 Screen-space IDW interpolation**

IDW weights are computed in screen pixel space rather than geographic space. At different zoom levels, the same geographic distance corresponds to different screen distances, causing the interpolation weights to change. The zoom-invariant falloff (Section 10.3) partially compensates, but the fundamental weighting structure is zoom-dependent. This means the visual pattern subtly shifts with zoom level.
