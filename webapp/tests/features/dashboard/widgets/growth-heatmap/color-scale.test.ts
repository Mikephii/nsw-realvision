import { describe, expect, it } from 'vitest'
import type { ColorStop } from '@/features/dashboard/widgets/growth-heatmap/types'
import {
  DEFAULT_RESOLVED,
  GROWTH_COLOR_STOPS,
  STOP_RGBS_NORM,
  colorToRgbNorm,
  defaultStopsAsColorStops,
  growthToColor,
  hexToRgbNorm,
  hslToRgbNorm,
  interpolateStopRgbs,
  resolveColorStops,
  validateColorStops,
} from '@/features/dashboard/widgets/growth-heatmap/color-scale'

// ─── hslToRgbNorm ────────────────────────────────────────────────────────────

describe('hslToRgbNorm', () => {
  it('parses pure red', () => {
    const [r, g, b] = hslToRgbNorm('hsl(0, 100%, 50%)')
    expect(r).toBeCloseTo(1, 2)
    expect(g).toBeCloseTo(0, 2)
    expect(b).toBeCloseTo(0, 2)
  })

  it('parses pure green', () => {
    const [r, g, b] = hslToRgbNorm('hsl(120, 100%, 50%)')
    expect(r).toBeCloseTo(0, 2)
    expect(g).toBeCloseTo(1, 2)
    expect(b).toBeCloseTo(0, 2)
  })

  it('parses pure blue', () => {
    const [r, g, b] = hslToRgbNorm('hsl(240, 100%, 50%)')
    expect(r).toBeCloseTo(0, 2)
    expect(g).toBeCloseTo(0, 2)
    expect(b).toBeCloseTo(1, 2)
  })

  it('parses achromatic (gray)', () => {
    const [r, g, b] = hslToRgbNorm('hsl(0, 0%, 50%)')
    expect(r).toBeCloseTo(0.5, 2)
    expect(g).toBeCloseTo(0.5, 2)
    expect(b).toBeCloseTo(0.5, 2)
  })

  it('returns fallback for invalid input', () => {
    expect(hslToRgbNorm('not-a-color')).toEqual([0.5, 0.5, 0.5])
    expect(hslToRgbNorm('')).toEqual([0.5, 0.5, 0.5])
  })
})

// ─── hexToRgbNorm ────────────────────────────────────────────────────────────

describe('hexToRgbNorm', () => {
  it('parses #ff0000 as red', () => {
    const [r, g, b] = hexToRgbNorm('#ff0000')
    expect(r).toBeCloseTo(1, 2)
    expect(g).toBeCloseTo(0, 2)
    expect(b).toBeCloseTo(0, 2)
  })

  it('parses #00ff00 as green', () => {
    const [r, g, b] = hexToRgbNorm('#00ff00')
    expect(r).toBeCloseTo(0, 2)
    expect(g).toBeCloseTo(1, 2)
    expect(b).toBeCloseTo(0, 2)
  })

  it('parses #0000ff as blue', () => {
    const [r, g, b] = hexToRgbNorm('#0000ff')
    expect(r).toBeCloseTo(0, 2)
    expect(g).toBeCloseTo(0, 2)
    expect(b).toBeCloseTo(1, 2)
  })

  it('parses #808080 as mid-gray', () => {
    const [r, g, b] = hexToRgbNorm('#808080')
    expect(r).toBeCloseTo(0.502, 2)
    expect(g).toBeCloseTo(0.502, 2)
    expect(b).toBeCloseTo(0.502, 2)
  })

  it('is case-insensitive', () => {
    expect(hexToRgbNorm('#FF00FF')).toEqual(hexToRgbNorm('#ff00ff'))
  })

  it('returns fallback for invalid input', () => {
    expect(hexToRgbNorm('ff0000')).toEqual([0.5, 0.5, 0.5]) // missing #
    expect(hexToRgbNorm('#fff')).toEqual([0.5, 0.5, 0.5]) // shorthand not supported
    expect(hexToRgbNorm('')).toEqual([0.5, 0.5, 0.5])
  })
})

// ─── colorToRgbNorm ──────────────────────────────────────────────────────────

