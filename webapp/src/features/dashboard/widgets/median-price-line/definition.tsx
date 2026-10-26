/**
 * Widget definition for Median Price Time Series (line chart).
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { ChartLineData01Icon } from '@hugeicons/core-free-icons'
import {  registerWidget } from '../registry'
import { MedianPriceLineChart } from './MedianPriceLineChart'
import { MedianPriceLineSettings } from './MedianPriceLineSettings'
import type {WidgetTag} from '../registry';
import type { DataSource, Granularity, StrataFilter } from '@/lib/queries'
import type { TrendLineMethod } from '@/lib/stats'
import { DEFAULT_MA_WINDOW } from '@/lib/stats'

export interface MedianPriceLineConfig {
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
   * When enabled, a dashed line appears alongside the raw/smoothed line,
   * showing values blended toward a broader reference trend. The blending
   * strength depends on local sample size — more sales = more local weight.
   *
   * Most useful for small custom areas with sparse data.
   * @default false
   */
  showBayesEstimate?: boolean

  /**
   * Active trend line smoothing method.
   * - `'none'` — Raw data lines (default, same as current behavior).
   * - `'loess'` — LOESS-smoothed curves replace raw lines.
   * - `'moving-average'` — Trailing moving average replaces raw lines.
   * @default 'none'
   */
  trendLine?: TrendLineMethod

  /**
   * LOESS bandwidth (span) parameter. Controls how much of the data
   * influences each smoothed point.
   * Range: 0.1 (very responsive) to 0.9 (very smooth).
   * @default 0.35
   */
  loessSpan?: number

  /**
   * Trailing window size for moving average, in number of periods.
   * @default 3
   */
  movingAvgWindow?: number
}

function MedianPriceLineIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={ChartLineData01Icon}
      className={className}
      strokeWidth={2}
    />
  )
}

registerWidget<MedianPriceLineConfig>({
  type: 'median-price-line',
  label: 'Median Price Trend',
  icon: MedianPriceLineIcon,
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
  component: MedianPriceLineChart,
  settingsPanel: MedianPriceLineSettings,
  getTags: (config) => {
    const tags: Array<WidgetTag> = []
    if (config.dataSource === 'repeat-sales')
      tags.push({ label: 'Repeat Sales' })
    if (config.showBayesEstimate) tags.push({ label: 'Bayes Est.' })
    if (config.strataFilter === 'freehold') tags.push({ label: 'Freehold' })
    if (config.strataFilter === 'strata') tags.push({ label: 'Strata' })
    if (config.trendLine === 'loess') tags.push({ label: 'LOESS' })
    if (config.trendLine === 'moving-average')
      tags.push({ label: `${config.movingAvgWindow ?? DEFAULT_MA_WINDOW}p MA` })
    return tags
  },
})
