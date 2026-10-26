/**
 * Widget definition for Growth Heatmap.
 *
 * Registers the growth heatmap as a dashboard widget. The heatmap shows
 * annualized property growth rates as a smooth IDW gradient on a map.
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { Analytics01Icon } from '@hugeicons/core-free-icons'
import {  registerWidget } from '../registry'
import { GrowthHeatmap } from './GrowthHeatmap'
import { GrowthHeatmapSettings } from './GrowthHeatmapSettings'
import type {WidgetTag} from '../registry';
import type { GrowthHeatmapConfig } from './types'

function GrowthHeatmapIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={Analytics01Icon}
      className={className}
      strokeWidth={2}
    />
  )
}

registerWidget<GrowthHeatmapConfig>({
  type: 'growth-heatmap',
  label: 'Growth Heatmap',
  icon: GrowthHeatmapIcon,
  defaultLayout: { w: 6, h: 5, minW: 4, minH: 3 },
  defaultConfig: () => ({
    yearsBack: 10,
    metric: 'median-price',
    strataFilter: 'freehold',
    renderer: 'custom',
    viewport: { longitude: 151.215, latitude: -33.845, zoom: 12.5 },
  }),
  component: GrowthHeatmap,
  settingsPanel: GrowthHeatmapSettings,
  getTags: (config) => {
    const tags: Array<WidgetTag> = []
    if (config.customRange) {
      tags.push({ label: `${config.customRange.startYear}\u2013${config.customRange.endYear}` })
    } else {
      const years = config.growthMethod === 'loess'
        ? (config.loessYearsBack ?? config.yearsBack)
        : config.yearsBack
      tags.push({ label: `${years}yr` })
    }
    if (config.metric === 'price-per-sqm') tags.push({ label: '$/sqm' })
    if (config.strataFilter === 'freehold') tags.push({ label: 'Freehold' })
    if (config.strataFilter === 'strata') tags.push({ label: 'Strata' })
    if (config.growthMethod === 'trend-fit') tags.push({ label: 'Trend-Fit' })
    if (config.growthMethod === 'loess') tags.push({ label: 'LOESS' })
    if (config.fillSparseHexes) tags.push({ label: 'Fill' })
    if (config.customColorStops) tags.push({ label: 'Custom Colors' })
    return tags
  },
})
