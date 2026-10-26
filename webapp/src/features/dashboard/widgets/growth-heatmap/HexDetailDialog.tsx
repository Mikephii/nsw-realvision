/**
 * Hex Detail Dialog — click a hex cell to inspect the growth computation.
 *
 * Shows:
 * 1. Summary header with locality, growth rate, and method badge.
 * 2. Line chart of yearly median prices with the computed trend line overlaid.
 *    Start/end windows are highlighted with shaded mark areas.
 *    For LOESS, draggable grab handles on the markArea edges let the user
 *    explore different time windows (dialog-local only, does not update heatmap).
 * 3. Scrollable table of individual sales in the hex cell.
 *
 * Data is fetched on open via two parallel server calls:
 * - getHexYearlyMedians → yearly median prices for the chart
 * - getHexSales → individual sales for the table
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { formatGrowthPercent, growthToColor } from './color-scale'
import { ChartRangeHandles } from './ChartRangeHandles'
import type { EChartsOption } from '@/components/charts/EChartsBase'
import type {
  GrowthMethod,
  GrowthMetric,
  HeatmapDataPoint,
  HexSale,
  HexYearlyMedian,
} from '@/lib/heatmap-queries'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EChartsBase } from '@/components/charts/EChartsBase'
import { getHexSales, getHexYearlyMedians, getLoessCurve } from '@/lib/server-fns'
import type { LoessCurveData } from '@/lib/heatmap-queries'
import { heatmapEndYear } from '@/lib/heatmap-queries'
import { useDataCoverage } from '@/lib/data-coverage'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { formatDate, formatPrice, natureLabel } from '@/lib/format'
import type * as echarts from 'echarts/core'

interface Props {
  point: HeatmapDataPoint | null
  onClose: () => void
  config: {
    yearsBack: number
    metric: GrowthMetric
    strataFilter: 'all' | 'freehold' | 'strata'
    growthMethod?: GrowthMethod
    customRange?: { startYear: number; endYear: number }
  }
  resolution: 7 | 8 | 9
}

/** End year for display: the year of the last completed quarter. */

/**
 * Map an R² value to a color for the confidence badge.
 *
 * R² measures how well the log-linear regression fits the observed yearly
 * medians. High R² means the trend line tracks the data closely; low R²
 * means the data is noisy and the trend line may be misleading.
 *
 * Thresholds:
 *   >= 0.7  Green  — good fit, trend line is trustworthy.
 *   >= 0.4  Amber  — moderate fit, visible trend but noisy.
 *   <  0.4  Red    — poor fit, often caused by compositional shifts
 *                    (varying mix of property types year to year).
 */
