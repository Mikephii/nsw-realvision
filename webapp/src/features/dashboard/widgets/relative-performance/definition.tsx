/**
 * Widget definition for Relative Performance.
 *
 * Registers the relative performance heatmap as a dashboard widget.
 * Shows property growth relative to the metro-wide average.
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { ChartAverageIcon } from '@hugeicons/core-free-icons'
import {  registerWidget } from '../registry'
import { RelativePerformance } from './RelativePerformance'
import { RelativePerformanceSettings } from './RelativePerformanceSettings'
import type {WidgetTag} from '../registry';
import type { RelativePerformanceConfig } from './types'

function RelativePerformanceIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={ChartAverageIcon}
      className={className}
      strokeWidth={2}
    />
  )
}

registerWidget<RelativePerformanceConfig>({
  type: 'relative-performance',
  label: 'Relative Performance',
  icon: RelativePerformanceIcon,
  defaultLayout: { w: 6, h: 5, minW: 4, minH: 3 },
  defaultConfig: () => ({
    yearsBack: 10,
    metric: 'median-price',
    strataFilter: 'freehold',
    renderer: 'custom',
  }),
  component: RelativePerformance,
  settingsPanel: RelativePerformanceSettings,
  getTags: (config) => {
    const tags: Array<WidgetTag> = []
    tags.push({ label: `${config.yearsBack}yr` })
    if (config.metric === 'price-per-sqm') tags.push({ label: '$/sqm' })
    if (config.strataFilter === 'freehold') tags.push({ label: 'Freehold' })
    if (config.strataFilter === 'strata') tags.push({ label: 'Strata' })
    return tags
  },
})
