import { describe, it, expect } from 'vitest'
import {
  LOESS_BANDWIDTH,
  LOESS_MIN_WEIGHTED_POINTS,
  LOESS_PRICE_MIN,
  LOESS_PRICE_MAX,
  LOESS_EVAL_START_QUARTER,
  QUARTER_STEP,
} from '../../src/heatmap/loess-config.js'
import {
  H3_RESOLUTIONS,
  GROWTH_METRICS,
  STRATA_FILTERS,
} from '../../src/heatmap/types.js'

describe('LOESS curve precompute — quarter alignment', () => {
  it('quarter encoding matches EXTRACT(YEAR) + (EXTRACT(QUARTER) - 1) * 0.25', () => {
    // Simulate the SQL formula for known dates
    const testCases: Array<{ year: number; quarter: number; expected: number }> = [
      { year: 2020, quarter: 1, expected: 2020.0 },
      { year: 2020, quarter: 2, expected: 2020.25 },
      { year: 2020, quarter: 3, expected: 2020.5 },
      { year: 2020, quarter: 4, expected: 2020.75 },
      { year: 1990, quarter: 1, expected: 1990.0 },
      { year: 2025, quarter: 4, expected: 2025.75 },
    ]

    for (const { year, quarter, expected } of testCases) {
      const encoded = year + (quarter - 1) * QUARTER_STEP
      expect(encoded).toBe(expected)
    }
  })

  it('quarter fractions are exactly representable as IEEE 754 doubles', () => {
    // 0.0, 0.25, 0.5, 0.75 are all powers of 2 — no floating point error
    for (let year = 1990; year <= 2030; year++) {
      for (let q = 0; q < 4; q++) {
        const fraction = year + q * QUARTER_STEP
        // Verify round-trip: encode then decode back to year + quarter
        const decodedYear = Math.floor(fraction)
        const decodedQuarter = Math.round((fraction - decodedYear) / QUARTER_STEP) + 1
        expect(decodedYear).toBe(year)
        expect(decodedQuarter).toBe(q + 1)
      }
    }
  })
})

describe('LOESS curve precompute — eval grid', () => {
  it('generate_series produces expected count from 1990 to 2026', () => {
    // Simulate: generate_series(1990.0, 2026.0, 0.25)
    const evalEnd = 2026.0
    const count = Math.round((evalEnd - LOESS_EVAL_START_QUARTER) / QUARTER_STEP) + 1
    // 1990.0 to 2026.0 = 36 years × 4 quarters/year + 1 = 145
    expect(count).toBe(145)
  })

  it('grid boundaries align with Q1 of start and end years', () => {
    const firstQuarter = LOESS_EVAL_START_QUARTER
    expect(firstQuarter).toBe(1990.0) // Q1 1990

    // If evalEnd is current quarter, it should be a valid quarter fraction
    const evalEnd = 2026.0
    const remainder = (evalEnd - LOESS_EVAL_START_QUARTER) % QUARTER_STEP
    expect(remainder).toBeCloseTo(0, 10)
  })

  it('all generated quarters are within the valid range', () => {
    const evalEnd = 2026.0
    const quarters: number[] = []
    for (let q = LOESS_EVAL_START_QUARTER; q <= evalEnd + 1e-9; q += QUARTER_STEP) {
      quarters.push(q)
    }

    expect(quarters[0]).toBe(LOESS_EVAL_START_QUARTER)
    expect(quarters[quarters.length - 1]).toBeCloseTo(evalEnd, 10)

    // Every quarter should be in range
    for (const q of quarters) {
      expect(q).toBeGreaterThanOrEqual(LOESS_EVAL_START_QUARTER)
      expect(q).toBeLessThanOrEqual(evalEnd + 1e-9)
    }
  })
})

describe('LOESS curve precompute — combination count', () => {
  it('18 combinations: 3 resolutions × 2 metrics × 3 strata filters', () => {
    const combos = H3_RESOLUTIONS.length * GROWTH_METRICS.length * STRATA_FILTERS.length
    expect(combos).toBe(18)
  })

  it('resolutions are 7, 8, 9', () => {
    expect([...H3_RESOLUTIONS]).toEqual([7, 8, 9])
  })

  it('metrics are median-price and price-per-sqm', () => {
    expect([...GROWTH_METRICS]).toEqual(['median-price', 'price-per-sqm'])
  })

  it('strata filters are all, freehold, strata', () => {
    expect([...STRATA_FILTERS]).toEqual(['all', 'freehold', 'strata'])
  })
})

