/**
 * Gradient legend overlay for the relative performance heatmap.
 * Diverging scale: red (underperformer) → gray (metro avg) → blue (outperformer).
 */

import { RELATIVE_COLOR_STOPS, formatRelativePercent } from './color-scale'

export function RelativeLegend() {
  const gradientStops = [...RELATIVE_COLOR_STOPS]
    .reverse()
    .map(
      ([, color], i, arr) =>
        `${color} ${((i / (arr.length - 1)) * 100).toFixed(0)}%`,
    )
    .join(', ')

  return (
    <div className="absolute bottom-3 right-3 z-10 flex items-stretch gap-2 rounded-md bg-background/80 p-2 backdrop-blur-sm">
      <div
        className="w-3 rounded-sm"
        style={{
          background: `linear-gradient(to bottom, ${gradientStops})`,
          minHeight: '120px',
        }}
      />
      <div className="flex flex-col justify-between text-[10px] font-medium text-muted-foreground">
        {[...RELATIVE_COLOR_STOPS].reverse().map(([value]) => (
          <span key={value}>
            {value === 0 ? 'Metro avg' : formatRelativePercent(value)}
          </span>
        ))}
      </div>
    </div>
  )
}
