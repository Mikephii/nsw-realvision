# Growth Heatmap Widget — Feasibility Study

**Date:** 2026-02-25
**Status:** Research / Pre-implementation

## 1. Problem Statement

We want a map-based widget that shows **annualized property price growth** across all of NSW, visible at state level and interactive when zooming in. The user should be able to:

- Toggle time windows: past 5, 10, 15, 20, 25 years
- Switch between total price growth and price-per-sqm growth
- Filter by freehold vs strata
- See growth rates colored on the map (green = high growth, red = low/negative)
- Zoom into specific areas for more granular data

This is fundamentally different from our existing map widget (which plots individual sale points for a filtered set of suburbs). A growth heatmap requires:

1. **Pre-aggregated data** — individual points don't carry growth information; growth is a derived metric across time
2. **Geographic boundaries** — growth must be aggregated to some spatial unit (suburb, postcode, hexagon)
3. **Full NSW coverage** — not filtered to selected suburbs; the entire state is rendered at once
4. **Performant rendering** — potentially thousands of geographic regions colored and rendered simultaneously

## 2. Data Inventory

### What we have

| Asset | Details |
|-------|---------|
| `fact_property_sale` | All NSW property sales (1990-2025). Columns include `purchase_price`, `contract_date`, `locality`, `area`, `area_type`, `strata`, `property_id` |
| `dim_address` | Geocoded property addresses with `latitude`, `longitude`, `geocode_confidence` (high/medium/low), `geocode_source` (gnaf_exact/gnaf_fuzzy/locality_centroid) |
| DuckDB spatial extension | Loaded on every connection. Supports `ST_Within`, `ST_Point`, `ST_GeomFromText` |
| MapLibre GL JS | Already in use for PropertyMap widget. Supports `heatmap`, `fill`, `circle`, `symbol` layer types natively |
| `PropertyFilter` | Existing filter infrastructure with `strataFilter`, date ranges, price ranges, spatial filters |

### What we don't have

| Gap | Impact |
|-----|--------|
| **Suburb boundary polygons** | Needed for choropleth rendering. Not currently in the database. Must be sourced externally (ABS, data.gov.au) |
| **Pre-aggregated growth tables** | All queries currently compute on-the-fly. A full NSW growth scan may be too slow without materialization |
| **Vector tile infrastructure** | Current map uses raster tile basemaps only. No vector tile server (Martin, Tileserver GL) for custom polygon layers |
| **H3 extension** | DuckDB has a community H3 extension but it's not installed. Would be needed for hexagonal approach |

### Data volume (estimated)

- Database size: ~1.3 GB
- Sales records: likely 2-5 million rows spanning 35 years
- Geocoded addresses: subset of all properties (coverage % unknown — needs a query)
- NSW suburbs: ~2,500 (ABS 2021 boundaries)
- NSW postcodes: ~600

## 3. Approaches

### Approach A: Suburb-Level Choropleth (Recommended MVP)

**How it works:**
1. Pre-aggregate median price per suburb for the start and end of the selected time window
2. Calculate annualized growth rate per suburb
3. Render suburb polygons on the map colored by growth rate
4. Use MapLibre `fill` layer with data-driven color expressions

**Data flow:**
```
DuckDB query:
  SELECT locality,
         MEDIAN(price) FILTER (year BETWEEN start AND start+2) AS price_start,
         MEDIAN(price) FILTER (year BETWEEN end-2 AND end) AS price_end,
         COUNT(*) as sale_count
  FROM fact_property_sale
  GROUP BY locality
  → Calculate: annualized_growth = (price_end/price_start)^(1/years) - 1
  → Filter: sale_count >= 30 for statistical validity

Frontend:
  → Receive ~2,500 suburb records with growth rates
  → Join to suburb boundary GeoJSON
  → Render as MapLibre fill layer
  → Color: green (high growth) → yellow (moderate) → red (negative)
```

**Performance estimate:**
- Query: <2s (single GROUP BY locality scan)
- Transfer: ~50KB (suburb names + growth values, no geometry)
- Render: instant (suburb polygons loaded once as static GeoJSON or vector tiles)

**Pros:**
- Aligns with industry practice (CoreLogic, Domain, REA all use suburb choropleth)
- Geographically meaningful to users (people think in suburbs)
- Excellent rendering performance (~2,500 polygons is trivial for MapLibre)
- Simple growth calculation (suburb-level median comparison)
- Works with existing DuckDB infrastructure — no new extensions needed
- Dynamic filtering is fast — just re-query and re-color existing polygons

