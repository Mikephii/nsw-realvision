/**
 * Interface for heatmap rendering backends.
 *
 * Both the library-based IDW renderer and our custom WebGL shader
 * implement this interface. The GrowthHeatmap component holds a
 * ref to the active renderer and calls these methods — it never
 * touches MapLibre layers directly for the heatmap visualization.
 *
 * This abstraction lets us:
 * - Toggle between renderers at runtime via config.renderer
 * - Develop the custom shader without breaking the working library version
 * - Test renderer performance side-by-side
 */

import type maplibregl from 'maplibre-gl'
import type { HeatmapDataPoint } from '@/lib/heatmap-queries'

export interface HeatmapRenderer {
  /** Unique ID for this renderer (used as MapLibre layer ID prefix). */
  readonly id: string

  /**
   * Add the renderer's layer(s) to the map.
   * Called once when the map is ready and the renderer is first activated.
   */
  attach: (map: maplibregl.Map) => void

  /**
   * Update the rendered data.
   * Called when new growth data arrives (config change, zoom resolution change).
   */
  setData: (points: Array<HeatmapDataPoint>) => void

  /**
   * Update the opacity of the rendered layer.
   * Used for cross-fade transitions when switching resolutions.
   */
  setOpacity: (opacity: number) => void

  /**
   * Remove the renderer's layer(s) from the map.
   * Called when switching renderers or unmounting the widget.
   */
  detach: () => void

  /**
   * Update the color mapping range without re-fetching data.
   * Only supported by the custom WebGL renderer.
   */
  setColorRange?: (min: number, max: number) => void

  /**
   * Replace the color stops used for the visualization.
   * Rebuilds the color ramp and triggers a repaint.
   */
  setColorStops?: (
    stops: Array<[number, string]>,
    rgbs: Array<[number, number, number]>,
  ) => void
}