describe('LOESS curve precompute — array indexing', () => {
  it('array index formula produces correct 1-based indices', () => {
    // DuckDB list_extract is 1-based:
    // index = (target_quarter - min_quarter) / QUARTER_STEP + 1
    const minQuarter = 1995.0
    const maxQuarter = 2025.75

    // First element
    expect((minQuarter - minQuarter) / QUARTER_STEP + 1).toBe(1)
    // Second element
    expect((1995.25 - minQuarter) / QUARTER_STEP + 1).toBe(2)
    // Last element
    const expectedLength = (maxQuarter - minQuarter) / QUARTER_STEP + 1
    expect((maxQuarter - minQuarter) / QUARTER_STEP + 1).toBe(expectedLength)
    // Length should be 124 quarters for 1995.0 to 2025.75
    // 30.75 years / 0.25 step + 1 = 124
    expect(expectedLength).toBe(124)
  })

  it('array length equals full range from min to max quarter', () => {
    // Arrays span [earliest_sale, latest_sale] with one slot per quarter.
    // Positions where the LOESS fit failed are NULL — but the array length
    // always equals the full range, not just the non-NULL count.
    const minQuarter = 2000.0
    const maxQuarter = 2025.0
    const expectedLength = (maxQuarter - minQuarter) / QUARTER_STEP + 1
    expect(expectedLength).toBe(101) // 25 years × 4 + 1
    expect(Number.isInteger(expectedLength)).toBe(true)
  })

  it('NULL positions in gap-tolerant arrays are valid', () => {
    // Simulate an array with NULLs at gap positions (e.g. data gap 2015-2023)
    const minQuarter = 2002.0
    const maxQuarter = 2025.0
    const length = (maxQuarter - minQuarter) / QUARTER_STEP + 1
    const fittedPrices: Array<number | null> = Array(length).fill(null)

    // Fill fitted values for 2002-2014 and 2024-2025 (gap in between)
    for (let i = 0; i <= (2014.0 - 2002.0) / QUARTER_STEP; i++) {
      fittedPrices[i] = 500_000 + i * 5000
    }
    for (let i = Math.round((2024.0 - 2002.0) / QUARTER_STEP); i < length; i++) {
      fittedPrices[i] = 800_000 + (i - Math.round((2024.0 - 2002.0) / QUARTER_STEP)) * 5000
    }

    // Non-NULL count should be at least 4 (the minimum for a valid curve)
    const nonNullCount = fittedPrices.filter((v) => v !== null).length
    expect(nonNullCount).toBeGreaterThanOrEqual(4)

    // Array length matches full range regardless of NULLs
    expect(fittedPrices.length).toBe(length)

    // Gap positions are NULL
    const gapIdx = Math.round((2018.0 - 2002.0) / QUARTER_STEP)
    expect(fittedPrices[gapIdx]).toBeNull()

    // Non-gap positions are numbers
    expect(fittedPrices[0]).toEqual(expect.any(Number))
  })

  it('indexing formula works identically for arrays with NULLs', () => {
    // The index formula (target - min) / 0.25 produces the correct index
    // regardless of whether the value at that index is NULL or a number
    const minQuarter = 2002.0
    const maxQuarter = 2025.0

    // Simulate 0-based TypeScript indexing
    const targetYear = 2018.0
    const idx = Math.round((targetYear - minQuarter) / QUARTER_STEP)
    expect(idx).toBe(64) // (2018 - 2002) / 0.25 = 64

    // Simulate 1-based DuckDB list_extract indexing
    const duckdbIdx = (targetYear - minQuarter) / QUARTER_STEP + 1
    expect(duckdbIdx).toBe(65)
    expect(duckdbIdx).toBe(idx + 1)
  })
})

describe('LOESS curve precompute — config constants used correctly', () => {
  it('all config constants are numeric and finite', () => {
    const constants = [
      LOESS_BANDWIDTH,
      LOESS_MIN_WEIGHTED_POINTS,
      LOESS_PRICE_MIN,
      LOESS_PRICE_MAX,
      LOESS_EVAL_START_QUARTER,
      QUARTER_STEP,
    ]

    for (const c of constants) {
      expect(typeof c).toBe('number')
      expect(Number.isFinite(c)).toBe(true)
    }
  })

  it('bandwidth covers at least MIN_WEIGHTED_POINTS quarterly periods', () => {
    // With bandwidth B years and quarterly data, the kernel window has
    // at most 2*B/QUARTER_STEP data points. This must exceed MIN_WEIGHTED_POINTS.
    const maxPointsInWindow = (2 * LOESS_BANDWIDTH) / QUARTER_STEP
    expect(maxPointsInWindow).toBeGreaterThanOrEqual(LOESS_MIN_WEIGHTED_POINTS)
  })

  it('eval start quarter is before the current year', () => {
    const currentYear = new Date().getFullYear()
    expect(LOESS_EVAL_START_QUARTER).toBeLessThan(currentYear)
  })
})
