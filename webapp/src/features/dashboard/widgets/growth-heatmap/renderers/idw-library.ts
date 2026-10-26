/**
 * IDW renderer using the maplibre-gl-interpolate-heatmap library.
 *
 * This is the default renderer. It wraps the MaplibreInterpolateHeatmapLayer
 * which implements MapLibre's CustomLayerInterface with a 3-pass WebGL pipeline:
 * 1. Scatter data points to a framebuffer texture
 * 2. Accumulate weighted values per pixel (IDW kernel)
 * 3. Map accumulated values to colors via a custom GLSL function
 *
 * The library normalizes all data values to the 0-1 range internally using
 * (val - minValue) / (maxValue - minValue), then passes that normalized
 * float to the valueToColor(float) GLSL function.
 *
 * The library doesn't support dynamic data updates, so on setData() we
 * remove the old layer and add a new one with the new data.
 */

import {
  GROWTH_COLOR_STOPS,
  STOP_RGBS_NORM,
  rgbNormToGlslVec3,
} from '../color-scale'
import { LAYER_IDS } from '../map-layers'
import type maplibregl from 'maplibre-gl'
import type { HeatmapRenderer } from './types'
import type { HeatmapDataPoint } from '@/lib/heatmap-queries'

/**
 * Build a GLSL valueToColor function from our growth color stops.
 *
 * The library calls `vec3 valueToColor(float value)` for each pixel where
 * `value` is already normalized to [0, 1] by the library. We map this
 * normalized value through our diverging color scale using mix/smoothstep.
 *
 * Our stops go from -0.05 to +0.15, which the library maps to 0.0 to 1.0.
 * So normalized 0.0 = -5% growth (red), 0.25 = 0% (yellow), 1.0 = +15% (purple).
 */
function buildGlslColorFunction(): string {
  const minGrowth = GROWTH_COLOR_STOPS[0][0]
  const maxGrowth = GROWTH_COLOR_STOPS[GROWTH_COLOR_STOPS.length - 1][0]
  const range = maxGrowth - minGrowth

  const lines: Array<string> = []
  lines.push('vec3 valueToColor(float value) {')

  // Start with the first stop's color (pre-parsed from color-scale.ts)
  lines.push(`  vec3 color = ${rgbNormToGlslVec3(STOP_RGBS_NORM[0])};`)

  // Each subsequent stop blends in with smoothstep
  for (let i = 1; i < GROWTH_COLOR_STOPS.length; i++) {
    const [prevGrowth] = GROWTH_COLOR_STOPS[i - 1]
    const [curGrowth] = GROWTH_COLOR_STOPS[i]
    const rgb = rgbNormToGlslVec3(STOP_RGBS_NORM[i])

    // Map growth values to the 0-1 normalized range
    const normPrev = (prevGrowth - minGrowth) / range
    const normCur = (curGrowth - minGrowth) / range

    lines.push(
      `  color = mix(color, ${rgb}, smoothstep(${normPrev.toFixed(4)}, ${normCur.toFixed(4)}, value));`,
    )
  }

  // Boost saturation and brightness to compensate for multiply blend darkening.
  // Multiply blend: result = heatmap × basemap_gray, which halves intensity.
  // Pre-brighten here so the final composited colors are vivid.
  lines.push('  float luma = dot(color, vec3(0.299, 0.587, 0.114));')
  lines.push('  color = mix(vec3(luma), color, 1.6);') // 60% saturation boost
  lines.push('  color = pow(color, vec3(0.7));') // gamma brighten
  lines.push('  color = clamp(color, 0.0, 1.0);')

  lines.push('  return color;')
  lines.push('}')
  return lines.join('\n')
}

export class LibraryIDWRenderer implements HeatmapRenderer {
  readonly id = 'idw-library'

  private map: maplibregl.Map | null = null
  private layerId: string = LAYER_IDS.IDW_LIBRARY
  private currentOpacity = 0.8
  private currentData: Array<HeatmapDataPoint> = []

