/**
 * Widget definition for Growth Rate Comparison (line chart).
 *
 * Shows cumulative percentage change from a baseline period, allowing
 * comparison of suburbs with vastly different price levels. All lines
 * start at 0% and diverge based on relative growth.
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { ChartAverageIcon } from '@hugeicons/core-free-icons'
import {  registerWidget } from '../registry'
import { GrowthRateChart } from './GrowthRateChart'
import { GrowthRateSettings } from './GrowthRateSettings'
import type {WidgetTag} from '../registry';
import type { Granularity, StrataFilter } from '@/lib/queries'
import type { TrendLineMethod } from '@/lib/stats'
import { DEFAULT_MA_WINDOW } from '@/lib/stats'

export type GrowthRateMetric = 'median-price' | 'price-per-sqm'

export interface GrowthRateConfig {
  localities: Array<string>
  /** Custom area IDs for spatial polygon filtering. */
  areaIds?: Array<string>
  granularity: Granularity
  strataFilter?: StrataFilter
  /** Which price metric to normalize. */
  metric: GrowthRateMetric
  dateFrom: string | null
  dateTo: string | null

  /**
   * Active trend line smoothing method.
   * - `'none'` — Raw data lines (default).
   * - `'loess'` — LOESS-smoothed curves replace raw lines.
   * - `'moving-average'` — Trailing moving average replaces raw lines.
   *
   * For growth rate charts, smoothing is applied to raw price values
   * BEFORE normalization to 0% baseline — this is more statistically
   * correct than smoothing the normalized percentages.
   * @default 'none'
   */
  trendLine?: TrendLineMethod

  /**
   * LOESS bandwidth (span) parameter.
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

function GrowthRateIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={ChartAverageIcon}
      className={className}
      strokeWidth={2}
    />
  )
}

registerWidget<GrowthRateConfig>({
  type: 'growth-rate',
  label: 'Growth Rate Comparison',
  icon: GrowthRateIcon,
  defaultLayout: { w: 6, h: 4, minW: 3, minH: 3 },
  defaultConfig: () => ({
    localities: [],
    areaIds: [],
    granularity: 'year',
    strataFilter: 'all',
    metric: 'median-price',
    dateFrom: null,
    dateTo: null,
    trendLine: 'none' as const,
  }),
  component: GrowthRateChart,
  settingsPanel: GrowthRateSettings,
  getTags: (config) => {
    const tags: Array<WidgetTag> = []
    if (config.strataFilter === 'freehold') tags.push({ label: 'Freehold' })
    if (config.strataFilter === 'strata') tags.push({ label: 'Strata' })
    if (config.metric === 'price-per-sqm') tags.push({ label: '$/sqm' })
    if (config.trendLine === 'loess') tags.push({ label: 'LOESS' })
    if (config.trendLine === 'moving-average')
      tags.push({ label: `${config.movingAvgWindow ?? DEFAULT_MA_WINDOW}p MA` })
    return tags
  },
})
