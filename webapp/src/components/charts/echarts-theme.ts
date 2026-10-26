/**
 * Bridge between shadcn CSS theme variables and ECharts theme configuration.
 * Reads computed CSS variable values at runtime and builds an ECharts theme object.
 */

/**
 * Read a CSS variable value from the document root.
 * Returns the raw computed value (e.g. an oklch string or rgb string).
 */
function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
}

/**
 * Convert a CSS variable (potentially oklch) to a usable CSS color string.
 * Uses a temporary element to let the browser do the conversion to rgb().
 */
function resolveCssColor(varName: string): string {
  const raw = getCssVar(varName)
  if (!raw) return '#888888'

  const el = document.createElement('div')
  el.style.color = raw.startsWith('oklch')
    ? `oklch(${raw.replace('oklch(', '').replace(')', '')})`
    : raw
  if (!el.style.color) {
    // If it's already a plain oklch value without the function wrapper
    el.style.color = `oklch(${raw})`
  }
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)
  return computed || '#888888'
}

/**
 * Resolve a CSS chart color variable to an rgb() string.
 *
 * Useful when you need to programmatically reference a chart theme color
 * outside of ECharts' automatic color assignment (e.g., to match a
 * companion series to its primary series).
 *
 * @param index - Zero-based color index (wraps at 10).
 */
export function resolveChartColor(index: number): string {
  return resolveCssColor(`--chart-${(index % 10) + 1}`)
}

/**
 * Build an ECharts theme object using the current CSS variables.
 * Call this once when initialising an ECharts instance.
 */
export function buildEChartsTheme(): Record<string, unknown> {
  const chartColors = Array.from({ length: 10 }, (_, i) =>
    resolveCssColor(`--chart-${i + 1}`),
  )

  const foreground = resolveCssColor('--foreground')
  const mutedForeground = resolveCssColor('--muted-foreground')
  const border = resolveCssColor('--border')

  return {
    color: chartColors,
    backgroundColor: 'transparent',
    textStyle: {
      color: foreground,
      fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
    },
    title: {
      textStyle: { color: foreground },
      subtextStyle: { color: mutedForeground },
    },
    legend: {
      textStyle: { color: mutedForeground },
    },
    tooltip: {
      backgroundColor: resolveCssColor('--popover'),
      borderColor: border,
      textStyle: { color: resolveCssColor('--popover-foreground') },
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: border } },
      axisTick: { lineStyle: { color: border } },
      axisLabel: { color: mutedForeground },
      splitLine: { lineStyle: { color: border, type: 'dashed' as const } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: border } },
      axisTick: { lineStyle: { color: border } },
      axisLabel: { color: mutedForeground },
      splitLine: { lineStyle: { color: border, type: 'dashed' as const } },
    },
    line: {
      smooth: true,
      symbolSize: 4,
      lineStyle: { width: 2 },
    },
  }
}
