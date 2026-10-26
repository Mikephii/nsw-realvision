import { describe, expect, it } from 'vitest'
import {
  LoessCurveRequestSchema,
  LoessHeatmapRequestSchema,
} from '@/lib/validation'

// ---------------------------------------------------------------------------
// Array index formula
// ---------------------------------------------------------------------------

/**
 * Replicates the DuckDB list_extract index computation:
 *   CAST((targetQuarter - minQuarter) / 0.25 + 1 AS INT)
 *
 * DuckDB list_extract is 1-indexed.
 */
function listExtractIndex(targetQuarter: number, minQuarter: number): number {
  return Math.trunc((targetQuarter - minQuarter) / 0.25 + 1)
}

describe('list_extract index formula', () => {
  it('returns 1 for targetQuarter at minQuarter', () => {
    expect(listExtractIndex(2000.0, 2000.0)).toBe(1)
  })

  it('returns correct index for one quarter ahead', () => {
    expect(listExtractIndex(2000.25, 2000.0)).toBe(2)
  })

  it('returns correct index for one year ahead', () => {
    // 4 quarters = 4 steps -> index 5
    expect(listExtractIndex(2001.0, 2000.0)).toBe(5)
  })

  it('returns correct index for maxQuarter', () => {
    // Array from 2000.0 to 2025.75 = 103 quarters -> 103 entries
    const minQ = 2000.0
    const maxQ = 2025.75
    const expectedLength = (maxQ - minQ) / 0.25 + 1
    expect(listExtractIndex(maxQ, minQ)).toBe(expectedLength)
  })

  it('handles non-integer minQuarter', () => {
    // minQuarter = 1993.5 (Q3), target = 1994.0 (Q1 next year)
    // Offset = 0.5 / 0.25 = 2, index = 3
    expect(listExtractIndex(1994.0, 1993.5)).toBe(3)
  })

  it('handles Q4 quarters (year.75)', () => {
    expect(listExtractIndex(2020.75, 2020.0)).toBe(4)
  })

  it('returns 0 or negative for targetQuarter before minQuarter (out of bounds)', () => {
    // DuckDB list_extract with index < 1 returns NULL, which is the desired behavior
    const idx = listExtractIndex(1999.0, 2000.0)
    expect(idx).toBeLessThan(1)
  })

  it('computes correct indices for a known 10-year span', () => {
    const minQ = 2015.0
    const indices = [
      { q: 2015.0, expected: 1 },
      { q: 2015.25, expected: 2 },
      { q: 2015.5, expected: 3 },
      { q: 2015.75, expected: 4 },
      { q: 2016.0, expected: 5 },
      { q: 2020.0, expected: 21 },
      { q: 2025.0, expected: 41 },
    ]
    for (const { q, expected } of indices) {
      expect(listExtractIndex(q, minQ)).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// CAGR formula
// ---------------------------------------------------------------------------

/**
 * Replicates the DuckDB CAGR computation:
 *   POWER(endPrice / startPrice, 1.0 / (endQuarter - startQuarter)) - 1
 */
function cagr(
  startPrice: number,
  endPrice: number,
  startQuarter: number,
  endQuarter: number,
): number {
  const years = endQuarter - startQuarter
  return Math.pow(endPrice / startPrice, 1.0 / years) - 1
}

describe('CAGR formula', () => {
  it('returns 0 for no price change', () => {
    expect(cagr(500_000, 500_000, 2015.0, 2025.0)).toBeCloseTo(0, 10)
  })

  it('returns correct rate for doubling over 10 years', () => {
    // 2^(1/10) - 1 ≈ 0.07177
    const result = cagr(500_000, 1_000_000, 2015.0, 2025.0)
    expect(result).toBeCloseTo(0.07177, 4)
  })

  it('returns correct rate for tripling over 20 years', () => {
    // 3^(1/20) - 1 ≈ 0.05647
    const result = cagr(300_000, 900_000, 2005.0, 2025.0)
    expect(result).toBeCloseTo(0.05647, 4)
  })

  it('returns negative rate for price decline', () => {
    const result = cagr(800_000, 600_000, 2018.0, 2023.0)
    expect(result).toBeLessThan(0)
  })

  it('handles non-integer year spans (quarters)', () => {
    // 2.5 year span (10 quarters)
    const result = cagr(500_000, 600_000, 2020.0, 2022.5)
    // (600000/500000)^(1/2.5) - 1 ≈ 0.07565
    expect(result).toBeCloseTo(0.07565, 4)
  })

  it('roundtrips: applying CAGR for N years recovers end price', () => {
    const startPrice = 450_000
    const endPrice = 780_000
    const startQ = 2010.0
    const endQ = 2025.0
    const rate = cagr(startPrice, endPrice, startQ, endQ)
    const recovered = startPrice * Math.pow(1 + rate, endQ - startQ)
    expect(recovered).toBeCloseTo(endPrice, 2)
  })
})

// ---------------------------------------------------------------------------
// Zod schema tests
// ---------------------------------------------------------------------------

describe('LoessHeatmapRequestSchema', () => {
  it('coerces string params to numbers', () => {
    const input = {
      resolution: '8',
      metric: 'median-price',
      strataFilter: 'all',
      startQuarter: '2016.0',
      endQuarter: '2026.0',
    }
    const result = LoessHeatmapRequestSchema.parse(input)
    expect(result.resolution).toBe(8)
    expect(result.startQuarter).toBe(2016)
    expect(result.endQuarter).toBe(2026)
    expect(typeof result.resolution).toBe('number')
    expect(typeof result.startQuarter).toBe('number')
  })

  it('accepts numeric params directly', () => {
    const input = {
      resolution: 7,
      metric: 'price-per-sqm',
      strataFilter: 'strata',
      startQuarter: 2021.25,
      endQuarter: 2025.75,
    }
    const result = LoessHeatmapRequestSchema.parse(input)
    expect(result.resolution).toBe(7)
    expect(result.startQuarter).toBe(2021.25)
    expect(result.endQuarter).toBe(2025.75)
  })

  it('accepts optional viewport', () => {
    const input = {
      resolution: 8,
      metric: 'median-price',
      strataFilter: 'all',
      startQuarter: 2020.0,
      endQuarter: 2025.0,
      viewport: {
        minLat: '-34.0',
        maxLat: '-33.0',
        minLng: '150.0',
        maxLng: '152.0',
      },
    }
    const result = LoessHeatmapRequestSchema.parse(input)
    expect(result.viewport?.minLat).toBe(-34)
    expect(result.viewport?.maxLng).toBe(152)
  })

  it('rejects invalid metric', () => {
    expect(() =>
      LoessHeatmapRequestSchema.parse({
        resolution: 8,
        metric: 'invalid',
        strataFilter: 'all',
        startQuarter: 2020,
        endQuarter: 2025,
      }),
    ).toThrow()
  })

  it('rejects invalid strataFilter', () => {
    expect(() =>
      LoessHeatmapRequestSchema.parse({
        resolution: 8,
        metric: 'median-price',
        strataFilter: 'invalid',
        startQuarter: 2020,
        endQuarter: 2025,
      }),
    ).toThrow()
  })
})

describe('LoessCurveRequestSchema', () => {
  it('coerces string resolution to number', () => {
    const input = {
      h3Index: '89283082803ffff',
      resolution: '8',
      metric: 'median-price',
      strataFilter: 'freehold',
    }
    const result = LoessCurveRequestSchema.parse(input)
    expect(result.resolution).toBe(8)
    expect(result.h3Index).toBe('89283082803ffff')
    expect(typeof result.resolution).toBe('number')
  })

  it('keeps h3Index as string', () => {
    const input = {
      h3Index: 'abc123',
      resolution: 9,
      metric: 'price-per-sqm',
      strataFilter: 'strata',
    }
    const result = LoessCurveRequestSchema.parse(input)
    expect(typeof result.h3Index).toBe('string')
    expect(result.h3Index).toBe('abc123')
  })

  it('rejects missing h3Index', () => {
    expect(() =>
      LoessCurveRequestSchema.parse({
        resolution: 8,
        metric: 'median-price',
        strataFilter: 'all',
      }),
    ).toThrow()
  })
})
