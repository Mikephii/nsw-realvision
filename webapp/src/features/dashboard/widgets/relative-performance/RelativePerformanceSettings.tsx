/**
 * Settings panel for the Relative Performance widget.
 * Same controls as GrowthHeatmap (time window, metric, property type).
 */

import { PropertyTypeFilter } from '../../components/filters/PropertyTypeFilter'
import { ColorRangeSlider } from '../../components/ColorRangeSlider'
import { RELATIVE_COLOR_STOPS } from './color-scale'
import type { GrowthMetric, RelativePerformanceConfig } from './types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

interface Props {
  config: RelativePerformanceConfig
  onChange: (config: RelativePerformanceConfig) => void
}

export function RelativePerformanceSettings({ config, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Time Window</Label>
        <Select
          value={String(config.yearsBack)}
          onValueChange={(v) =>
            onChange({
              ...config,
              yearsBack: Number(v) as RelativePerformanceConfig['yearsBack'],
            })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5">5 years</SelectItem>
            <SelectItem value="10">10 years</SelectItem>
            <SelectItem value="15">15 years</SelectItem>
            <SelectItem value="20">20 years</SelectItem>
            <SelectItem value="25">25 years</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Metric</Label>
        <Select
          value={config.metric}
          onValueChange={(v) =>
            onChange({ ...config, metric: v as GrowthMetric })
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

      <PropertyTypeFilter
        value={config.strataFilter}
        onChange={(strataFilter) => onChange({ ...config, strataFilter })}
      />

      <ColorRangeSlider
        value={[
          config.colorMin ?? RELATIVE_COLOR_STOPS[0][0],
          config.colorMax ??
            RELATIVE_COLOR_STOPS[RELATIVE_COLOR_STOPS.length - 1][0],
        ]}
        bounds={[
          RELATIVE_COLOR_STOPS[0][0],
          RELATIVE_COLOR_STOPS[RELATIVE_COLOR_STOPS.length - 1][0],
        ]}
        colorStops={RELATIVE_COLOR_STOPS}
        onChange={([colorMin, colorMax]) =>
          onChange({ ...config, colorMin, colorMax })
        }
      />
    </div>
  )
}
