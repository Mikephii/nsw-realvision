/**
 * Dialog that shows a custom area rendered on a map.
 *
 * Opens in-context (no navigation) so the user doesn't lose
 * their current board/settings state. Uses {@link useMapEffect}
 * for safe layer lifecycle management.
 */

import { useRef, useState } from 'react'
import { Map, NavigationControl } from 'react-map-gl/maplibre'
import maplibregl from 'maplibre-gl'
import type { MapRef } from 'react-map-gl/maplibre'
import type maplibreglType from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { CustomArea } from '../types'
import { useTheme } from '@/components/ThemeProvider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MAP_STYLE_DARK,
  MAP_STYLE_LIGHT,
} from '@/features/dashboard/widgets/property-map/map-style'
import { useMapEffect } from '@/features/dashboard/widgets/property-map/use-map-effect'

const SOURCE_ID = 'area-preview'
const LAYER_FILL = 'area-preview-fill'
const LAYER_STROKE = 'area-preview-stroke'

interface Props {
  area: CustomArea | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AreaMapDialog({ area, open, onOpenChange }: Props) {
  const mapRef = useRef<MapRef>(null)
  const { theme } = useTheme()
  const [mapInstance, setMapInstance] = useState<maplibreglType.Map | null>(
    null,
  )

  // Compute initial view from polygon bounds
  const initialViewState = area
    ? (() => {
        const coords = area.polygon.coordinates[0]
        const bounds = new maplibregl.LngLatBounds()
        for (const coord of coords) {
          bounds.extend(coord as [number, number])
        }
        const center = bounds.getCenter()
        return { longitude: center.lng, latitude: center.lat, zoom: 13 }
      })()
    : { longitude: 151.2, latitude: -33.87, zoom: 10 }

  // Render polygon on map
  useMapEffect(
    mapInstance,
    (map) => {
      if (!area) return

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: area.polygon,
          properties: {},
        },
      })

      map.addLayer({
        id: LAYER_FILL,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': area.color,
          'fill-opacity': 0.15,
        },
      })

      map.addLayer({
        id: LAYER_STROKE,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': area.color,
          'line-width': 2,
        },
      })

      const coords = area.polygon.coordinates[0]
      const bounds = new maplibregl.LngLatBounds()
      for (const coord of coords) {
        bounds.extend(coord as [number, number])
      }
      map.fitBounds(bounds, { padding: 40, maxZoom: 16 })

      return () => {
        if (map.getLayer(LAYER_STROKE)) map.removeLayer(LAYER_STROKE)
        if (map.getLayer(LAYER_FILL)) map.removeLayer(LAYER_FILL)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      }
    },
    [area?.id, area?.color, theme],
  )

  // Reset map instance when dialog closes so a fresh map is created next open
  const handleOpenChange = (value: boolean) => {
    if (!value) setMapInstance(null)
    onOpenChange(value)
  }

  const vertexCount = area ? area.polygon.coordinates[0].length - 1 : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {area && (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: area.color }}
              />
            )}
            {area?.name ?? 'Area'}
          </DialogTitle>
          <DialogDescription>
            {area?.description ?? `${vertexCount} vertices`}
          </DialogDescription>
        </DialogHeader>

        <div className="h-72 overflow-hidden rounded-md">
          {open && area && (
            <Map
              ref={mapRef}
              key={area.id}
              initialViewState={initialViewState}
              mapStyle={theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
              style={{ width: '100%', height: '100%' }}
              onLoad={() => setMapInstance(mapRef.current?.getMap() ?? null)}
            >
              <NavigationControl position="top-right" showCompass={false} />
            </Map>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
