# Custom Map Areas — Feasibility Research

## Overview

This document investigates whether users can draw arbitrary polygons on the property map, save them as named "custom areas", and use them to query and aggregate property sales data. The core use case: draw an area that crosses suburb boundaries, name it "My Area", then select it in widgets like the median price chart to see trends for just the properties inside that polygon.

This requires solving four problems:

1. **Drawing** — How does the user draw a polygon on a MapLibre map?
2. **Representation & Storage** — How do we represent and persist the polygon?
3. **Spatial Querying** — How do we efficiently find which properties fall inside the polygon?
4. **Aggregation** — How do we plug spatial filters into our existing query pipeline?

---

## 1. Drawing Polygons on Maps

### The Problem

Our property map uses MapLibre GL JS (via `react-map-gl/maplibre`). We need to let users click a sequence of points on the map to define a closed polygon, preview it as they draw, and capture the result as a coordinate array.

### Library: Terra-Draw

**Terra-Draw** is the drawing library recommended by the MapLibre project itself (it replaced the deprecated `mapbox-gl-draw`). It's renderer-agnostic — the core library handles drawing logic, and adapter packages connect it to specific map renderers.

| Property | Detail |
|---|---|
| Package | `terra-draw` + `terra-draw-maplibre-gl-adapter` |
| License | MIT |
| Bundle size | ~30KB gzipped (core + adapter) |
| API style | Imperative — construct a `TerraDraw` instance, call `.start()`, `.stop()`, `.setMode()` |
| Output | GeoJSON Features (Polygon, LineString, Point) via `.getSnapshot()` |

#### How Drawing Works

Terra-Draw registers event listeners on the map canvas for mouse/touch input. When the user enters polygon mode:

1. Each click adds a vertex to the in-progress polygon
2. Terra-Draw renders the partial polygon as a filled/stroked overlay in real time
3. Double-click (or clicking the first vertex) closes the polygon
4. The completed polygon is emitted as a GeoJSON Feature via a `finish` event

```typescript
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

const draw = new TerraDraw({
  adapter: new TerraDrawMapLibreGLAdapter({ map, lib: maplibregl }),
  modes: [
    new TerraDrawPolygonMode(),
    new TerraDrawSelectMode({ flags: { polygon: { draggable: true } } }),
  ],
})

draw.start()
draw.setMode('polygon')

draw.on('finish', (id) => {
  const snapshot = draw.getSnapshot()
  const feature = snapshot.find((f) => f.id === id)
  // feature.geometry = { type: 'Polygon', coordinates: [[[lon, lat], ...]] }
})
```

#### MapLibre Integration

The adapter hooks into MapLibre's `addSource`/`addLayer` API — exactly the same imperative approach we already use for property dots. Terra-Draw creates its own source and layers for the drawing overlay, so there's no conflict with our existing `properties` source. The adapter handles:

- Coordinate projection (screen pixels to lng/lat)
- Rendering the in-progress polygon as a MapLibre fill+line layer
- Cursor changes during drawing
- Touch support on mobile

#### Alternative: Manual Drawing

We could implement drawing ourselves using MapLibre's mouse events (`map.on('click', ...)`) and maintain our own coordinate array. This avoids a dependency but requires reimplementing:

- Vertex snapping (closing the polygon when clicking near the first point)
- Undo (removing the last vertex)
- Real-time preview rendering
- Touch/mobile support
- Edit mode (dragging vertices after creation)

Terra-Draw handles all of this out of the box. The dependency cost (~30KB) is justified.

### Feasibility: Drawing

**Fully feasible.** Terra-Draw is purpose-built for this, actively maintained, MIT licensed, and has a dedicated MapLibre adapter. Our existing imperative layer management approach is compatible. The main integration work is UI: adding a toolbar button, managing draw mode state, and showing a save dialog when drawing completes.

---

## 2. Representing & Storing Areas

### Polygon Representation: GeoJSON

