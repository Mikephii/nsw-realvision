/**
 * Diverging color scale for growth rate visualisation.
 *
 * Centered on 0% (neutral) with red for declining markets and
 * green/blue for growing markets. The stops are fixed (not data-driven
 * quantiles) so that the same growth rate always maps to the same colour,
 * enabling consistent visual interpretation across different settings.
 *
 * This module is the single source of truth for color parsing, interpolation,
 * and color stop resolution. The custom WebGL renderer and library renderer
 * both import from here instead of maintaining local copies.
 */

import type { ColorStop } from './types'

/**
 * Color stop definition: [growth rate as decimal, CSS color string].
 * Growth rates below the minimum stop clamp to the first color;
 * rates above the maximum stop clamp to the last color.
 */
export const GROWTH_COLOR_STOPS: Array<[number, string]> = [
  [-0.05, '#cf1717'], // -5% p.a.: red (declining)
  [0.0, '#df4020'], // 0% p.a.: red-orange (flat)
  [0.02, '#e6bd19'], // +2% p.a.: gold (below inflation)
  [0.065, '#00ff62'], // +6.5% p.a.: green (solid growth)
  [0.09, '#0400ff'], // +9% p.a.: blue (strong growth)
  [0.2, '#e100ff'], // +20% p.a.: magenta (extreme)
]

// ─── Color Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse an HSL CSS string to normalised [r, g, b] in the 0-1 range.
 *
 * Accepts strings like `"hsl(130, 70%, 42%)"`. Returns `[0.5, 0.5, 0.5]`
 * if the string doesn't match the expected format.
 */
export function hslToRgbNorm(hsl: string): [number, number, number] {
  const match = hsl.match(/hsl\(\s*(\d+),\s*(\d+)%,\s*(\d+)%\s*\)/)
  if (!match) return [0.5, 0.5, 0.5]

  const h = parseInt(match[1]) / 360
  const s = parseInt(match[2]) / 100
  const l = parseInt(match[3]) / 100

  if (s === 0) return [l, l, l]

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
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

/**
 * Parse a hex CSS string (#rrggbb) to normalised [r, g, b] in the 0-1 range.
 * Returns `[0.5, 0.5, 0.5]` for invalid input.
 */
export function hexToRgbNorm(hex: string): [number, number, number] {
  const match = hex.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
  if (!match) return [0.5, 0.5, 0.5]
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255,
  ]
}

/**
 * Parse any supported CSS color string to normalised [r, g, b] in the 0-1 range.
 * Detects hex (#rrggbb) vs HSL (hsl(...)) format automatically.
 */
export function colorToRgbNorm(color: string): [number, number, number] {
  if (color.startsWith('#')) return hexToRgbNorm(color)
  return hslToRgbNorm(color)
}

/**
 * Format a normalised [r, g, b] (0-1) as a GLSL vec3 literal.
 * Used by the library renderer to build the valueToColor shader function.
 */
export function rgbNormToGlslVec3(rgb: [number, number, number]): string {
  return `vec3(${rgb[0].toFixed(4)}, ${rgb[1].toFixed(4)}, ${rgb[2].toFixed(4)})`
}

// ─── Resolved Color Stops ────────────────────────────────────────────────────

/** Pre-parsed color stops ready for interpolation and ramp building. */
export interface ResolvedColorStops {
  /** Tuple array: [growthDecimal, cssColor]. Sorted ascending by value. */
  stops: Array<[number, string]>
  /** Pre-computed normalised RGB for each stop (0-1 range). */
  rgbs: Array<[number, number, number]>
}

/** Pre-computed normalised RGB values for each default color stop (0-1 range). */
export const STOP_RGBS_NORM: Array<[number, number, number]> =
  GROWTH_COLOR_STOPS.map(([, color]) => colorToRgbNorm(color))

/** Default resolved stops from the hardcoded GROWTH_COLOR_STOPS. */
export const DEFAULT_RESOLVED: ResolvedColorStops = {
  stops: GROWTH_COLOR_STOPS,
  rgbs: STOP_RGBS_NORM,
}

/**
 * Resolve an array of ColorStop (from config) into the internal format
 * used by interpolation and ramp building. Sorts by value ascending
 * and parses color strings to normalised RGB.
 */
