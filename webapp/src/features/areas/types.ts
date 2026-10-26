/**
 * Core type system for custom map areas.
 *
 * Custom areas are user-defined geographic polygons that act as reusable
 * filters across the entire application. They are a first-class, app-wide
 * resource — not tied to any single widget or dashboard.
 *
 * The type system is designed with three layers of abstraction:
 * - **Entity layer** (`CustomArea`) — what gets stored and managed
 * - **Filter layer** (`GeographicFilter`) — how widgets reference locations
 * - **Query layer** (`SpatialFilter`) — what gets sent to DuckDB
 *
 * This separation ensures that swapping the storage backend (localStorage →
 * a server store) or query engine only requires changing implementations, not
 * the types themselves.
 */

// ---------------------------------------------------------------------------
// Entity Types
// ---------------------------------------------------------------------------

/**
 * A user-defined geographic area represented as a GeoJSON polygon.
 *
 * Areas are a first-class, app-wide resource that can be used as
 * geographic filters in any widget (property map, median price chart, etc.).
 * They persist across sessions and are independent of any dashboard or widget.
 *
 * @example
 * ```ts
 * const area: CustomArea = {
 *   id: 'a1b2c3d4-...',
 *   name: 'Bondi Beach Pocket',
 *   polygon: {
 *     type: 'Polygon',
 *     coordinates: [[[151.27, -33.89], [151.28, -33.89], [151.28, -33.90], [151.27, -33.89]]],
 *   },
 *   color: '#3b82f6',
 *   createdAt: 1708800000000,
 *   updatedAt: 1708800000000,
 * }
 * ```
 */
export interface CustomArea {
  /** Unique identifier (UUID). Stable across sessions. */
  readonly id: string

  /** User-given display name (e.g. "My Area", "Beach Streets"). */
  name: string

  /** Optional user-provided description of what this area represents. */
  description?: string

  /**
   * GeoJSON Polygon geometry defining the area boundary.
   *
   * Coordinates are `[longitude, latitude]` per the GeoJSON spec (RFC 7946).
   * The outer ring must be closed (first and last coordinate identical).
   */
  polygon: GeoJSON.Polygon

  /** Hex color for rendering on maps and in UI chips (e.g. "#3b82f6"). */
  color: string

  /** Unix timestamp (ms) when the area was first created. */
  readonly createdAt: number

  /** Unix timestamp (ms) when the area was last modified. */
  updatedAt: number
}

/**
 * Mutable fields of a {@link CustomArea} that can be updated after creation.
 * Used by {@link AreaRepository.update} to accept partial updates.
 */
export type CustomAreaUpdate = Partial<
  Pick<CustomArea, 'name' | 'description' | 'polygon' | 'color'>
>

/**
 * Fields required to create a new {@link CustomArea}.
 * The store generates `id`, `createdAt`, and `updatedAt` automatically.
 * Color is optional — the store auto-assigns from {@link AREA_COLORS}
 * if not provided.
 */
export type CustomAreaCreate = Omit<
  CustomArea,
  'id' | 'createdAt' | 'updatedAt' | 'color'
> & {
  /** Optional hex color. Auto-assigned from {@link AREA_COLORS} round-robin if omitted. */
  color?: string
}

// ---------------------------------------------------------------------------
// Area Group Types (future — not implemented yet)
// ---------------------------------------------------------------------------

/**
 * A named collection of custom areas and/or localities.
 *
 * Designed for future implementation — allows users to group
 * multiple areas and suburbs into a single reusable filter.
 */
export interface AreaGroup {
  readonly id: string
  name: string
  description?: string
  /** Custom area IDs belonging to this group. */
  areaIds: Array<string>
  /** Suburb/locality names belonging to this group. */
  localities: Array<string>
  readonly createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Spatial Types
// ---------------------------------------------------------------------------

/**
 * Axis-aligned bounding box (AABB) for a geographic region.
 *
 * Used as a pre-filter in spatial queries: a B-tree range scan on
 * indexed lat/lon columns eliminates 95%+ of candidate rows before
 * the expensive ST_Within point-in-polygon check runs.
 *
 * All values are in decimal degrees (WGS 84).
 */
export interface AreaBounds {
  /** Southern boundary (minimum latitude, e.g. -33.95). */
  minLat: number

