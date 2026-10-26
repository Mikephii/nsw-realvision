/**
 * Reusable gradient preview bar for color stops.
 *
 * Renders a horizontal bar showing the color gradient defined by the stops.
 * Accepts either ColorStop[] (from config) or [number, string][] (internal format).
 */

import { useMemo } from 'react'
import type { ColorStop } from './types'
import { cn } from '@/lib/utils'

interface GradientPreviewProps {
  stops: Array<ColorStop> | Array<[number, string]>
  className?: string
}

function normalizeStop(s: ColorStop | [number, string]): {
  value: number
  color: string
} {
  if (Array.isArray(s)) return { value: s[0], color: s[1] }
  return s
}

export function GradientPreview({ stops, className }: GradientPreviewProps) {
  const gradient = useMemo(() => {
    const normalized = stops.map(normalizeStop)
    const sorted = [...normalized].sort((a, b) => a.value - b.value)
    if (sorted.length < 2) return 'transparent'

    const first = sorted[0].value
    const last = sorted[sorted.length - 1].value
    const range = last - first
    if (range === 0) return sorted[0].color

    const cssStops = sorted
      .map((s) => {
        const pct = ((s.value - first) / range) * 100
        return `${s.color} ${pct.toFixed(1)}%`
      })
      .join(', ')

    return `linear-gradient(to right, ${cssStops})`
  }, [stops])

  return (
    <div
      className={cn('h-3 w-full rounded-sm border', className)}
      style={{ background: gradient }}
    />
  )
}
