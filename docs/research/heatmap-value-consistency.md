# Research: Achieving Consistent Values Across Heatmap, Tooltip, Dialog, and Chart

## The Problem

We have four places that display growth/start/end values for a hex cell, and they can show different numbers for the same cell:

1. **Heatmap color** — driven by the ETL-precomputed growth rate
2. **Map tooltip** (hover) — shows growth, start/end values
3. **Dialog summary row** (click) — shows start/end values
4. **Dialog chart fitted line** (hover over LOESS/trend-fit curve) — shows fitted value at each year

The user's core question: *"Why can't we just select the same data and run the same algorithm so the numbers match?"*

**Answer: There is no fundamental blocker.** The divergences are implementation choices that can be aligned. This report documents exactly where each value comes from, why they diverge, and how to fix it.

---

## Architecture: What Gets Computed Where

### The Two Computation Environments

| Environment | When it runs | What it produces | Data source |
|-------------|-------------|-----------------|-------------|
| **ETL precompute** (`h3-precompute.ts`) | Offline, ~2 min for all combos | `agg_h3_growth` table with growth rates, fitted values | `fact_property_sale` + `dim_address` (full table scan, all cells at once) |
| **Client-side** (`HexDetailDialog.tsx`) | On-demand when user clicks a cell | Chart curve, summary start/end | `queryHexYearlyMedians` (single-cell query) |

### The Flow

```
ETL precompute
  └─ Scans fact_property_sale for ALL cells simultaneously
  └─ Computes yearly medians per (cell, year)
  └─ Runs LOESS / trend-fit / CAGR on those medians
  └─ Stores results in agg_h3_growth table
       │
       ├─ Heatmap color: reads growth_rate from agg_h3_growth
       ├─ Map tooltip: reads growth, loessStart/End, trendFitIntercept from agg_h3_growth
       │
       └─ Dialog (on click):
            ├─ Summary row: (varies by method, see below)
            ├─ Chart yearly medians: from queryHexYearlyMedians (re-queries fact_property_sale for ONE cell)
            └─ Chart fitted line: client-side loessAt() / exp(a+b*year) on the yearly medians
```

---

## Every Display Location and Its Data Source

### 1. Heatmap Cell Color

**Source:** `agg_h3_growth.growth_rate` (ETL precomputed)

```sql
-- Query in heatmap-queries.ts:
COALESCE(loess_growth, annualized_growth) AS growth_rate   -- for LOESS method
COALESCE(trend_fit_growth, annualized_growth) AS growth_rate -- for trend-fit method
annualized_growth AS growth_rate                             -- for endpoint method
```

This is the single source of truth for the heatmap visualization. All other displays should be consistent with this.

### 2. Map Tooltip (GrowthTooltip.tsx)

**Source:** `HeatmapDataPoint` fields from `agg_h3_growth`

| Value shown | Source | Code |
|-------------|--------|------|
| Growth % | `point.growth` | ETL `growth_rate` column |
| Start value | Method-dependent (see below) | |
| End value | Method-dependent (see below) | |
| R² | `point.trendFitR2` | ETL `trend_fit_r2` column |

**Start/end value logic (GrowthTooltip.tsx lines 41-52):**

```typescript
// Endpoint: raw 3-year window medians from ETL
displayStart = point.medianStart    // ETL median_start
displayEnd = point.medianEnd        // ETL median_end

// Trend-fit: derived from ETL intercept + growth
slope = Math.log(1 + point.growth)
displayStart = round(exp(point.trendFitIntercept + slope * startYear))
displayEnd = round(exp(point.trendFitIntercept + slope * currentYear))

// LOESS: ETL precomputed values
displayStart = point.loessStart     // ETL loess_start
displayEnd = point.loessEnd         // ETL loess_end
```

### 3. Dialog Summary Row (HexDetailDialog.tsx)

**Source:** Mixed — depends on method

