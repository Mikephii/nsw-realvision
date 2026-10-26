/**
 * Property Map widget — renders geocoded property sales as dots on a map.
 * Uses react-map-gl with MapLibre GL JS for WebGL-accelerated rendering.
 *
 * Uses imperative source/layer management (map.addSource, map.addLayer)
 * rather than declarative <Source>/<Layer> components, because the
 * declarative approach in react-map-gl v8 has timing issues where layers
 * can be created before their source exists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map, NavigationControl } from 'react-map-gl/maplibre'
import maplibregl from 'maplibre-gl'
import { MapPopupPortal } from '../growth-heatmap/MapTooltipPortal'
import { useWidgetData } from '../../hooks/use-widget-data'
import {
  MAP_STYLE_DARK,
  MAP_STYLE_LIGHT,
  NSW_CENTER,
  NSW_ZOOM,
} from './map-style'
import { getCircleColor, getClusterColor } from './color-expressions'
import { useMapEffect } from './use-map-effect'
import { PropertyDetailDialog } from './PropertyDetailDialog'
import { DrawingControl } from './DrawingControl'
import type { MapLayerMouseEvent, MapRef } from 'react-map-gl/maplibre'
import type maplibreglType from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { MapGeoJSON, MapPointProperties, PropertyMapConfig } from './types'
import { getMapPoints } from '@/lib/server-fns'
import { useTheme } from '@/components/ThemeProvider'
import { Button } from '@/components/ui/button'
import { SaveAreaDialog } from '@/features/areas/components/SaveAreaDialog'
import { useAreaActions } from '@/features/areas/hooks/use-areas'
import { useAreaStore } from '@/features/areas/area-store'
import { useTerraDraw } from '@/features/areas/hooks/use-terra-draw'
import { resolveSpatialFilters } from '@/features/areas/spatial/geo-utils'

interface Props {
  config: PropertyMapConfig
  widgetId: string
}

const SOURCE_ID = 'properties'
const LAYER_CLUSTERS = 'clusters'
const LAYER_CLUSTER_COUNT = 'cluster-count'
const LAYER_POINTS = 'unclustered-point'

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

/**
 * Circle radius that scales with zoom to approximate ~10m real-world radius.
 * Uses exponential base 2 (each zoom level doubles pixel size).
 * At zoom 15 ≈ 2.5px, zoom 18 ≈ 20px, zoom 20 ≈ 80px.
 * Clamped to 1.5px minimum at wide zooms for visibility.
 */
const PLOT_SIZED_RADIUS: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  10,
  1.5,
  15,
  2.5,
  20,
  80,
]

/** Fixed pixel radius — same screen size at every zoom level. */
const FIXED_RADIUS = 6

/** Remove all property layers + source from the map if they exist. */
function removeLayers(map: maplibregl.Map) {
  if (map.getLayer(LAYER_POINTS)) map.removeLayer(LAYER_POINTS)
  if (map.getLayer(LAYER_CLUSTER_COUNT)) map.removeLayer(LAYER_CLUSTER_COUNT)
  if (map.getLayer(LAYER_CLUSTERS)) map.removeLayer(LAYER_CLUSTERS)
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}