describe('colorToRgbNorm', () => {
  it('dispatches hex to hexToRgbNorm', () => {
    expect(colorToRgbNorm('#ff0000')).toEqual(hexToRgbNorm('#ff0000'))
  })

  it('dispatches hsl to hslToRgbNorm', () => {
    expect(colorToRgbNorm('hsl(0, 100%, 50%)')).toEqual(
      hslToRgbNorm('hsl(0, 100%, 50%)'),
    )
  })
})

// ─── resolveColorStops ───────────────────────────────────────────────────────

describe('resolveColorStops', () => {
  it('sorts stops by value ascending', () => {
    const input: Array<ColorStop> = [
      { value: 0.1, color: '#0000ff' },
      { value: 0.0, color: '#ff0000' },
      { value: 0.05, color: '#00ff00' },
    ]
    const resolved = resolveColorStops(input)
    expect(resolved.stops.map(([v]) => v)).toEqual([0.0, 0.05, 0.1])
  })

  it('parses hex colors to normalized RGB', () => {
    const input: Array<ColorStop> = [
      { value: 0, color: '#ff0000' },
      { value: 1, color: '#00ff00' },
    ]
    const resolved = resolveColorStops(input)
    expect(resolved.rgbs[0][0]).toBeCloseTo(1, 2) // red channel
    expect(resolved.rgbs[1][1]).toBeCloseTo(1, 2) // green channel
  })

  it('handles HSL color strings', () => {
    const input: Array<ColorStop> = [
      { value: 0, color: 'hsl(0, 100%, 50%)' },
      { value: 1, color: 'hsl(120, 100%, 50%)' },
    ]
    const resolved = resolveColorStops(input)
    expect(resolved.rgbs[0][0]).toBeCloseTo(1, 2) // red
    expect(resolved.rgbs[1][1]).toBeCloseTo(1, 2) // green
  })

  it('produces matching stops and rgbs arrays', () => {
    const input: Array<ColorStop> = [
      { value: 0, color: '#ff0000' },
      { value: 0.5, color: '#00ff00' },
      { value: 1, color: '#0000ff' },
    ]
    const resolved = resolveColorStops(input)
    expect(resolved.stops.length).toBe(3)
    expect(resolved.rgbs.length).toBe(3)
  })
})

// ─── defaultStopsAsColorStops ────────────────────────────────────────────────

