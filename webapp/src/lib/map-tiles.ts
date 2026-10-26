/**
 * Map tile, style and font URLs, in one place so a deployment can point them at its own or a
 * keyed provider. Each reads a `VITE_` env var at build time and falls back to a free public
 * default that needs no API key.
 *
 * The defaults have usage policies: the OpenStreetMap tile server is not for heavy app use, and
 * OpenFreeMap and the OpenMapTiles font server are community-run. See docs/self-hosting.md before
 * deploying publicly.
 */

import type { VectorSourceSpecification } from 'maplibre-gl'

function fromEnv(value: string | undefined, fallback: string): string {
  return value && value.trim() !== '' ? value.trim() : fallback
}

const env = import.meta.env

export const TILE_URLS = {
  /** Raster basemap for the light property and area maps (an XYZ template). */
  basemapLight: fromEnv(
    env.VITE_BASEMAP_LIGHT_URL,
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  ),
  /** MapLibre style URL for dark-theme maps. */
  styleDark: fromEnv(
    env.VITE_MAP_STYLE_DARK_URL,
    'https://tiles.openfreemap.org/styles/dark',
  ),
  /** MapLibre style URL for the muted light map (relative performance). */
  styleLightMono: fromEnv(
    env.VITE_MAP_STYLE_LIGHT_MONO_URL,
    'https://tiles.openfreemap.org/styles/positron',
  ),
  /**
   * OpenMapTiles-schema vector tiles, for the heatmap's basemap, water mask, roads and place
   * labels. Either a TileJSON URL or an XYZ template containing `{z}`.
   */
  vectorTiles: fromEnv(
    env.VITE_VECTOR_TILES_URL,
    'https://tiles.openfreemap.org/planet',
  ),
  /** Font glyphs for vector labels. */
  glyphs: fromEnv(
    env.VITE_MAP_GLYPHS_URL,
    'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  ),
} as const

/** Attribution for the OpenMapTiles vector source. */
export const VECTOR_TILES_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

/** The OpenMapTiles vector source, from a TileJSON URL or an XYZ template. */
export function vectorTilesSource(): VectorSourceSpecification {
  const url = TILE_URLS.vectorTiles
  return url.includes('{z}')
    ? {
        type: 'vector',
        tiles: [url],
        maxzoom: 14,
        attribution: VECTOR_TILES_ATTRIBUTION,
      }
    : { type: 'vector', url, attribution: VECTOR_TILES_ATTRIBUTION }
}
