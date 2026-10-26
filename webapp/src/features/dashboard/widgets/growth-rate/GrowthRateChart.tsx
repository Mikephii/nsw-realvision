/**
 * Growth Rate Comparison line chart widget.
 *
 * Fetches raw median price (or price/sqm) data and normalizes each
 * locality to 0% at the first period. This lets users compare suburbs
 * with different absolute price levels on the same scale.
 *
 * When a smoothing method is active, smoothing is applied to raw price
 * values BEFORE normalization to 0% baseline. This is more statistically
 * correct — LOESS on raw prices captures the actual price trend, and
 * normalizing smoothed prices preserves relative growth rates.
 */

import { useMemo } from 'react'
import { useWidgetData } from '../../hooks/use-widget-data'
import type { EChartsOption } from '@/components/charts/EChartsBase'
import type {TimeSeriesPoint} from '@/lib/stats';
import type { GrowthRateConfig } from './definition'
import { EChartsBase } from '@/components/charts/EChartsBase'
import {
  getMedianPriceSqmTimeSeries,
  getMedianPriceTimeSeries,
} from '@/lib/server-fns'
import { useAreaStore } from '@/features/areas/area-store'
import { resolveSpatialFilters } from '@/features/areas/spatial/geo-utils'
import {
  LOW_SAMPLE_THRESHOLD,
  
  applySmoothingToSeries
} from '@/lib/stats'

/** Unified shape for both median price and price-per-sqm data. */
interface PeriodDataPoint {
  period: string
  locality: string
  value: number
  saleCount: number
}

interface Props {
  config: GrowthRateConfig
  widgetId: string
}

export function GrowthRateChart({ config, widgetId }: Props) {
  const getAreaById = useAreaStore((s) => s.getById)

  const validAreaIds = useMemo(
    () => (config.areaIds ?? []).filter((id) => getAreaById(id)),
    [config.areaIds, getAreaById],
  )

  const { data, isLoading, error } = useWidgetData<
    GrowthRateConfig,
    Array<PeriodDataPoint>
  >(widgetId, config, async (cfg) => {
    const hasLocalities = cfg.localities.length > 0
    if (!hasLocalities && validAreaIds.length === 0) return []

    const spatialFilters =
      validAreaIds.length > 0
        ? resolveSpatialFilters(validAreaIds, getAreaById)
        : undefined

    const filter = {
      localities: cfg.localities,
      dateFrom: cfg.dateFrom ?? undefined,
      dateTo: cfg.dateTo ?? undefined,
      strataFilter: cfg.strataFilter,
      spatialFilters,
    }

    if (cfg.metric === 'price-per-sqm') {
      const rows = await getMedianPriceSqmTimeSeries({
        data: { filter, granularity: cfg.granularity },
      })
      return rows.map((r) => ({
        period: r.period,
        locality: r.locality,
        value: r.medianPriceSqm,
        saleCount: r.saleCount,
      }))
    }

    const rows = await getMedianPriceTimeSeries({
      data: { filter, granularity: cfg.granularity },
    })
    return rows.map((r) => ({
      period: r.period,
      locality: r.locality,
      value: r.medianPrice,
      saleCount: r.saleCount,
    }))
  })

  const option = useMemo<EChartsOption>(() => {
    if (!data || data.length === 0) return {}
    return buildOption(data, config)
  }, [
    data,
    config.metric,
    config.trendLine,
    config.loessSpan,
    config.movingAvgWindow,
  ])

  if (config.localities.length === 0 && validAreaIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select suburbs or areas in settings to compare growth rates
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

function formatValue(value: number, metric: string): string {
  if (metric === 'price-per-sqm') {
    return currencyFormatter.format(value) + '/sqm'
  }
  return currencyFormatter.format(value)
}

function buildOption(
  data: Array<PeriodDataPoint>,
  config: GrowthRateConfig,
): EChartsOption {
  const periods = [...new Set(data.map((d) => d.period))].sort()
  const labels = [...new Set(data.map((d) => d.locality))].sort()

  const series = labels
    .map((label) => {
      const labelData = data.filter((d) => d.locality === label)
      const valueMap = new Map(labelData.map((d) => [d.period, d.value]))

      // Smooth raw values BEFORE normalization. LOESS on raw prices captures
      // the actual price trend; normalizing smoothed prices preserves
      // relative growth rates.
      const rawPoints: Array<TimeSeriesPoint> = periods.map((p, i) => ({
        x: i,
        y: valueMap.get(p) ?? null,
      }))
      const smoothed = applySmoothingToSeries(
        rawPoints,
        config.trendLine ?? 'none',
        { span: config.loessSpan, window: config.movingAvgWindow },
      )

      // Baseline = smoothed value at the first period with data
      const baseline = smoothed.find((p) => p.y !== null)?.y ?? null

      // Skip localities with no baseline or zero baseline (can't compute %)
      if (!baseline || baseline === 0) return null

      return {
        name: label,
        type: 'line' as const,
        smooth: true,
        data: smoothed.map((p) =>
          p.y != null ? ((p.y - baseline) / baseline) * 100 : null,
        ),
        connectNulls: true,
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  // Build lookup maps for tooltips (period → locality → value/count)
  const rawValueMap = new Map<string, Map<string, number>>()
  const saleCountMap = new Map<string, Map<string, number>>()
  for (const d of data) {
    if (!rawValueMap.has(d.period)) rawValueMap.set(d.period, new Map())
    rawValueMap.get(d.period)!.set(d.locality, d.value)
    if (!saleCountMap.has(d.period)) saleCountMap.set(d.period, new Map())
    saleCountMap.get(d.period)!.set(d.locality, d.saleCount)
  }

  return {
    tooltip: {
      appendTo: () => document.body,
      trigger: 'axis',
      formatter: (params: unknown) => {
        const items = params as Array<{
          seriesName: string
          value: number | null
          axisValue: string
          marker: string
        }>
        if (!items || items.length === 0) return ''

        const period = items[0].axisValue
        const lines = items
          .filter((item) => item.value != null)
          .map((item) => {
            const pct = item.value!
            const sign = pct >= 0 ? '+' : ''
            const rawVal = rawValueMap.get(period)?.get(item.seriesName)
            const rawStr =
              rawVal != null ? ` (${formatValue(rawVal, config.metric)})` : ''
            const count = saleCountMap.get(period)?.get(item.seriesName)
            const countStr =
              count != null
                ? ` \u00B7 ${count} sale${count !== 1 ? 's' : ''}`
                : ''
            const warn =
              count != null && count < LOW_SAMPLE_THRESHOLD ? ' \u26A0' : ''
            return `${item.marker} ${item.seriesName}: ${sign}${pct.toFixed(1)}%${rawStr}${countStr}${warn}`
          })

        return `<strong>${period}</strong><br/>${lines.join('<br/>')}`
      },
    },
    legend: { data: labels, top: 0, left: 'center' },
    grid: { left: 60, right: 16, top: 32, bottom: 24, containLabel: false },
    xAxis: { type: 'category', data: periods },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => {
          const sign = v >= 0 ? '+' : ''
          return `${sign}${v.toFixed(0)}%`
        },
      },
    },
    series,
  }
}
