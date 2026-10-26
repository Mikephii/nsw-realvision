/**
 * Reusable ECharts React wrapper.
 * Handles lifecycle, responsive resizing via ResizeObserver, and theme integration.
 * Re-registers the ECharts theme and reinits the chart when dark/light mode changes.
 */

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { buildEChartsTheme } from './echarts-theme'
import type { EChartsOption } from 'echarts'
import { useTheme } from '@/components/ThemeProvider'

// Tree-shake: register only what we use
echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  MarkAreaComponent,
  CanvasRenderer,
])

function registerTheme() {
  if (typeof document === 'undefined') return
  echarts.registerTheme('realvision', buildEChartsTheme())
}

interface EChartsBaseProps {
  option: EChartsOption
  className?: string
  loading?: boolean
  /** Called after chart instance is created, providing access for coordinate conversion. */
  onInit?: (chart: echarts.ECharts) => void
}

export function EChartsBase({ option, className, loading, onInit }: EChartsBaseProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const onInitRef = useRef(onInit)
  onInitRef.current = onInit
  const { theme } = useTheme()

  // Init on mount + reinit on theme change
  useEffect(() => {
    if (!containerRef.current) return
    registerTheme()
    const chart = echarts.init(containerRef.current, 'realvision')
    chartRef.current = chart
    onInitRef.current?.(chart)
    return () => {
      chart.dispose()
      chartRef.current = null
    }
  }, [theme])

  // Responsive resize
  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return
    const observer = new ResizeObserver(() => {
      chartRef.current?.resize()
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [theme])

  // Update option
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option, theme])

  // Loading state
  useEffect(() => {
    if (loading) {
      chartRef.current?.showLoading('default', {
        text: '',
        maskColor: 'transparent',
        spinnerRadius: 16,
      })
    } else {
      chartRef.current?.hideLoading()
    }
  }, [loading])

  return <div ref={containerRef} className={className ?? 'h-full w-full'} />
}

export type { EChartsOption }