The standard representation for geographic shapes on the web is GeoJSON (RFC 7946). A polygon is:

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [151.2093, -33.8688],
      [151.2150, -33.8700],
      [151.2120, -33.8750],
      [151.2060, -33.8720],
      [151.2093, -33.8688]
    ]
  ]
}
```

Key properties:
- Coordinates are `[longitude, latitude]` (note: longitude first, per GeoJSON spec)
- The outer ring is an array of coordinate pairs
- The first and last coordinate must be identical (closed ring)
- Coordinates wind counter-clockwise for the exterior ring
- Supports holes via additional rings (unlikely needed for our use case)

GeoJSON is the natural choice because:
1. Terra-Draw outputs GeoJSON
2. MapLibre renders GeoJSON natively
3. DuckDB's spatial extension can parse GeoJSON via `ST_GeomFromGeoJSON()`
4. It's the universal interchange format for geospatial data

#### Alternative Representations

| Format | Pros | Cons |
|---|---|---|
| **GeoJSON** | Universal, native to Terra-Draw/MapLibre/DuckDB | Verbose for complex polygons |
| **WKT (Well-Known Text)** | Compact text, `POLYGON((lon lat, ...))` | Need conversion for MapLibre rendering |
| **WKB (Well-Known Binary)** | Most compact, fastest to parse | Not human-readable, complex to work with in JS |
| **Coordinate array** | Minimal, just `number[][]` | Loses type information, need to reconstruct for each consumer |

**Recommendation:** Store as GeoJSON (the canonical format), convert to WKT only at the query boundary when passing to DuckDB's `ST_GeomFromText()`.

### Storage: Zustand + localStorage

Custom areas are a user-level resource shared across all widgets. They should persist across page refreshes and be available to any widget's settings panel.

Our existing pattern for this is Zustand with `persist` middleware (same as the widget store). The store would hold:

```typescript
interface CustomArea {
  id: string                // nanoid — unique identifier
  name: string              // user-given name, e.g. "My Area"
  polygon: GeoJSON.Polygon  // the polygon geometry
  color: string             // hex color for map rendering
  createdAt: number         // unix timestamp
}
```

#### Storage Size Considerations

A typical hand-drawn polygon has 5-20 vertices. Each vertex is two floats (~20 chars as JSON). A 20-vertex polygon serialises to ~600 bytes. Even with 100 saved areas, that's ~60KB in localStorage — well within the 5-10MB browser limit.

#### Alternative: IndexedDB

For very large numbers of areas or complex polygons (hundreds of vertices), IndexedDB would be more appropriate. But for the expected use case (tens of areas with simple polygons), localStorage via Zustand persist is simpler and consistent with our existing patterns.

#### Alternative: Server-Side Storage

Storing areas in DuckDB or a separate database would enable sharing between users or devices. This adds complexity (API endpoints, auth) and isn't needed for the single-user local-first architecture. Could be added later if we introduce user accounts.

### Feasibility: Storage

**Fully feasible.** GeoJSON + Zustand/localStorage is a proven pattern, consistent with our existing architecture, and handles the expected data volumes with no issues.

---

## 3. Spatial Acceleration — Finding Points Inside a Polygon

### The Core Problem: Point-in-Polygon

Given a polygon with N vertices and a set of M points (property addresses with lat/lon), determine which points fall inside the polygon. This is the classic **point-in-polygon** (PIP) problem from computational geometry.

### The Ray Casting Algorithm

The standard PIP algorithm is **ray casting** (also called the Jordan curve theorem method):

1. Cast a ray from the test point in any direction (typically along the positive x-axis)
2. Count how many times the ray crosses the polygon's edges
3. If the count is odd, the point is inside; if even, it's outside

Time complexity: **O(N)** per point, where N is the number of polygon edges. For a 20-vertex polygon, this is 20 comparisons per point — trivially fast for a single check.

The challenge is scale: with ~3.3 million addresses in `dim_address`, a naive approach would perform 3.3M ray-casting checks. At ~20 edge comparisons each, that's 66 million comparisons. While modern CPUs handle this in seconds, we can do much better.

### Acceleration Strategy 1: Bounding Box Pre-Filter

The simplest and most effective acceleration is a **bounding box (AABB) pre-filter**:

1. Compute the axis-aligned bounding box of the polygon: `minLat, maxLat, minLon, maxLon`
2. First query: `WHERE latitude BETWEEN minLat AND maxLat AND longitude BETWEEN minLon AND maxLon`
3. This uses B-tree indexes on the lat/lon columns — an O(log M) index lookup
4. Only the surviving points (those inside the bounding box) go through the exact PIP test

**Effectiveness:** For a typical suburb-sized polygon, the bounding box might cover ~0.01 of NSW's total area. With 3.3M addresses, the bbox filter reduces candidates to roughly 30,000-50,000 points. The subsequent PIP checks on 50K points take microseconds.

This is the approach DuckDB's spatial extension uses internally, and we can make it explicit in our queries for maximum performance.

### Acceleration Strategy 2: R-Tree Index

An **R-tree** is a spatial index that organises points (or rectangles) into a hierarchy of bounding boxes. Querying "which points fall inside this rectangle?" is O(log M + k) where k is the number of results.

DuckDB's spatial extension supports R-tree indexes:

```sql
CREATE INDEX idx_address_spatial ON dim_address USING RTREE (longitude, latitude);
```

With an R-tree, the bounding box pre-filter becomes an index-assisted operation rather than a full table scan with a range condition. For our dataset size (~3.3M rows), the practical difference between a B-tree range scan and an R-tree is small — both prune to the same candidate set. R-trees become more valuable at tens of millions of rows or for complex spatial queries (e.g., nearest-neighbour).

**Recommendation:** Start with the B-tree BETWEEN approach (we already have indexes on lat/lon). Add an R-tree index only if benchmarking shows it's needed.

### Acceleration Strategy 3: Grid Bucketing (Geohash / S2 / H3)

Another approach is to pre-assign each address to a **spatial grid cell**:

- **Geohash:** Divides the world into hierarchical rectangular cells. A geohash prefix like `r3gx2` identifies a ~5km cell. Stored as a VARCHAR column, queryable with `LIKE 'r3gx2%'`
- **S2 Cells (Google):** Hierarchical cells on a sphere. Better uniformity than geohash near poles (irrelevant for NSW)
- **H3 (Uber):** Hexagonal grid system. Good for aggregation (equal-area cells) but more complex

The idea: compute which grid cells the polygon overlaps, then filter to only addresses in those cells before doing PIP.

**Trade-offs vs. bounding box:**

| Approach | Setup Cost | Query Speed | Complexity |
|---|---|---|---|
| Bounding box (BETWEEN) | None — uses existing indexes | Fast (B-tree range scan) | Trivial |
| R-tree index | One-time index creation | Slightly faster for large datasets | Low |
| Grid bucketing | Add column + compute for all rows | Fast cell lookup | Medium — need to handle cells that partially overlap the polygon |

For our dataset size and use case, **bounding box pre-filter is sufficient**. Grid bucketing adds complexity (a new column on 3.3M rows, partial-overlap handling) with marginal benefit at our scale. It becomes worthwhile at 100M+ points or for real-time spatial joins.

### Acceleration Strategy 4: Pre-Computed Spatial Joins (Materialised)

For areas that are queried repeatedly (saved custom areas), we could pre-compute which properties fall inside each area and store the mapping:

```sql
CREATE TABLE area_membership (
  area_id VARCHAR,
  property_id VARCHAR,
  unit_number VARCHAR,
  house_number VARCHAR
);
```

This turns spatial queries into simple JOINs. The downside: the table must be rebuilt when areas are created/modified or when new properties are geocoded. For a local-first app where areas change infrequently, this is viable but adds maintenance complexity.

**Recommendation:** Skip pre-computation initially. The hybrid bbox + ST_Within approach should be fast enough (<200ms). If profiling reveals slow queries, pre-computation is the next step.

### Feasibility: Spatial Acceleration

**Fully feasible.** The bounding box pre-filter alone reduces 3.3M points to thousands, making the subsequent exact PIP check near-instant. DuckDB's spatial extension handles the PIP calculation natively. No exotic data structures needed.

---

## 4. DuckDB Spatial Queries

### The Spatial Extension

DuckDB includes an official `spatial` extension that adds geometry types and spatial functions. It must be installed once and loaded per connection:

```sql
INSTALL spatial;  -- downloads the extension (once)
LOAD spatial;     -- activates it for this connection
```

In our `db.server.ts`, this would be added to the connection initialisation path.

### Key Spatial Functions

| Function | Purpose | Example |
|---|---|---|
| `ST_Point(lon, lat)` | Create a point geometry from coordinates | `ST_Point(151.2, -33.8)` |
| `ST_GeomFromText(wkt)` | Parse a WKT string into a geometry | `ST_GeomFromText('POLYGON((...))')` |
| `ST_GeomFromGeoJSON(json)` | Parse GeoJSON into a geometry | `ST_GeomFromGeoJSON('{"type":"Polygon",...}')` |
| `ST_Within(geom_a, geom_b)` | True if A is entirely inside B | `ST_Within(point, polygon)` |
| `ST_Contains(geom_a, geom_b)` | True if A contains B (inverse of Within) | `ST_Contains(polygon, point)` |
| `ST_Intersects(geom_a, geom_b)` | True if A and B share any space | For edge cases |

### The Hybrid Query Pattern

The optimal query strategy combines a bounding box pre-filter (using existing B-tree indexes) with an exact spatial predicate:

```sql
-- Step 1: Load spatial extension
LOAD spatial;

