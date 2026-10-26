/**
 * Area editor — create or edit a custom map area.
 *
 * Two-column layout: form panel (left) with name, description, color picker,
 * and status; map (right) with terra-draw polygon drawing. Shared between
 * the create (`/areas/new`) and edit (`/areas/$areaId/edit`) pages.
 *
 * State machine:
 * - `idle`: no polygon yet, draw button shown on map
 * - `drawing`: terra-draw polygon mode active
 * - `drawn`: polygon complete, rendered on map, save enabled (if name present)
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { Map, NavigationControl } from 'react-map-gl/maplibre'
import maplibregl from 'maplibre-gl'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, PenTool01Icon } from '@hugeicons/core-free-icons'
import { AREA_COLORS } from '../types'
import { useTerraDraw } from '../hooks/use-terra-draw'
import { AreaPreview } from './AreaPreview'
import type { MapRef } from 'react-map-gl/maplibre'
import type maplibreglType from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { CustomArea } from '../types'
import { useTheme } from '@/components/ThemeProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  MAP_STYLE_DARK,
  MAP_STYLE_LIGHT,
  NSW_CENTER,
  NSW_ZOOM,
} from '@/features/dashboard/widgets/property-map/map-style'
import { useMapEffect } from '@/features/dashboard/widgets/property-map/use-map-effect'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AreaEditorProps {
  /** Pre-populate for edit mode. Omit for create mode. */
  initialArea?: CustomArea
  /** Called on save with the final area data. */
  onSave: (data: {
    name: string
    description?: string
    polygon: GeoJSON.Polygon
    color: string
  }) => void
  /** Called when user cancels. */
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_ID = 'area-polygon'
const LAYER_FILL = 'area-fill'
const LAYER_STROKE = 'area-stroke'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AreaEditor({ initialArea, onSave, onCancel }: AreaEditorProps) {
  const mapRef = useRef<MapRef>(null)
  const { theme } = useTheme()
  const [mapInstance, setMapInstance] = useState<maplibreglType.Map | null>(
    null,
  )

  // Form state
  const [name, setName] = useState(initialArea?.name ?? '')
  const [description, setDescription] = useState(initialArea?.description ?? '')
  const [color, setColor] = useState(initialArea?.color ?? AREA_COLORS[0])
  const [polygon, setPolygon] = useState<GeoJSON.Polygon | null>(
    initialArea?.polygon ?? null,
  )

  // Drawing
  const handleDrawComplete = useCallback((poly: GeoJSON.Polygon) => {
    setPolygon(poly)
  }, [])

  const { isDrawing, startDrawing, cancelDrawing } = useTerraDraw({
    map: mapInstance,
    onComplete: handleDrawComplete,
  })

  const handleClear = useCallback(() => {
    setPolygon(null)
    cancelDrawing()
  }, [cancelDrawing])

  const canSave = name.trim().length > 0 && polygon !== null

  const handleSave = useCallback(() => {
    if (!canSave || !polygon) return
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      polygon,
      color,
    })
  }, [canSave, name, description, polygon, color, onSave])

  const vertexCount = polygon ? polygon.coordinates[0].length - 1 : 0

  // --- Render polygon on map ---
  useMapEffect(
    mapInstance,
    (map) => {
      // Clean up existing
      if (map.getLayer(LAYER_STROKE)) map.removeLayer(LAYER_STROKE)
      if (map.getLayer(LAYER_FILL)) map.removeLayer(LAYER_FILL)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)

      if (!polygon)
        return () => {
          if (map.getLayer(LAYER_STROKE)) map.removeLayer(LAYER_STROKE)
          if (map.getLayer(LAYER_FILL)) map.removeLayer(LAYER_FILL)
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
        }

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: polygon,
          properties: {},
        },
      })

      map.addLayer({
        id: LAYER_FILL,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': color,
          'fill-opacity': 0.15,
        },
      })

      map.addLayer({
        id: LAYER_STROKE,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': color,
          'line-width': 2,
        },
      })

      // Fit bounds to polygon
      const coords = polygon.coordinates[0]
      const bounds = new maplibregl.LngLatBounds()
      for (const coord of coords) {
        bounds.extend(coord as [number, number])
      }
      map.fitBounds(bounds, { padding: 60, maxZoom: 16 })

      return () => {
        if (map.getLayer(LAYER_STROKE)) map.removeLayer(LAYER_STROKE)
        if (map.getLayer(LAYER_FILL)) map.removeLayer(LAYER_FILL)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      }
    },
    [polygon, color, theme],
  )

  // Initial viewport for edit mode: fit to existing polygon
  const initialViewState = useMemo(() => {
    if (initialArea?.polygon) {
      const coords = initialArea.polygon.coordinates[0]
      const bounds = new maplibregl.LngLatBounds()
      for (const coord of coords) {
        bounds.extend(coord as [number, number])
      }
      const center = bounds.getCenter()
      return {
        longitude: center.lng,
        latitude: center.lat,
        zoom: 13,
      }
    }
    return {
      longitude: NSW_CENTER.longitude,
      latitude: NSW_CENTER.latitude,
      zoom: NSW_ZOOM,
    }
  }, [initialArea])

  return (
    <div className="-m-4 md:-m-6 flex h-[calc(100vh-3rem)]">
      {/* Form panel */}
      <div className="flex w-80 shrink-0 flex-col border-r bg-background">
        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="text-lg font-semibold">
            {initialArea ? 'Edit Area' : 'Create Area'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {initialArea
              ? 'Update the area details or redraw the boundary.'
              : 'Draw a boundary on the map and give it a name.'}
          </p>

          {/* Name */}
          <div className="mt-5 space-y-1.5">
            <Label htmlFor="area-name">Name</Label>
            <Input
              id="area-name"
              placeholder="e.g. Bondi Beach Pocket"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="area-desc">Description</Label>
            <Textarea
              id="area-desc"
              placeholder="Optional notes about this area..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Color */}
          <div className="mt-4 space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {AREA_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-6 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline: c === color ? '2px solid currentColor' : 'none',
                    outlineOffset: '2px',
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {/* Drawing instructions */}
          <div className="mt-6 rounded-md border border-dashed p-3">
            {!polygon ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Draw a boundary</p>
                <p className="text-xs text-muted-foreground">
                  Click &ldquo;Start Draw&rdquo; on the map, then click to place
                  points. Double-click to complete the shape.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <AreaPreview polygon={polygon} color={color} size={48} />
                  <div>
                    <p className="text-sm font-medium">Area drawn</p>
                    <p className="text-xs text-muted-foreground">
                      {vertexCount} vertices
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleClear}
                >
                  Clear &amp; Redraw
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Footer buttons */}
        <div className="border-t p-4">
          {!canSave && (
            <p className="mb-2 text-xs text-muted-foreground">
              {!name.trim() && !polygon
                ? 'Enter a name and draw an area to save.'
                : !name.trim()
                  ? 'Enter a name to save.'
                  : 'Draw an area on the map to save.'}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!canSave} onClick={handleSave}>
              {initialArea ? 'Save Changes' : 'Create Area'}
            </Button>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="relative flex-1">
        <Map
          ref={mapRef}
          initialViewState={initialViewState}
          mapStyle={theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
          style={{ width: '100%', height: '100%' }}
          onLoad={() => setMapInstance(mapRef.current?.getMap() ?? null)}
        >
          <NavigationControl position="top-right" showCompass={false} />
        </Map>

        {/* Drawing controls overlay */}
        {mapInstance && (
          <div className="absolute left-3 top-3 z-10">
            {isDrawing ? (
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="gap-2 shadow-md"
                  onClick={cancelDrawing}
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                  Cancel Drawing
                </Button>
                <div className="rounded-md bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-md backdrop-blur-sm">
                  Click to place points &middot; Double-click to finish
                </div>
              </div>
            ) : !polygon ? (
              <Button
                variant="secondary"
                className="gap-2 shadow-lg transition-all hover:scale-105 hover:shadow-xl"
                onClick={startDrawing}
              >
                <HugeiconsIcon
                  icon={PenTool01Icon}
                  className="size-4"
                  strokeWidth={2}
                />
                Start Drawing
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
