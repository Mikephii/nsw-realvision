# Growth Heatmap — Advanced Rendering & Acceleration Research

**Date:** 2026-02-25
**Status:** Research / Pre-implementation
**Builds on:** `growth-heatmap-feasibility.md` (basic feasibility, suburb choropleth MVP)

## 1. Motivation

The feasibility report established that a suburb-level choropleth is the right MVP approach. However, the user wants to explore whether we can achieve a **smooth, continuous color gradient** (like weather radar or temperature maps) instead of blocky per-suburb polygons, with **animated transitions** between time windows, and **precomputed acceleration structures** in DuckDB for fast multi-resolution queries.

This document covers the advanced options investigated.

---

## 2. Smooth Gradient Rendering via IDW Interpolation

### What is IDW?

**Inverse Distance Weighting** is a spatial interpolation method that estimates a value at any location as a weighted average of known data points, where nearer points contribute more:

```
value(x) = Σ(vi / di^p) / Σ(1 / di^p)
```

- `vi` = value at known point `i` (e.g., annualized growth rate)
- `di` = distance from the estimation point `x` to point `i`
- `p` = power parameter (typically 2; higher values = more local influence)

The result is a continuous surface that passes through all data points and smoothly interpolates between them. This is exactly what weather radar and temperature maps use.

### WebGL Shader Approach

IDW can be computed in a **WebGL fragment shader** running on the GPU, evaluating the interpolation formula for every pixel on screen in parallel:

1. Upload data points (lat/lon/value) as a texture or uniform array
2. For each screen pixel, the fragment shader:
   - Projects the pixel to map coordinates
   - Iterates over all data points
   - Computes distance-weighted average
   - Maps the result through a color gradient
3. Output: continuous color field rendered at 60fps

**Performance**: With ~2,500 suburb centroids (or ~5,000-10,000 H3 centroids), GPU computation handles this easily at 60fps. The bottleneck is the number of data points × screen resolution, but modern GPUs handle this for point counts up to ~10,000.

### Library: `maplibre-gl-interpolate-heatmap`

