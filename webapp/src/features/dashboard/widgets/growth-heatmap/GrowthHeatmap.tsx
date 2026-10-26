/**
 * Growth Heatmap widget.
 *
 * Renders a MapLibre map with an IDW interpolation layer showing
 * annualized property growth rates across NSW. Data is fetched from
 * the pre-aggregated agg_h3_growth table via server function.
 *
 * Architecture:
 * 1. Map renders with light basemap tiles (always light — multiply blend needs light base)
 * 2. useWidgetData fetches HeatmapDataPoint[] for current config + resolution
 * 3. Zoom changes trigger resolution switches (debounced)
 * 4. HeatmapRenderer (pluggable) renders IDW interpolation
 * 5. React overlays: legend, tooltip, loading state
 *
 * Data flow:
 *   config change -> useWidgetData refetch -> renderer.setData()
 *   zoom change -> resolution check -> new fetch if needed -> renderer.setData()
 *   renderer switch -> detach old -> attach new -> setData
 */

import { vectorTilesSource } from '@/lib/map-tiles'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map, NavigationControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { toast } from 'sonner'
import { cellToBoundary } from 'h3-js'

import { useWidgetData } from '../../hooks/use-widget-data'
import { useWidgetStore } from '../../stores/widget-store'
import { DatePresetBar } from '../../components/DatePresetBar'
import {
  MAP_STYLE_LIGHT_NOLABELS,
  NSW_CENTER,
  NSW_ZOOM,
} from '../property-map/map-style'
import { useMapEffect } from '../property-map/use-map-effect'
import { resolutionForZoom } from './types'
import { GrowthLegend } from './GrowthLegend'
import {
  DEFAULT_RESOLVED,
  
  growthToColor,
  resolveColorStops
} from './color-scale'
import type {ResolvedColorStops} from './color-scale';
import { EstimatedTooltip, GrowthTooltip } from './GrowthTooltip'
import { MapTooltipPortal } from './MapTooltipPortal'
import { LibraryIDWRenderer } from './renderers/idw-library'
import { CustomIDWRenderer } from './renderers/idw-custom'
import { LAYER_IDS, LAYER_ORDER, SOURCE_IDS } from './map-layers'
import { useEnforceLayerOrder } from './use-enforce-layer-order'
import { HexDetailDialog } from './HexDetailDialog'
import type { MapRef } from 'react-map-gl/maplibre'
import type { HeatmapRenderer } from './renderers/types'
import type { GrowthHeatmapConfig } from './types'
import type { HeatmapDataPoint } from '@/lib/heatmap-queries'
import { heatmapEndYear } from '@/lib/heatmap-queries'
import { useDataCoverage } from '@/lib/data-coverage'
import type { GeoJSONSource } from 'maplibre-gl'
import type maplibreglType from 'maplibre-gl'
import type {EstimatedHexCell} from '@/lib/heatmap-stats';
import {  fillAdjacentHexes } from '@/lib/heatmap-stats'
import { getHeatmapGrowthData, getLoessHeatmapData } from '@/lib/server-fns'
import { useTheme } from '@/components/ThemeProvider'

interface Props {
  config: GrowthHeatmapConfig
  widgetId: string
}

/**
 * Find the nearest data point to a given lat/lng.
 * Uses simple Euclidean distance on lat/lng (sufficient for tooltip proximity).
 */
function findNearestPoint(
  points: Array<HeatmapDataPoint>,
  lat: number,
  lng: number,
  maxDistDeg = 0.5,
): HeatmapDataPoint | null {
  let nearest: HeatmapDataPoint | null = null
  let minDist = Infinity

  for (const point of points) {
    const dlat = point.lat - lat
    const dlng = point.lng - lng
    const dist = dlat * dlat + dlng * dlng
    if (dist < minDist) {
      minDist = dist
      nearest = point
    }
  }

  // Only return if within a reasonable distance
  if (minDist > maxDistDeg * maxDistDeg) return null
  return nearest
}

/**
 * Find the nearest estimated cell to a given lat/lng.
 * Tighter distance threshold than observed points.
 */