  attach(map: maplibregl.Map): void {
    this.map = map
  }

  setData(points: Array<HeatmapDataPoint>): void {
    if (!this.map) return
    this.currentData = points

    // Remove existing layer if present
    this.removeLayer()

    if (points.length === 0) return

    // Dynamically import the library (it's a heavy WebGL module)
    import('maplibre-gl-interpolate-heatmap')
      .then(({ MaplibreInterpolateHeatmapLayer }) => {
        if (!this.map) {
          console.warn('[IDW] map gone before layer could be added')
          return
        }

        const minGrowth = GROWTH_COLOR_STOPS[0][0]
        const maxGrowth = GROWTH_COLOR_STOPS[GROWTH_COLOR_STOPS.length - 1][0]

        // Clamp growth values to the color stop range. The library expands its
        // normalization range to fit ALL data values (including outliers), which
        // compresses our GLSL color function into a subset of [0,1] and makes
        // most values map to the same color. Clamping ensures the library's
        // normalization matches our GLSL expectations exactly.
        const data = points.map((p) => ({
          lat: p.lat,
          lon: p.lng,
          val: Math.max(minGrowth, Math.min(maxGrowth, p.growth)),
        }))

        const layer = new MaplibreInterpolateHeatmapLayer({
          id: this.layerId,
          data,
          opacity: this.currentOpacity,
          minValue: minGrowth,
          maxValue: maxGrowth,
          p: 3,
          framebufferFactor: 0.5,
          valueToColor: buildGlslColorFunction(),
        })

        // Multiply blend mode: tints the basemap instead of alpha overlay.
        // Intercepts only the final compositing pass (SRC_ALPHA, ONE_MINUS_SRC_ALPHA)
        // and replaces with multiply (DST_COLOR, ONE_MINUS_SRC_ALPHA).
        //
        // This monkey-patches the library layer's internal render() method.
        // Guard against library API changes that might rename or remove it.
        const layerAny = layer as unknown as Record<string, unknown>
        if (typeof layerAny.render !== 'function') {
          console.warn(
            '[IDW] Library layer has no render method — skipping blend patch. Library API may have changed.',
          )
        } else {
          const originalRender = (layerAny.render).bind(layer)
          layerAny.render = (gl: WebGL2RenderingContext, options: unknown) => {
            const origBlendFunc = gl.blendFunc.bind(gl)
            gl.blendFunc = (sfactor: number, dfactor: number) => {
              if (
                sfactor === gl.SRC_ALPHA &&
                dfactor === gl.ONE_MINUS_SRC_ALPHA
              ) {
                origBlendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA)
              } else {
                origBlendFunc(sfactor, dfactor)
              }
            }
            originalRender(gl, options)
            gl.blendFunc = origBlendFunc
          }
        }

        try {
          this.map.addLayer(layer as unknown as maplibregl.LayerSpecification)
        } catch (err) {
          console.error('[IDW] Failed to add layer:', err)
        }

        // Ensure water mask stays on top of the heatmap layer
        if (this.map.getLayer(LAYER_IDS.WATER_MASK)) {
          this.map.moveLayer(LAYER_IDS.WATER_MASK)
        }
      })
      .catch((err) => {
        console.error('[IDW] Failed to import library:', err)
      })
  }

  setOpacity(opacity: number): void {
    this.currentOpacity = opacity
    // Re-render with new opacity if we have data
    if (this.currentData.length > 0) {
      this.setData(this.currentData)
    }
  }

  detach(): void {
    this.removeLayer()
    this.map = null
    this.currentData = []
  }

  private removeLayer(): void {
    if (!this.map) return
    try {
      if (this.map.getLayer(this.layerId)) {
        this.map.removeLayer(this.layerId)
      }
    } catch {
      // Layer may already be removed
    }
  }
}
