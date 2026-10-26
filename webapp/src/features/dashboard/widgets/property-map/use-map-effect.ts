/**
 * Safe imperative effect hook for MapLibre maps.
 *
 * Wraps `useEffect` with:
 * - Null-guard on the map instance (no `mapLoaded` state needed)
 * - Style-loaded gate (waits for `styledata` if style isn't ready)
 * - Stale-proof `destroyed` flag to prevent callbacks after cleanup
 * - try/catch around the user-provided cleanup so navigation away
 *   never throws even if the map has already been destroyed
 */

import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'

export function useMapEffect(
  map: maplibregl.Map | null,
  effect: (map: maplibregl.Map) => (() => void) | void,
  deps: React.DependencyList,
) {
  const effectRef = useRef(effect)
  effectRef.current = effect

  useEffect(() => {
    if (!map) return

    let cleanup: (() => void) | void
    let destroyed = false

    const run = () => {
      if (destroyed) return
      cleanup = effectRef.current(map)
    }

    if (map.isStyleLoaded()) {
      run()
    } else {
      map.once('styledata', () => setTimeout(run, 50))
    }

    return () => {
      destroyed = true
      if (cleanup) {
        try {
          cleanup()
        } catch {
          /* map may already be destroyed */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ...deps])
}
