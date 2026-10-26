import type { StyleSpecification } from 'maplibre-gl'
import { TILE_URLS, vectorTilesSource } from '@/lib/map-tiles'

/** Light basemap for the property and area maps: OpenStreetMap raster tiles. */
export const MAP_STYLE_LIGHT: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [TILE_URLS.basemapLight],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

/** Dark basemap: a MapLibre style URL (OpenFreeMap Dark by default). */
export const MAP_STYLE_DARK: string = TILE_URLS.styleDark

/** Muted light basemap with labels: a MapLibre style URL (OpenFreeMap Positron by default). */
export const MAP_STYLE_LIGHT_MONO: string = TILE_URLS.styleLightMono

interface NoLabelsPalette {
  background: string
  park: string
  water: string
}

/**
 * A quiet vector basemap with no labels, roads or water drawn on top: land, parks and water only.
 * The heatmap draws its own water mask, roads and place labels above its colour layer, so this is
 * just what shows at the edges and offshore.
 */
function noLabelsStyle(palette: NoLabelsPalette): StyleSpecification {
  return {
    version: 8,
    glyphs: TILE_URLS.glyphs,
    sources: { basemap: vectorTilesSource() },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': palette.background },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'park',
        paint: { 'fill-color': palette.park, 'fill-opacity': 0.6 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': palette.water },
      },
    ],
  }
}

/** Light basemap without text labels, for layering the heatmap between base and labels. */
export const MAP_STYLE_LIGHT_NOLABELS: StyleSpecification = noLabelsStyle({
  background: '#f3f3f1',
  park: '#e3eadf',
  water: '#d6dee6',
})

/** Dark basemap without text labels, for layering the heatmap between base and labels. */
export const MAP_STYLE_DARK_NOLABELS: StyleSpecification = noLabelsStyle({
  background: '#1c1d21',
  park: '#202722',
  water: '#15191f',
})

export const NSW_CENTER = { longitude: 151.2, latitude: -33.8 }
export const NSW_ZOOM = 6
