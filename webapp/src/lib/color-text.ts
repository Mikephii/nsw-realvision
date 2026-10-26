/**
 * Text color contrast utilities.
 *
 * Clamps the lightness of an RGB color so it remains readable as text
 * on light or dark backgrounds, without altering hue or saturation.
 * Completely decoupled from the heatmap color pipeline.
 */

import { useCallback } from 'react'
import { useTheme } from '@/components/ThemeProvider'

/**
 * Convert an RGB color (0-255) to HSL (h: 0-360, s: 0-1, l: 0-1).
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2

  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60
  } else {
    h = ((rn - gn) / d + 4) * 60
  }

  return [h, s, l]
}

/**
 * Convert HSL (h: 0-360, s: 0-1, l: 0-1) back to RGB (0-255).
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
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
  const hn = h / 360

  return [
    Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hn) * 255),
    Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  ]
}

/**
 * Clamp an RGB color's lightness for text readability.
 *
 * Converts to HSL, clamps L to the given bounds, and returns an
 * `rgb(r, g, b)` CSS string. Hue and saturation are preserved.
 *
 * @param rgb  - Color as [r, g, b] in 0-255 range (from growthToColor etc.)
 * @param opts - `minL`: floor lightness (e.g. 0.5 for dark backgrounds),
 *               `maxL`: ceiling lightness (e.g. 0.45 for light backgrounds)
 */
export function clampTextColor(
  rgb: [number, number, number],
  opts: { minL?: number; maxL?: number },
): string {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2])
  let clamped = l
  if (opts.minL != null && clamped < opts.minL) clamped = opts.minL
  if (opts.maxL != null && clamped > opts.maxL) clamped = opts.maxL
  if (clamped === l) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
  const [r, g, b] = hslToRgb(h, s, clamped)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Hook that returns a theme-aware text color clamper.
 *
 * - Light mode: caps lightness at 0.45 (darkens washed-out yellows/greens)
 * - Dark mode: floors lightness at 0.5 (brightens dark reds/blues)
 */
export function useTextColor(): (rgb: [number, number, number]) => string {
  const { theme } = useTheme()
  return useCallback(
    (rgb: [number, number, number]) =>
      theme === 'dark'
        ? clampTextColor(rgb, { minL: 0.8 })
        : clampTextColor(rgb, { maxL: 0.45 }),
    [theme],
  )
}
