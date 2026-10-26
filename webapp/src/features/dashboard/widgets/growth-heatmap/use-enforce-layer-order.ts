/**
 * Hook that enforces a declarative layer stacking order on a MapLibre map.
 *
 * Individual `useMapEffect` hooks add their layers independently and may
 * fire in any order (deferred by style-loaded gates, async source loading,
 * etc.). This hook watches for the map to become idle after rendering and
 * calls `moveLayer()` to correct any ordering violations.
 *
 * The check is idempotent: if layers are already in the correct relative
 * order, no `moveLayer()` calls are made (avoiding a render → idle loop).
 *
 * Layers that don't exist yet (not all hooks have fired) are silently
 * skipped — the hook will re-check on the next idle event.
 */

import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'

export function useEnforceLayerOrder(
  map: maplibregl.Map | null,
  layerOrder: ReadonlyArray<string>,
): void {
  useEffect(() => {
    if (!map) return

    const enforce = () => {
      const style = map.getStyle()
      if (!style?.layers) return

      // Find which of our managed layers are currently present on the map
      const allIds = style.layers.map((l) => l.id)
      const present = layerOrder.filter((id) => allIds.includes(id))

      // Need at least 2 layers to have an ordering constraint
      if (present.length < 2) return

      // Check if the relative order of present layers matches the desired order.
      // Compare consecutive index positions in the full layer stack — if each
      // managed layer appears after the previous one, the order is correct.
      const indices = present.map((id) => allIds.indexOf(id))
      let ordered = true
      for (let i = 1; i < indices.length; i++) {
        if (indices[i] <= indices[i - 1]) {
          ordered = false
          break
        }
      }

      if (ordered) return

      // Fix order by moving each layer below the one after it.
      // Processes bottom-to-top so each moveLayer has a valid `beforeId`.
      for (let i = 0; i < present.length - 1; i++) {
        try {
          map.moveLayer(present[i], present[i + 1])
        } catch {
          /* layer may have been removed between check and move */
        }
      }
    }

    // Run immediately (layers may already be present) and on each idle
    // event (fired after all pending tiles load and rendering completes).
    enforce()
    map.on('idle', enforce)

    return () => {
      map.off('idle', enforce)
    }
  }, [map, layerOrder])
}
