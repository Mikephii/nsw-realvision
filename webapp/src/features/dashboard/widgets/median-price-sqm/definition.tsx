/**
 * Widget definition for Median Price per sqm Time Series (line chart).
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { ChartLineData01Icon } from '@hugeicons/core-free-icons'
import {  registerWidget } from '../registry'
import { MedianPriceSqmChart } from './MedianPriceSqmChart'
import { MedianPriceSqmSettings } from './MedianPriceSqmSettings'
import type {WidgetTag} from '../registry';
import type { DataSource, Granularity, StrataFilter } from '@/lib/queries'
import type { TrendLineMethod } from '@/lib/stats'

export interface MedianPriceSqmConfig {
  localities: Array<string>
  /** Custom area IDs for spatial polygon filtering. Optional for backward compat. */
  areaIds?: Array<string>
  granularity: Granularity
  strataFilter?: StrataFilter
  dateFrom: string | null
  dateTo: string | null
  /**
   * Data source for the time series.
   * - `'all-sales'` — Every valid sale (default).
   * - `'repeat-sales'` — Only properties that have sold 2+ times.
   * @default 'all-sales'
   */
  dataSource?: DataSource
  /**
   * Whether to show an empirical Bayes blended estimate line for sparse periods.
   * @default false
   */
  showBayesEstimate?: boolean
  /** Smoothing method applied to price/sqm values. Defaults to 'none'. */
  trendLine?: TrendLineMethod
  /** LOESS span (0.1–0.9). Only used when trendLine is 'loess'. */
  loessSpan?: number
  /** Moving average window size in periods. Only used when trendLine is 'moving-average'. */
  movingAvgWindow?: number
}

function MedianPriceSqmIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={ChartLineData01Icon}
      className={className}
      strokeWidth={2}
    />
  )
}

registerWidget<MedianPriceSqmConfig>({
  type: 'median-price-sqm',
  label: 'Price per sqm Trend',
  icon: MedianPriceSqmIcon,
  defaultLayout: { w: 6, h: 4, minW: 3, minH: 3 },
  defaultConfig: () => ({
    localities: [],
    areaIds: [],
    granularity: 'year',
    strataFilter: 'all',
    dateFrom: null,
    dateTo: null,
    trendLine: 'none' as const,
  }),
  component: MedianPriceSqmChart,
  settingsPanel: MedianPriceSqmSettings,
  getTags: (config) => {
    const tags: Array<WidgetTag> = []
    if (config.dataSource === 'repeat-sales')
      tags.push({ label: 'Repeat Sales' })
    if (config.showBayesEstimate) tags.push({ label: 'Bayes Est.' })
    if (config.strataFilter === 'freehold') tags.push({ label: 'Freehold' })
    if (config.strataFilter === 'strata') tags.push({ label: 'Strata' })
    if (config.trendLine === 'loess') tags.push({ label: 'LOESS' })
    if (config.trendLine === 'moving-average')
      tags.push({ label: `${config.movingAvgWindow ?? 3}p MA` })
    return tags
  },
})