-- Step 2: Hybrid bbox + ST_Within query
WITH bbox_filtered AS (
  SELECT
    fps.property_id,
    fps.unit_number,
    fps.house_number,
    fps.purchase_price,
    fps.contract_date,
    fps.zone_code,
    fps.locality,
    fps.nature_of_property,
    da.latitude,
    da.longitude,
    da.geocode_confidence
  FROM fact_property_sale fps
  INNER JOIN dim_address da
    ON fps.property_id = da.property_id
    AND fps.unit_number = da.unit_number
    AND fps.house_number = da.house_number
  WHERE da.latitude BETWEEN -33.90 AND -33.85    -- bbox south/north
    AND da.longitude BETWEEN 151.18 AND 151.23    -- bbox west/east
    AND fps.purchase_price > 0
    AND fps.contract_date IS NOT NULL
)
SELECT * FROM bbox_filtered
WHERE ST_Within(
  ST_Point(longitude, latitude),
  ST_GeomFromText('POLYGON((151.18 -33.85, 151.23 -33.85, 151.23 -33.90, 151.18 -33.90, 151.18 -33.85))')
)
```

**Execution flow:**

1. The CTE joins `fact_property_sale` to `dim_address` and applies the bounding box filter using indexed columns — this is a fast range scan
2. The outer WHERE applies `ST_Within` only to the bbox-surviving rows (typically thousands, not millions)
3. `ST_Point` constructs a point geometry from each row's coordinates
4. `ST_GeomFromText` parses the polygon WKT (done once, cached by the query engine)
5. `ST_Within` performs the exact ray-casting check

### WKT Conversion

GeoJSON polygons need to be converted to WKT (Well-Known Text) for `ST_GeomFromText`. The conversion is straightforward:

```
GeoJSON: { "coordinates": [[[151.20, -33.86], [151.21, -33.87], ...]] }
WKT:     POLYGON((151.20 -33.86, 151.21 -33.87, ...))
```

Note: GeoJSON uses `[longitude, latitude]` order, and WKT uses `longitude latitude` (space-separated) — the order is the same, just the delimiter changes from comma-in-array to space-in-pair.

### Bounding Box Extraction

Computing the bounding box from a GeoJSON polygon:

```typescript
function polygonBBox(polygon: GeoJSON.Polygon) {
  const coords = polygon.coordinates[0]
  let minLon = Infinity, maxLon = -Infinity
  let minLat = Infinity, maxLat = -Infinity
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return { minLon, maxLon, minLat, maxLat }
}
```

### Performance Estimate

| Stage | Rows Processed | Estimated Time |
|---|---|---|
| B-tree range scan on lat/lon | 3.3M → ~30K-50K | ~20ms |
| ST_Within on bbox candidates | ~30K-50K → final set | ~10-50ms |
| **Total** | | **~30-70ms** |

These are conservative estimates for a local DuckDB instance. The BETWEEN pre-filter is the key — it leverages B-tree indexes to avoid scanning the full 3.3M row table. The subsequent ST_Within on tens of thousands of rows is compute-bound but trivially fast on modern hardware.

### Feasibility: Spatial Queries

**Fully feasible and well-supported.** DuckDB's spatial extension is production-ready, the hybrid query pattern is standard practice in spatial databases, and our dataset size (3.3M addresses) is well within comfortable performance bounds.

---

## 5. Aggregation Queries Within Custom Areas

### Integration with Existing Query Pipeline

Our current query pipeline operates on `fact_property_sale` with filters applied via `buildWhereClause()`. The `PropertyFilter` interface supports:

- `localities` (suburb names)
- `districtCodes` (LGA codes)
- `dateFrom` / `dateTo`
- `minPrice` / `maxPrice`
- `zoneCategories`
- `natureOfProperty`

To support custom areas, we need to add a spatial filter that:

1. JOINs to `dim_address` (for lat/lon)
2. Applies the bbox + ST_Within predicates
3. Composes with all existing filters (date range, price range, etc.)

### Median Price Time Series

Our current `queryMedianPriceTimeSeries` query groups by locality and time period to produce per-suburb trend lines. With a custom area, the query changes:

**Current (suburb-based):**
```sql
SELECT
  locality,
  strftime(contract_date, '%Y-%m') AS period,
  MEDIAN(purchase_price) AS median_price,
  COUNT(*) AS sale_count
