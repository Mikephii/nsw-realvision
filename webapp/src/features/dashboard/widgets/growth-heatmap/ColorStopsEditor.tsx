/**
 * Dialog content for editing custom color stops.
 *
 * Users can add/remove stops, pick colors via native color input,
 * and set arbitrary percentage values. Edits are held in draft state
 * and only committed when the user clicks Apply.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  colorToRgbNorm,
  interpolateStopRgbs,
  validateColorStops,
} from './color-scale'
import { GradientPreview } from './GradientPreview'
import type { ColorStop } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ColorStopsEditorProps {
  /** Current stops to edit (either custom or defaults converted to ColorStop[]). */
  stops: Array<ColorStop>
  /** Called when user clicks Apply with the new stops. */
  onApply: (stops: Array<ColorStop>) => void
  /** Called when user clicks Reset to Default. */
  onReset: () => void
}

function sortStops(stops: Array<ColorStop>): Array<ColorStop> {
  return [...stops].sort((a, b) => a.value - b.value)
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(1, n)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function formatPct(value: number): string {
  return (value * 100).toFixed(1)
}

/**
 * Individual stop row with its own string state for the percentage input.
 * Commits to the parent only on blur — avoids re-sorting while the user types.
 */
function StopRow({
  stop,
  onColorChange,
  onValueCommit,
  onRemove,
  canRemove,
}: {
  stop: ColorStop
  onColorChange: (color: string) => void
  onValueCommit: (value: number) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [text, setText] = useState(() => formatPct(stop.value))

  // Sync from parent when the stop value changes externally (add/remove/reset)
  const [prevValue, setPrevValue] = useState(stop.value)
  if (stop.value !== prevValue) {
    setPrevValue(stop.value)
    setText(formatPct(stop.value))
  }

  const commitValue = () => {
    const parsed = parseFloat(text)
    if (Number.isNaN(parsed)) {
      // Revert to current stop value
      setText(formatPct(stop.value))
    } else {
      onValueCommit(parsed / 100)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-border"
        style={{ backgroundColor: stop.color }}
      >
        <input
          type="color"
          value={stop.color}
          onChange={(e) => onColorChange(e.target.value)}
          className="invisible h-0 w-0"
        />
      </label>

      <div className="flex items-center gap-1">
        <Input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitValue()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="w-20 tabular-nums"
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        disabled={!canRemove}
        onClick={onRemove}
        className="ml-auto h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
      >
        <span className="text-sm">&times;</span>
      </Button>
    </div>
  )
}

export function ColorStopsEditor({
  stops: initial,
  onApply,
  onReset,
}: ColorStopsEditorProps) {
  const [draft, setDraft] = useState<Array<ColorStop>>(() => sortStops(initial))

  const sorted = useMemo(() => sortStops(draft), [draft])
  const errors = useMemo(() => validateColorStops(draft), [draft])
  const isValid = errors.length === 0

  const updateColor = useCallback((index: number, color: string) => {
    setDraft((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], color }
      return next // no re-sort — color change doesn't affect order
    })
  }, [])

  const commitValue = useCallback((index: number, value: number) => {
    setDraft((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], value }
      return sortStops(next) // re-sort now that typing is done
    })
  }, [])

  const removeStop = useCallback((index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const addStop = useCallback(() => {
    setDraft((prev) => {
      const s = sortStops(prev)
      if (s.length < 2) {
        return [...s, { value: 0, color: '#808080' }]
      }
      // Insert at midpoint of the last two stops with interpolated color
      const a = s[s.length - 2]
      const b = s[s.length - 1]
      const midValue = (a.value + b.value) / 2
      const stops: Array<[number, string]> = s.map((st) => [st.value, st.color])
      const rgbs = stops.map(([, c]) => colorToRgbNorm(c))
      const [r, g, b2] = interpolateStopRgbs(
        stops,
        rgbs,
        midValue,
      )
      return sortStops([...s, { value: midValue, color: rgbToHex(r, g, b2) }])
    })
  }, [])

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit Color Scale</DialogTitle>
        <DialogDescription>
          Define growth rate thresholds and their colors. The gradient
          interpolates linearly between stops.
        </DialogDescription>
      </DialogHeader>

      <GradientPreview stops={sorted} className="my-2 h-4" />

      <div className="max-h-[340px] space-y-1.5 overflow-y-auto py-1">
        {draft.map((stop, i) => (
          <StopRow
            key={i}
            stop={stop}
            onColorChange={(color) => updateColor(i, color)}
            onValueCommit={(value) => commitValue(i, value)}
            onRemove={() => removeStop(i)}
            canRemove={draft.length > 2}
          />
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addStop} className="w-full">
        + Add Stop
      </Button>

      {errors.length > 0 && (
        <div className="text-xs text-destructive">{errors[0]}</div>
      )}

      <DialogFooter className="mt-3">
        <Button variant="ghost" size="sm" onClick={onReset} className="mr-auto">
          Reset to Default
        </Button>
        <DialogClose asChild>
          <Button variant="outline" size="sm">
            Cancel
          </Button>
        </DialogClose>
        <Button size="sm" disabled={!isValid} onClick={() => onApply(sorted)}>
          Apply
        </Button>
      </DialogFooter>
    </>
  )
}