export function r2Color(r2: number): string {
  if (r2 >= 0.7) return 'text-green-600 dark:text-green-400'
  if (r2 >= 0.4) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

/** Format a price value based on the metric type. */
function formatMetricValue(val: number, metric: GrowthMetric): string {
  if (metric === 'price-per-sqm') {
    return `$${Math.round(val).toLocaleString()}/sqm`
  }
  return formatPrice(val)
}

/** Look up the stored LOESS fitted value at a given year. */
function loessValueAt(year: number, curve: LoessCurveData): number | null {
  const idx = Math.round((year - curve.minQuarter) / 0.25)
  if (idx >= 0 && idx < curve.fittedPrices.length) {
    return curve.fittedPrices[idx]
  }
  return null
}

/** Compute the display price for an individual sale based on the active metric. */
function salePrice(sale: HexSale, metric: GrowthMetric): number | null {
  if (metric === 'price-per-sqm') {
    if (!sale.area || sale.area <= 0) return null
    const sqm = sale.areaType === 'H' ? sale.area * 10000 : sale.area
    return sale.purchasePrice / sqm
  }
  return sale.purchasePrice
}

/**
 * Build the ECharts option for the yearly median chart with trend line overlay.
 *
 * @param rangeStart - Start year of the analysis window (may be overridden by local drag state)
 * @param rangeEnd - End year of the analysis window
 * @param displayEndYear - The data's latest year; the x-axis reaches at least this far
 */
function buildChartOption(
  yearlyMedians: Array<HexYearlyMedian>,
  config: Props['config'],
  point: HeatmapDataPoint,
  loessCurve: LoessCurveData | null,
  rangeStart: number,
  rangeEnd: number,
  displayEndYear: number,
  individualSales?: Array<HexSale> | null,
): EChartsOption {
  const years = yearlyMedians.map((m) => m.year)
  const medians: Array<number | null> = yearlyMedians.map((m) => m.medianPrice)

  // Extend x-axis to displayEndYear so the trend line reaches the displayed end year.
  if (!years.includes(displayEndYear)) {
    years.push(displayEndYear)
    medians.push(null)
  }

  // Compute trend line using point.growth from the server (precomputed).
  const trendData: Array<number | null> = []
  const growth = point.growth

  if (config.growthMethod === 'trend-fit' && point.trendFitIntercept != null) {
    const b = Math.log(1 + growth)
    const a = point.trendFitIntercept

    for (const year of years) {
      if (year >= rangeStart && year <= rangeEnd) {
        trendData.push(Math.round(Math.exp(a + b * year)))
      } else {
        trendData.push(null)
      }
    }
  } else if (config.growthMethod === 'loess' && loessCurve) {
    // Display the FULL precomputed LOESS curve.
    const reliableEnd = Math.floor(loessCurve.maxQuarter - loessCurve.bandwidth)
    const curveStartYear = Math.ceil(loessCurve.minQuarter)
    const curveEndYear = Math.max(reliableEnd, displayEndYear)

    // Expand years array to cover the full curve range
    const allYears = new Set(years)
    for (let y = curveStartYear; y <= curveEndYear; y++) {
      allYears.add(y)
    }
    const sortedYears = [...allYears].sort((a, b) => a - b)

    // Rebuild medians for the expanded x-axis (null where no data)
    const medianMap = new Map(yearlyMedians.map((m) => [m.year, m.medianPrice]))
    const expandedMedians: Array<number | null> = sortedYears.map(
      (y) => medianMap.get(y) ?? null,
    )

    years.length = 0
    years.push(...sortedYears)
    medians.length = 0
    medians.push(...expandedMedians)

    // Plot LOESS values with edge extrapolation
    for (const year of years) {
      trendData.push(loessValueAt(year, loessCurve))
    }
  } else if (config.growthMethod === 'endpoint' || !config.growthMethod) {
    // Endpoint CAGR: exponential curve anchored at medianStart
    if (point.medianStart > 0) {
      for (const year of years) {
        if (year >= rangeStart && year <= rangeEnd) {
          const yearsFromStart = year - rangeStart
          trendData.push(
            Math.round(
              point.medianStart * Math.pow(1 + growth, yearsFromStart),
            ),
          )
        } else {
          trendData.push(null)
        }
      }
    }
  }

  const isSqm = config.metric === 'price-per-sqm'
  const yAxisLabel = isSqm ? '$/sqm' : 'Median Price'

  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      appendTo: () => document.body,
      formatter: (params: unknown) => {
        const items = params as Array<{
          seriesName: string
          value: number | [number, number]
          marker: string
          axisValue: string
        }>
        let html = `<div style="font-weight:600;margin-bottom:4px">${items[0].axisValue}</div>`
        for (const item of items) {
          const val = Array.isArray(item.value) ? item.value[1] : item.value
          if (val == null) continue
          html += `<div>${item.marker} ${item.seriesName}: <b>${formatMetricValue(val, config.metric)}</b></div>`
        }
        const medianItem = yearlyMedians.find(
          (m) => m.year === Number(items[0].axisValue),
        )
        if (medianItem) {
          html += `<div style="color:#888;margin-top:4px">${medianItem.saleCount} sales</div>`
        }
        return html
      },
    },
    grid: {
      left: 16,
      right: 16,
      top: 40,
      bottom: 24,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: years.map(String),
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      name: yAxisLabel,
      nameTextStyle: { fontSize: 10 },
      axisLabel: {
        fontSize: 10,
        formatter: (val: number) => {
          if (isSqm) return `$${(val / 1000).toFixed(0)}k`
          if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
          return `$${(val / 1000).toFixed(0)}k`
        },
      },
    },
    series: [
      {
        name: 'Yearly Median',
        type: 'line',
        data: medians,
        connectNulls: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 1, type: 'solid' },
        itemStyle: { color: '#3b82f6' },
        // Shaded analysis window spanning the selected range
        markArea: {
          silent: true,
          label: { show: false },
          itemStyle: { color: 'rgba(59, 130, 246, 0.05)', borderWidth: 0 },
          data: [
            [{ xAxis: String(rangeStart) }, { xAxis: String(rangeEnd) }],
          ] as Array<[{ xAxis: string }, { xAxis: string }]>,
        },
      },
      ...(trendData.some((v) => v !== null)
        ? [
            {
              name:
                config.growthMethod === 'trend-fit'
                  ? 'Trend-fit'
                  : config.growthMethod === 'loess'
                    ? 'LOESS'
                    : 'CAGR curve',
              type: 'line' as const,
              data: trendData,
              symbol: 'none' as const,
              connectNulls: false,
              lineStyle: {
                width: 2,
                type: 'dashed' as const,
                color: '#f97316',
              },
              itemStyle: { color: '#f97316' },
            },
          ]
        : []),
      // Individual sales scatter — each sale plotted at its contract year
      ...(individualSales && individualSales.length > 0
        ? [
            {
              name: 'Individual Sales',
              type: 'scatter' as const,
              data: individualSales
                .map((sale) => {
                  const price = salePrice(sale, config.metric)
                  if (price == null) return null
                  const year = new Date(sale.contractDate).getFullYear()
                  return [String(year), Math.round(price)] as [string, number]
                })
                .filter((d): d is [string, number] => d !== null),
              symbolSize: 4,
              itemStyle: { color: 'rgba(239, 68, 68, 0.5)' },
              z: 0,
            },
          ]
        : []),
    ],
  }

  return option
}

