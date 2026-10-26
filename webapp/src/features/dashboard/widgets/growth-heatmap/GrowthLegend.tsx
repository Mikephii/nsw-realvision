/**
 * Gradient legend overlay for the growth heatmap.
 *
 * Renders a vertical color bar with labeled tick marks showing
 * the growth-to-color mapping. Absolutely positioned in the
 * bottom-right of the map container.
 */

import {
  GROWTH_COLOR_STOPS,
  
  formatGrowthPercent
} from './color-scale'
import type {ResolvedColorStops} from './color-scale';

interface GrowthLegendProps {
  resolvedStops?: ResolvedColorStops
}

export function GrowthLegend({ resolvedStops }: GrowthLegendProps) {
  const stops = resolvedStops?.stops ?? GROWTH_COLOR_STOPS

  // Build CSS gradient from stops (bottom = low/red, top = high/purple)
  const gradientStops = [...stops]
    .reverse()
    .map(
      ([, color], i, arr) =>
        `${color} ${((i / (arr.length - 1)) * 100).toFixed(0)}%`,
    )
    .join(', ')

  return (
    <div className="absolute bottom-3 right-3 z-10 flex items-stretch gap-2 rounded-md bg-background/80 p-2 backdrop-blur-sm">
      {/* Color bar */}
      <div
        className="w-3 rounded-sm"
        style={{
          background: `linear-gradient(to bottom, ${gradientStops})`,
          minHeight: '120px',
        }}
      />
      {/* Labels */}
      <div className="flex flex-col justify-between text-[10px] font-medium text-muted-foreground">
        {[...stops].reverse().map(([value]) => (
          <span key={value}>{formatGrowthPercent(value)}</span>
        ))}
      </div>
    </div>
  )
}
