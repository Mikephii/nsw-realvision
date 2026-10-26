/**
 * Median Price Time Series line chart widget.
 * Renders one line per suburb showing median sale price over time.
 *
 * This component is composable — it can be used inside the dashboard grid
 * or on a standalone page. It receives config as a prop and fetches its own data.
 *
 * When a smoothing method is active (LOESS or Moving Average), the raw line
 * is replaced with the smoothed version — not overlaid. This keeps the chart
 * readable when comparing multiple areas. The widget header tag indicates
 * which method is active.
 */

import { useMemo } from 'react'
import { useWidgetData } from '../../hooks/use-widget-data'
import type { EChartsOption } from '@/components/charts/EChartsBase'
import type {BayesSeriesInput, BayesSeriesPoint, TimeSeriesPoint} from '@/lib/stats';
import type { MedianPriceLineConfig } from './definition'
import type { MedianPriceByPeriod } from '@/lib/queries'
import { EChartsBase } from '@/components/charts/EChartsBase'
import { getMedianPriceTimeSeries } from '@/lib/server-fns'
import { useAreaStore } from '@/features/areas/area-store'
import { resolveSpatialFilters } from '@/features/areas/spatial/geo-utils'
import {
  BAYES_SHRINKAGE_K,
  
  
  LOW_SAMPLE_THRESHOLD,
  
  applySmoothingToSeries,
  computeBayesSeries
} from '@/lib/stats'
import { resolveChartColor } from '@/components/charts/echarts-theme'

interface Props {
  config: MedianPriceLineConfig
  widgetId: string
}

