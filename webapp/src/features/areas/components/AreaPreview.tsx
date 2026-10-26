/**
 * SVG polygon thumbnail — renders a miniature preview of a custom area's shape.
 *
 * Computes the bounding box (reusing {@link polygonBBox}), maps polygon
 * coordinates to SVG space with aspect-ratio preservation, and renders
 * a single `<polygon>` element with the area's color.
 *
 * Y-axis is flipped because latitude increases northward but SVG Y
 * increases downward.
 */

import { useMemo } from 'react'
import { polygonBBox } from '../spatial/geo-utils'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** The GeoJSON polygon geometry to preview. */
  polygon: GeoJSON.Polygon
  /** Hex color for fill (at 20% opacity) and stroke. */
  color: string
  /** Additional CSS classes for the SVG element. */
  className?: string
  /** Width and height in pixels. Defaults to 40. */
  size?: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AreaPreview({ polygon, color, className, size = 40 }: Props) {
  const points = useMemo(() => {
    const coords = polygon.coordinates[0]
    if (!coords || coords.length < 3) return ''

    const bbox = polygonBBox(polygon)
    const width = bbox.maxLon - bbox.minLon
    const height = bbox.maxLat - bbox.minLat

    // Guard against degenerate polygons
    if (width === 0 && height === 0) return ''

    const padding = 4
    const drawSize = size - padding * 2

    // Scale to fit, maintaining aspect ratio
    const scale =
      width === 0 || height === 0
        ? drawSize / Math.max(width, height)
        : Math.min(drawSize / width, drawSize / height)
    const offsetX = padding + (drawSize - width * scale) / 2
    const offsetY = padding + (drawSize - height * scale) / 2

    return coords
      .map(([lon, lat]) => {
        const x = (lon - bbox.minLon) * scale + offsetX
        // Flip Y: latitude increases upward, SVG Y increases downward
        const y = (bbox.maxLat - lat) * scale + offsetY
        return `${x},${y}`
      })
      .join(' ')
  }, [polygon, size])

  if (!points) return null

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('rounded', className)}
    >
      <polygon
        points={points}
        fill={color}
        fillOpacity={0.2}
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}
