/**
 * Settings panel for the Growth Heatmap widget.
 * Controlled component — receives config and calls onChange to update.
 */

import { useMemo, useState } from 'react'
import { PropertyTypeFilter } from '../../components/filters/PropertyTypeFilter'
import { MethodExplainer } from '../../components/MethodExplainer'
import { DatePresetBar } from '../../components/DatePresetBar'
import { defaultStopsAsColorStops } from './color-scale'
import { GradientPreview } from './GradientPreview'
import { ColorStopsEditor } from './ColorStopsEditor'
import type { GrowthHeatmapConfig, GrowthMethod, GrowthMetric } from './types'
import { heatmapEndYear } from '@/lib/heatmap-queries'
import { useDataCoverage } from '@/lib/data-coverage'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

interface Props {
  config: GrowthHeatmapConfig
  onChange: (config: GrowthHeatmapConfig) => void
}

export function GrowthHeatmapSettings({ config, onChange }: Props) {
  const endYear = heatmapEndYear(useDataCoverage())
  const [editorOpen, setEditorOpen] = useState(false)

  const editorStops = useMemo(
    () => config.customColorStops ?? defaultStopsAsColorStops(),
    [config.customColorStops],
  )

  return (
    <div className="space-y-4">
      <div>
        <Label>Time Window</Label>
        <DatePresetBar
          presets={[5, 10, 15, 20, 25]}
          activePreset={
            config.customRange
              ? null
              : config.growthMethod === 'loess'
                ? (config.loessYearsBack ?? config.yearsBack)
                : config.yearsBack
          }
          customRange={config.customRange ?? null}
          onPresetChange={(years) => {
            if (years === 'all') return
            if (config.growthMethod === 'loess') {
              onChange({
                ...config,
                loessYearsBack: years,
                customRange: undefined,
              })
            } else {
              onChange({
                ...config,
                yearsBack: years as GrowthHeatmapConfig['yearsBack'],
                customRange: undefined,
              })
            }
          }}
          onCustomChange={
            config.growthMethod === 'loess'
              ? (startYear, endYear) =>
                  onChange({
                    ...config,
                    customRange: { startYear, endYear },
                    loessYearsBack: undefined,
                  })
              : undefined
          }
          showAll={false}
          sliderMin={2001}
          sliderMax={endYear}
        />
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

      <div>
        <div className="flex items-center gap-0.5">
          <Label>Growth Calculation</Label>
          {config.growthMethod === 'trend-fit' && (
            <MethodExplainer methodId="trend-fit" />
          )}
        </div>
        <Select
          value={config.growthMethod ?? 'endpoint'}
          onValueChange={(v) =>
            onChange({ ...config, growthMethod: v as GrowthMethod })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="endpoint">Endpoint Comparison</SelectItem>
            <SelectItem value="trend-fit">Trend-Fit Regression</SelectItem>
            <SelectItem value="loess">LOESS Smoothing</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <PropertyTypeFilter
        value={config.strataFilter}
        onChange={(strataFilter) => onChange({ ...config, strataFilter })}
      />

      {/* Color Scale section */}
      <div>
        <div className="flex items-center justify-between">
          <Label>Color Scale</Label>
          <span className="text-[10px] text-muted-foreground">
            {config.customColorStops ? 'Custom' : 'Default'}
          </span>
        </div>

        <GradientPreview stops={editorStops} className="mt-2" />

        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="mt-2 w-full">
              Edit Color Stops
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <ColorStopsEditor
              stops={editorStops}
              onApply={(stops) => {
                onChange({
                  ...config,
                  customColorStops: stops,
                  colorMin: undefined,
                  colorMax: undefined,
                })
                setEditorOpen(false)
              }}
              onReset={() => {
                onChange({
                  ...config,
                  customColorStops: undefined,
                  colorMin: undefined,
                  colorMax: undefined,
                })
                setEditorOpen(false)
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="show-h3-borders">Show cell borders on hover</Label>
        <Switch
          id="show-h3-borders"
          size="sm"
          checked={config.showH3Borders ?? true}
          onCheckedChange={(checked) =>
            onChange({ ...config, showH3Borders: checked === true })
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <Label htmlFor="fill-sparse-hexes">Fill sparse areas</Label>
          <MethodExplainer methodId="neighbor-fill" />
        </div>
        <Switch
          id="fill-sparse-hexes"
          size="sm"
          checked={config.fillSparseHexes ?? false}
          onCheckedChange={(checked) =>
            onChange({ ...config, fillSparseHexes: checked === true })
          }
        />
      </div>

      <div>
        <Label>Renderer</Label>
        <Select
          value={config.renderer}
          onValueChange={(v) =>
            onChange({ ...config, renderer: v as 'library' | 'custom' })
          }
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="library">Library IDW</SelectItem>
            <SelectItem value="custom">Custom Shader</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
