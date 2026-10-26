/**
 * Settings panel for the Median Price per sqm widget.
 * Controlled component — receives config and calls onChange to update.
 */

import { SuburbsFilter } from '../../components/filters/SuburbsFilter'
import { PropertyTypeFilter } from '../../components/filters/PropertyTypeFilter'
import { DateRangeFilter } from '../../components/filters/DateRangeFilter'
import { DataSourceControl } from '../../components/filters/DataSourceControl'
import { TrendLineControls } from '../../components/filters/TrendLineControls'
import { MethodExplainer } from '../../components/MethodExplainer'
import type { Granularity } from '@/lib/queries'
import type { MedianPriceSqmConfig } from './definition'
import { DEFAULT_LOESS_SPAN, DEFAULT_MA_WINDOW } from '@/lib/stats'
import { AreaPickerButton } from '@/features/areas/components/AreaPickerButton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface Props {
  config: MedianPriceSqmConfig
  onChange: (config: MedianPriceSqmConfig) => void
}

export function MedianPriceSqmSettings({ config, onChange }: Props) {
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

      <DataSourceControl
        value={config.dataSource ?? 'all-sales'}
        onChange={(dataSource) => onChange({ ...config, dataSource })}
      />

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

      <DateRangeFilter
        dateFrom={config.dateFrom}
        dateTo={config.dateTo}
        onChange={(dateFrom, dateTo) =>
          onChange({ ...config, dateFrom, dateTo })
        }
      />

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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <Label htmlFor="bayes-estimate-sqm">Bayesian estimate</Label>
          <MethodExplainer methodId="empirical-bayes" />
        </div>
        <Switch
          id="bayes-estimate-sqm"
          size="sm"
          checked={config.showBayesEstimate ?? false}
          onCheckedChange={(checked) =>
            onChange({ ...config, showBayesEstimate: checked === true })
          }
        />
      </div>
    </div>
  )
}