export function MedianPriceLineChart({ config, widgetId }: Props) {
  const getAreaById = useAreaStore((s) => s.getById)

  // Filter out stale area IDs (deleted areas) so we never pass undefined downstream
  const validAreaIds = useMemo(
    () => (config.areaIds ?? []).filter((id) => getAreaById(id)),
    [config.areaIds, getAreaById],
  )

  const { data, isLoading, error } = useWidgetData<
    MedianPriceLineConfig,
    Array<MedianPriceByPeriod>
  >(widgetId, config, async (cfg) => {
    const hasLocalities = cfg.localities.length > 0
    if (!hasLocalities && validAreaIds.length === 0) return []
    const spatialFilters =
      validAreaIds.length > 0
        ? resolveSpatialFilters(validAreaIds, getAreaById)
        : undefined
    return getMedianPriceTimeSeries({
      data: {
        filter: {
          localities: cfg.localities,
          dateFrom: cfg.dateFrom ?? undefined,
          dateTo: cfg.dateTo ?? undefined,
          strataFilter: cfg.strataFilter,
          spatialFilters,
        },
        granularity: cfg.granularity,
        dataSource: cfg.dataSource,
      },
    })
  })

  const option = useMemo<EChartsOption>(() => {
    if (!data || data.length === 0) return {}
    return buildOption(data, config)
  }, [
    data,
    config.trendLine,
    config.loessSpan,
    config.movingAvgWindow,
    config.showBayesEstimate,
  ])

  if (config.localities.length === 0 && validAreaIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select suburbs or areas in settings to see price trends
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return <EChartsBase option={option} loading={isLoading} />
}

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function buildOption(
  data: Array<MedianPriceByPeriod>,
  config: MedianPriceLineConfig,
): EChartsOption {
  const periods = [...new Set(data.map((d) => d.period))].sort()
  const labels = [...new Set(data.map((d) => d.locality))].sort()

  // Build sale count lookup for tooltips (period → locality → count)
  const saleCountMap = new Map<string, Map<string, number>>()
  for (const d of data) {
    if (!saleCountMap.has(d.period)) saleCountMap.set(d.period, new Map())
    saleCountMap.get(d.period)!.set(d.locality, d.saleCount)
  }

  // Build per-label raw points and sale count arrays (shared by primary + Bayes)
  const labelDataMap = new Map<
    string,
    { rawPoints: Array<TimeSeriesPoint>; saleCounts: Array<number> }
  >()
  for (const label of labels) {
    const rows = data.filter((d) => d.locality === label)
    const valueMap = new Map(rows.map((d) => [d.period, d.medianPrice]))
    const countMap = new Map(rows.map((d) => [d.period, d.saleCount]))
    labelDataMap.set(label, {
      rawPoints: periods.map((p, i) => ({ x: i, y: valueMap.get(p) ?? null })),
      saleCounts: periods.map((p) => countMap.get(p) ?? 0),
    })
  }

  // Primary series (raw or smoothed)
  const series: Array<Record<string, unknown>> = labels.map((label) => {
    const { rawPoints } = labelDataMap.get(label)!
    const smoothed = applySmoothingToSeries(
      rawPoints,
      config.trendLine ?? 'none',
      {
        span: config.loessSpan,
        window: config.movingAvgWindow,
      },
    )
    return {
      name: label,
      type: 'line' as const,
      smooth: true,
      data: smoothed.map((p) => p.y),
      connectNulls: true,
    }
  })

  // Bayes estimate series (dashed, when enabled).
  // Only added for series that actually have sparse periods (saleCount < k),
  // so dense suburbs don't get a redundant dashed line.
  // Uses the SAME name as the primary series so legend toggle/hover links both.
  let bayesDataMap: Map<string, Array<BayesSeriesPoint>> | null = null
  const estimateSeriesIndices = new Set<number>()
  if (config.showBayesEstimate) {
    const bayesInputs: Array<BayesSeriesInput> = labels.map((label) => {
      const { rawPoints, saleCounts } = labelDataMap.get(label)!
      return { label, points: rawPoints, saleCounts }
    })
    bayesDataMap = computeBayesSeries(
      bayesInputs,
      BAYES_SHRINKAGE_K,
      config.loessSpan,
    )

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]
      const { saleCounts } = labelDataMap.get(label)!
      const hasSparse = saleCounts.some((c) => c > 0 && c < BAYES_SHRINKAGE_K)
      if (!hasSparse) continue

      const bayesPoints = bayesDataMap.get(label)
      if (!bayesPoints) continue

      estimateSeriesIndices.add(series.length)
      series.push({
        name: label, // same name → linked legend toggle/hover
        type: 'line' as const,
        smooth: true,
        data: bayesPoints.map((p) => p.y),
        connectNulls: true,
        lineStyle: { type: 'dashed' as const, width: 1.5, opacity: 0.7 },
        color: resolveChartColor(i),
        symbol: 'none',
        z: 1,
      })
    }
  }

  return {
    tooltip: {
      appendTo: () => document.body,
      trigger: 'axis',
      formatter: (params: unknown) => {
        const items = params as Array<{
          seriesName: string
          seriesIndex: number
          value: number | null
          axisValue: string
          marker: string
        }>
        if (!items || items.length === 0) return ''

        const period = items[0].axisValue
        const lines: Array<string> = []

        for (const item of items) {
          if (item.value == null) continue

          const isEstimate = estimateSeriesIndices.has(item.seriesIndex)

          if (isEstimate && bayesDataMap) {
            const periodIdx = periods.indexOf(period)
            const bayesPoint = bayesDataMap.get(item.seriesName)?.[periodIdx]
            const estPct = bayesPoint?.estimationPct ?? 0
            if (estPct > 0) {
              const formatted = currencyFormatter.format(item.value)
              lines.push(
                `${item.marker} Est: ${formatted} <span style="opacity:0.7;font-size:0.85em">(${estPct}% from trend)</span>`,
              )
            }
          } else if (!isEstimate) {
            const formatted = currencyFormatter.format(item.value)
            const count = saleCountMap.get(period)?.get(item.seriesName)
            const countStr =
              count != null ? ` (${count} sale${count !== 1 ? 's' : ''})` : ''
            const warn =
              count != null && count < LOW_SAMPLE_THRESHOLD ? ' \u26A0' : ''
            lines.push(
              `${item.marker} ${item.seriesName}: ${formatted}${countStr}${warn}`,
            )
          }
        }

        return `<strong>${period}</strong><br/>${lines.join('<br/>')}`
      },
    },
    legend: { data: labels, top: 0, left: 'center' },
    grid: { left: 60, right: 16, top: 32, bottom: 24, containLabel: false },
    xAxis: { type: 'category', data: periods },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => `$${(v / 1000).toFixed(0)}k`,
      },
    },
    series,
  }
}
