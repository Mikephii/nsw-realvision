/**
 * Dual-handle slider for adjusting the color mapping range of heatmap widgets.
 *
 * Shows a gradient preview of the color stops and lets the user narrow
 * or widen the mapped range. Changes update shader uniforms without
 * re-fetching data.
 */

import { useCallback, useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

interface ColorRangeSliderProps {
  /** Current min value (growth decimal, e.g. -0.05). */
  value: [number, number]
  /** Absolute bounds the slider can reach. */
  bounds: [number, number]
  /** Step size for the slider (default 0.005 = 0.5%). */
  step?: number
  /** Color stops for the gradient preview: [value, cssColor][]. */
  colorStops: Array<[number, string]>
  /** Called when the range changes. */
  onChange: (range: [number, number]) => void
}

function formatPct(v: number): string {
  const pct = (v * 100).toFixed(1)
  return v >= 0 ? `+${pct}%` : `${pct}%`
}

export function ColorRangeSlider({
  value,
  bounds,
  step = 0.005,
  colorStops,
  onChange,
}: ColorRangeSliderProps) {
  // Build CSS gradient from stops within the bounds
  const gradient = useMemo(() => {
    const [bMin, bMax] = bounds
    const range = bMax - bMin
    const stops = colorStops
      .filter(([v]) => v >= bMin && v <= bMax)
      .map(
        ([v, color]) => `${color} ${(((v - bMin) / range) * 100).toFixed(1)}%`,
      )
      .join(', ')
    return `linear-gradient(to right, ${stops})`
  }, [bounds, colorStops])

  // Convert growth decimals to integer slider units (avoid float precision issues)
  const toSlider = useCallback((v: number) => Math.round(v / step), [step])
  const fromSlider = useCallback((v: number) => v * step, [step])

  const sliderMin = toSlider(bounds[0])
  const sliderMax = toSlider(bounds[1])
  const sliderValue = [toSlider(value[0]), toSlider(value[1])] as [
    number,
    number,
  ]

  const handleChange = useCallback(
    (vals: Array<number>) => {
      if (vals.length >= 2) {
        onChange([fromSlider(vals[0]), fromSlider(vals[1])])
      }
    },
    [fromSlider, onChange],
  )

  return (
    <div>
      <Label>Color Range</Label>
      <div className="mt-2 space-y-2">
        {/* Gradient preview */}
        <div
          className="h-3 w-full rounded-sm"
          style={{ background: gradient }}
        />
        {/* Dual-handle slider */}
        <Slider
          value={sliderValue}
          min={sliderMin}
          max={sliderMax}
          step={1}
          onValueChange={handleChange}
        />
        {/* Labels */}
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatPct(value[0])}</span>
          <span>{formatPct(value[1])}</span>
        </div>
      </div>
    </div>
  )
}
