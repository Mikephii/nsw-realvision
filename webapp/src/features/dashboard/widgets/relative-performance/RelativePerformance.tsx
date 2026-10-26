/**
 * Relative Performance widget.
 *
 * Shows property growth relative to the metro-wide average as a diverging
 * heatmap. Blue areas outperform the metro average; red areas underperform.
 * This removes CAGR starting-point sensitivity since all areas share the
 * same metro average baseline.
 *
 * Uses the same map + IDW rendering architecture as GrowthHeatmap but with
 * a different data source (relative growth) and diverging color scale.
 */

import { vectorTilesSource } from '@/lib/map-tiles'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map, NavigationControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

import { useWidgetData } from '../../hooks/use-widget-data'
import {
  MAP_STYLE_DARK,
  MAP_STYLE_LIGHT_MONO,
  NSW_CENTER,
  NSW_ZOOM,
} from '../property-map/map-style'
import { useMapEffect } from '../property-map/use-map-effect'
import { MapTooltipPortal } from '../growth-heatmap/MapTooltipPortal'
import { CustomIDWRenderer } from '../growth-heatmap/renderers/idw-custom'
import { resolutionForZoom } from './types'
import { RELATIVE_COLOR_STOPS } from './color-scale'
import { RelativeLegend } from './RelativeLegend'
import { RelativeTooltip } from './RelativeTooltip'
import type { RelativePerformanceConfig } from './types'
import type { HeatmapRenderer } from '../growth-heatmap/renderers/types'
import type { HeatmapDataPoint } from '@/lib/heatmap-queries'
import type maplibreglType from 'maplibre-gl'
import type { MapRef } from 'react-map-gl/maplibre'
import { useTheme } from '@/components/ThemeProvider'
import { getRelativePerformanceData } from '@/lib/server-fns'

interface Props {
  config: RelativePerformanceConfig
  widgetId: string
}

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

  if (minDist > maxDistDeg * maxDistDeg) return null
  return nearest
}

export function RelativePerformance({ config, widgetId }: Props) {
  const mapRef = useRef<MapRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const [mapInstance, setMapInstance] = useState<maplibreglType.Map | null>(
    null,
  )
  const [resolution, setResolution] = useState<7 | 8 | 9>(7)
  const [tooltip, setTooltip] = useState<{
    point: HeatmapDataPoint
    x: number
    y: number
  } | null>(null)
  const rendererRef = useRef<HeatmapRenderer | null>(null)

  // Viewport bounds for spatial filtering at high resolutions (res 8+).
  const [viewportBounds, setViewportBounds] = useState<{
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  } | null>(null)

  const fetchViewport = resolution >= 8 ? viewportBounds : undefined

  const fetchConfig = useMemo(
    () => ({
      ...config,
      resolution,
      fetchViewport,
    }),
    [config, resolution, fetchViewport],
  )

  const { data, isLoading, error, refetch } = useWidgetData<
    typeof fetchConfig,
    Array<HeatmapDataPoint>
  >(widgetId, fetchConfig, async (cfg) => {
    return getRelativePerformanceData({
      data: {
        resolution: cfg.resolution,
        yearsBack: cfg.yearsBack,
        metric: cfg.metric,
        strataFilter: cfg.strataFilter,
        viewport: cfg.fetchViewport ?? undefined,
      },
    })
  })

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize()
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Zoom tracking -> resolution switching
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

      // Set initial bounds immediately
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

  // Water mask
  useMapEffect(
    mapInstance,
    (map) => {
      const sourceId = 'water-mask-source-rel'
      const layerId = 'water-mask-rel'

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, vectorTilesSource())
      }

      const fillColor = theme === 'dark' ? '#1a1a2e' : '#d4d4d4'

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
            'fill-opacity': 1,
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
    [theme],
  )

  // Renderer lifecycle
  useEffect(() => {
    if (!mapInstance) return

    if (rendererRef.current) {
      rendererRef.current.detach()
    }

    const renderer = new CustomIDWRenderer({
      colorStops: RELATIVE_COLOR_STOPS,
    })

    renderer.attach(mapInstance)
    rendererRef.current = renderer

    if (data && data.length > 0) {
      renderer.setData(data)
    }

    return () => {
      renderer.detach()
      if (rendererRef.current === renderer) {
        rendererRef.current = null
      }
    }
  }, [mapInstance, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push data to renderer
  useEffect(() => {
    if (rendererRef.current && data) {
      rendererRef.current.setData(data)
    }
  }, [data])

  // Update color range when config changes
  useEffect(() => {
    if (
      rendererRef.current?.setColorRange &&
      (config.colorMin != null || config.colorMax != null)
    ) {
      const min = config.colorMin ?? RELATIVE_COLOR_STOPS[0][0]
      const max =
        config.colorMax ??
        RELATIVE_COLOR_STOPS[RELATIVE_COLOR_STOPS.length - 1][0]
      rendererRef.current.setColorRange(min, max)
    }
  }, [config.colorMin, config.colorMax])

  // Mouse hover for tooltip
  const handleMouseMove = useCallback(
    (e: {
      lngLat: { lat: number; lng: number }
      point: { x: number; y: number }
    }) => {
      if (!data || data.length === 0) {
        setTooltip(null)
        return
      }

      const nearest = findNearestPoint(data, e.lngLat.lat, e.lngLat.lng)
      if (nearest) {
        setTooltip({
          point: nearest,
          x: e.point.x,
          y: e.point.y,
        })
      } else {
        setTooltip(null)
      }
    },
    [data],
  )

  const handleMouseLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-b-lg"
    >
      {isLoading && !data && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
          <span className="text-sm text-muted-foreground">
            Loading relative data...
          </span>
        </div>
      )}

      <Map
        ref={mapRef}
        initialViewState={{
          longitude: NSW_CENTER.longitude,
          latitude: NSW_CENTER.latitude,
          zoom: NSW_ZOOM,
        }}
        mapStyle={theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT_MONO}
        style={{ width: '100%', height: '100%' }}
        onLoad={() => setMapInstance(mapRef.current?.getMap() ?? null)}
        onMouseMove={handleMouseMove}
        onMouseOut={handleMouseLeave}
      >
        <NavigationControl position="top-right" showCompass={false} />
      </Map>

      <RelativeLegend />

      {tooltip && (
        <MapTooltipPortal
          containerRef={containerRef}
          x={tooltip.x}
          y={tooltip.y}
        >
          <RelativeTooltip point={tooltip.point} yearsBack={config.yearsBack} />
        </MapTooltipPortal>
      )}

      {!isLoading && data && data.length > 0 && (
        <div className="absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
          {data.length.toLocaleString()} cells (res {resolution})
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
    </div>
  )
}