describe('defaultStopsAsColorStops', () => {
  it('returns the same number of stops as GROWTH_COLOR_STOPS', () => {
    const result = defaultStopsAsColorStops()
    expect(result.length).toBe(GROWTH_COLOR_STOPS.length)
  })

  it('preserves the growth rate values', () => {
    const result = defaultStopsAsColorStops()
    for (let i = 0; i < result.length; i++) {
      expect(result[i].value).toBe(GROWTH_COLOR_STOPS[i][0])
    }
  })

  it('converts HSL to hex format', () => {
    const result = defaultStopsAsColorStops()
    for (const stop of result) {
      expect(stop.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('round-trips through resolveColorStops with similar RGB values', () => {
    const asColorStops = defaultStopsAsColorStops()
    const resolved = resolveColorStops(asColorStops)

    // The RGB values should be very close to the original STOP_RGBS_NORM
    for (let i = 0; i < resolved.rgbs.length; i++) {
      for (let c = 0; c < 3; c++) {
        // Allow small rounding error from HSL -> hex -> RGB conversion
        expect(resolved.rgbs[i][c]).toBeCloseTo(STOP_RGBS_NORM[i][c], 1)
      }
    }
  })
})

// ─── validateColorStops ──────────────────────────────────────────────────────

describe('validateColorStops', () => {
  it('returns no errors for valid stops', () => {
    const stops: Array<ColorStop> = [
      { value: 0, color: '#ff0000' },
      { value: 0.05, color: '#00ff00' },
      { value: 0.1, color: '#0000ff' },
    ]
    expect(validateColorStops(stops)).toEqual([])
  })

  it('requires at least 2 stops', () => {
    expect(validateColorStops([])).toContainEqual(
      expect.stringContaining('At least 2'),
    )
    expect(validateColorStops([{ value: 0, color: '#ff0000' }])).toContainEqual(
      expect.stringContaining('At least 2'),
    )
  })

  it('rejects invalid hex colors', () => {
    const stops: Array<ColorStop> = [
      { value: 0, color: 'not-a-color' },
      { value: 1, color: '#ff0000' },
    ]
    const errors = validateColorStops(stops)
    expect(errors.some((e) => e.includes('invalid color'))).toBe(true)
  })

  it('rejects duplicate values', () => {
    const stops: Array<ColorStop> = [
      { value: 0.05, color: '#ff0000' },
      { value: 0.05, color: '#00ff00' },
      { value: 0.1, color: '#0000ff' },
    ]
    const errors = validateColorStops(stops)
    expect(errors.some((e) => e.includes('Duplicate'))).toBe(true)
  })

  it('rejects out-of-range values', () => {
    const stops: Array<ColorStop> = [
      { value: -0.6, color: '#ff0000' },
      { value: 1.5, color: '#0000ff' },
    ]
    const errors = validateColorStops(stops)
    expect(errors.some((e) => e.includes('outside the allowed range'))).toBe(
      true,
    )
  })

  it('accepts boundary values', () => {
    const stops: Array<ColorStop> = [
      { value: -0.5, color: '#ff0000' },
      { value: 1.0, color: '#0000ff' },
    ]
    expect(validateColorStops(stops)).toEqual([])
  })
})

// ─── interpolateStopRgbs ─────────────────────────────────────────────────────

describe('interpolateStopRgbs', () => {
  const stops: Array<[number, string]> = [
    [0, '#ff0000'],
    [0.5, '#00ff00'],
    [1, '#0000ff'],
  ]
  const rgbs: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  it('returns the exact stop color at a stop value', () => {
    expect(interpolateStopRgbs(stops, rgbs, 0)).toEqual([1, 0, 0])
    expect(interpolateStopRgbs(stops, rgbs, 0.5)).toEqual([0, 1, 0])
    expect(interpolateStopRgbs(stops, rgbs, 1)).toEqual([0, 0, 1])
  })

  it('clamps to first stop for values below range', () => {
    expect(interpolateStopRgbs(stops, rgbs, -1)).toEqual([1, 0, 0])
  })

  it('clamps to last stop for values above range', () => {
    expect(interpolateStopRgbs(stops, rgbs, 2)).toEqual([0, 0, 1])
  })

  it('interpolates between stops', () => {
    const [r, g, b] = interpolateStopRgbs(stops, rgbs, 0.25) // midpoint of red and green
    expect(r).toBeCloseTo(0.5, 2)
    expect(g).toBeCloseTo(0.5, 2)
    expect(b).toBeCloseTo(0, 2)
  })
})

// ─── growthToColor ───────────────────────────────────────────────────────────

describe('growthToColor', () => {
  it('returns 0-255 RGB values with default stops', () => {
    const [r, g, b] = growthToColor(0.06)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(255)
    expect(g).toBeGreaterThanOrEqual(0)
    expect(g).toBeLessThanOrEqual(255)
    expect(b).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThanOrEqual(255)
  })

  it('is backward compatible without resolved param', () => {
    // Should produce the same result as passing DEFAULT_RESOLVED
    const withoutParam = growthToColor(0.06)
    const withDefault = growthToColor(0.06, DEFAULT_RESOLVED)
    expect(withoutParam).toEqual(withDefault)
  })

  it('uses custom stops when provided', () => {
    const customResolved = resolveColorStops([
      { value: 0, color: '#ff0000' },
      { value: 1, color: '#0000ff' },
    ])
    const [r, g, b] = growthToColor(0.5, customResolved)
    // At midpoint between red and blue, we expect roughly equal r and b
    expect(r).toBeGreaterThan(50)
    expect(b).toBeGreaterThan(50)
    expect(g).toBeLessThan(10)
  })

  it('produces different colors with custom vs default stops', () => {
    const customResolved = resolveColorStops([
      { value: -0.05, color: '#00ff00' }, // Green where default is red
      { value: 0.2, color: '#ff0000' }, // Red where default is magenta
    ])
    const defaultColor = growthToColor(-0.05)
    const customColor = growthToColor(-0.05, customResolved)
    // Default at -0.05 is #cf1717 (red); custom at -0.05 is #00ff00 (green)
    expect(defaultColor[0]).toBeGreaterThan(defaultColor[1]) // default: more red than green
    expect(customColor[1]).toBeGreaterThan(customColor[0]) // custom: more green than red
  })
})