FROM fact_property_sale
WHERE locality IN ('SYDNEY', 'RANDWICK')
  AND purchase_price > 0 AND contract_date IS NOT NULL
GROUP BY locality, period
ORDER BY locality, period
```

**With custom area:**
```sql
SELECT
  'My Area' AS series_name,
  strftime(fps.contract_date, '%Y-%m') AS period,
  MEDIAN(fps.purchase_price) AS median_price,
  COUNT(*) AS sale_count
FROM fact_property_sale fps
INNER JOIN dim_address da
  ON fps.property_id = da.property_id
  AND fps.unit_number = da.unit_number
  AND fps.house_number = da.house_number
WHERE da.latitude BETWEEN ? AND ?
  AND da.longitude BETWEEN ? AND ?
  AND ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(?))
  AND fps.purchase_price > 0
  AND fps.contract_date IS NOT NULL
GROUP BY period
ORDER BY period
```

Key differences:
- JOIN to `dim_address` for coordinates
- Bounding box + ST_Within filter replaces (or augments) the locality filter
- Groups by area name instead of locality (since the area may span multiple suburbs)
- The area name comes from the client-side store, not the database

### Combining Areas with Suburb Filters

Custom areas and suburb selections should compose with OR logic: show properties that are in any selected suburb OR in any selected custom area. This allows users to compare "My Custom Area" against "RANDWICK" on the same chart.

```sql
WHERE (
  fps.locality IN ('RANDWICK', 'COOGEE')   -- suburb filter
  OR ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(?))  -- area filter
)
AND fps.purchase_price > 0
AND fps.contract_date IS NOT NULL
```

The GROUP BY would use a CASE expression:

```sql
SELECT
  CASE
    WHEN ST_Within(ST_Point(da.longitude, da.latitude), ST_GeomFromText(?))
      THEN 'My Area'
    ELSE fps.locality
  END AS series_name,
  ...
