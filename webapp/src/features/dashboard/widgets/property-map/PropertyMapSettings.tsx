/**
 * Settings panel for the Property Map widget.
 * Controlled component — receives config and calls onChange to update.
 */

import { SuburbsFilter } from '../../components/filters/SuburbsFilter'
import { PropertyTypeFilter } from '../../components/filters/PropertyTypeFilter'
import { DateRangeFilter } from '../../components/filters/DateRangeFilter'
import type { ColorMode, PropertyMapConfig } from './types'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { AreaPickerButton } from '@/features/areas/components/AreaPickerButton'

interface Props {
  config: PropertyMapConfig
  onChange: (config: PropertyMapConfig) => void
}

const COLOR_MODES: Array<{ value: ColorMode; label: string; description: string }> =
  [
    {
      value: 'price',
      label: 'Sale Price',
      description: 'Blue (low) to red (high)',
    },
    {
      value: 'zone',
      label: 'Zone Type',
      description: 'Residential, business, industrial, etc.',
    },
    {
      value: 'recency',
      label: 'Sale Recency',
      description: 'Gray (old) to blue (recent)',
    },
    {
      value: 'confidence',
      label: 'Geocode Confidence',
      description: 'Green (exact) / yellow (fuzzy) / red (centroid)',
    },
  ]

export function PropertyMapSettings({ config, onChange }: Props) {
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

      {/* Color Mode */}
      <div>
        <Label>Color By</Label>
        <Select
          value={config.colorMode}
          onValueChange={(v) =>
            onChange({ ...config, colorMode: v as ColorMode })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLOR_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Map toggles */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="clustering-toggle">Cluster nearby points</Label>
          <Switch
            id="clustering-toggle"
            size="sm"
            checked={config.enableClustering}
            onCheckedChange={(checked) =>
              onChange({ ...config, enableClustering: checked })
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="fixed-dot-toggle">Fixed dot size</Label>
          <Switch
            id="fixed-dot-toggle"
            size="sm"
            checked={config.fixedDotSize}
            onCheckedChange={(checked) =>
              onChange({ ...config, fixedDotSize: checked })
            }
          />
        </div>
      </div>

      <DateRangeFilter
        dateFrom={config.dateFrom}
        dateTo={config.dateTo}
        onChange={(dateFrom, dateTo) =>
          onChange({ ...config, dateFrom, dateTo })
        }
      />

      {/* Price Range */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Min Price</Label>
          <Input
            type="number"
            className="mt-1"
            placeholder="Any"
            value={config.minPrice ?? ''}
            onChange={(e) =>
              onChange({
                ...config,
                minPrice: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
        <div>
          <Label>Max Price</Label>
          <Input
            type="number"
            className="mt-1"
            placeholder="Any"
            value={config.maxPrice ?? ''}
            onChange={(e) =>
              onChange({
                ...config,
                maxPrice: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
      </div>
    </div>
  )
}