| Method | Start/end source | Code location |
|--------|-----------------|---------------|
| Endpoint | `point.medianStart/End` (ETL) | Lines 339-340 |
| Trend-fit | Derived from `point.trendFitIntercept` + `point.growth` (ETL) | Lines 343-348 |
| LOESS | **Client-side `loessAt()`** on `yearlyMedians` from `queryHexYearlyMedians` | Lines 349-365 |

### 4. Dialog Chart Fitted Line (buildChartOption in HexDetailDialog.tsx)

**Source:** Client-side computation on `yearlyMedians` from `queryHexYearlyMedians`

| Method | Fitted value computation |
|--------|------------------------|
| Endpoint | `medianStart * (1 + growth)^yearsFromStart` — uses ETL `medianStart` and `growth` |
| Trend-fit | `exp(intercept + slope * year)` — uses ETL `trendFitIntercept` and `growth` |
| LOESS | `exp(loessAt(logData, year, bandwidth))` — **fully client-side** using `yearlyMedians` |

---

## Divergence Analysis

### Trend-fit: No Divergence (Already Consistent)

Trend-fit is already fully consistent because it uses a **single source of truth**: the ETL-computed `trendFitIntercept` and `growth` values. Every display location derives fitted values from these same two parameters:

```
fitted(year) = exp(intercept + log(1 + growth) * year)
```

The tooltip, dialog summary, and chart all use this same formula with the same ETL-provided inputs. No divergence possible.

### Endpoint CAGR: No Divergence (Already Consistent)

Endpoint uses `medianStart`, `medianEnd`, and `growth` directly from the ETL. The chart draws a smooth CAGR curve from `medianStart`, which by definition passes through `medianEnd` at the end year. All consistent.

### LOESS: Divergences Exist

This is where things break. LOESS has **two independent computations** that should produce the same result but may not:

#### Divergence 1: Tooltip vs Dialog/Chart

| | Tooltip | Dialog summary | Dialog chart |
|---|---------|---------------|-------------|
| **Data source** | ETL `loess_start/end` | Client-side `loessAt()` | Client-side `loessAt()` |
| **Input data** | ETL yearly medians (computed across ALL cells in one pass) | `queryHexYearlyMedians` (one cell) | Same |
| **Year range** | `[startYear - bandwidth, endYear + bandwidth]` | **All years** (no limit) | Same |
| **Quality gate** | None (recently fixed) | None | Same |

**Why they can differ:** The ETL includes yearly medians from a bounded year range, while the client query returns ALL years for the cell. If the cell has data outside the ETL's range (e.g., sales from 1995 when the lookback starts at 2011 with bandwidth 8, the ETL covers back to 2003 but the client has everything), the extra data points shift the LOESS kernel weights.

#### Divergence 2: Growth rate vs displayed start/end

The heatmap color and tooltip growth come from ETL `loess_growth`. But the dialog summary start/end come from client-side `loessAt()`. If the LOESS values differ (due to the year range issue above), then:

- Growth rate says -5.2% p.a. (from ETL)
- But the displayed start/end values imply +3.1% (from client-side)

This is the most confusing case for users.

---

## Why the Data Differs: Detailed Breakdown

### The Yearly Medians Should Be Identical...

Both the ETL and `queryHexYearlyMedians` compute:
```sql
MEDIAN(purchase_price) -- or MEDIAN(purchase_price / area) for $/sqm
GROUP BY cell, year
```

From the same tables (`fact_property_sale` JOIN `dim_address`) with the same filters (`purchase_price > 0`, `is_bulk_sale = FALSE`, `is_price_outlier = FALSE`, strata, area guards).

For a given (cell, year), the median value MUST be identical because it's the same data.

### Divergence 1 (Fixed): Year Range Bound

The ETL's LOESS CTE originally used yearly medians from a bounded year range (`BETWEEN startYear-bandwidth AND endYear+bandwidth`). The client's `queryHexYearlyMedians` returns ALL years. This was fixed by removing the year range filter from the ETL LOESS CTE entirely.