  /** Northern boundary (maximum latitude, e.g. -33.85). */
  maxLat: number

  /** Western boundary (minimum longitude, e.g. 151.18). */
  minLon: number

  /** Eastern boundary (maximum longitude, e.g. 151.28). */
  maxLon: number
}

/**
 * A resolved spatial filter ready for use in DuckDB queries.
 *
 * This is the boundary type between the UI/state layer (which deals with
 * GeoJSON polygons and area IDs) and the query layer (which deals with
 * SQL predicates and DuckDB's spatial extension functions).
 *
 * The query layer uses {@link bounds} for a bounding-box pre-filter
 * (`WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`) and {@link wkt}
 * for the exact `ST_Within(ST_Point(...), ST_GeomFromText(?))` check.
 *
 * @example
 * ```ts
 * const filter: SpatialFilter = {
 *   wkt: 'POLYGON((151.18 -33.85, 151.23 -33.85, 151.23 -33.90, 151.18 -33.90, 151.18 -33.85))',
 *   bounds: { minLat: -33.90, maxLat: -33.85, minLon: 151.18, maxLon: 151.23 },
 *   label: 'My Area',
 * }
 * ```
 */
export interface SpatialFilter {
  /**
   * Well-Known Text representation of the polygon.
   * Passed to DuckDB's `ST_GeomFromText()`.
   */
  wkt: string

  /** Bounding box for the BETWEEN pre-filter on indexed lat/lon columns. */
  bounds: AreaBounds

  /**
   * Display label for this filter.
   * Used in chart legends and as a GROUP BY alias in aggregation queries.
   */
  label: string
}

// ---------------------------------------------------------------------------
// Filter Types
// ---------------------------------------------------------------------------

/**
 * A generalised geographic filter that supports both suburb-based
 * and custom-area-based filtering.
 *
 * This replaces the raw `localities: string[]` pattern in widget configs.
 * Widgets reference areas by ID; the query layer resolves IDs to polygons
 * via the area store.
 *
 * Filtering uses OR logic: a property matches if it's in ANY selected
 * locality OR inside ANY selected custom area.
 *
 * When migrating to server-side storage, only the resolution step changes
 * (client store lookup → server-side lookup). Widget configs and
 * query logic remain unchanged.
 */
export interface GeographicFilter {
  /** Suburb/locality names for `WHERE locality IN (...)` filtering. */
  localities: Array<string>

  /** Custom area IDs to resolve to spatial polygon filters. */
  areaIds: Array<string>
}

// ---------------------------------------------------------------------------
// Repository Interface
// ---------------------------------------------------------------------------

/**
 * Persistence interface for custom area CRUD operations.
 *
 * Provides a clean abstraction over the storage backend. All consumers
 * (hooks, components, query resolvers) program against this interface.
 *
 * **Current implementation:** Zustand store backed by localStorage.
 * A server-backed implementation can replace it.
 *
 * Swapping the implementation requires no changes to any consumer code.
 */
export interface AreaRepository {
  /** Retrieve all saved areas, ordered by creation date (newest first). */
  getAll: () => Array<CustomArea>

  /** Retrieve a single area by ID. Returns `undefined` if not found. */
  getById: (id: string) => CustomArea | undefined

  /**
   * Create a new area. The repository generates `id`, `createdAt`,
   * and `updatedAt` automatically.
   * @returns The generated area ID.
   */
  create: (area: CustomAreaCreate) => string

  /**
   * Update an existing area's mutable fields (name, polygon, color).
   * Automatically updates `updatedAt`. No-op if the area doesn't exist.
   */
  update: (id: string, changes: CustomAreaUpdate) => void

  /**
   * Permanently delete an area by ID.
   * No-op if the area doesn't exist.
   */
  remove: (id: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default color palette for custom areas.
 *
 * Colors are auto-assigned to new areas in round-robin order. Chosen for
 * visual distinction on both light and dark map tiles, and for accessibility
 * (sufficient contrast between adjacent colors).
 */
export const AREA_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
] as const