**Cons:**
- Requires external suburb boundary data (one-time setup)
- No intra-suburb variation visible (entire suburb is one color)
- Suburb boundaries change over time (council mergers)
- Some suburbs may have too few sales for reliable growth rates

**Verdict: Build this first.**

---

### Approach B: H3 Hexagonal Grid (Phase 2 Enhancement)

**How it works:**
1. Install DuckDB H3 extension
2. Index all geocoded properties to H3 cells at resolution 7 (~1.4km edge, ~5 sqkm area)
3. Aggregate growth metrics per hexagon
4. Render hexagons as MapLibre `fill` layer polygons
5. At lower zoom levels, aggregate to coarser H3 resolutions (res 5 → res 4)

**Data flow:**
```
DuckDB:
  SELECT H3_LATLNG_TO_CELL(da.latitude, da.longitude, 7) AS h3_cell,
         MEDIAN(price) FILTER (...) AS price_start,
         MEDIAN(price) FILTER (...) AS price_end,
         COUNT(*)
  FROM fact_property_sale fps
  JOIN dim_address da ON ...
  GROUP BY h3_cell
  → Calculate annualized growth per hexagon

Frontend:
  → Receive hexagon IDs + growth values
  → Convert H3 IDs to polygon boundaries (h3-js library, client-side)
  → Render as MapLibre fill layer
  → Multi-resolution: coarser hexagons at lower zoom
```

**Performance estimate:**
- Query: 2-5s (JOIN to dim_address + H3 computation on all rows)
- Transfer: ~100-500KB depending on zoom resolution
- Render: good (thousands of hexagons at res 7, hundreds at res 5)

**Pros:**
- Shows intra-suburb variation (find hot micro-markets)
- Consistent geometry (no political boundary changes)
- Hierarchical zoom (drill through H3 resolutions)
- Mathematically cleaner than arbitrary suburb shapes

**Cons:**
- Less intuitive to users (hexagons vs familiar suburb names)
- Requires H3 extension installation in DuckDB
- Requires `h3-js` client-side library for hexagon polygon generation
- Needs geocoded addresses (dim_address JOIN required)
- More complex query with potential performance impact

**Verdict: Worth building after suburb choropleth is proven. Could offer as a "precision mode" toggle.**

---

### Approach C: Point-Based MapLibre Heatmap Layer (Not Recommended)

**How it works:**
1. Query individual property sales with lat/lon
2. Calculate per-property growth (requires repeat sales matching)
3. Send points to MapLibre `heatmap` layer with `heatmap-weight` = growth rate
4. MapLibre renders kernel density estimation on the GPU

**Why this doesn't work for our use case:**
- MapLibre heatmap layers are designed for **density visualization**, not for showing a **derived metric** like growth rate. The "heat" represents point concentration, not a property value.
- Growth rate is **not a per-point property** — it's derived from comparing prices across time. You'd need repeat-sales matching first, which is a complex ETL step.
- **50,000 point limit** for acceptable GeoJSON performance. NSW has millions of sales.
- Would require pre-filtering to a small area, defeating the "full NSW at a glance" goal.
- The visual result would be misleading — areas with more sales look "hotter" regardless of growth rate.

**Verdict: Not suitable. Use fill layers (choropleth or hexagons) instead.**

## 4. Growth Calculation Methodology

### Annualized Growth Rate Formula

```
annualized_growth = (price_end / price_start) ^ (1 / years) - 1
```

For a 15-year window ending 2025:
- `price_start` = median price in 2010-2012 (3-year window for smoothing)
- `price_end` = median price in 2023-2025 (3-year window for smoothing)
- `years` = 15
- Result: e.g., 0.065 = 6.5% annualized growth

### Two approaches to calculating suburb-level growth

**A. Volume-weighted median comparison (simpler, recommended for MVP):**
```sql
SELECT
  locality,
  CAST(MEDIAN(purchase_price)
    FILTER (WHERE EXTRACT(YEAR FROM contract_date) BETWEEN ? AND ?) AS BIGINT) AS price_start,
  CAST(MEDIAN(purchase_price)
    FILTER (WHERE EXTRACT(YEAR FROM contract_date) BETWEEN ? AND ?) AS BIGINT) AS price_end,
  COUNT(*) AS total_sales
FROM fact_property_sale
WHERE purchase_price > 0 AND contract_date IS NOT NULL
GROUP BY locality
HAVING price_start > 0 AND price_end > 0
```

