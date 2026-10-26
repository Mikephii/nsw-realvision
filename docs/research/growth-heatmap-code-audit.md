# Growth Heatmap Widget — Code Quality Audit

**Date**: 2026-02-27
**Scope**: `webapp/src/features/dashboard/widgets/growth-heatmap/` (10 files, ~2,222 lines)

## Executive Summary

The growth heatmap widget is a technically ambitious piece of work: a custom WebGL IDW interpolation renderer integrated with MapLibre via `CustomLayerInterface`, with animated transitions, viewport culling, and a pluggable renderer architecture. The core rendering pipeline is well-architected and the GPU-side code is production-quality.

However, the widget was built through rapid iterative debugging sessions, and this shows in several areas: duplicated utility functions, implicit ordering dependencies between React hooks, magic strings for layer IDs, and a few `as any` casts that bypass type safety. None of these are bugs — the widget works correctly — but they create maintenance risk and deviate from the engineering standards established in the rest of the codebase.

**Overall assessment**: Solid foundation, needs a cleanup pass. The rendering core (`idw-custom.ts`) is excellent; the React orchestration layer (`GrowthHeatmap.tsx`) needs the most attention.

---

## Files Reviewed

| File | Lines | Role | Quality |
|------|-------|------|---------|
| `GrowthHeatmap.tsx` | 574 | Map orchestration, layer management, UI overlays | Needs cleanup |
| `renderers/idw-custom.ts` | 944 | Custom WebGL IDW renderer | Good (well-documented) |
| `renderers/idw-library.ts` | 214 | Library wrapper renderer | Acceptable |
| `renderers/types.ts` | 51 | Renderer interface | Good |
| `GrowthHeatmapSettings.tsx` | 100 | Settings panel | Good |
| `GrowthLegend.tsx` | 36 | Legend overlay | Good |
| `GrowthTooltip.tsx` | 74 | Tooltip overlay | Good |
| `color-scale.ts` | 106 | Color mapping utilities | Good |
| `types.ts` | 82 | Config types and constants | Good |
| `definition.tsx` | 41 | Widget registration | Good |

---

## Critical Findings

### 1. Triplicated HSL Parsing Function

**Files**: `idw-custom.ts:230`, `idw-library.ts:72`, `color-scale.ts:30`

The exact same `hslToRgb` / `hslToRgbNorm` / `hslToGlslVec3` function is implemented three times with minor output format differences:
- `color-scale.ts` — returns `[r, g, b]` as 0-255 integers
- `idw-custom.ts` — returns `[r, g, b]` as 0-1 floats
- `idw-library.ts` — returns a GLSL `vec3(r, g, b)` string

All three contain the same HSL-to-RGB algorithm with the same `hue2rgb` inner function.

**Risk**: If the color stops change or the parsing logic needs a fix, three places need updating. Easy to miss one.

**Recommendation**: Extract a single `hslToRgb(hsl: string): [number, number, number]` returning normalised 0-1 floats into `color-scale.ts`. Consumers can scale to 0-255 or format as GLSL strings from there.

| Pros | Cons |
|------|------|
| Single source of truth for color conversion | Marginal: adds one import to each consumer |
| Fewer lines of code overall | |
| Bug fixes apply everywhere automatically | |

**Priority**: High — straightforward DRY violation.

---

### 2. Implicit Hook Ordering Dependency in GrowthHeatmap.tsx

**File**: `GrowthHeatmap.tsx:209` (comment: "This hook must run AFTER water mask and BEFORE road/labels overlays")

The layer stacking order (basemap → idw-custom → water-mask → road-overlay → place-labels) depends on the **declaration order** of `useMapEffect` hooks in the component body. This is documented via a comment, but is fragile: reordering hooks during a refactor would silently break the layer stack, and the bug would only be visible at runtime.

A separate `useEffect` at line 420 attempts to fix ordering with `moveLayer()` + a 200ms retry timeout, which is a workaround for the fragility.

**Risk**: Future edits could reorder hooks without realising the visual dependency. The 200ms setTimeout is a race condition (not guaranteed to fire after all hooks complete).

**Recommendation**: Replace implicit ordering with explicit declarative layer ordering. Options:

**Option A — Explicit moveLayer orchestration** (simpler):
Replace the scattered `useMapEffect` hooks with a single `useMapLayers` effect that adds all overlay layers in the correct order and calls `moveLayer` to enforce stacking. This removes the hook-ordering dependency entirely.

| Pros | Cons |
|------|------|
| Layer order is explicit in one place | Larger single effect (more lines) |
| No race conditions or setTimeout hacks | Loses the clean separation of per-layer hooks |
| Easier to reason about for new developers | |