| Property | Details |
|----------|---------|
| **Repository** | [geoql/maplibre-gl-interpolate-heatmap](https://github.com/geoql/maplibre-gl-interpolate-heatmap) |
| **Version** | v0.1.3 (January 29, 2026) |
| **License** | MIT |
| **Language** | TypeScript (94.1%) |
| **Dependencies** | Zero external dependencies |
| **Stars** | ~8 (small community) |
| **Commits** | 885+ |
| **Requirements** | MapLibre GL JS v5+, Node >= 24 |

**How it works**: Implements MapLibre's `CustomLayerInterface` with a 3-pass WebGL pipeline:
1. Texture generation (scatter data points)
2. Blending via accumulator (IDW computation)
3. Color mapping (value → RGBA)

**Supported features**:
- Custom color scale functions (GLSL-based)
- Opacity control (0-1)
- IDW power parameter (`p`)
- Framebuffer resolution factor (quality vs performance tradeoff)
- Area-of-interest polygon clipping

**Not supported**:
- Animated transitions between datasets
- Multiple simultaneous layers for blending
- Built-in legend generation

**Data format**: Array of `{ lat: number, lon: number, val: number }` objects.

### Custom `CustomLayerInterface` (Alternative)

For full control over animation and rendering, we can write our own MapLibre custom layer:

```typescript
class IDWLayer implements CustomLayerInterface {
  id: string
  type = 'custom' as const
  renderingMode = '2d' as const

  // Two data buffers for animated transitions
  private prevData: Float32Array
  private currData: Float32Array
  private transitionProgress: number = 1.0

  onAdd(map: Map, gl: WebGL2RenderingContext) {
    // Compile shaders, create buffers, set up textures
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    // Upload projection matrix
    // Set blend uniform (transitionProgress)
    // Draw fullscreen quad — fragment shader computes IDW per pixel
  }
}
```

**Fragment shader sketch**:
```glsl
uniform sampler2D u_prevPoints;  // previous dataset
uniform sampler2D u_currPoints;  // current dataset
uniform float u_transition;       // 0.0 → 1.0
uniform float u_power;            // IDW power parameter

vec3 idwSample(sampler2D points, vec2 screenPos) {
  float totalWeight = 0.0;
  float totalValue = 0.0;
  for (int i = 0; i < numPoints; i++) {
    vec4 pt = texelFetch(points, ivec2(i, 0), 0);
    float d = distance(screenPos, pt.xy);
    float w = 1.0 / pow(max(d, 0.001), u_power);
    totalWeight += w;
    totalValue += w * pt.z;
  }
  float value = totalValue / totalWeight;
  return colorMap(value);  // map to diverging color scale
}

void main() {
  vec3 colorA = idwSample(u_prevPoints, v_position);
  vec3 colorB = idwSample(u_currPoints, v_position);
  gl_FragColor = vec4(mix(colorA, colorB, u_transition), u_opacity);
}
```

**Pros**: Full animation control, custom color scales, no third-party dependency.
**Cons**: Significant development effort, shader debugging, must handle map projection ourselves.

### Why NOT the Built-In MapLibre Heatmap Layer

MapLibre's native `heatmap` layer type is **density-based**, not value-based:

- `heatmap-weight`: Scales how much each point contributes to the **density kernel**, not the interpolated value
- `heatmap-color`: Maps the resulting **density** (0-1) to colors via `heatmap-density`
- `heatmap-radius`: Controls the Gaussian blur radius

The visual result shows **where points are concentrated**, not what values they carry. An area with many low-growth sales would look "hotter" than an area with few high-growth sales. This is fundamentally wrong for our use case.

### Verdict

| Approach | Effort | Animation | Quality | Recommendation |
|----------|--------|-----------|---------|----------------|
| Library (`maplibre-gl-interpolate-heatmap`) | Low | Manual (swap data) | Good | Phase 2 quick start |
| Custom `CustomLayerInterface` | High | Full control | Excellent | Phase 3 if needed |
| MapLibre native heatmap | N/A | N/A | Wrong metric | **Not suitable** |

**Recommended**: Start with suburb choropleth (Phase 1), add IDW via the library as a "Smooth mode" toggle (Phase 2), upgrade to custom shader only if the library proves insufficient (Phase 3).

---

## 3. DuckDB Acceleration Structures

### H3 Hexagonal Grid (Recommended)

The [H3](https://h3geo.org/) system by Uber divides the Earth's surface into hierarchical hexagonal cells. DuckDB has a community extension (`duckdb_h3` by Isaac Brodsky) that provides 70+ H3 functions.

**Installation**:
```sql
INSTALL h3 FROM community;
LOAD h3;

-- Verify
SELECT h3_latlng_to_cell(-33.8688, 151.2093, 10);  -- Sydney CBD
```

**Resolution hierarchy and use cases**:

| Resolution | Cell Area | Edge Length | Use Case | Zoom Level |
|------------|-----------|-------------|----------|------------|
| 4 | ~1,107 km² | ~22 km | Regional trends | 0-6 |
| 6 | ~36 km² | ~3.7 km | Suburb-scale | 7-10 |
| 8 | ~0.74 km² | ~460 m | Street-level micro-markets | 11-14 |
| 10 | ~0.015 km² | ~66 m | Block-level (future) | 15+ |

**Key functions**:
```sql
-- Convert coordinates to cell
H3_LATLNG_TO_CELL(latitude, longitude, resolution) → BIGINT

-- Navigate hierarchy
H3_CELL_TO_PARENT(cell, parent_resolution) → BIGINT
H3_CELL_TO_CHILDREN(cell, child_resolution) → BIGINT[]

-- Get cell geometry (for IDW input points)
H3_CELL_TO_LAT(cell) → DOUBLE
H3_CELL_TO_LNG(cell) → DOUBLE
H3_CELL_TO_BOUNDARY_WKT(cell) → VARCHAR

-- Spatial queries
H3_GRID_DISK(cell, distance) → BIGINT[]
H3_ARE_NEIGHBOR_CELLS(cell1, cell2) → BOOLEAN
```

**Performance benchmarks** (from published research on 31M row datasets):
| Method | Query Time | Speedup |
|--------|-----------|---------|
| No index (full scan) | 1,380 ms | 1x |
| R-tree index | 65.3 ms | 21x |
| **H3 cell lookup** | **28.4 ms** | **48x** |

**Precomputation schema**:
```sql
CREATE TABLE agg_h3_growth (
  h3_cell BIGINT,
  resolution TINYINT,          -- 4, 6, or 8
  years_back TINYINT,          -- 5, 10, 15, 20, 25
  metric VARCHAR,              -- 'median-price' | 'price-per-sqm'
  strata_filter VARCHAR,       -- 'all' | 'freehold' | 'strata'
  annualized_growth DOUBLE,
  median_start BIGINT,
  median_end BIGINT,
  sale_count INTEGER,
  centroid_lat DOUBLE,
  centroid_lng DOUBLE
);

-- Composite index for fast lookups
CREATE INDEX idx_h3_lookup
  ON agg_h3_growth(resolution, years_back, metric, strata_filter);
```

**Precomputation query** (example for resolution 6, median-price, all strata):
```sql
INSERT INTO agg_h3_growth
WITH sales_h3 AS (
  SELECT
    h3_latlng_to_cell(da.latitude, da.longitude, 6) AS h3_cell,
    fps.purchase_price,
    fps.contract_date
  FROM fact_property_sale fps
  JOIN dim_address da ON fps.property_id = da.property_id
  WHERE fps.purchase_price > 0
    AND da.latitude IS NOT NULL
),
start_window AS (
  SELECT h3_cell,
         MEDIAN(purchase_price) AS median_price,
         COUNT(*) AS sale_count
  FROM sales_h3
  WHERE EXTRACT(YEAR FROM contract_date) BETWEEN 2014 AND 2016
  GROUP BY h3_cell
  HAVING COUNT(*) >= 10
),
end_window AS (
  SELECT h3_cell,
         MEDIAN(purchase_price) AS median_price,
         COUNT(*) AS sale_count
  FROM sales_h3
  WHERE EXTRACT(YEAR FROM contract_date) BETWEEN 2024 AND 2026
  GROUP BY h3_cell
  HAVING COUNT(*) >= 10
)
SELECT
  s.h3_cell,
  6 AS resolution,
  10 AS years_back,
  'median-price' AS metric,
  'all' AS strata_filter,
  POWER(e.median_price::DOUBLE / s.median_price, 1.0 / 10) - 1 AS annualized_growth,
  s.median_price AS median_start,
  e.median_price AS median_end,
  s.sale_count + e.sale_count AS sale_count,
  h3_cell_to_lat(s.h3_cell) AS centroid_lat,
  h3_cell_to_lng(s.h3_cell) AS centroid_lng
FROM start_window s
JOIN end_window e ON s.h3_cell = e.h3_cell
WHERE s.median_price > 0 AND e.median_price > 0;
```

**Total precomputation**: 3 resolutions × 5 time windows × 2 metrics × 3 strata filters = **90 combinations**. Each combination produces ~500-5,000 rows depending on resolution. Total table size: ~100K-500K rows. Can be computed in a few minutes and refreshed on each ETL load.

### R-Tree Indexes

DuckDB's spatial extension supports R-tree indexes on GEOMETRY columns:

```sql
CREATE INDEX idx_address_geom ON dim_address USING RTREE (geom);
```

**Performance**: 21x speedup for bounding-box queries (65ms vs 1,380ms on 31M rows).

**Limitation**: Only accelerates queries where one predicate argument is a constant known at planning time. This means viewport-based queries work (`ST_Within(geom, constant_bbox)`), but join-based spatial predicates may not benefit.

**For our use case**: R-tree is useful for the live query path (Phase 1 suburb-level queries), but H3 precomputation is more impactful for the heatmap where we pre-aggregate everything.

### Tile-Based Materialization (z/x/y)

Pre-compute aggregates aligned to Web Mercator tile coordinates:

```sql
CREATE TABLE property_tiles (
  z INT, x INT, y INT,
  sale_count INT,
  avg_price DOUBLE,
  growth_pct DOUBLE
);
CREATE INDEX idx_tile ON property_tiles(z, x, y);
```

**Function support**: `ST_TileEnvelope(z, x, y)` returns the bounding box for a tile.

**Tradeoff vs H3**: Tile coordinates map perfectly to web map tile requests, but tiles are square (edge effects at tile boundaries), varying in size (larger near equator), and don't have the clean hierarchical properties of H3. H3 is superior for analytical aggregation; tile materialization is better for direct tile-serving infrastructure.

**Verdict**: H3 is preferred for growth heatmap precomputation. Tile-based materialization is a future optimization if we serve vector tiles directly.

---

## 4. Animated Transitions

### Choropleth Paint Transitions (Phase 1)

MapLibre natively supports smooth transitions on paint properties:

```javascript
map.addLayer({
  id: 'suburb-growth-fill',
  type: 'fill',
  source: 'suburb-boundaries',
  paint: {
    'fill-color': getGrowthFillColor(),  // interpolate expression
    'fill-opacity': 0.7,
  },
})

// When updating data, just replace the source:
map.getSource('suburb-boundaries').setData(newMergedGeoJSON)

// MapLibre will transition fill-color over the default 300ms
// Or configure explicitly:
// 'fill-color-transition': { duration: 400, delay: 0 }
```

This gives us smooth color morphing when switching time windows or metrics at zero implementation cost.

### IDW Shader Transitions (Phase 2/3)

For the IDW smooth mode, transitions require shader-level blending:

1. **Double buffering**: Maintain `prevPointsTexture` and `currPointsTexture`
2. **On data change**: Copy current → previous, upload new data → current, reset transition timer
3. **Render loop**: Animate `u_transition` from 0.0 to 1.0 over 400-600ms using `requestAnimationFrame`
4. **Fragment shader**: `mix(idw(prevPoints), idw(currPoints), u_transition)`

```typescript
class IDWLayer implements CustomLayerInterface {
  private transitionStart = 0
  private transitionDuration = 500 // ms

  updateData(newPoints: Float32Array) {
    // Swap buffers
    [this.prevTexture, this.currTexture] = [this.currTexture, this.prevTexture]
    // Upload new data
    this.uploadTexture(this.currTexture, newPoints)
    // Start transition
    this.transitionStart = performance.now()
    this.map.triggerRepaint()
  }

  render(gl: WebGL2RenderingContext) {
    const elapsed = performance.now() - this.transitionStart
    const t = Math.min(elapsed / this.transitionDuration, 1.0)
    gl.uniform1f(this.u_transition, easeInOutCubic(t))
    // ... draw fullscreen quad
    if (t < 1.0) this.map.triggerRepaint() // keep animating
  }
}
```

### Cross-Fade Between Zoom Resolutions (Phase 2)

When the user zooms across a resolution boundary (e.g., zoom 6 → 7, switching from H3 res 4 to res 6):

1. Keep both resolution layers active
2. Animate: fade out coarse layer (opacity 1 → 0), fade in fine layer (opacity 0 → 1)
3. Duration: 300ms, triggered on debounced zoom change
4. Remove the old layer after transition completes

This prevents a jarring "pop" when resolution switches.

---

## 5. Multi-Resolution Zoom Behavior

### Zoom → Resolution Mapping

| Zoom Range | Data Resolution | Data Source | Point Count (approx) |
|------------|----------------|-------------|---------------------|
| 0-6 | H3 res 4 | `agg_h3_growth` WHERE resolution=4 | ~50-200 |
| 7-10 | H3 res 6 | `agg_h3_growth` WHERE resolution=6 | ~500-2,000 |
| 11-14 | H3 res 8 | `agg_h3_growth` WHERE resolution=8 | ~2,000-10,000 |
| Any | Suburb-level | `queryLocalityGrowth()` (live query) | ~2,500 |

### Implementation Pattern

```typescript
function getResolutionForZoom(zoom: number): number {
  if (zoom <= 6) return 4
  if (zoom <= 10) return 6
  return 8
}

// In the map component:
const [currentResolution, setCurrentResolution] = useState(4)

useMapEffect(mapInstance, (map) => {
  const onZoomEnd = debounce(() => {
    const zoom = map.getZoom()
    const newRes = getResolutionForZoom(zoom)
    if (newRes !== currentResolution) {
      setCurrentResolution(newRes)
      // This triggers data fetch for new resolution
    }
  }, 200)

  map.on('zoomend', onZoomEnd)
  return () => map.off('zoomend', onZoomEnd)
}, [currentResolution])
```

### Viewport-Based Fetching (Optimization)

For high resolutions (res 8), fetching all of NSW would return thousands of points. Instead, fetch only cells visible in the current viewport:

```sql
SELECT * FROM agg_h3_growth
WHERE resolution = 8
  AND years_back = 10
  AND metric = 'median-price'
  AND strata_filter = 'all'
  AND centroid_lat BETWEEN ? AND ?
  AND centroid_lng BETWEEN ? AND ?
```

At lower resolutions (res 4), fetch everything (only ~200 points for all of NSW).

---

## 6. Client-Side Interpolation Alternatives

### `@turf/interpolate` (IDW to Grid)

```typescript
import { interpolate } from '@turf/interpolate'

const grid = interpolate(pointsFC, 0.5, { // 0.5 km cell size
  gridType: 'hex',
  property: 'growth',
  weight: 2, // IDW power
})
```

**Pros**: Pure JavaScript, familiar Turf.js API, no WebGL.
**Cons**: CPU-bound (blocks main thread for large grids), memory-intensive (100x100 grid = 10,000 features), must re-run on every data change, cannot animate smoothly.

**Verdict**: Not suitable for real-time interactive use. Acceptable for one-time static renders.

### `kriging.js` (Gaussian Process Regression)

More statistically sophisticated than IDW — models spatial correlation (semivariogram) and provides uncertainty estimates.

**Pros**: Better interpolation quality, accounts for spatial autocorrelation.
**Cons**: Much slower than IDW (~10-100x), overkill for visualization purposes, no GPU acceleration.

**Verdict**: Not needed. IDW produces visually similar results for our use case, and we don't need uncertainty quantification.

### `d3-contour` (Marching Squares)

Generates contour polygons from a regular grid of values. Can produce smooth contour lines or filled contour regions.

**Workflow**: Pre-compute grid (via Turf.js or server-side) → `d3.contours()` → GeoJSON polygons → MapLibre fill layers.

**Pros**: Familiar D3 ecosystem, smooth contour appearance.
**Cons**: Requires pre-computed grid as input, computationally expensive for fine grids, contour "banding" is visible (not truly smooth).

**Verdict**: Interesting for a "contour lines" overlay but not the primary visualization mode.

### Server-Side Raster Tiles (GDAL)

Pre-render interpolated surfaces as PNG/WebP tiles using `gdal_grid` + `gdal2tiles`:

```bash
# 1. IDW interpolation to GeoTIFF
gdal_grid -a_srs EPSG:4326 -of GTiff \
  -a invdist:power=2.0:smoothing=0.5 \
  input_points.vrt output.tif

# 2. Generate tile pyramid
gdal2tiles.py --zoom=8-14 --processes=4 output.tif tiles/
```

**Pros**: Pre-computed (instant serving), CDN-cacheable, excellent quality.
**Cons**: Cannot animate between time windows (separate tile set per config), requires Python/GDAL infrastructure, disk storage for all combinations (~90 config variants × ~1000 tiles per variant = ~90,000 tiles).

**Verdict**: Best for a "published" static view. Not suitable for interactive time window switching, but could complement the live IDW layer as a fallback for slow connections.

---

## 7. Recommended Phased Approach

### Phase 1: Suburb Choropleth MVP
- Suburb polygon fill layer colored by growth rate
- MapLibre paint transitions for smooth color changes on config switch
- Live DuckDB query per config change (~2s)
- Tooltip + legend
- **No precomputation, no IDW, no H3**

### Phase 2: H3 Precomputation + Multi-Resolution
- Install DuckDB H3 extension
- Precompute `agg_h3_growth` table (90 combinations)
- Add ETL script step to refresh on data load
- Zoom-based resolution switching with cross-fade animation
- Replace live query with precomputed lookup (<50ms)
- H3 cell centroids feed into choropleth OR future IDW layer

### Phase 3: IDW Smooth Mode
- Add `maplibre-gl-interpolate-heatmap` as "Smooth mode" toggle
- H3 centroids as input points (from precomputed table)
- Custom color scale matching the choropleth diverging palette
- If library proves insufficient: build custom `CustomLayerInterface` with shader-based IDW + animated transitions

### Phase 4: Polish (Future)
- Server-side raster tile cache for most popular configs
- Contour line overlay option
- Suburb name labels at high zoom
- Click-to-zoom with suburb detail panel
- Repeat-sales index for composition-bias-free growth calculation

---

## 8. Key Library References

| Library | Purpose | URL |
|---------|---------|-----|
| `maplibre-gl-interpolate-heatmap` | IDW interpolation layer for MapLibre | [GitHub](https://github.com/geoql/maplibre-gl-interpolate-heatmap) |
| `duckdb_h3` | H3 hexagonal grid functions for DuckDB | [GitHub](https://github.com/isaacbrodsky/h3-duckdb) |
| `h3-js` | H3 client-side (cell → polygon conversion) | [npm](https://www.npmjs.com/package/h3-js) |
| `@turf/interpolate` | Client-side IDW grid interpolation | [Turf.js docs](https://turfjs.org/docs/api/interpolate) |
| `d3-contour` | Contour polygon generation | [D3 docs](https://d3js.org/d3-contour) |
| `kriging.js` | Gaussian process spatial interpolation | [GitHub](https://github.com/oeo4b/kriging.js) |
| GDAL | Server-side raster interpolation + tile generation | [gdal_grid docs](https://gdal.org/en/stable/programs/gdal_grid.html) |

## 9. Open Questions

1. **IDW power parameter**: What value of `p` gives the best visual result for property growth data? Need to experiment — `p=2` is standard but `p=3` gives more localized effects. Could expose as an advanced setting.

2. **Geocoding coverage for H3**: H3 requires lat/lon from `dim_address`. What percentage of sales have geocoded coordinates? If coverage is low for older sales, H3 may only work for shorter time windows. Need to run: `SELECT COUNT(*) FILTER (WHERE latitude IS NOT NULL) * 100.0 / COUNT(*) FROM dim_address`.

3. **H3 minimum sales threshold**: At res 8 (~0.74 km²), many cells will have very few sales. What's the minimum threshold? Probably lower than suburb-level (10 instead of 30) since cells are smaller.

4. **Library viability**: `maplibre-gl-interpolate-heatmap` requires Node >= 24 and MapLibre v5+. We have MapLibre v5.19.0 which is fine, but need to verify Node version compatibility with our build tooling.

5. **Transition UX**: When animating between time windows (5yr → 10yr), should we animate the color change in-place (morph) or cross-fade (two layers)? In-place morph is simpler for choropleth; cross-fade is better for IDW if the point set changes significantly.
