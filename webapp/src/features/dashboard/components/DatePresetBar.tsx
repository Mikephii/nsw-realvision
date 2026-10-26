/**
 * Inline date preset bar for widgets.
 *
 * Displays a row of lookback period buttons (e.g. 3yr, 5yr, 10yr, All)
 * plus an optional "Custom" button that opens a popover with a dual-handle
 * year range slider. When a custom range is active, the button shows the
 * range (e.g. "2018–2025") instead of "Custom".
 */

import * as React from 'react'
import { useState, useCallback, useRef, useEffect } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** Earliest year available in the dataset. */
const MIN_YEAR = 2001

interface DatePresetBarProps {
  /** Available lookback year presets (e.g. [3, 5, 10, 20]). */
  presets: Array<number>
  /** Currently active preset: a year number, 'all', or null (custom active). */
  activePreset: number | 'all' | null
  /** Active custom range, or null if a preset is active. */
  customRange: { startYear: number; endYear: number } | null
  /** Called when a preset button is tapped. */
  onPresetChange: (years: number | 'all') => void
  /** Called when the custom range slider changes. Only rendered when provided. */
  onCustomChange?: (startYear: number, endYear: number) => void
  /** Whether to show the "All" button. Defaults to true. */
  showAll?: boolean
  /** Presets to disable, mapped to tooltip reason (e.g. "Data starts 2005"). */
  disabledPresets?: Map<number, string>
  /** Override slider min year. Defaults to 2001. */
  sliderMin?: number
  /** Override slider max year. Defaults to currentYear - 1. */
  sliderMax?: number
}

export function DatePresetBar({
  presets,
  activePreset,
  customRange,
  onPresetChange,
  onCustomChange,
  showAll = true,
  disabledPresets,
  sliderMin,
  sliderMax,
}: DatePresetBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const defaultMaxYear = new Date().getFullYear() - 1
  const maxYear = sliderMax ?? defaultMaxYear
  const minYear = sliderMin ?? MIN_YEAR
  const showCustom = onCustomChange != null

  // Local slider state for smooth dragging (committed on release)
  const [sliderValue, setSliderValue] = useState<[number, number]>([
    customRange?.startYear ?? maxYear - 10,
    customRange?.endYear ?? maxYear,
  ])

  // Sync slider when customRange changes externally
  const prevRange = useRef(customRange)
  useEffect(() => {
    if (
      customRange &&
      (customRange.startYear !== prevRange.current?.startYear ||
        customRange.endYear !== prevRange.current?.endYear)
    ) {
      setSliderValue([customRange.startYear, customRange.endYear])
    }
    prevRange.current = customRange
  }, [customRange])

  const handlePresetClick = useCallback(
    (years: number | 'all') => {
      onPresetChange(years)
      setPopoverOpen(false)
    },
    [onPresetChange],
  )

  const handleSliderCommit = useCallback(
    (value: number[]) => {
      const [start, end] = value as [number, number]
      onCustomChange?.(start, end)
    },
    [onCustomChange],
  )

  const isCustomActive = activePreset === null && customRange !== null
  const customLabel = isCustomActive
    ? `${customRange!.startYear}\u2013${customRange!.endYear}`
    : 'Custom'

  return (
    <div className="flex items-center gap-0.5 px-3 pb-1">
      <TooltipProvider delayDuration={300}>
        {presets.map((years) => {
          const disabledReason = disabledPresets?.get(years)
          const isDisabled = disabledReason != null

          const button = (
            <PresetButton
              key={years}
              active={activePreset === years}
              disabled={isDisabled}
              onClick={isDisabled ? undefined : () => handlePresetClick(years)}
            >
              {years}yr
            </PresetButton>
          )

          if (isDisabled) {
            return (
              <Tooltip key={years}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {disabledReason}
                </TooltipContent>
              </Tooltip>
            )
          }

          return button
        })}
      </TooltipProvider>
      {showAll && (
        <PresetButton
          active={activePreset === 'all'}
          onClick={() => handlePresetClick('all')}
        >
          All
        </PresetButton>
      )}

      {showCustom && (
        <PopoverPrimitive.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverPrimitive.Trigger asChild>
            <PresetButton active={isCustomActive}>
              {customLabel}
            </PresetButton>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="bottom"
              align="end"
              sideOffset={4}
              className="bg-popover text-popover-foreground z-50 w-56 rounded-md border p-3 shadow-md"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>{sliderValue[0]}</span>
                  <span className="text-muted-foreground">to</span>
                  <span>{sliderValue[1]}</span>
                </div>
                <Slider
                  min={minYear}
                  max={maxYear}
                  step={1}
                  value={sliderValue}
                  onValueChange={(v) => setSliderValue(v as [number, number])}
                  onValueCommit={handleSliderCommit}
                />
              </div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      )}
    </div>
  )
}

/** Small toggle button for presets. Forwards ref + props for Radix asChild. */
const PresetButton = React.forwardRef<
  HTMLButtonElement,
  { active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ active, disabled, className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    disabled={disabled}
    className={cn(
      'h-5 rounded px-1.5 text-[0.625rem] font-medium transition-colors select-none',
      disabled
        ? 'cursor-not-allowed text-muted-foreground/40'
        : active
          ? 'cursor-pointer bg-primary text-primary-foreground'
          : 'cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground',
      className,
    )}
    {...props}
  >
    {children}
  </button>
))