### Divergence 2 (Fixed): Median Type Precision (BIGINT Cast)

Even after fixing the year range, a **critical type precision mismatch** caused 40x discrepancies for the $/sqm metric:

| Path | SQL | Effect |
|------|-----|--------|
| **ETL** | `MEDIAN(price/area) AS median_val` (float) | Kept sub-$1 values, e.g. 0.025 |
| **Client** | `CAST(MEDIAN(price/area) AS BIGINT)` (integer) | Rounded 0.025 → 0, filtered out |

For $/sqm, if a cell has old years with a single large-lot sale (e.g. $50k on 2M sqm = $0.025/sqm), the ETL kept the fractional value. It passed `median_val > 0`, and `ln(0.025) = -3.69` massively dragged down the LOESS regression. The client's BIGINT cast rounded it to 0, which was then excluded by `medianPrice > 0`.

**Example:** Chatswood West at 25yr/$/sqm/freehold showed "Smoothed 2001: $22/sqm" in the tooltip (ETL) but ~$830/sqm on the chart LOESS curve (client) — a 40x difference caused by garbage sub-$1 $/sqm data polluting the ETL regression.

**Fix:** Added `CAST(MEDIAN(...) AS BIGINT)` to the ETL LOESS `yearly_medians` CTE, making it type-identical to the client query. Sub-$1 $/sqm values now round to 0 and get filtered by `median_val > 0` in the weighted CTE.

---

## Quality Gates: What Gets Culled and Where

### ETL Quality Gates

| Gate | Where applied | What it does | Effect |
|------|--------------|-------------|--------|
| `HAVING COUNT(*) >= minSales[resolution]` | Endpoint start/end windows | Requires 7/4/2 sales in each 3-year window | Cells with too few sales in either window get no row at all |
| `HAVING COUNT(*) >= 2` | **Trend-fit** yearly_medians | Excludes yearly medians based on 1 sale | Single-sale years don't participate in regression |
| `HAVING COUNT(DISTINCT yr) >= 4` | Trend-fit slopes | Requires 4+ qualifying years | Cells with sparse history get NULL trend-fit |
| (none) | **LOESS** yearly_medians | All yearly medians included | Single-sale years participate (kernel handles noise) |
| `HAVING COUNT(*) >= 3` | LOESS agg (per eval point) | Requires 3+ weighted points | Eval points with very sparse data get NULL |

### Client Quality Gates

| Gate | Where applied | What it does |
|------|--------------|-------------|
| `m.medianPrice > 0` | Dialog chart LOESS | Excludes years with zero/negative median |
| `logData.length >= 3` | Dialog chart LOESS | Requires 3+ total data points |
| None | `queryHexYearlyMedians` | ALL yearly medians returned, even single-sale |

### The Visibility Problem

The chart shows ALL yearly medians as data points (blue dots), including single-sale years. But for trend-fit, those single-sale years were **excluded from the regression**. The user sees a data point at 2024 with $12,253/sqm (1 sale) but the trend line doesn't pass through it — and has no way to know why.

**Recommendation:** Show culled data points differently on the chart. Either:
- Render single-sale medians as hollow/smaller dots
- Add a "(1 sale)" annotation in the chart tooltip
- Show a separate "used in fit" series vs "excluded" series

The `saleCount` field is already returned by `queryHexYearlyMedians`, so this is purely a rendering change.

---

## Recommendations: How to Achieve Perfect Consistency

### Option A: Make ETL Match the Client (Recommended)

The simplest path to consistency: make the ETL LOESS use the same data the client uses.

**Change:** Remove the year range filter from the ETL LOESS CTE entirely. Let all available yearly medians participate, just like the client does.