export function resolveColorStops(custom: Array<ColorStop>): ResolvedColorStops {
  const sorted = [...custom].sort((a, b) => a.value - b.value)
  const stops: Array<[number, string]> = sorted.map((s) => [s.value, s.color])
  const rgbs: Array<[number, number, number]> = stops.map(([, color]) =>
    colorToRgbNorm(color),
  )
  return { stops, rgbs }
}

/**
 * Convert the hardcoded default stops to ColorStop[] format for the editor.
 * HSL colors are converted to hex for compatibility with <input type="color">.
 */
export function defaultStopsAsColorStops(): Array<ColorStop> {
  return GROWTH_COLOR_STOPS.map(([value, color]) => {
    // If already hex, use directly. Otherwise convert via colorToRgbNorm.
    if (color.startsWith('#')) return { value, color }
    const [r, g, b] = colorToRgbNorm(color)
    const toHex = (n: number) =>
      Math.round(n * 255)
        .toString(16)
        .padStart(2, '0')
    return { value, color: `#${toHex(r)}${toHex(g)}${toHex(b)}` }
  })
}

// ─── Validation ──────────────────────────────────────────────────────────────

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/

/** Validate an array of custom color stops. Returns an array of error messages (empty = valid). */
export function validateColorStops(stops: Array<ColorStop>): Array<string> {
  const errors: Array<string> = []

  if (stops.length < 2) {
    errors.push('At least 2 color stops are required')
    return errors
  }

  for (let i = 0; i < stops.length; i++) {
    if (!HEX_REGEX.test(stops[i].color)) {
      errors.push(`Stop ${i + 1}: invalid color format (expected #rrggbb)`)
    }
  }

  const sorted = [...stops].sort((a, b) => a.value - b.value)
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].value - sorted[i - 1].value) < 0.0001) {
      errors.push(`Duplicate value at ${(sorted[i].value * 100).toFixed(1)}%`)
    }
  }

  for (const stop of stops) {
    if (stop.value < -0.5 || stop.value > 1.0) {
      errors.push(
        `Value ${(stop.value * 100).toFixed(1)}% is outside the allowed range (-50% to +100%)`,
      )
    }
  }

  return errors
}

// ─── Interpolation ───────────────────────────────────────────────────────────

/**
 * Interpolate between pre-parsed RGB stop values at a given growth rate.
 *
 * Linearly interpolates between the two nearest stops. Clamps to the
 * first/last stop for values outside the range. Returns values in the
 * same numeric range as the input `rgbs` array (typically 0-1 or 0-255).
 */
export function interpolateStopRgbs(
  stops: Array<[number, string]>,
  rgbs: Array<[number, number, number]>,
  value: number,
): [number, number, number] {
  if (value <= stops[0][0]) return rgbs[0]
  if (value >= stops[stops.length - 1][0]) return rgbs[rgbs.length - 1]

  for (let i = 0; i < stops.length - 1; i++) {
    const [v0] = stops[i]
    const [v1] = stops[i + 1]

    if (value >= v0 && value <= v1) {
      const t = (value - v0) / (v1 - v0)
      const [r0, g0, b0] = rgbs[i]
      const [r1, g1, b1] = rgbs[i + 1]
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t]
    }
  }

  return rgbs[0]
}

// ─── Public Utilities ─────────────────────────────────────────────────────────

/**
 * Convert a growth rate to an RGB color using the diverging scale.
 * Returns [r, g, b] in 0-255 range. Linearly interpolates between
 * the two nearest stops. Clamps to min/max stop values.
 *
 * Pass `resolved` to use custom color stops instead of the defaults.
 */
export function growthToColor(
  growth: number,
  resolved?: ResolvedColorStops,
): [number, number, number] {
  const { stops, rgbs } = resolved ?? DEFAULT_RESOLVED
  const [r, g, b] = interpolateStopRgbs(stops, rgbs, growth)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

/**
 * Format a growth rate for display.
 * @example formatGrowthPercent(0.0653) -> "+6.5%"
 * @example formatGrowthPercent(-0.0123) -> "-1.2%"
 */
export function formatGrowthPercent(growth: number): string {
  const pct = (growth * 100).toFixed(1)
  return growth >= 0 ? `+${pct}%` : `${pct}%`
}
