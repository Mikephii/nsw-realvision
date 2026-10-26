/**
 * Portal wrappers for map overlays.
 *
 * Renders children into a portal at document.body, escaping all
 * overflow-hidden ancestors (Card, CardContent, map container).
 *
 * Two variants:
 * - {@link MapTooltipPortal} — hover tooltips positioned by container-relative pixels
 * - {@link MapPopupPortal} — click popups anchored to geographic coordinates
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMapEffect } from '../property-map/use-map-effect'
import type maplibreglType from 'maplibre-gl'

// ---------------------------------------------------------------------------
// Hover tooltip (container-relative pixel positioning)
// ---------------------------------------------------------------------------

interface TooltipProps {
  /** Ref to the map container div for getBoundingClientRect(). */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Container-relative x from MapLibre's e.point.x. */
  x: number
  /** Container-relative y from MapLibre's e.point.y. */
  y: number
  children: React.ReactNode
}

export function MapTooltipPortal({
  containerRef,
  x,
  y,
  children,
}: TooltipProps) {
  const rect = containerRef.current?.getBoundingClientRect()
  if (!rect) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left: rect.left + x + 12,
        top: rect.top + y - 10,
        transform: 'translateY(-100%)',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Click popup (geo-anchored, tracks map pan/zoom)
// ---------------------------------------------------------------------------

interface PopupProps {
  /** Ref to the map container div for getBoundingClientRect(). */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** MapLibre map instance for projecting coordinates. */
  map: maplibreglType.Map | null
  /** Geographic longitude of the anchor point. */
  longitude: number
  /** Geographic latitude of the anchor point. */
  latitude: number
  children: React.ReactNode
}

/**
 * Portal popup anchored to a geographic coordinate.
 * Re-projects on every map `move` event so it tracks pan/zoom.
 * Interactive (pointer-events enabled on content).
 */
export function MapPopupPortal({
  containerRef,
  map,
  longitude,
  latitude,
  children,
}: PopupProps) {
  // Counter incremented on map move to trigger re-render with fresh projection
  const [, setMoveCount] = useState(0)

  useMapEffect(
    map,
    (m) => {
      const onMove = () => setMoveCount((c) => c + 1)
      m.on('move', onMove)
      return () => {
        m.off('move', onMove)
      }
    },
    [],
  )

  // Re-render on page scroll so getBoundingClientRect stays fresh
  useEffect(() => {
    const onScroll = () => setMoveCount((c) => c + 1)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [])

  const rect = containerRef.current?.getBoundingClientRect()
  if (!rect || !map) return null

  const projected = map.project([longitude, latitude])

  return createPortal(
    <div
      className="fixed z-50"
      style={{
        left: rect.left + projected.x,
        top: rect.top + projected.y,
        transform: 'translate(-50%, -100%)',
        paddingBottom: 12,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
