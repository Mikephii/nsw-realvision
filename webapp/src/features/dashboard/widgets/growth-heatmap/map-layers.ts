/**
 * Shared layer and source IDs for the growth heatmap map overlay stack.
 *
 * Centralised here to prevent typos across files and document the
 * intended layer stacking order.
 *
 * Target stacking order (bottom to top):
 *   basemap tiles → IDW_CUSTOM → WATER_MASK → ROAD_OVERLAY → PLACE_LABELS
 */

export const LAYER_IDS = {
  /** Custom WebGL IDW interpolation layer (CustomLayerInterface). */
  IDW_CUSTOM: 'idw-custom',
  /** Library-based IDW interpolation layer (maplibre-gl-interpolate-heatmap). */
  IDW_LIBRARY: 'growth-heatmap-idw',
  /** Solid fill over water bodies to hide heatmap bleeding into ocean/harbour. */
  WATER_MASK: 'water-mask',
  /** Transportation lines (roads, railways) rendered above the heatmap. */
  ROAD_OVERLAY: 'road-overlay',
  /** Vector place name labels (city, suburb, etc.) on top of everything. */
  PLACE_LABELS: 'place-labels',
  /** Semi-transparent H3 polygon fill for estimated (neighbor-filled) cells. */
  ESTIMATED_HEXES: 'estimated-hexes',
  /** H3 hexagonal cell border shown on hover. */
  HEX_BORDER: 'hex-border',
} as const

export const SOURCE_IDS = {
  /** OpenMapTiles vector tiles — shared by water mask, roads, and labels. */
  OPENMAPTILES: 'openmaptiles-vector',
  /** GeoJSON source for estimated hex cell polygons. */
  ESTIMATED_HEXES: 'estimated-hexes-source',
  /** GeoJSON source for the H3 hex border hover highlight. */
  HEX_BORDER: 'hex-border-source',
} as const

/**
 * Declarative layer stacking order (bottom to top).
 *
 * Used by `useEnforceLayerOrder` to maintain correct ordering regardless
 * of the order in which layers are added by independent hooks. Any layer
 * listed here will be moved to its correct relative position whenever
 * the map becomes idle after rendering.
 */
export const LAYER_ORDER: ReadonlyArray<string> = [
  LAYER_IDS.IDW_CUSTOM,
  LAYER_IDS.ESTIMATED_HEXES,
  LAYER_IDS.WATER_MASK,
  LAYER_IDS.ROAD_OVERLAY,
  LAYER_IDS.PLACE_LABELS,
  LAYER_IDS.HEX_BORDER,
]
