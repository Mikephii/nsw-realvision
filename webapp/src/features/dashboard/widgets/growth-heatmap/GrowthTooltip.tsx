/**
 * Hover tooltips for the growth heatmap.
 *
 * Two variants:
 * - {@link GrowthTooltip} — observed data points (standard display)
 * - {@link EstimatedTooltip} — neighbor-filled estimated cells (dashed border)
 *
 * Both are positioned absolutely relative to the map container and follow the mouse.
 */

import {
  
  formatGrowthPercent,
  growthToColor
} from './color-scale'
import type {ResolvedColorStops} from './color-scale';
import { heatmapEndYear } from '@/lib/heatmap-queries'
import { useDataCoverage } from '@/lib/data-coverage'
import type { GrowthMethod, HeatmapDataPoint } from '@/lib/heatmap-queries'
import type { EstimatedHexCell } from '@/lib/heatmap-stats'

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

interface Props {
  point: HeatmapDataPoint
  /** Current yearsBack setting for display context. */
  yearsBack: number
  /** Current metric for formatting context. */
  metric: 'median-price' | 'price-per-sqm'
  /** Current growth computation method. */
  growthMethod?: GrowthMethod
  resolvedStops?: ResolvedColorStops
}

export function GrowthTooltip({
  point,
  yearsBack,
  metric,
  growthMethod,
  resolvedStops,
}: Props) {
  const [r, g, b] = growthToColor(point.growth, resolvedStops)
  const currentYear = heatmapEndYear(useDataCoverage())
  const startYear = currentYear - yearsBack

  // Compute display start/end values based on the active method.
  // - Trend-fit: derive from the regression intercept (authoritative source).
  // - LOESS: use the precomputed smoothed values from the server.
  // - Endpoint: use the raw 3-year window medians.
  const hasTrendFit = point.trendFitIntercept != null
  const hasLoess = point.loessStart != null && point.loessEnd != null
  let displayStart = point.medianStart
  let displayEnd = point.medianEnd
  if (hasTrendFit) {
    const slope = Math.log(1 + point.growth)
    displayStart = Math.round(
      Math.exp(point.trendFitIntercept! + slope * startYear),
    )
    displayEnd = Math.round(
      Math.exp(point.trendFitIntercept! + slope * currentYear),
    )
  } else if (hasLoess) {
    displayStart = point.loessStart!
    displayEnd = point.loessEnd!
  }

  // Label for the start/end values depends on the method
  const valueLabel = hasTrendFit ? 'Fitted' : hasLoess ? 'Smoothed' : 'Median'

  const formatValue = (val: number) => {
    if (metric === 'price-per-sqm') {
      return `$${val.toLocaleString()}/sqm`
    }
    return currencyFormatter.format(val)
  }

  return (
    <div className="min-w-[180px] rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      {point.locality && (
        <div className="mb-1 text-sm font-semibold">{point.locality}</div>
      )}
      <div className="space-y-0.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            Growth
            {growthMethod === 'trend-fit'
              ? ' (trend-fit)'
              : growthMethod === 'loess'
                ? ' (LOESS)'
                : ' (CAGR)'}
          </span>
          <span
            className="font-medium"
            style={{ color: `rgb(${r}, ${g}, ${b})` }}
          >
            {formatGrowthPercent(point.growth)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            {valueLabel} {startYear}
          </span>
          <span>{formatValue(displayStart)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            {valueLabel} {currentYear}
          </span>
          <span>{formatValue(displayEnd)}</span>
        </div>
        {/* R² confidence indicator: only shown for trend-fit cells with regression data */}
        {point.trendFitR2 != null && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Fit quality</span>
            <span>R² {point.trendFitR2.toFixed(2)}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 border-t pt-1 text-[10px] text-muted-foreground">
        Based on {point.saleCount.toLocaleString()} sales
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Estimated cell tooltip
// ---------------------------------------------------------------------------

interface EstimatedTooltipProps {
  cell: EstimatedHexCell
  resolvedStops?: ResolvedColorStops
}

export function EstimatedTooltip({
  cell,
  resolvedStops,
}: EstimatedTooltipProps) {
  const [r, g, b] = growthToColor(cell.growth, resolvedStops)

  return (
    <div className="min-w-[180px] rounded-md border border-dashed bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <div className="mb-1 text-xs font-semibold text-muted-foreground">
        <span className="rounded bg-muted px-1 py-0.5 text-[10px]">
          Estimated
        </span>
      </div>
      <div className="space-y-0.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Estimated growth</span>
          <span
            className="font-medium"
            style={{ color: `rgb(${r}, ${g}, ${b})` }}
          >
            {formatGrowthPercent(cell.growth)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Sales in cell</span>
          <span>0</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Estimation</span>
          <span>100% from {cell.observedNeighborCount} neighbors</span>
        </div>
      </div>
      <div className="mt-1.5 border-t pt-1 text-[10px] text-muted-foreground">
        Based on {cell.neighborSaleCount.toLocaleString()} sales in neighboring
        cells
      </div>
    </div>
  )
}