- Uses 3-year windows at start and end to smooth out single-year anomalies
- Simple, fast, uses existing query patterns
- Weakness: composition bias — if the mix of property types changes (e.g., more apartments built), median shifts without "real" growth

**B. Repeat-sales index (industry standard, more complex):**
- Match properties that sold at least twice (same `property_id`)
- Calculate individual property growth rates
- Aggregate to suburb level
- Eliminates composition bias
- Requires ETL step to identify repeat sales
- Much more complex to implement

**Recommendation:** Start with volume-weighted median (Approach A). Add repeat-sales as a future enhancement.

### Minimum sample thresholds

Following REA/CoreLogic industry practice:
- **Minimum 30 sales** in each time window (start + end) for a suburb to be included
- Suburbs below threshold shown as gray / "insufficient data"
- This prevents volatile results from low-activity suburbs

### Price-per-sqm growth variant

Same methodology but using `MEDIAN(purchase_price / normalized_area)` instead of `MEDIAN(purchase_price)`. Requires the area filter: `area > 0 AND area_type IN ('M', 'H')`, with hectare normalization (`area * 10000` when `area_type = 'H'`). This is the same pattern already implemented in `queryMedianPriceSqmTimeSeries`.

## 5. Performance Analysis

### DuckDB query performance

| Operation | Estimated Time | Notes |
|-----------|---------------|-------|
| Full scan GROUP BY locality | <2s | DuckDB excels at columnar aggregation. ~2-5M rows, single GROUP BY |
| With strata filter | <2s | Simple WHERE clause addition |
| With area normalization (price/sqm) | <3s | Extra arithmetic per row, plus area > 0 filter |
| H3 cell computation (if used) | 3-5s | Requires JOIN to dim_address + H3 function per row |

These are estimates based on DuckDB benchmarks showing 100M row aggregations in ~1 minute. Our dataset is much smaller.

### MapLibre rendering performance

| Layer type | Feature count | Expected FPS |
|------------|--------------|-------------|
| `fill` (suburb polygons) | ~2,500 | 60fps |
| `fill` (H3 res 7 hexagons) | ~5,000-10,000 | 60fps |
| `fill` (H3 res 5 hexagons) | ~500-1,000 | 60fps |
| `heatmap` (points) | 50,000 max | 30-60fps |
| `circle` (individual points) | 50,000 | 30fps with clustering |

Suburb choropleth is well within MapLibre's comfort zone.

### Data transfer

| Approach | Payload size | Notes |
|----------|-------------|-------|
| Suburb growth values (no geometry) | ~50KB | ~2,500 rows x 20 bytes |
| Suburb boundary GeoJSON (simplified) | ~5-15MB | One-time load, cacheable |
| Suburb boundary vector tiles | ~500KB per viewport | Streamed on demand |
| H3 hexagons (computed client-side) | ~200KB | h3-js generates polygons from cell IDs |

### Caching strategy

The growth heatmap is an excellent candidate for aggressive caching:
- Growth rates over 15+ years don't change frequently
- Cache invalidation only needed when new sales data is loaded (weekly at most)
- Could pre-compute and store results in a materialized table
- Client-side: cache the growth data with a long stale time (1 hour+)

## 6. Widget Config Requirements

```typescript
interface GrowthHeatmapConfig {
  /** Time window for growth calculation */
  yearsBack: 5 | 10 | 15 | 20 | 25

  /** Which metric to display */
  metric: 'median-price' | 'price-per-sqm'

  /** Freehold/strata segmentation */
  strataFilter?: StrataFilter

  /** Aggregation level (future: 'h3' option) */
  aggregation: 'suburb'

  /** Minimum sales threshold per suburb */
  minSales: number  // default 30
}
```

**Settings panel controls:**
- **Time Window**: Select dropdown (5 / 10 / 15 / 20 / 25 years)
- **Metric**: Select dropdown (Median Price Growth / Price per sqm Growth)
- **Property Type**: PropertyTypeFilter (shared component, All / Freehold / Strata)
- **Min Sales**: number input or slider (default 30)

**Tags for title bar:**
- Strata/Freehold tag (same as other widgets)
- Time window tag: e.g., "15yr"
- Metric tag: e.g., "$/sqm"

## 7. Implementation Roadmap

### Phase 1: MVP — Suburb Choropleth (estimated effort: medium)