**Option B — Layer ID registry with declarative ordering** (more robust):
Define a `LAYER_ORDER` array (`['idw-custom', 'water-mask', 'road-overlay', 'place-labels']`) and write a `useEnforceLayerOrder(map, LAYER_ORDER)` hook that runs after all layers are added and calls `moveLayer` to sort them.

| Pros | Cons |
|------|------|
| Fully declarative — add a layer ID and it's auto-sorted | More abstraction overhead |
| Works regardless of hook execution order | Need to handle layers not yet added |
| Eliminates the 200ms timeout | |

**Priority**: High — correctness depends on comment-documented invariants.

---

### 3. Stale Closure Risk in `saveViewport`

**File**: `GrowthHeatmap.tsx:491-504`

```tsx
const saveViewport = useCallback(() => {
  const map = mapRef.current
  if (!map) return
  const center = map.getCenter()
  updateWidgetConfig(widgetId, {
    ...config,   // <-- captures config at callback creation time
    viewport: { ... },
  })
  toast('View position saved as default')
}, [config, widgetId, updateWidgetConfig])
```

The spread `...config` captures the config object from the closure. If `config` changes between renders and the callback fires before re-render, stale config values could be written back. In practice this is unlikely (the user must click the button in the exact frame between a config update and the re-render), but it violates the principle of using refs or functional updates for values that change.

**Recommendation**: Use a ref for config or use the Zustand store's `getState()` to read the latest config at invocation time.

| Pros | Cons |
|------|------|
| Eliminates theoretical race condition | Slightly more complex callback |
| Follows React best practices for callbacks | |

**Priority**: Medium — theoretical risk, unlikely in practice.

---

## Moderate Findings

### 4. Magic Strings for Layer IDs

**Files**: `GrowthHeatmap.tsx` (multiple), `idw-custom.ts:341`

Layer IDs (`'water-mask'`, `'water-mask-source'`, `'road-overlay'`, `'place-labels'`, `'idw-custom'`) are hardcoded as string literals throughout. The same string appears in multiple files:
- `'water-mask'` appears in `GrowthHeatmap.tsx` (lines 167, 180-182, 197, 425-429) and `idw-custom.ts` (line 437) and `idw-library.ts` (line 182-183)
- `'water-mask-source'` appears in `GrowthHeatmap.tsx` (lines 165, 249, 295)

