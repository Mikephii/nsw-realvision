/**
 * Hover tooltip for the relative performance heatmap.
 * Shows relative growth, absolute growth, metro avg, and sale count.
 */

import { formatGrowthPercent } from '../growth-heatmap/color-scale'
import { formatRelativePercent, relativeToColor } from './color-scale'
import type { HeatmapDataPoint } from '@/lib/heatmap-queries'

interface Props {
  point: HeatmapDataPoint
  yearsBack: number
}

export function RelativeTooltip({ point, yearsBack }: Props) {
  const [r, g, b] = relativeToColor(point.growth)
  const absoluteGrowth =
    point.metroAvg != null ? point.growth + point.metroAvg : null

  return (
    <div className="min-w-[200px] rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      {point.locality && (
        <div className="mb-1 text-sm font-semibold">{point.locality}</div>
      )}
      <div className="space-y-0.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            vs Metro ({yearsBack}yr)
          </span>
          <span
            className="font-medium"
            style={{ color: `rgb(${r}, ${g}, ${b})` }}
          >
            {formatRelativePercent(point.growth)}
          </span>
        </div>
        {absoluteGrowth != null && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Absolute growth</span>
            <span>{formatGrowthPercent(absoluteGrowth)}</span>
          </div>
        )}
        {point.metroAvg != null && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Metro average</span>
            <span>{formatGrowthPercent(point.metroAvg)}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 border-t pt-1 text-[10px] text-muted-foreground">
        Based on {point.saleCount.toLocaleString()} sales
      </div>
    </div>
  )
}
