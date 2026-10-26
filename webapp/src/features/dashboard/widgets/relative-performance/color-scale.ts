/**
 * Diverging color scale for relative performance visualisation.
 *
 * Centered on 0% (metro average) with red for underperforming areas
 * and blue for outperforming areas. Gray at the center means "in line
 * with metro average".
 */

/**
 * Color stops for relative growth (area growth minus metro average).
 * Symmetric diverging scale: red (-) → gray (0) → blue (+).
 */
export const RELATIVE_COLOR_STOPS: Array<[number, string]> = [
  [-0.04, 'hsl(0, 75%, 45%)'], // -4% relative: deep red (strong underperformer)
  [-0.02, 'hsl(10, 60%, 55%)'], // -2% relative: red-orange
  [-0.01, 'hsl(20, 40%, 60%)'], // -1% relative: muted warm
  [0.0, 'hsl(0, 0%, 65%)'], //  0% relative: neutral gray (metro average)
  [0.01, 'hsl(210, 40%, 60%)'], // +1% relative: muted cool
  [0.02, 'hsl(215, 60%, 55%)'], // +2% relative: blue
  [0.04, 'hsl(220, 75%, 45%)'], // +4% relative: deep blue (strong outperformer)
]

/** Parse HSL CSS string to [r, g, b] in 0-255. */
function hslToRgb(hsl: string): [number, number, number] {
  const match = hsl.match(/hsl\(\s*(\d+),\s*(\d+)%,\s*(\d+)%\s*\)/)
  if (!match) return [128, 128, 128]

  const h = parseInt(match[1]) / 360
  const s = parseInt(match[2]) / 100
  const l = parseInt(match[3]) / 100

  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

const STOP_RGBS = RELATIVE_COLOR_STOPS.map(([, color]) => hslToRgb(color))

/** Convert a relative growth rate to an RGB color. */
export function relativeToColor(growth: number): [number, number, number] {
  if (growth <= RELATIVE_COLOR_STOPS[0][0]) return STOP_RGBS[0]
  if (growth >= RELATIVE_COLOR_STOPS[RELATIVE_COLOR_STOPS.length - 1][0]) {
    return STOP_RGBS[STOP_RGBS.length - 1]
  }

  for (let i = 0; i < RELATIVE_COLOR_STOPS.length - 1; i++) {
    const [lowVal] = RELATIVE_COLOR_STOPS[i]
    const [highVal] = RELATIVE_COLOR_STOPS[i + 1]

    if (growth >= lowVal && growth <= highVal) {
      const t = (growth - lowVal) / (highVal - lowVal)
      const [r1, g1, b1] = STOP_RGBS[i]
      const [r2, g2, b2] = STOP_RGBS[i + 1]
      return [
        Math.round(r1 + (r2 - r1) * t),
        Math.round(g1 + (g2 - g1) * t),
        Math.round(b1 + (b2 - b1) * t),
      ]
    }
  }

  return [128, 128, 128]
}

/**
 * Format a relative growth rate for display.
 * @example formatRelativePercent(0.015) -> "+1.5%"
 * @example formatRelativePercent(-0.008) -> "-0.8%"
 */
export function formatRelativePercent(growth: number): string {
  const pct = (growth * 100).toFixed(1)
  return growth >= 0 ? `+${pct}%` : `${pct}%`
}