GROUP BY series_name, period
```

Note: a property could fall in both a selected suburb and a custom area. The CASE expression assigns it to the area first. Whether this is the desired behaviour (or whether it should appear in both series) is a UX decision.

### Map Points Query

The existing `queryMapPoints` already JOINs to `dim_address`. Adding spatial filtering is straightforward — append the bbox + ST_Within predicates to the existing WHERE clause. The result is the same GeoJSON FeatureCollection, just filtered to points within the polygon.

### Other Aggregations

Any query that currently filters by locality can be extended with spatial filtering using the same pattern:

| Query | Current Filter | Spatial Extension |
|---|---|---|
| Median price time series | `locality IN (...)` | Add JOIN + ST_Within |
| Growth rate calculation | `locality IN (...)` | Add JOIN + ST_Within |
| Suburb summary stats | `locality IN (...)` | Add JOIN + ST_Within, rename to area |
| Map points | Already joins dim_address | Add ST_Within to WHERE |

### Feasibility: Aggregations

**Fully feasible.** The spatial filter is additive — it slots into our existing query pipeline as an additional JOIN + WHERE clause. The main architectural consideration is that suburb-based queries currently don't JOIN to `dim_address`, so the spatial path adds a JOIN. For the map points query, the JOIN already exists.

---

## 6. Feasibility Summary

| Component | Feasibility | Confidence | Notes |
|---|---|---|---|
| Drawing polygons on MapLibre | Proven | High | Terra-Draw is purpose-built, actively maintained, has MapLibre adapter |
| GeoJSON polygon representation | Standard | High | Universal format, native to all components in our stack |
| Zustand + localStorage storage | Proven pattern | High | Same architecture as our widget store |
| Bounding box pre-filter | Proven | High | Standard SQL BETWEEN on indexed columns |
| DuckDB ST_Within | Proven | High | Official spatial extension, production-ready |
| Hybrid query performance (<200ms) | Estimated | Medium-High | Based on dataset size (3.3M) and typical bbox selectivity; needs benchmarking |
| Integration with median price queries | Feasible | High | Requires JOIN addition but straightforward |
| Combining areas + suburbs (OR logic) | Feasible | Medium | CASE expression in GROUP BY needs careful handling |

### What's Proven

- DuckDB's spatial extension works with `ST_Within`, `ST_Point`, `ST_GeomFromText`
- Terra-Draw outputs GeoJSON polygons from user drawing on MapLibre maps
- Bounding box pre-filters on indexed columns dramatically reduce candidate sets
- Our existing query pipeline can be extended with additional JOINs and WHERE clauses

### What Needs Benchmarking

- Exact query time for the hybrid bbox + ST_Within approach on our 3.3M address dataset
- Whether `LOAD spatial` adds meaningful latency to connection startup
- Performance impact of the additional `dim_address` JOIN on queries that currently don't use it
- Whether the 50,000 point limit in `queryMapPoints` needs adjustment for area-based queries

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| DuckDB spatial extension not available in our Node.js binding | Low | The `@duckdb/node-api` supports `INSTALL`/`LOAD` for extensions |
| Terra-Draw API instability | Low | Pin version, adapter API is small |
| Performance regression on non-spatial queries | None | Spatial JOIN is only added when a polygon filter is present |
| localStorage quota exceeded | Very Low | Polygons are small (~600 bytes each); would need 10,000+ areas |

### Conclusion

The custom map areas feature is **fully feasible** with our current tech stack. DuckDB's spatial extension provides native point-in-polygon support, Terra-Draw handles the drawing UX, and GeoJSON is the universal glue format. The hybrid bounding box + ST_Within query pattern is a standard approach in spatial databases and should comfortably handle our dataset size. No exotic acceleration structures (quadtrees, grid bucketing) are needed at our scale — simple B-tree indexes on lat/lon columns provide sufficient pre-filtering.

The main implementation effort is UI/UX: the drawing toolbar, save dialog, area management, and integrating the area selector into widget settings panels. The query-side changes are relatively contained — adding a spatial JOIN and WHERE clause to existing query functions.