export function PropertyMap({ config, widgetId }: Props) {
  const mapRef = useRef<MapRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const [mapInstance, setMapInstance] = useState<maplibreglType.Map | null>(
    null,
  )
  const hoveredIdRef = useRef<number | null>(null)

  // Detail dialog state (rendered outside the map so it isn't clipped)
  const [detailProps, setDetailProps] = useState<MapPointProperties | null>(
    null,
  )

  // Stable ref for area lookup (used in fetcher closure)
  const getAreaById = useAreaStore((s) => s.getById)

  // Filter out stale area IDs (deleted areas) so we never pass undefined downstream
  const validAreaIds = useMemo(
    () => (config.areaIds ?? []).filter((id) => getAreaById(id)),
    [config.areaIds, getAreaById],
  )

  // Drawing state
  const [pendingPolygon, setPendingPolygon] = useState<GeoJSON.Polygon | null>(
    null,
  )
  const { create: createArea } = useAreaActions()

  const handleDrawComplete = useCallback((polygon: GeoJSON.Polygon) => {
    setPendingPolygon(polygon)
  }, [])

  const { isDrawing, startDrawing, cancelDrawing } = useTerraDraw({
    map: mapInstance,
    onComplete: handleDrawComplete,
  })

  const handleSaveArea = useCallback(
    (name: string) => {
      if (pendingPolygon) {
        createArea({ name, polygon: pendingPolygon })
        setPendingPolygon(null)
      }
    },
    [pendingPolygon, createArea],
  )

  const handleCancelSave = useCallback(() => {
    setPendingPolygon(null)
  }, [])

  const { data, isLoading, error } = useWidgetData<
    PropertyMapConfig,
    MapGeoJSON
  >(widgetId, config, async (cfg) => {
    const hasLocalities = cfg.localities.length > 0
    if (!hasLocalities && validAreaIds.length === 0) {
      return { type: 'FeatureCollection', features: [] }
    }
    const spatialFilters =
      validAreaIds.length > 0
        ? resolveSpatialFilters(validAreaIds, getAreaById)
        : undefined
    return getMapPoints({
      data: {
        filter: {
          localities: cfg.localities,
          dateFrom: cfg.dateFrom ?? undefined,
          dateTo: cfg.dateTo ?? undefined,
          minPrice: cfg.minPrice ?? undefined,
          maxPrice: cfg.maxPrice ?? undefined,
          strataFilter: cfg.strataFilter,
          spatialFilters,
        },
      },
    })
  })

  // ResizeObserver for grid layout changes
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize()
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const circleColor = useMemo(
    () => getCircleColor(config.colorMode),
    [config.colorMode],
  )

  // --- Effect 1: Manage source + layers ---
  // Rebuilds layers when data, color, theme, clustering, or dot size changes.
  // Does NOT call fitBounds (that's effect 2).
  useMapEffect(
    mapInstance,
    (map) => {
      removeLayers(map)
      if (!data || data.features.length === 0) return () => removeLayers(map)

      const clustering = config.enableClustering

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: data,
        cluster: clustering,
        clusterMaxZoom: 14,
        clusterRadius: 50,
        generateId: true,
      })

      if (clustering) {
        map.addLayer({
          id: LAYER_CLUSTERS,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': getClusterColor(),
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              16,
              100,
              22,
              750,
              28,
              5000,
              34,
            ],
            'circle-opacity': 0.75,
            'circle-stroke-width': 2,
            'circle-stroke-color': 'rgba(255,255,255,0.4)',
          },
        })

        map.addLayer({
          id: LAYER_CLUSTER_COUNT,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 11,
          },
          paint: {
            'text-color': '#ffffff',
          },
        })
      }

      const pointFilter = clustering
        ? (['!', ['has', 'point_count']] as maplibregl.ExpressionSpecification)
        : undefined

      const radius = config.fixedDotSize
        ? FIXED_RADIUS
        : (PLOT_SIZED_RADIUS as unknown as number)

      map.addLayer({
        id: LAYER_POINTS,
        type: 'circle',
        source: SOURCE_ID,
        ...(pointFilter ? { filter: pointFilter } : {}),
        paint: {
          'circle-color': circleColor as unknown as string,
          'circle-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.95,
            0.65,
          ],
          'circle-radius': radius,
          'circle-stroke-color': circleColor as unknown as string,
          'circle-stroke-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            1,
            0.8,
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            2,
            1,
          ],
        },
      })

      return () => removeLayers(map)
    },
    [data, circleColor, theme, config.enableClustering, config.fixedDotSize],
  )

  // --- Effect 2: Fit bounds (only on data change) ---
  useMapEffect(
    mapInstance,
    (map) => {
      if (!data || data.features.length === 0) return

      const bounds = new maplibregl.LngLatBounds()
      for (const f of data.features) {
        bounds.extend(f.geometry.coordinates as [number, number])
      }
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 })
    },
    [data],
  )

  // --- Effect 3: Hover feature-state ---
  useMapEffect(
    mapInstance,
    (map) => {
      const onMouseMove = (
        e: maplibregl.MapMouseEvent & {
          features?: Array<maplibregl.GeoJSONFeature>
        },
      ) => {
        if (!e.features || e.features.length === 0) return
        const id = e.features[0].id as number | undefined
        if (id === undefined) return

        if (hoveredIdRef.current !== null && hoveredIdRef.current !== id) {
          map.setFeatureState(
            { source: SOURCE_ID, id: hoveredIdRef.current },
            { hover: false },
          )
        }
        hoveredIdRef.current = id
        map.setFeatureState({ source: SOURCE_ID, id }, { hover: true })
        map.getCanvas().style.cursor = 'pointer'
      }

      const onMouseLeave = () => {
        if (hoveredIdRef.current !== null) {
          map.setFeatureState(
            { source: SOURCE_ID, id: hoveredIdRef.current },
            { hover: false },
          )
          hoveredIdRef.current = null
        }
        map.getCanvas().style.cursor = ''
      }

      map.on('mousemove', LAYER_POINTS, onMouseMove)
      map.on('mouseleave', LAYER_POINTS, onMouseLeave)

      return () => {
        map.off('mousemove', LAYER_POINTS, onMouseMove)
        map.off('mouseleave', LAYER_POINTS, onMouseLeave)
      }
    },
    [],
  )

  // Popup state
  const [popupInfo, setPopupInfo] = useState<{
    longitude: number
    latitude: number
    properties: MapPointProperties
  } | null>(null)

  // Build interactiveLayerIds based on clustering
  const interactiveLayerIds = useMemo(() => {
    const ids = [LAYER_POINTS]
    if (config.enableClustering) ids.push(LAYER_CLUSTERS)
    return ids
  }, [config.enableClustering])

  // Click handler
  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0]
    if (!feature) {
      setPopupInfo(null)
      return
    }

    // Cluster: zoom in
    if (feature.properties?.cluster) {
      const clusterId = feature.properties.cluster_id as number
      const map = mapRef.current?.getMap()
      const source = map?.getSource<maplibreglType.GeoJSONSource>(SOURCE_ID)
      if (source) {
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          mapRef.current?.easeTo({
            center: (feature.geometry as GeoJSON.Point).coordinates as [
              number,
              number,
            ],
            zoom,
          })
        })
      }
      return
    }

    // Individual point: show popup
    const coords = (feature.geometry as GeoJSON.Point).coordinates
    setPopupInfo({
      longitude: coords[0],
      latitude: coords[1],
      properties: {
        purchasePrice: Number(feature.properties?.purchasePrice ?? 0),
        contractDate: String(feature.properties?.contractDate ?? ''),
        contractYear: Number(feature.properties?.contractYear ?? 0),
        zoneCode: feature.properties?.zoneCode ?? null,
        locality: String(feature.properties?.locality ?? ''),
        natureOfProperty: feature.properties?.natureOfProperty ?? null,
        geocodeConfidence: feature.properties?.geocodeConfidence ?? null,
        propertyId: String(feature.properties?.propertyId ?? ''),
        address: String(feature.properties?.address ?? ''),
      },
    })
  }, [])

  const featureCount = data?.features.length ?? 0

  // Empty state
  if (config.localities.length === 0 && validAreaIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select suburbs or areas in settings to see properties on the map
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-b-lg"
    >
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
          <span className="text-sm text-muted-foreground">
            Loading map data...
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
        mapStyle={theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={interactiveLayerIds}
        onClick={onClick}
        onLoad={() => setMapInstance(mapRef.current?.getMap() ?? null)}
      >
        <NavigationControl position="top-right" showCompass={false} />
      </Map>

      {popupInfo && (
        <MapPopupPortal
          containerRef={containerRef}
          map={mapInstance}
          longitude={popupInfo.longitude}
          latitude={popupInfo.latitude}
        >
          <div className="w-[280px] rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
            <button
              onClick={() => setPopupInfo(null)}
              className="absolute right-2 top-2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Close popup"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="space-y-1.5">
              <div className="pr-5 text-sm font-semibold leading-tight">
                {popupInfo.properties.address}
              </div>
              <div className="text-xs text-muted-foreground">
                {popupInfo.properties.locality}
                {popupInfo.properties.zoneCode && (
                  <span className="ml-1.5 inline-block rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-foreground">
                    {popupInfo.properties.zoneCode}
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                <span className="text-sm font-medium">
                  {currencyFormatter.format(popupInfo.properties.purchasePrice)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {popupInfo.properties.contractDate}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  setDetailProps(popupInfo.properties)
                  setPopupInfo(null)
                }}
              >
                View Details
              </Button>
            </div>
          </div>
        </MapPopupPortal>
      )}

      {/* Drawing control */}
      {mapInstance && (
        <DrawingControl
          isDrawing={isDrawing}
          onToggle={isDrawing ? cancelDrawing : startDrawing}
        />
      )}

      {/* Point count badge */}
      {!isLoading && featureCount > 0 && (
        <div className="absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
          {featureCount.toLocaleString()} properties
        </div>
      )}

      {error && (
        <div className="absolute bottom-2 left-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive backdrop-blur-sm">
          {error}
        </div>
      )}

      {/* Property detail dialog (rendered outside map so it isn't clipped) */}
      <PropertyDetailDialog
        properties={detailProps}
        onClose={() => setDetailProps(null)}
      />

      {/* Save area dialog */}
      <SaveAreaDialog
        polygon={pendingPolygon}
        onSave={handleSaveArea}
        onCancel={handleCancelSave}
      />
    </div>
  )
}
