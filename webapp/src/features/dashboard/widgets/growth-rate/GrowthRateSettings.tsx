/**
 * Settings panel for the Growth Rate Comparison widget.
 * Controlled component — receives config and calls onChange to update.
 */

import { SuburbsFilter } from '../../components/filters/SuburbsFilter'
import { PropertyTypeFilter } from '../../components/filters/PropertyTypeFilter'
import { DateRangeFilter } from '../../components/filters/DateRangeFilter'
import { TrendLineControls } from '../../components/filters/TrendLineControls'
import type { Granularity } from '@/lib/queries'
import type { GrowthRateConfig, GrowthRateMetric } from './definition'
import { AreaPickerButton } from '@/features/areas/components/AreaPickerButton'
import { DEFAULT_LOESS_SPAN, DEFAULT_MA_WINDOW } from '@/lib/stats'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface Props {
  config: GrowthRateConfig
  onChange: (config: GrowthRateConfig) => void
}

export function GrowthRateSettings({ config, onChange }: Props) {
  return (
    <div className="space-y-4">
      <SuburbsFilter
        localities={config.localities}
        onChange={(localities) => onChange({ ...config, localities })}
      />

      <AreaPickerButton
        selectedAreaIds={config.areaIds ?? []}
        onChange={(areaIds) => onChange({ ...config, areaIds })}
      />

      <PropertyTypeFilter
        value={config.strataFilter ?? 'all'}
        onChange={(strataFilter) => onChange({ ...config, strataFilter })}
      />

      <div>
        <Label>Metric</Label>
        <Select
          value={config.metric}
          onValueChange={(v) =>
            onChange({ ...config, metric: v as GrowthRateMetric })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="median-price">Median Price</SelectItem>
            <SelectItem value="price-per-sqm">Price per sqm</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Granularity</Label>
        <Select
          value={config.granularity}
          onValueChange={(v) =>
            onChange({ ...config, granularity: v as Granularity })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="year">Year</SelectItem>
            <SelectItem value="quarter">Quarter</SelectItem>
            <SelectItem value="month">Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <TrendLineControls
        trendLine={config.trendLine ?? 'none'}
        loessSpan={config.loessSpan ?? DEFAULT_LOESS_SPAN}
        movingAvgWindow={config.movingAvgWindow ?? DEFAULT_MA_WINDOW}
        onTrendLineChange={(trendLine) => onChange({ ...config, trendLine })}
        onLoessSpanChange={(loessSpan) => onChange({ ...config, loessSpan })}
        onMovingAvgWindowChange={(movingAvgWindow) =>
          onChange({ ...config, movingAvgWindow })
        }
      />

      <DateRangeFilter
        dateFrom={config.dateFrom}
        dateTo={config.dateTo}
        onChange={(dateFrom, dateTo) =>
          onChange({ ...config, dateFrom, dateTo })
        }
      />
    </div>
  )
}
