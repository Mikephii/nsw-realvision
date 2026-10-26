# Heatmap LOESS — Precomputed Curve Architecture

## Single-Implementation Architecture

LOESS is now a **single-implementation** system. The ETL precomputes full quarterly LOESS curves and stores them in `agg_h3_loess_curve`. All consumers (heatmap widget, hex detail dialog, tooltip) read from this single source — there is no client-side LOESS evaluation.

| Concern | Location |
|---------|----------|
| LOESS kernel & regression | `scripts/src/heatmap/loess-curve-precompute.ts` (ETL only) |
| Weight math reference impl | `scripts/src/heatmap/loess-math.ts` (pure TS, for testing) |
| Algorithm constants | `scripts/src/heatmap/loess-config.ts` (single source of truth) |
| Table schema | `scripts/src/heatmap/schema.ts` (`agg_h3_loess_curve` DDL) |
| Heatmap query (growth at arbitrary period) | `webapp/src/lib/heatmap-queries.ts:queryLoessHeatmapData()` |
| Full curve fetch (hex detail dialog) | `webapp/src/lib/heatmap-queries.ts:queryLoessCurve()` |
| Server functions | `webapp/src/lib/server-fns.ts` (`getLoessHeatmapData`, `getLoessCurve`) |
| Validation schemas | `webapp/src/lib/validation.ts` (`LoessHeatmapRequestSchema`, `LoessCurveRequestSchema`) |

## Key Concepts

### Stored Curve Format

Each row in `agg_h3_loess_curve` stores a `fitted_prices BIGINT[]` array — one slot per quarter from `min_quarter` to `max_quarter`. The array spans the cell's full data range `[earliest_sale, latest_sale]` and may contain NULLs at positions where the LOESS fit failed (insufficient kernel support due to data gaps wider than the bandwidth window). Query-time consumers check for non-NULL at their specific endpoints before computing CAGR.

### Array Indexing

DuckDB `list_extract` is **1-indexed**:
```sql
list_extract(fitted_prices, CAST((target_quarter - min_quarter) / 0.25 + 1 AS INT))
```

TypeScript (0-indexed):
```typescript
const idx = Math.round((year - loessCurve.minQuarter) / 0.25)
const price = loessCurve.fittedPrices[idx]
```

### Growth Computation (Query-Time)

CAGR between any two quarters is computed at query time from the stored array:
```sql
POWER(
  list_extract(fitted_prices, end_idx)::DOUBLE
  / NULLIF(list_extract(fitted_prices, start_idx)::DOUBLE, 0),
  1.0 / (end_quarter - start_quarter)
) - 1
```

### Canonical Constants

All LOESS parameters live in `scripts/src/heatmap/loess-config.ts`:
- `LOESS_BANDWIDTH = 5` (years)
- `LOESS_MIN_WEIGHTED_POINTS = 3`
- `LOESS_PRICE_MIN = 1`, `LOESS_PRICE_MAX = 1_000_000_000`
- `QUARTER_STEP = 0.25`

Changing any value requires re-running the ETL (`pnpm etl recompute-loess`).

### Weight Formula

Total weight = `sale_count × tricube(|distance| / bandwidth)`.

Case weighting per Cleveland (1979): yearly medians from more sales
receive proportionally higher influence, reflecting lower variance of
the median estimate (inverse-variance weighting, Gauss-Markov BLUE).

Reference implementation: `scripts/src/heatmap/loess-math.ts`

## Historical Bugs (Lessons Learned)

### Bug 1: Year Range Filtering Mismatch (Pre-Curve Era)
The old ETL bounded yearly medians to a windowed year range, while the client query returned all years. Extra distant-year data shifted kernel weights, causing visible divergence between heatmap tiles and dialog curves. **Lesson:** The tricube kernel already handles distance decay — explicit range filters are redundant and create divergence surfaces. The precomputed curve architecture eliminates this class of bug entirely.

### Bug 2: BIGINT Cast Precision ($/sqm metric)
The old ETL kept `MEDIAN(price/area)` as float while the client cast to BIGINT. Sub-$1 medians survived in the ETL but became 0 in the client. **Lesson:** Type precision of intermediate values matters. The precomputed curve applies `CAST(MEDIAN(...) AS BIGINT)` once in the ETL, and all consumers read the same stored values.

## Before You Change LOESS — Checklist

1. Read `scripts/src/heatmap/loess-config.ts` — all algorithm constants.
2. Read `scripts/src/heatmap/loess-curve-precompute.ts` — the ETL pipeline.
3. Read `scripts/src/heatmap/schema.ts` — the `agg_h3_loess_curve` table DDL.
4. If changing query-time array indexing, check `webapp/src/lib/heatmap-queries.ts:queryLoessHeatmapData()` and `webapp/tests/lib/loess-query-math.test.ts`.
5. After ETL changes, rebuild: `cd scripts && pnpm etl recompute-loess`.