1. **Source suburb boundary data**
   - Download NSW suburb/locality boundaries from data.gov.au (ABS ASGS or NSW Spatial Services)
   - Simplify geometry with mapshaper to reduce file size (~5MB target)
   - Store as static GeoJSON asset in the webapp, or load into DuckDB as a reference table

2. **Build growth query**
   - New `queryGrowthHeatmap()` in `queries.ts`
   - Parameters: `yearsBack`, `metric`, `strataFilter`, `minSales`
   - Returns: `{ locality: string; growth: number; priceStart: number; priceEnd: number; saleCount: number }[]`

3. **Build server function**
   - `getGrowthHeatmap` in `server-fns.ts`

4. **Build widget**
   - New `growth-heatmap/` directory with definition, chart component, settings panel
   - Map renders suburb polygons colored by growth rate
   - Legend showing color scale (e.g., -5% to +15% annualized)
   - Click on suburb shows detail popup (growth rate, sale count, price range)

5. **Wire up config**
   - Time window toggle, metric select, strata filter, min sales threshold
   - Tags in title bar

### Phase 2: Polish and Performance

- Add materialized/cached growth table refreshed on ETL load
- Add zoom-dependent suburb labels
- Add tooltip on hover (suburb name + growth %)
- Add option to filter by postcode or district
- Consider vector tiles if GeoJSON size is a bottleneck

### Phase 3: H3 Hexagonal Mode (future)

- Install DuckDB H3 extension
- Add `h3-js` to webapp dependencies
- Build H3-aggregated query variant
- Add toggle between suburb and hexagon views
- Multi-resolution H3 based on zoom level

## 8. Suburb Boundary Data Sources

| Source | Format | Coverage | Notes |
|--------|--------|----------|-------|
| **ABS ASGS Suburbs/Localities (SAL)** | GeoJSON, Shapefile | All of Australia | Official ABS boundaries. Updated each census. ~2,500 suburbs in NSW. Available from abs.gov.au |
| **NSW Spatial Services** | GeoJSON, Shapefile | NSW only | State government authoritative boundaries. data.nsw.gov.au |
| **data.gov.au** | Various | National | Aggregator for government open data. Search "suburb boundaries NSW" |
| **OpenStreetMap** | PBF, GeoJSON | Global | Community-maintained. May differ from official boundaries |

**Recommendation:** Use ABS ASGS SAL (Suburb and Locality) boundaries. These are the official statistical boundaries, free to use under Creative Commons, and match the `locality` field in our sales data. Download once, simplify with mapshaper (`-simplify 15%`), and bundle as a static asset.

**Geometry simplification target:**
- Raw: ~90MB GeoJSON for all NSW suburbs
- Simplified (15%): ~5-10MB
- Further simplified for zoom <10: ~2MB
- As vector tiles: ~500KB per viewport

## 9. Open Questions

1. **Geocoding coverage** — What percentage of properties in `dim_address` have valid coordinates? Run: `SELECT COUNT(*) FILTER (WHERE latitude IS NOT NULL) * 100.0 / COUNT(*) FROM dim_address`. This affects whether the H3 approach is viable.

2. **Locality name matching** — Do our `locality` values in `fact_property_sale` match ABS suburb names exactly? If not, we need a mapping table. Historical data may use outdated suburb names.

3. **Boundary version** — Which ABS census year's boundaries should we use? 2021 is current but older sales used older boundaries. For MVP, using 2021 boundaries for all years is acceptable.

4. **GeoJSON delivery** — Bundle as a static asset in the webapp build (simple, adds ~5-10MB to bundle) or serve dynamically (more complex, better for large files)?

5. **Materialization strategy** — Pre-compute growth rates on ETL load (fastest query time, stale until next load) or compute on-demand (always fresh, slower)?

6. **Color scale** — Linear or quantile? Linear shows true distribution but most suburbs cluster in a narrow band. Quantile ensures visual spread but distorts magnitude differences. Consider: diverging scale centered on 0% with fixed breakpoints.

7. **Per-sqm growth data coverage** — Many older sales may not have area data. Need to check: `SELECT EXTRACT(YEAR FROM contract_date) AS yr, COUNT(*) FILTER (WHERE area > 0) * 100.0 / COUNT(*) AS pct FROM fact_property_sale GROUP BY yr ORDER BY yr`. If pre-2005 area coverage is poor, $/sqm growth may only be reliable for shorter time windows.