**Risk**: Typo in one location causes silent failure (MapLibre doesn't throw on missing layer IDs from `getLayer()`).

**Recommendation**: Define layer ID constants in a shared module:
```ts
// map-layers.ts
export const LAYER_IDS = {
  IDW_CUSTOM: 'idw-custom',
  WATER_MASK: 'water-mask',
  ROAD_OVERLAY: 'road-overlay',
  PLACE_LABELS: 'place-labels',
} as const

export const SOURCE_IDS = {
  VECTOR_TILES: 'water-mask-source',  // rename to something semantic
} as const
```

| Pros | Cons |
|------|------|
| Type-safe references, IDE autocomplete | One more import per file |
| Typos caught at compile time | |
| Source ID name can reflect actual purpose (not "water-mask-source" for a general vector tile source) | |

**Priority**: Medium — reduces bug surface area.

---

### 5. Unsafe Type Casts in Library Renderer

**File**: `idw-library.ts:159-162`

```ts
const originalRender = (layer as any).render.bind(layer)
;(layer as any).render = (gl: WebGL2RenderingContext, options: any) => { ... }
```

The library renderer monkey-patches the third-party library's `render` method to intercept blend state. This requires `as any` casts because the library doesn't export the render method type.

**Risk**: Library updates could rename or restructure the render method, and TypeScript wouldn't catch it.

**Recommendation**: Either:
- Add a runtime check: `if (typeof (layer as any).render !== 'function') throw new Error(...)`
- Or create a typed wrapper interface that mirrors the library's actual shape

| Pros | Cons |
|------|------|
| Catches library API changes at runtime | Can't fully type a third-party internal API |
| Documents the assumption explicitly | |

**Priority**: Low-Medium — the library renderer is a fallback; the custom renderer is the default.

---

### 6. `as unknown as maplibregl.LayerSpecification` Casts

**Files**: `idw-custom.ts:438`, `idw-library.ts:176`

Both renderers cast their custom layer objects through `as unknown as maplibregl.LayerSpecification` when calling `map.addLayer()`. This is necessary because MapLibre's TypeScript types don't include `CustomLayerInterface` in the `addLayer` overload.

**Risk**: Low — this is a well-known MapLibre typing gap, not a code quality issue.

**Recommendation**: Leave as-is or add a typed helper:
```ts
function addCustomLayer(map: maplibregl.Map, layer: maplibregl.CustomLayerInterface, before?: string) {
  map.addLayer(layer as unknown as maplibregl.LayerSpecification, before)
}
```

**Priority**: Low — standard workaround for MapLibre's type system.

---

### 7. Shared Source ID Named After First Consumer

**File**: `GrowthHeatmap.tsx:165`

The vector tile source is named `'water-mask-source'` but is used by three layers: water-mask, road-overlay, and place-labels. The name suggests it's only for the water mask.

**Recommendation**: Rename to `'openmaptiles-vector'` or `'vector-tiles'` to reflect its actual role as a shared vector tile source.

| Pros | Cons |
|------|------|
| Self-documenting | Requires updating all references (but would be done alongside layer ID constants) |

**Priority**: Low — cosmetic, but improves readability.

---

## Minor Findings

### 8. `interpolateStops()` in `idw-custom.ts` Duplicates `growthToColor()` from `color-scale.ts`

**File**: `idw-custom.ts:251-265`

The `interpolateStops()` function does linear interpolation between color stops — the same thing `growthToColor()` does in `color-scale.ts`, just with different output format (0-1 floats vs 0-255 integers).

**Recommendation**: Consolidate with the HSL deduplication (Finding #1). One `interpolateColorStops()` function returning normalised floats, with `growthToColor()` as a thin wrapper that scales to 0-255.

**Priority**: Low — part of the HSL dedup effort.

---

### 9. `buildColorRamp()` Calls `interpolateStops()` Per Pixel

**File**: `idw-custom.ts:274-285`

The color ramp builder calls `interpolateStops()` (which calls `hslToRgbNorm()`) for each of 256 texels. Each `hslToRgbNorm()` call parses the HSL CSS string with a regex. This is 256 regex parses per ramp build.

**Risk**: None in practice (runs once on init and on color range change — microseconds total). But it's inelegant.

**Recommendation**: Pre-parse color stop strings to RGB tuples once (like `color-scale.ts` does with `STOP_RGBS`), then interpolate between the pre-parsed values.

**Priority**: Low — performance is fine, just cleaner.

---

### 10. Matrix Variable Names in Viewport Culling

**File**: `idw-custom.ts:769-771`

```ts
const m0 = matrix[0], m1 = matrix[1], m3 = matrix[3]
const m4 = matrix[4], m5 = matrix[5], m7 = matrix[7]
const m12 = matrix[12], m13 = matrix[13], m15 = matrix[15]
```

These are raw column-major matrix indices. The comment above explains the pattern, but the variable names don't convey which matrix element they represent (e.g., `m0` is actually `m00`, the first element of the first column).

**Recommendation**: Consider naming them after their matrix role or adding inline comments:
```ts
// Column-major 4x4 matrix: m[col][row] stored as m[col*4 + row]
const m00 = matrix[0], m10 = matrix[1], m30 = matrix[3]  // col 0
const m01 = matrix[4], m11 = matrix[5], m31 = matrix[7]  // col 1
const m03 = matrix[12], m13 = matrix[13], m33 = matrix[15] // col 3
```

| Pros | Cons |
|------|------|
| Matrix algebra is self-documenting | More verbose variable names |
| Standard notation familiar to graphics programmers | |

**Priority**: Low — the surrounding comments are adequate.

---

### 11. `extractMatrix()` Uses `as Record<string, unknown>`

**File**: `idw-custom.ts:672-678`

```ts
private extractMatrix(args: unknown): Float32Array | null {
  const a = args as Record<string, unknown>
  const projData = a?.defaultProjectionData as Record<string, unknown> | undefined
  const matrix = (projData?.mainMatrix ?? args) as Float64Array | number[]
  ...
}
```

The MapLibre render callback args are untyped (`unknown`). This function navigates the internal structure with defensive casting.

**Risk**: MapLibre internal API changes could break this silently.

**Recommendation**: Add a runtime shape check before casting, or define a local interface that documents the expected structure.

**Priority**: Low — works correctly, defensive null check on return handles failure gracefully.

---

### 12. Save Button Positioned with Pixel Offset `top-[84px]`

**File**: `GrowthHeatmap.tsx:538`

```tsx
className="absolute right-2.5 top-[84px] z-10 ..."
```

The `84px` offset positions the save button below MapLibre's NavigationControl. This is a magic number tied to the NavigationControl's rendered height.

**Risk**: If NavigationControl changes size (library update, compact mode, etc.), the button overlaps or has a gap.

**Recommendation**: Wrap the NavigationControl and save button in a flex container, or use a CSS custom property. Alternatively, document the 84px derivation with a comment.

**Priority**: Low — unlikely to change, but brittle.

---

### 13. `findNearestPoint()` Uses O(n) Linear Scan

**File**: `GrowthHeatmap.tsx:56-78`

Tooltip lookup scans all data points on every mouse move. With ~2,000 H3 cells this is fast (sub-millisecond), but scales linearly.

**Recommendation**: No action needed at current data volumes. If data grows significantly, consider a spatial index (R-tree or grid bucketing). Note: mouse move events are already debounced by React's synthetic event batching.

**Priority**: None — not a problem at current scale.

---

### 14. GrowthLegend Recomputes Gradient on Every Render

**File**: `GrowthLegend.tsx:13-16`

The gradient string is computed inline without `useMemo`. Since `GROWTH_COLOR_STOPS` is a module-level constant, the result never changes.

**Recommendation**: Compute at module level (outside the component) or wrap in `useMemo(() => ..., [])`.

**Priority**: None — trivial computation, no measurable impact.

---

## What's Already Good

These aspects of the codebase deserve recognition — they should be preserved and extended:

1. **Excellent documentation in `idw-custom.ts`**: The "Critical WebGL Constraints" header block and per-method JSDoc are exemplary. They explain *why* decisions were made, not just *what* the code does. The constraints section has saved (and will save) hours of debugging.

2. **Clean renderer abstraction**: The `HeatmapRenderer` interface in `types.ts` is well-designed — minimal surface area, clear lifecycle (`attach` → `setData` → `detach`), and optional capabilities (`setColorRange?`). Both renderers implement it cleanly.

3. **Dual-FBO transition animation**: The swap-and-crossfade approach in `uploadData()` is elegant and handles the NaN poisoning edge case correctly.

4. **Viewport culling**: CPU-side frustum culling with configurable `CULL_MARGIN` is a smart optimisation that keeps edge gradients smooth.

5. **GL state save/restore**: Saving and restoring `STENCIL_TEST`, `DEPTH_TEST`, `SCISSOR_TEST` in `renderFrame()` is correct and well-commented. Many custom layer implementations get this wrong.

6. **Color scale design**: Fixed stops (not data-driven quantiles) ensure visual consistency across settings. The diverging red-to-purple scale is perceptually effective.

7. **Small, focused subcomponents**: `GrowthLegend`, `GrowthTooltip`, `GrowthHeatmapSettings` are clean, well-typed, and independently testable.

---

## Recommended Action Plan

Prioritised list of refactoring tasks, ordered by impact-to-effort ratio:

### Phase 1 — Quick Wins (1-2 hours)

1. **Extract shared HSL parsing** into `color-scale.ts` (Findings #1, #8, #9)
   - Single `hslToRgbNorm()` returning `[r, g, b]` (0-1 floats)
   - Pre-parse `STOP_RGBS_NORM` at module level
   - Update `idw-custom.ts`, `idw-library.ts`, `color-scale.ts` to use it
   - Removes ~80 lines of duplicated code

2. **Extract layer ID constants** (Finding #4)
   - New file: `map-layers.ts` with `LAYER_IDS` and `SOURCE_IDS`
   - Rename `'water-mask-source'` → `'openmaptiles-vector'` (Finding #7)
   - Find-and-replace across 3 files

3. **Document the 84px offset** (Finding #12)
   - Add a comment explaining the NavigationControl height derivation

### Phase 2 — Structural Improvements (2-4 hours)

4. **Replace implicit hook ordering with explicit layer management** (Finding #2)
   - Recommend Option B (layer ordering hook) for long-term maintainability
   - Remove the 200ms setTimeout retry hack
   - Consider a `useMapLayers()` hook that manages all overlay layers with declarative ordering

5. **Fix saveViewport stale closure** (Finding #3)
   - Use a ref or Zustand's `getState()` for latest config

### Phase 3 — Nice-to-Haves (optional)

6. Add runtime check for library renderer monkey-patch (Finding #5)
7. Rename matrix variables for clarity (Finding #10)
8. Type the MapLibre render callback args locally (Finding #11)

---

## Conclusion

The growth heatmap widget is a strong piece of work — the WebGL rendering pipeline is sophisticated, well-documented, and correct. The issues identified are all in the "maintainability and code hygiene" category, not correctness. The highest-impact improvements are the HSL deduplication and the layer ordering refactor, which together would make the widget significantly easier to maintain and extend.
