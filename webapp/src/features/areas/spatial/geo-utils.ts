/**
 * Spatial geometry utilities for converting between GeoJSON, WKT,
 * and bounding box representations.
 *
 * These functions sit at the boundary between the UI/state layer
 * (which deals with GeoJSON polygons and {@link CustomArea} entities)
 * and the query layer (which deals with {@link SpatialFilter} objects
 * containing WKT strings and bounding boxes for DuckDB).
 *
 * All coordinate handling follows the GeoJSON convention:
 * `[longitude, latitude]` (easting, northing).
 */

import type { AreaBounds, CustomArea, SpatialFilter } from '../types'

/**
 * Convert a GeoJSON Polygon to Well-Known Text (WKT) format.
 *
 * WKT is the format accepted by DuckDB's `ST_GeomFromText()` function.
 * Only the outer ring is converted (holes are not supported for custom areas).
 *
 * @param polygon - A GeoJSON Polygon geometry.
 * @returns WKT string, e.g. `"POLYGON((151.20 -33.86, 151.21 -33.87, ...))"`.
 *
 * @example
 * ```ts
 * const wkt = polygonToWKT({
 *   type: 'Polygon',
 *   coordinates: [[[151.20, -33.86], [151.21, -33.87], [151.20, -33.86]]],
 * })
 * // => 'POLYGON((151.2 -33.86, 151.21 -33.87, 151.2 -33.86))'
 * ```
 */
export function polygonToWKT(polygon: GeoJSON.Polygon): string {
  const ring = polygon.coordinates[0]
    .map(([lon, lat]) => `${lon} ${lat}`)
    .join(', ')
  return `POLYGON((${ring}))`
}

/**
 * Compute the axis-aligned bounding box of a GeoJSON Polygon.
 *
 * The bounding box is used as a pre-filter in spatial queries:
 * `WHERE lat BETWEEN minLat AND maxLat AND lon BETWEEN minLon AND maxLon`.
 * This B-tree range scan eliminates 95%+ of rows before the expensive
 * `ST_Within` point-in-polygon check.
 *
 * @param polygon - A GeoJSON Polygon geometry.
 * @returns Bounding box with min/max lat/lon in decimal degrees.
 *
 * @example
 * ```ts
 * const bbox = polygonBBox({
 *   type: 'Polygon',
 *   coordinates: [[[151.18, -33.90], [151.23, -33.85], [151.18, -33.90]]],
 * })
 * // => { minLat: -33.90, maxLat: -33.85, minLon: 151.18, maxLon: 151.23 }
 * ```
 */
export function polygonBBox(polygon: GeoJSON.Polygon): AreaBounds {
  const coords = polygon.coordinates[0]
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity

  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }

  return { minLat, maxLat, minLon, maxLon }
}

/**
 * Convert a {@link CustomArea} entity into a {@link SpatialFilter}
 * ready for use in DuckDB queries.
 *
 * This is the key translation function between the storage layer
 * (CustomArea with GeoJSON) and the query layer (SpatialFilter with WKT).
 *
 * @param area - A saved custom area.
 * @returns A spatial filter with WKT, bounding box, and display label.
 */
export function toSpatialFilter(area: CustomArea): SpatialFilter {
  return {
    wkt: polygonToWKT(area.polygon),
    bounds: polygonBBox(area.polygon),
    label: area.name,
  }
}

/**
 * Resolve an array of area IDs to {@link SpatialFilter} objects.
 *
 * Looks up each area by ID using the provided getter function, converts
 * found areas to spatial filters, and silently skips any IDs that don't
 * resolve (e.g. deleted areas still referenced in a widget config).
 *
 * @param areaIds - Array of custom area IDs to resolve.
 * @param getById - Lookup function (typically from the area store).
 * @returns Array of resolved spatial filters (may be shorter than input if some IDs are invalid).
 */
export function resolveSpatialFilters(
  areaIds: Array<string>,
  getById: (id: string) => CustomArea | undefined,
): Array<SpatialFilter> {
  const filters: Array<SpatialFilter> = []
  for (const id of areaIds) {
    const area = getById(id)
    if (area) {
      filters.push(toSpatialFilter(area))
    }
  }
  return filters
}