```sql
-- Current (bounded):
BETWEEN ${startYear - loessBandwidth} AND ${endYearTo + loessBandwidth}

-- Proposed (unbounded, same as client):
-- Remove this line entirely. Just use all available data.
```

**Trade-off:** Slightly more data to scan per cell in the ETL, but the H3+year grouping makes it negligible. The bandwidth-based filter in the `weighted` CTE already ensures only relevant years affect each eval point.

After this change:
- ETL yearly medians = client yearly medians (identical data)
- ETL LOESS algorithm = client `loessAt()` algorithm (same weighted OLS formula)
- ETL `loess_start/end` ≈ client `loessAt()` at start/end years (should match exactly)

### Option B: Derive ALL Displayed Values from ETL (Alternative)

Instead of client-side computation, have the tooltip and dialog both use ETL values exclusively.

**Problem:** The dialog chart draws a continuous LOESS curve at every year using `loessAt()`. We can't precompute the entire curve in the ETL (that would mean storing fitted values for ~25 years per cell). So the chart curve will always be client-side.

This means the dialog chart and summary row would use different sources (client vs ETL), reintroducing the divergence.

**Verdict:** Option A is better — make the inputs identical so both computations agree.

### Option C: Client-Side Everything (Expensive)

Compute LOESS start/end/growth entirely client-side by fetching yearly medians for every visible cell.

**Problem:** With 10k+ cells visible on the map, this would require 10k+ database queries just to render the heatmap. The entire point of ETL precomputation is to avoid this.

**Verdict:** Not viable for the heatmap. The ETL is necessary for the map-level view.

### The Hybrid Reality

The practical architecture is always:
- **Heatmap + tooltip:** ETL precomputed values (fast, 50ms query)
- **Dialog chart + summary:** Client-side computation for the ONE clicked cell (200ms query)

The goal is to make these produce the same numbers. Option A achieves this by ensuring both start from the same yearly medians.

---

## Remaining Gap After Option A: The Tooltip

Even with Option A, there's still one inconsistency:

- **Tooltip** shows `point.loessStart`/`point.loessEnd` (ETL values)
- **Dialog summary** computes `loessAt()` client-side
- **Dialog chart** computes `loessAt()` client-side

If Option A makes the ETL and client use identical data, these should match. But there's a subtle difference: the ETL computes `MEDIAN(price)` across all sales in one SQL pass, while `queryHexYearlyMedians` computes `MEDIAN(price)` for a single cell. The SQL `MEDIAN()` function is deterministic for a given set of values, so these MUST be identical.

**One edge case:** Rounding. The ETL stores `ROUND(loess_val)::BIGINT`. The client stores `Math.round(Math.exp(loessAt(...)))`. These should agree to within $1 due to floating-point differences.

**Bottom line:** With Option A implemented, the tooltip and dialog should show the same values (within $1 rounding).

---

## Summary of Current State vs Desired State

### Current State (After Both Fixes)

```
Heatmap color  ──── ETL loess_growth (year range: ALL years, BIGINT medians)
Tooltip        ──── ETL loess_start/end (year range: ALL years, BIGINT medians)
Dialog summary ──── Client loessAt() on queryHexYearlyMedians (year range: ALL years, BIGINT medians)
Dialog chart   ──── Client loessAt() on queryHexYearlyMedians (year range: ALL years, BIGINT medians)
```

Same data (all years, same type) → same algorithm → same results everywhere.

### Implementation (Both Applied)

**Two changes in `scripts/src/heatmap/h3-precompute.ts`:**

1. **Removed year range filter** from the LOESS `yearly_medians` CTE (no `BETWEEN` on contract_date year).

2. **Added `CAST(MEDIAN(...) AS BIGINT)`** to the LOESS `yearly_medians` CTE, matching the client's `queryHexYearlyMedians` type precision.

Both changes applied, heatmap rebuilt. The trend-fit CTE is unchanged — it keeps its own year range and quality gates, with consistency guaranteed by using the intercept as the single source of truth.