export function HexDetailDialog({ point, onClose, config, resolution }: Props) {
  const [yearlyMedians, setYearlyMedians] = useState<Array<HexYearlyMedian> | null>(
    null,
  )
  const [sales, setSales] = useState<Array<HexSale> | null>(null)
  const [loessCurve, setLoessCurve] = useState<LoessCurveData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSales, setShowSales] = useState(false)

  // Chart instance state for coordinate conversion (grab handles)
  // useState (not useRef) so that setting the instance triggers a re-render,
  // ensuring ChartRangeHandles receives the instance on first mount.
  const [chartInstance, setChartInstance] = useState<echarts.ECharts | null>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)

  // Dialog-local range override for grab handles (does NOT propagate to heatmap config)
  const [localRange, setLocalRange] = useState<{ startYear: number; endYear: number } | null>(null)

  const isOpen = point !== null

  // Periods end at the data's latest year, not today's date
  const displayEndYear = heatmapEndYear(useDataCoverage())

  // Compute the config-derived range
  const configStartYear = config.customRange
    ? config.customRange.startYear
    : displayEndYear - config.yearsBack
  const configEndYear = config.customRange
    ? config.customRange.endYear
    : displayEndYear

  // Effective range: local drag override takes precedence
  const startYear = localRange?.startYear ?? configStartYear
  const endYear = localRange?.endYear ?? configEndYear

  // Reset local range when dialog opens with a new point or config changes
  useEffect(() => {
    setLocalRange(null)
  }, [point?.h3Index, config.yearsBack, config.customRange?.startYear, config.customRange?.endYear])

  // Fetch data when dialog opens
  useEffect(() => {
    if (!point) {
      setYearlyMedians(null)
      setSales(null)
      setLoessCurve(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    const request = {
      h3Index: point.h3Index,
      resolution,
      metric: config.metric,
      strataFilter: config.strataFilter,
    }

    Promise.all([
      getHexYearlyMedians({ data: request }),
      getHexSales({ data: request }),
      config.growthMethod === 'loess'
        ? getLoessCurve({ data: request })
        : Promise.resolve(null),
    ])
      .then(([medians, salesData, curve]) => {
        setYearlyMedians(medians)
        setSales(salesData)
        setLoessCurve(curve)
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : 'Failed to load hex detail',
        )
      })
      .finally(() => {
        setLoading(false)
      })
  }, [point?.h3Index, resolution, config.metric, config.strataFilter, config.growthMethod]) // eslint-disable-line react-hooks/exhaustive-deps

  // Show grab handles for LOESS (has precomputed curve to evaluate at any year)
  const showGrabHandles = config.growthMethod === 'loess' && loessCurve != null

  const chartOption = useMemo(() => {
    if (!yearlyMedians || yearlyMedians.length === 0 || !point) return null
    return buildChartOption(
      yearlyMedians, config, point, loessCurve,
      startYear, endYear, displayEndYear,
      showSales ? sales : null,
    )
  }, [yearlyMedians, config, point, loessCurve, startYear, endYear, displayEndYear, showSales, sales])

  // Extract x-axis years from chart option for the grab handles
  const chartXYears = useMemo(() => {
    if (!chartOption) return []
    const xData = (chartOption as { xAxis?: { data?: Array<string> } }).xAxis?.data
    return xData?.map(Number) ?? []
  }, [chartOption])

  // Handle grab handle changes (dialog-local only)
  const handleRangeChange = useCallback((newStart: number, newEnd: number) => {
    setLocalRange({ startYear: newStart, endYear: newEnd })
  }, [])

  // For LOESS, recompute growth from integer-year curve values so the
  // header rate matches the displayed start/end values exactly.
  const displayGrowth = useMemo(() => {
    if (!point) return 0
    if (config.growthMethod !== 'loess' || !loessCurve) return point.growth
    const sv = loessValueAt(startYear, loessCurve)
    const ev = loessValueAt(endYear, loessCurve)
    if (!sv || !ev || sv <= 0) return point.growth
    const span = endYear - startYear
    if (span <= 0) return point.growth
    return Math.pow(ev / sv, 1 / span) - 1
  }, [point, config.growthMethod, loessCurve, startYear, endYear])

  const growthColor = point
    ? (() => {
        const [r, g, b] = growthToColor(displayGrowth)
        return `rgb(${r}, ${g}, ${b})`
      })()
    : undefined
  const methodLabel =
    config.growthMethod === 'trend-fit'
      ? 'Trend-fit regression'
      : config.growthMethod === 'loess'
        ? 'LOESS smoothing'
        : 'Endpoint CAGR'

  return (
    <Dialog
      open={isOpen}
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto" overlay={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {point?.locality ?? 'Hex Cell'}
            {point && (
              <span
                className="text-base font-bold"
                style={{ color: growthColor }}
              >
                {formatGrowthPercent(displayGrowth)} p.a.
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Badge variant="outline">Res {resolution}</Badge>
            <Badge variant="outline">{methodLabel}</Badge>
            <Badge variant="outline">
              {config.metric === 'price-per-sqm' ? '$/sqm' : 'Median price'}
            </Badge>
            {point?.trendFitR2 != null && (
              <Badge variant="outline" className={r2Color(point.trendFitR2)}>
                R² {point.trendFitR2.toFixed(2)}
              </Badge>
            )}
            <span>
              {startYear} &ndash; {endYear}
            </span>
            {point && (
              <code className="ml-auto text-[10px] text-muted-foreground font-mono select-all">
                {point.h3Index}
              </code>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Summary row — display values depend on active growth method */}
        {point &&
          (() => {
            const hasTrendFit = point.trendFitIntercept != null
            let displayStart = point.medianStart
            let displayEnd = point.medianEnd
            let startLabel = 'Start median'
            let endLabel = 'End median'
            if (hasTrendFit) {
              const slope = Math.log(1 + point.growth)
              displayStart = Math.round(
                Math.exp(point.trendFitIntercept! + slope * startYear),
              )
              displayEnd = Math.round(
                Math.exp(point.trendFitIntercept! + slope * endYear),
              )
              startLabel = 'Fitted start'
              endLabel = 'Fitted end'
            } else if (config.growthMethod === 'loess' && loessCurve) {
              const startVal = loessValueAt(startYear, loessCurve)
              const endVal = loessValueAt(endYear, loessCurve)
              if (startVal != null) displayStart = startVal
              if (endVal != null) displayEnd = endVal
              startLabel = 'Smoothed start'
              endLabel = 'Smoothed end'
            }
            return (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <div>
                  {startLabel} ({startYear}):{' '}
                  <span className="font-medium text-foreground">
                    {formatMetricValue(displayStart, config.metric)}
                  </span>
                </div>
                <div>
                  {endLabel} ({endYear}):{' '}
                  <span className="font-medium text-foreground">
                    {formatMetricValue(displayEnd, config.metric)}
                  </span>
                </div>
                <div>
                  Total sales:{' '}
                  <span className="font-medium text-foreground">
                    {point.saleCount.toLocaleString()}
                  </span>
                </div>
              </div>
            )
          })()}

        {/* Data caveat */}
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={-1} className="mt-px shrink-0 cursor-help">
                  <HugeiconsIcon
                    icon={InformationCircleIcon}
                    className="h-3.5 w-3.5 text-muted-foreground"
                    strokeWidth={2}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="max-w-xs text-xs leading-relaxed"
              >
                Medians are computed across all property types within this cell
                (houses, units, land, etc.). Years with an unusual mix, e.g.
                many luxury sales or many knockdowns, can shift the median
                without reflecting genuine price growth. The trend-fit method
                reduces this noise by fitting across all years rather than
                comparing endpoints.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span>
            Medians include all property types. Compositional shifts between
            years may affect values.
          </span>
        </div>

        {/* Chart controls */}
        <div className="flex items-center gap-2">
          <Label htmlFor="show-sales" className="text-xs">Show individual sales</Label>
          <Switch
            id="show-sales"
            size="sm"
            checked={showSales}
            onCheckedChange={(v) => setShowSales(v === true)}
          />
        </div>

        {/* Chart with grab handle overlays */}
        <div ref={chartContainerRef} className="relative h-[300px] w-full">
          {loading && !chartOption && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading chart data...
            </div>
          )}
          {error && (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          )}
          {chartOption && (
            <EChartsBase
              option={chartOption}
              loading={loading}
              onInit={(chart) => { setChartInstance(chart) }}
            />
          )}
          {showGrabHandles && chartOption && (
            <ChartRangeHandles
              chartInstance={chartInstance}
              startYear={startYear}
              endYear={endYear}
              years={chartXYears}
              onChange={handleRangeChange}
              containerRef={chartContainerRef}
            />
          )}
          {!loading &&
            !error &&
            yearlyMedians &&
            yearlyMedians.length === 0 && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No yearly median data available for this cell.
              </div>
            )}
        </div>

        {/* Sales table */}
        {sales && sales.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {sales.length.toLocaleString()} individual sales
            </div>
            <div className="max-h-[300px] overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Date</th>
                    <th className="px-2 py-1.5 text-left font-medium">
                      Address
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      Price
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">Type</th>
                    <th className="px-2 py-1.5 text-right font-medium">Area</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale, i) => (
                    <tr
                      key={`${sale.propertyId}-${sale.contractDate}-${i}`}
                      className="border-t hover:bg-muted/50"
                    >
                      <td className="px-2 py-1.5 tabular-nums">
                        {formatDate(sale.contractDate)}
                      </td>
                      <td className="px-2 py-1.5">{sale.address || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatPrice(sale.purchasePrice)}
                      </td>
                      <td className="px-2 py-1.5">
                        {sale.strata ? 'Strata' : 'Freehold'}
                        {sale.natureOfProperty
                          ? ` (${natureLabel(sale.natureOfProperty)})`
                          : ''}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {sale.area
                          ? `${sale.area.toLocaleString()} ${sale.areaType === 'H' ? 'ha' : 'sqm'}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sales && sales.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground">
            No individual sales found for this cell.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
