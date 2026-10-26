/**
 * Draggable grab handles overlaid on the ECharts markArea edges.
 *
 * Renders two small rounded-rectangle handles positioned directly above the
 * chart grid area, centered on the start/end year x-positions. Each handle
 * contains 3 horizontal grip lines. Dragging a handle adjusts the year and
 * calls `onChange` for instant visual feedback in the parent chart/summary.
 *
 * Uses ECharts `convertToPixel` / `convertFromPixel` to map between screen
 * coordinates and the chart's category x-axis.
 */

import { useCallback, useEffect, useState } from 'react'
import type * as echarts from 'echarts/core'

interface ChartRangeHandlesProps {
  chartInstance: echarts.ECharts | null
  startYear: number
  endYear: number
  /** All years on the x-axis (category axis), for snapping and clamping. */
  years: Array<number>
  /** Called on every pointer move during drag (instant local update). */
  onChange: (startYear: number, endYear: number) => void
  /** Chart container element for bounds calculation. */
  containerRef: React.RefObject<HTMLDivElement | null>
}

/** Handle dimensions in pixels. */
const HANDLE_W = 28
const HANDLE_H = 18

/** Get the chart grid rect for vertical positioning. */
function getGridRect(chart: echarts.ECharts): { top: number; height: number } | null {
  try {
    const model = (chart as unknown as { getModel(): { getComponent(type: string): unknown } }).getModel()
    const gridModel = model.getComponent('grid') as { coordinateSystem?: { getRect(): { y: number; height: number } } } | null
    if (gridModel?.coordinateSystem) {
      const rect = gridModel.coordinateSystem.getRect()
      return { top: rect.y, height: rect.height }
    }
  } catch {
    // Fallback if internal API changes
  }
  return null
}

/** Convert a year to an x pixel position on the chart. */
function yearToPixel(chart: echarts.ECharts, year: number): number | null {
  try {
    const px = chart.convertToPixel({ xAxisIndex: 0 }, String(year))
    if (typeof px === 'number' && isFinite(px)) return px
  } catch {
    // Chart not ready
  }
  return null
}

/** Convert an x pixel position to the nearest year on the chart. */
function pixelToYear(chart: echarts.ECharts, px: number, years: Array<number>): number | null {
  try {
    const val = chart.convertFromPixel({ xAxisIndex: 0 }, px)
    const idx = Math.round(Number(val))
    if (idx >= 0 && idx < years.length) return years[idx]
  } catch {
    // Chart not ready
  }
  return null
}

export function ChartRangeHandles({
  chartInstance,
  startYear,
  endYear,
  years,
  onChange,
  containerRef,
}: ChartRangeHandlesProps) {
  const [positions, setPositions] = useState<{
    startX: number
    endX: number
    top: number
    height: number
  } | null>(null)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)

  // Recalculate handle positions from chart coordinates
  const recalcPositions = useCallback(() => {
    if (!chartInstance) return
    const startX = yearToPixel(chartInstance, startYear)
    const endX = yearToPixel(chartInstance, endYear)
    const grid = getGridRect(chartInstance)
    if (startX != null && endX != null && grid) {
      setPositions({ startX, endX, top: grid.top, height: grid.height })
    }
  }, [chartInstance, startYear, endYear])

  // Recalc on year changes and chart updates
  useEffect(() => {
    recalcPositions()
  }, [recalcPositions])

  // Listen for chart `finished` event (fires after render/animation/resize)
  useEffect(() => {
    if (!chartInstance) return
    const handler = () => recalcPositions()
    chartInstance.on('finished', handler)
    return () => {
      chartInstance.off('finished', handler)
    }
  }, [chartInstance, recalcPositions])

  // ResizeObserver on container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => recalcPositions())
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef, recalcPositions])

  // Global pointer move/up during drag
  useEffect(() => {
    if (!dragging || !chartInstance) return

    const handlePointerMove = (e: PointerEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const year = pixelToYear(chartInstance, localX, years)
      if (year == null) return

      if (dragging === 'start') {
        const clamped = Math.min(year, endYear - 1)
        if (clamped !== startYear) onChange(clamped, endYear)
      } else {
        const clamped = Math.max(year, startYear + 1)
        if (clamped !== endYear) onChange(startYear, clamped)
      }
    }

    const handlePointerUp = () => {
      setDragging(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, chartInstance, containerRef, years, startYear, endYear, onChange])

  if (!positions || !chartInstance) return null

  const handleStyle = (x: number): React.CSSProperties => ({
    position: 'absolute',
    left: x - HANDLE_W / 2,
    top: positions.top - HANDLE_H,
    width: HANDLE_W,
    height: HANDLE_H,
    borderRadius: 4,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    cursor: dragging ? 'grabbing' : 'grab',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    zIndex: 10,
  })

  const gripLine: React.CSSProperties = {
    width: 12,
    height: 1,
    backgroundColor: 'var(--muted-foreground)',
    opacity: 0.5,
    borderRadius: 0.5,
    pointerEvents: 'none',
  }

  const onPointerDown = (handle: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(handle)
  }

  return (
    <>
      {/* Start handle */}
      <div
        style={handleStyle(positions.startX)}
        onPointerDown={onPointerDown('start')}
        data-range-handle="start"
        aria-label="Drag to change the start year"
      >
        <div style={gripLine} />
        <div style={gripLine} />
        <div style={gripLine} />
      </div>
      {/* End handle */}
      <div
        style={handleStyle(positions.endX)}
        onPointerDown={onPointerDown('end')}
        data-range-handle="end"
        aria-label="Drag to change the end year"
      >
        <div style={gripLine} />
        <div style={gripLine} />
        <div style={gripLine} />
      </div>
    </>
  )
}
