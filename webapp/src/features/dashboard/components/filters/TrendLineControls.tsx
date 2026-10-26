/**
 * Shared trend line settings controls for line chart widgets.
 *
 * Renders a method selector (None / LOESS / Moving Average) and
 * conditional sub-controls: a LOESS span slider or an MA window selector.
 * Each method has an ⓘ explainer icon that opens a dialog with a
 * plain-English description of the statistical method.
 *
 * Used by both Median Price Line and Growth Rate widgets to avoid
 * duplicating the same UI and logic in both settings panels.
 */

import { MethodExplainer } from '../MethodExplainer'
import type { TrendLineMethod } from '@/lib/stats'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

interface TrendLineControlsProps {
  /** Currently selected smoothing method. */
  trendLine: TrendLineMethod
  /** Current LOESS span value (0.1–0.9). */
  loessSpan: number
  /** Current moving average window size (in periods). */
  movingAvgWindow: number
  /** Called when the user selects a different method. */
  onTrendLineChange: (method: TrendLineMethod) => void
  /** Called when the user adjusts the LOESS span slider. */
  onLoessSpanChange: (span: number) => void
  /** Called when the user selects a different MA window size. */
  onMovingAvgWindowChange: (window: number) => void
}

export function TrendLineControls({
  trendLine,
  loessSpan,
  movingAvgWindow,
  onTrendLineChange,
  onLoessSpanChange,
  onMovingAvgWindowChange,
}: TrendLineControlsProps) {
  return (
    <>
      <div>
        <Label>Trend Line</Label>
        <Select
          value={trendLine}
          onValueChange={(v) => onTrendLineChange(v as TrendLineMethod)}
        >
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (raw data)</SelectItem>
            <SelectItem value="loess">LOESS Smoothing</SelectItem>
            <SelectItem value="moving-average">Moving Average</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {trendLine === 'loess' && (
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <Label>Smoothness</Label>
              <MethodExplainer methodId="loess" />
            </div>
            <span className="text-xs text-muted-foreground">
              {loessSpan.toFixed(2)}
            </span>
          </div>
          <Slider
            min={10}
            max={90}
            step={5}
            value={[loessSpan * 100]}
            onValueChange={([v]) => onLoessSpanChange(v / 100)}
            className="mt-2"
          />
          <div className="mt-1 flex justify-between text-[0.625rem] text-muted-foreground">
            <span>Responsive</span>
            <span>Smooth</span>
          </div>
        </div>
      )}

      {trendLine === 'moving-average' && (
        <div>
          <div className="flex items-center gap-0.5">
            <Label>Window</Label>
            <MethodExplainer methodId="moving-average" />
          </div>
          <Select
            value={String(movingAvgWindow)}
            onValueChange={(v) => onMovingAvgWindowChange(Number(v))}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 periods</SelectItem>
              <SelectItem value="5">5 periods</SelectItem>
              <SelectItem value="7">7 periods</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}