function findNearestEstimatedCell(
  cells: Array<EstimatedHexCell>,
  lat: number,
  lng: number,
  maxDistDeg = 0.3,
): EstimatedHexCell | null {
  let nearest: EstimatedHexCell | null = null
  let minDist = Infinity

  for (const cell of cells) {
    const dlat = cell.lat - lat
    const dlng = cell.lng - lng
    const dist = dlat * dlat + dlng * dlng
    if (dist < minDist) {
      minDist = dist
      nearest = cell
    }
  }

  if (minDist > maxDistDeg * maxDistDeg) return null
  return nearest
}

/** Convert an H3 cell index to a GeoJSON polygon ring ([lng, lat][], closed). */
function h3ToGeoJsonRing(h3Index: string): Array<Array<number>> {
  const boundary = cellToBoundary(h3Index)
  // cellToBoundary returns [lat, lng][] — GeoJSON needs [lng, lat][]
  const coords = boundary.map(([lat, lng]) => [lng, lat])
  coords.push(coords[0]) // close the ring
  return coords
}

export function GrowthHeatmap({ config, widgetId }: Props) {
  const mapRef = useRef<MapRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapInstance, setMapInstance] = useState<maplibreglType.Map | null>(
    null,
  )
  const { theme } = useTheme()
  const updateWidgetConfig = useWidgetStore((s) => s.updateWidgetConfig)

  // Current H3 resolution derived from zoom level.
  // Initialise from saved viewport zoom so the first fetch uses the correct resolution.
  const [resolution, setResolution] = useState<7 | 8 | 9>(
    resolutionForZoom(config.viewport?.zoom ?? NSW_ZOOM),
  )

  // Viewport bounds for spatial filtering at high resolutions (res 8+).
  // Updated on moveend with debounce. Includes a buffer zone so IDW
  // interpolation near edges has neighboring points to work with.
  const [viewportBounds, setViewportBounds] = useState<{
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  } | null>(null)

  // Tooltip state — discriminated union: observed data point or estimated cell
  const [tooltip, setTooltip] = useState<
    | { kind: 'observed'; point: HeatmapDataPoint; x: number; y: number }
    | { kind: 'estimated'; cell: EstimatedHexCell; x: number; y: number }
    | null
  >(null)

  // Selected hex cell for detail dialog
  const [selectedPoint, setSelectedPoint] = useState<HeatmapDataPoint | null>(
    null,
  )

  // Track mousedown position to distinguish clicks from drag-pans
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null)

  // Renderer ref (persists across renders)
  const rendererRef = useRef<HeatmapRenderer | null>(null)

  // Config ref — used by saveViewport so it always reads the latest config
  // at invocation time, avoiding stale closure captures in useCallback.
  const configRef = useRef(config)
  configRef.current = config

  // Resolve color stops from custom config or defaults
  const resolvedStops = useMemo((): ResolvedColorStops => {
    if (config.customColorStops && config.customColorStops.length >= 2) {
      return resolveColorStops(config.customColorStops)
    }
    return DEFAULT_RESOLVED
  }, [config.customColorStops])

  // Resolve the effective lookback period: LOESS has its own expanded options
  // customRange overrides preset-based lookback for LOESS method.
  const effectiveYearsBack =
    config.growthMethod === 'loess'
      ? config.customRange
        ? config.customRange.endYear - config.customRange.startYear
        : (config.loessYearsBack ?? config.yearsBack)
      : config.yearsBack

  // Periods end at the data's latest year, not today's date
  const endYear = heatmapEndYear(useDataCoverage())

  // Viewport filtering only at res 8+ (res 7 has few enough cells to fetch all NSW)
  const fetchViewport = resolution >= 8 ? viewportBounds : undefined

  // Build the config key that includes resolution + viewport (triggers data fetch)
  const fetchConfig = useMemo(
    () => ({
      ...config,
      resolution,
      fetchViewport,
      endYear,
    }),
    [config, resolution, fetchViewport, endYear],
  )

  // Fetch data using useWidgetData
  const { data, isLoading, error, refetch } = useWidgetData<
    typeof fetchConfig,
    Array<HeatmapDataPoint>
  >(widgetId, fetchConfig, async (cfg) => {
    if (cfg.growthMethod === 'loess') {
      let startQ: number
      let endQ: number
      if (cfg.customRange) {
        startQ = cfg.customRange.startYear
        endQ = cfg.customRange.endYear
      } else {
        endQ = cfg.endYear
        const loessYears = cfg.loessYearsBack ?? cfg.yearsBack
        startQ = endQ - loessYears
      }
      return getLoessHeatmapData({
        data: {
          resolution: cfg.resolution,
          metric: cfg.metric,
          strataFilter: cfg.strataFilter,
          startQuarter: startQ,
          endQuarter: endQ,
          viewport: cfg.fetchViewport ?? undefined,
        },
      })
    }
    return getHeatmapGrowthData({
      data: {
        resolution: cfg.resolution,
        yearsBack: cfg.yearsBack,
        metric: cfg.metric,
        strataFilter: cfg.strataFilter,
        growthMethod: cfg.growthMethod,
        viewport: cfg.fetchViewport ?? undefined,
      },
    })
  })

  // Compute estimated hex cells when fillSparseHexes is enabled
  const estimatedCells = useMemo(() => {
    if (!config.fillSparseHexes || !data || data.length === 0) return []
    return fillAdjacentHexes(data)
  }, [data, config.fillSparseHexes])

  // Merge estimated cells into the renderer data so IDW extends the gradient
  const rendererData = useMemo(() => {
    if (!data || estimatedCells.length === 0) return data
    const estimatedAsPoints: Array<HeatmapDataPoint> = estimatedCells.map((c) => ({
      lat: c.lat,
      lng: c.lng,
      growth: c.growth,
      saleCount: 0,
      medianStart: 0,
      medianEnd: 0,
      locality: null,
      h3Index: c.h3Index,
    }))
    return [...data, ...estimatedAsPoints]
  }, [data, estimatedCells])

  // Build GeoJSON FeatureCollection for estimated hex polygons
  const estimatedGeoJson = useMemo((): GeoJSON.FeatureCollection => {
    if (estimatedCells.length === 0) {
      return { type: 'FeatureCollection', features: [] }
    }

    const features: Array<GeoJSON.Feature> = []
    for (const cell of estimatedCells) {
      try {
        const [r, g, b] = growthToColor(cell.growth, resolvedStops)
        features.push({
          type: 'Feature',
          properties: { color: `rgb(${r}, ${g}, ${b})` },
          geometry: {
            type: 'Polygon',
            coordinates: [h3ToGeoJsonRing(cell.h3Index)],
          },
        })
      } catch {
        // Invalid h3 index — skip
      }
    }

    return { type: 'FeatureCollection', features }
  }, [estimatedCells, resolvedStops])

  // ResizeObserver for grid layout changes
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize()
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // --- Zoom tracking -> resolution switching ---
  useMapEffect(
    mapInstance,
    (map) => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null

      const onZoomEnd = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const newRes = resolutionForZoom(map.getZoom())
          setResolution((prev) => {
            if (prev !== newRes) return newRes
            return prev
          })
        }, 200)
      }

      map.on('zoomend', onZoomEnd)
      return () => {
        map.off('zoomend', onZoomEnd)
        if (debounceTimer) clearTimeout(debounceTimer)
      }
    },
    [],
  )

  // --- Viewport bounds tracking for spatial filtering ---
  // Only used at res 8+ to avoid fetching all of NSW at fine resolutions.
  // Buffer of 0.5° (~55 km) ensures IDW has data beyond the visible edge.
  useMapEffect(
    mapInstance,
    (map) => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      const BUFFER_DEG = 0.5

      const updateBounds = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const b = map.getBounds()
          setViewportBounds({
            minLat: b.getSouth() - BUFFER_DEG,
            maxLat: b.getNorth() + BUFFER_DEG,
            minLng: b.getWest() - BUFFER_DEG,
            maxLng: b.getEast() + BUFFER_DEG,
          })
        }, 500)
      }

      // Set initial bounds immediately (no debounce)
      const b = map.getBounds()
      setViewportBounds({
        minLat: b.getSouth() - BUFFER_DEG,
        maxLat: b.getNorth() + BUFFER_DEG,
        minLng: b.getWest() - BUFFER_DEG,
        maxLng: b.getEast() + BUFFER_DEG,
      })

      map.on('moveend', updateBounds)
      return () => {
        map.off('moveend', updateBounds)
        if (debounceTimer) clearTimeout(debounceTimer)
      }
    },
    [],
  )

  // --- Water mask layer (hides heatmap over ocean, harbour, rivers) ---
  useMapEffect(
    mapInstance,
    (map) => {
      const sourceId = SOURCE_IDS.OPENMAPTILES
      const layerId = LAYER_IDS.WATER_MASK

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, vectorTilesSource())
      }

      const fillColor = theme === 'dark' ? '#14181B' : '#FFFFFF'

      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'fill-color', fillColor)
      } else {
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          'source-layer': 'water',
          paint: {
            'fill-color': fillColor,
            'fill-opacity': 0.99, // Must be < 1 to force MapLibre's translucent pass (custom layers only render in translucent pass; opaque fills render in a separate earlier pass, so fill-opacity: 1 always renders BELOW custom layers regardless of moveLayer ordering)
          },
        })
      }

      return () => {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
          // Don't remove source here — road-overlay and place-labels also use it.
          // Source is cleaned up by MapLibre when the style reloads on theme change.
        } catch {
          /* map may already be removed */
        }
      }
    },
    [theme],
  )

  // --- Renderer lifecycle ---
  useEffect(() => {
    if (!mapInstance) return

    // Detach old renderer
    if (rendererRef.current) {
      rendererRef.current.detach()
    }

    // Create new renderer
    const renderer =
      config.renderer === 'custom'
        ? new CustomIDWRenderer({
            colorStops: resolvedStops.stops,
            stopsRgbs: resolvedStops.rgbs,
          })
        : new LibraryIDWRenderer()

    renderer.attach(mapInstance)
    rendererRef.current = renderer

    // If we already have data, set it immediately
    if (rendererData && rendererData.length > 0) {
      renderer.setData(rendererData)
    }

    return () => {
      renderer.detach()
      if (rendererRef.current === renderer) {
        rendererRef.current = null
      }
    }
  }, [mapInstance, config.renderer]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Road overlay (crisp roads above heatmap + water mask, incl. bridges) ---
  useMapEffect(
    mapInstance,
    (map) => {
      const sourceId = SOURCE_IDS.OPENMAPTILES
      const layerId = LAYER_IDS.ROAD_OVERLAY
      const lineColor = '#777'

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          'source-layer': 'transportation',
          paint: {
            'line-color': lineColor,
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              6,
              0.3,
              10,
              1,
              14,
              2,
            ],
            'line-opacity': 0.7,
          },
        })
      }

      return () => {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
        } catch {
          /* map may already be removed */
        }
      }
    },
    [],
  )

  // --- Labels overlay (vector labels from OpenMapTiles on top of everything) ---
  // Uses the existing water-mask-source (OpenMapTiles vector tiles) with the
  // `place` source-layer. Vector labels give consistent coverage at all zoom
  // levels, unlike CARTO raster label tiles which have density gaps at z11-12.
  useMapEffect(
    mapInstance,
    (map) => {
      const sourceId = SOURCE_IDS.OPENMAPTILES
      const layerId = LAYER_IDS.PLACE_LABELS
      const textColor = '#333'
      const haloColor = 'rgba(255,255,255,0.8)'

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'symbol',
          source: sourceId,
          'source-layer': 'place',
          filter: [
            'in',
            'class',
            'city',
            'town',
            'village',
            'suburb',
            'neighbourhood',
            'hamlet',
          ],
          layout: {
            'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
            'text-font': ['Open Sans Regular'],
            'text-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              6,
              ['match', ['get', 'class'], 'city', 14, 'town', 11, 8],
              10,
              [
                'match',
                ['get', 'class'],
                'city',
                18,
                'town',
                14,
                'suburb',
                12,
                10,
              ],
              14,
              [
                'match',
                ['get', 'class'],
                'city',
                22,
                'town',
                16,
                'suburb',
                14,
                12,
              ],
            ],
            'text-max-width': 8,
            'text-allow-overlap': false,
            'text-padding': 2,
            'symbol-sort-key': [
              'match',
              ['get', 'class'],
              'city',
              0,
              'town',
              1,
              'village',
              2,
              'suburb',
              3,
              'neighbourhood',
              4,
              'hamlet',
              5,
              6,
            ],
          },
          paint: {
            'text-color': textColor,
            'text-halo-color': haloColor,
            'text-halo-width': 1.5,
            'text-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              6,
              ['match', ['get', 'class'], 'city', 1, 'town', 0.8, 0],
              8,
              [
                'match',
                ['get', 'class'],
                'city',
                1,
                'town',
                1,
                'village',
                0.6,
                0,
              ],
              10,
              1,
            ],
          },
        })
      }

      return () => {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
          // Don't remove source — shared with water mask and road overlay
        } catch {
          /* map may already be removed */
        }
      }
    },
    [],
  )

  // --- H3 hex border layer (shown on hover when showH3Borders is enabled) ---
  useMapEffect(
    mapInstance,
    (map) => {
      if (!map.getSource(SOURCE_IDS.HEX_BORDER)) {
        map.addSource(SOURCE_IDS.HEX_BORDER, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      if (!map.getLayer(LAYER_IDS.HEX_BORDER)) {
        map.addLayer({
          id: LAYER_IDS.HEX_BORDER,
          type: 'line',
          source: SOURCE_IDS.HEX_BORDER,
          paint: {
            'line-color': '#fff',
            'line-width': 2,
            'line-opacity': 0.8,
          },
        })
      }

      return () => {
        try {
          if (map.getLayer(LAYER_IDS.HEX_BORDER))
            map.removeLayer(LAYER_IDS.HEX_BORDER)
          if (map.getSource(SOURCE_IDS.HEX_BORDER))
            map.removeSource(SOURCE_IDS.HEX_BORDER)
        } catch {
          /* map may already be removed */
        }
      }
    },
    [],
  )

  // --- Estimated hex fill layer (neighbor-filled sparse cells) ---
  useMapEffect(
    mapInstance,
    (map) => {
      const sourceId = SOURCE_IDS.ESTIMATED_HEXES
      const layerId = LAYER_IDS.ESTIMATED_HEXES

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 1.5,
            'line-opacity': 0.5,
            'line-dasharray': [2, 2],
          },
        })
      }

      return () => {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
          if (map.getSource(sourceId)) map.removeSource(sourceId)
        } catch {
          /* map may already be removed */
        }
      }
    },
    [],
  )

  // --- Enforce declarative layer stacking order ---
  // Individual useMapEffect hooks add layers independently and may fire in any
  // order. This hook watches for the map to idle and corrects any ordering
  // violations. See LAYER_ORDER in map-layers.ts for the desired stacking order.
  useEnforceLayerOrder(mapInstance, LAYER_ORDER)

  // --- Push data + resolution to renderer when they change ---
  useEffect(() => {
    if (rendererRef.current && rendererData) {
      if ('setResolution' in rendererRef.current) {
        ;(rendererRef.current as CustomIDWRenderer).setResolution(resolution)
      }
      rendererRef.current.setData(rendererData)
    }
  }, [rendererData, resolution])

  // --- Demo recording hook (dev only) ---
  // With `?demo=1` on a dev server, expose the map and the loading state so demo/record.mjs can
  // drive smooth camera moves and wait for data. Never present in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV || !mapInstance) return
    if (!new URLSearchParams(window.location.search).has('demo')) return
    const w = window as unknown as Record<string, unknown>
    w.__rvMap = mapInstance
    return () => {
      if (w.__rvMap === mapInstance) delete w.__rvMap
    }
  }, [mapInstance])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!new URLSearchParams(window.location.search).has('demo')) return
    ;(window as unknown as Record<string, unknown>).__rvHeatmapLoading = isLoading
  }, [isLoading])

  // --- Push estimated hex GeoJSON to map source ---
  useEffect(() => {
    if (!mapInstance) return
    const source = mapInstance.getSource<GeoJSONSource>(SOURCE_IDS.ESTIMATED_HEXES)
    if (!source) return
    source.setData(estimatedGeoJson)
  }, [mapInstance, estimatedGeoJson])

  // --- Sync color config (stops + range) to renderer ---
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    // Push custom color stops to the renderer
    if (renderer.setColorStops) {
      renderer.setColorStops(resolvedStops.stops, resolvedStops.rgbs)
    }

    // Push color range (setColorStops already sets min/max from stops,
    // but explicit colorMin/colorMax narrow the displayed range further)
    if (
      renderer.setColorRange &&
      (config.colorMin != null || config.colorMax != null)
    ) {
      const min = config.colorMin ?? resolvedStops.stops[0][0]
      const max =
        config.colorMax ??
        resolvedStops.stops[resolvedStops.stops.length - 1][0]
      renderer.setColorRange(min, max)
    }
  }, [config.colorMin, config.colorMax, resolvedStops])

  // --- Mouse hover for tooltip + hex border ---
  const handleMouseMove = useCallback(
    (e: {
      lngLat: { lat: number; lng: number }
      point: { x: number; y: number }
    }) => {
      if (!data || data.length === 0) {
        setTooltip(null)
        clearHexBorder()
        return
      }

      const nearest = findNearestPoint(data, e.lngLat.lat, e.lngLat.lng)
      const nearestEstimated =
        estimatedCells.length > 0
          ? findNearestEstimatedCell(estimatedCells, e.lngLat.lat, e.lngLat.lng)
          : null

      // Pick whichever centroid is closer to the cursor
      let picked: 'observed' | 'estimated' | null = null
      if (nearest && nearestEstimated) {
        const dObs =
          (nearest.lat - e.lngLat.lat) ** 2 + (nearest.lng - e.lngLat.lng) ** 2
        const dEst =
          (nearestEstimated.lat - e.lngLat.lat) ** 2 +
          (nearestEstimated.lng - e.lngLat.lng) ** 2
        picked = dEst < dObs ? 'estimated' : 'observed'
      } else if (nearest) {
        picked = 'observed'
      } else if (nearestEstimated) {
        picked = 'estimated'
      }

      const activeH3Index =
        picked === 'observed'
          ? nearest!.h3Index
          : picked === 'estimated'
            ? nearestEstimated!.h3Index
            : undefined

      // Update hex border (shows over both land and water)
      if (activeH3Index && (config.showH3Borders ?? true)) {
        updateHexBorder(activeH3Index)
      } else {
        clearHexBorder()
      }

      // Suppress tooltip over water bodies (hex border still shows)
      if (
        activeH3Index &&
        mapInstance &&
        mapInstance.getLayer(LAYER_IDS.WATER_MASK)
      ) {
        const waterHit = mapInstance.queryRenderedFeatures(
          [e.point.x, e.point.y],
          { layers: [LAYER_IDS.WATER_MASK] },
        )
        if (waterHit.length > 0) {
          setTooltip(null)
          return
        }
      }

      if (picked === 'observed') {
        setTooltip({
          kind: 'observed',
          point: nearest!,
          x: e.point.x,
          y: e.point.y,
        })
      } else if (picked === 'estimated') {
        setTooltip({
          kind: 'estimated',
          cell: nearestEstimated!,
          x: e.point.x,
          y: e.point.y,
        })
      } else {
        setTooltip(null)
      }
    },
    [data, estimatedCells, mapInstance, config.showH3Borders],
  )

  const handleMouseLeave = useCallback(() => {
    setTooltip(null)
    clearHexBorder()
  }, [])

  const handleMouseDown = useCallback(
    (e: { point: { x: number; y: number } }) => {
      mouseDownRef.current = { x: e.point.x, y: e.point.y }
    },
    [],
  )

  const handleClick = useCallback(
    (e: {
      lngLat: { lat: number; lng: number }
      point: { x: number; y: number }
    }) => {
      // Ignore if the mouse moved more than 3px from mousedown (was a drag/pan)
      if (mouseDownRef.current) {
        const dx = e.point.x - mouseDownRef.current.x
        const dy = e.point.y - mouseDownRef.current.y
        if (dx * dx + dy * dy > 9) return
      }

      if (!data || data.length === 0) return

      const nearest = findNearestPoint(data, e.lngLat.lat, e.lngLat.lng)
      if (nearest) {
        setSelectedPoint(nearest)
      }
    },
    [data],
  )

  /** Update the hex border GeoJSON source with the boundary of the given H3 cell. */
  function updateHexBorder(h3Index: string) {
    if (!mapInstance) return
    const source = mapInstance.getSource<GeoJSONSource>(SOURCE_IDS.HEX_BORDER)
    if (!source) return

    try {
      const boundary = cellToBoundary(h3Index)
      // cellToBoundary returns [lat, lng][] — GeoJSON needs [lng, lat][]
      const coords = boundary.map(([lat, lng]) => [lng, lat])
      coords.push(coords[0]) // close the ring
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
      })
    } catch {
      // Invalid h3 index — clear instead of crashing
      clearHexBorder()
    }
  }

  /** Clear the hex border overlay. */
  function clearHexBorder() {
    if (!mapInstance) return
    const source = mapInstance.getSource<GeoJSONSource>(SOURCE_IDS.HEX_BORDER)
    if (!source) return
    source.setData({ type: 'FeatureCollection', features: [] })
  }

  const saveViewport = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const center = map.getCenter()
    updateWidgetConfig(widgetId, {
      ...configRef.current,
      viewport: {
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
      },
    })
    toast('View position saved as default')
  }, [widgetId, updateWidgetConfig])

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-b-lg"
    >
      {/* Compact preset bar */}
      <div className="shrink-0 border-b">
        <DatePresetBar
          presets={[5, 10, 15, 20, 25]}
          activePreset={
            config.customRange
              ? null
              : config.growthMethod === 'loess'
                ? (config.loessYearsBack ?? config.yearsBack)
                : config.yearsBack
          }
          customRange={config.customRange ?? null}
          onPresetChange={(years) => {
            if (years === 'all') return
            if (config.growthMethod === 'loess') {
              updateWidgetConfig(widgetId, {
                ...config,
                loessYearsBack: years,
                customRange: undefined,
              })
            } else {
              updateWidgetConfig(widgetId, {
                ...config,
                yearsBack: years as GrowthHeatmapConfig['yearsBack'],
                customRange: undefined,
              })
            }
          }}
          onCustomChange={
            config.growthMethod === 'loess'
              ? (startYear, endYear) =>
                  updateWidgetConfig(widgetId, {
                    ...config,
                    customRange: { startYear, endYear },
                    loessYearsBack: undefined,
                  })
              : undefined
          }
          showAll={false}
          sliderMin={2001}
          sliderMax={endYear}
        />
      </div>

      {/* Map wrapper */}
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {isLoading && !data && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <span className="text-sm text-muted-foreground">
              Loading heatmap data...
            </span>
          </div>
        )}

        <Map
          ref={mapRef}
          initialViewState={{
            longitude: config.viewport?.longitude ?? NSW_CENTER.longitude,
            latitude: config.viewport?.latitude ?? NSW_CENTER.latitude,
            zoom: config.viewport?.zoom ?? NSW_ZOOM,
          }}
          mapStyle={MAP_STYLE_LIGHT_NOLABELS}
          style={{ width: '100%', height: '100%' }}
          onLoad={() => setMapInstance(mapRef.current?.getMap() ?? null)}
          onMouseMove={handleMouseMove}
          onMouseOut={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
        >
          <NavigationControl position="top-right" showCompass={false} />
        </Map>

        {/* Save viewport button — positioned below MapLibre's NavigationControl. */}
        <button
          onClick={saveViewport}
          className="absolute right-2.5 top-[84px] z-10 flex h-[29px] w-[29px] items-center justify-center rounded bg-white shadow-md hover:bg-gray-100"
          title="Save current view as default"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#333"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </button>

        <GrowthLegend resolvedStops={resolvedStops} />

        {tooltip && (
          <MapTooltipPortal
            containerRef={containerRef}
            x={tooltip.x}
            y={tooltip.y}
          >
            {tooltip.kind === 'observed' ? (
              <GrowthTooltip
                point={tooltip.point}
                yearsBack={effectiveYearsBack}
                metric={config.metric}
                growthMethod={config.growthMethod}
                resolvedStops={resolvedStops}
              />
            ) : (
              <EstimatedTooltip
                cell={tooltip.cell}
                resolvedStops={resolvedStops}
              />
            )}
          </MapTooltipPortal>
        )}

        {/* Point count badge */}
        {!isLoading && data && data.length > 0 && (
          <div className="absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            {data.length.toLocaleString()} cells (res {resolution})
            {estimatedCells.length > 0 && (
              <span> + {estimatedCells.length.toLocaleString()} estimated</span>
            )}
          </div>
        )}

        {isLoading && data && (
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            <svg
              className="h-3 w-3 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            Updating...
          </div>
        )}

        {error && (
          <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive backdrop-blur-sm">
            {error}
            <button onClick={refetch} className="underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        <HexDetailDialog
          point={selectedPoint}
          onClose={() => setSelectedPoint(null)}
          config={{
            yearsBack: effectiveYearsBack,
            metric: config.metric,
            strataFilter: config.strataFilter,
            growthMethod: config.growthMethod,
            customRange: config.customRange,
          }}
          resolution={resolution}
        />
      </div>
    </div>
  )
}
