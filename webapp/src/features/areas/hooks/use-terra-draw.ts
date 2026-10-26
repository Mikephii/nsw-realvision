/**
 * Reusable hook for Terra Draw polygon drawing on a MapLibre map.
 *
 * Manages the TerraDraw lifecycle, mode switching, finish events,
 * escape key handling, and cleanup. Returns simple controls for
 * starting, cancelling, and clearing drawings.
 *
 * Extracted from {@link DrawingControl} so both the PropertyMap
 * widget and the standalone AreaEditor can use polygon drawing
 * without duplicating terra-draw integration code.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRenderMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type maplibregl from 'maplibre-gl'

interface UseTerraDrawOptions {
  /** MapLibre map instance. Pass null until the map is ready. */
  map: maplibregl.Map | null
  /** Called when the user completes a polygon (double-click to close). */
  onComplete: (polygon: GeoJSON.Polygon) => void
}

interface UseTerraDrawReturn {
  /** Whether drawing mode is currently active. */
  isDrawing: boolean
  /** Enter polygon drawing mode. */
  startDrawing: () => void
  /** Cancel drawing and return to static mode. Cleans up in-progress features. */
  cancelDrawing: () => void
}

export function useTerraDraw({
  map,
  onComplete,
}: UseTerraDrawOptions): UseTerraDrawReturn {
  const [isDrawing, setIsDrawing] = useState(false)
  const drawRef = useRef<TerraDraw | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  // --- Create Terra Draw instance and register finish listener ---
  // useLayoutEffect so cleanup (draw.stop) runs before React removes DOM
  // nodes and before the Map child's useEffect cleanup destroys the map.
  useLayoutEffect(() => {
    if (!map) return

    let cancelled = false

    const init = () => {
      if (cancelled) return

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode(),
          new TerraDrawRenderMode({ modeName: 'static', styles: {} }),
        ],
      })

      const handleFinish = (id: string | number) => {
        const feature = draw.getSnapshot().find((f) => f.id === id)
        if (feature && feature.geometry.type === 'Polygon') {
          onCompleteRef.current(feature.geometry)
          draw.removeFeatures([id])
        }
        setIsDrawing(false)
      }

      draw.on('finish', handleFinish)
      draw.start()
      drawRef.current = draw

      cleanupRef.current = () => {
        draw.off('finish', handleFinish)
        try {
          draw.stop()
        } catch {
          /* map already destroyed */
        }
        drawRef.current = null
        setIsDrawing(false)
      }
    }

    if (map.isStyleLoaded()) {
      init()
    } else {
      map.once('load', init)
    }

    return () => {
      cancelled = true
      map.off('load', init)
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [map])

  // --- Sync drawing mode ---
  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return

    try {
      if (isDrawing) {
        draw.setMode('polygon')
      } else {
        draw.setMode('static')
        const ids = draw
          .getSnapshot()
          .map((f) => f.id)
          .filter((id): id is string | number => id != null)
        if (ids.length > 0) {
          draw.removeFeatures(ids)
        }
      }
    } catch {
      // Map may have been destroyed during unmount
    }
  }, [isDrawing])

  // --- Escape key cancels drawing ---
  useEffect(() => {
    if (!isDrawing) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDrawing(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isDrawing])

  const startDrawing = useCallback(() => setIsDrawing(true), [])
  const cancelDrawing = useCallback(() => setIsDrawing(false), [])

  return { isDrawing, startDrawing, cancelDrawing }
}
