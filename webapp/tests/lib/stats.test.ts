import { describe, expect, it } from 'vitest'
import type {BayesSeriesInput, TimeSeriesPoint} from '@/lib/stats';
import {
  BAYES_SHRINKAGE_K,
  
  
  annualizedGrowth,
  applySmoothingToSeries,
  bayesShrinkageEstimate,
  computeBayesSeries,
  loessSmooth,
  logLinearGrowthRate,
  movingAverageSmooth,
  percentChange
} from '@/lib/stats'

describe('annualizedGrowth', () => {
  it('calculates CAGR for a multi-year holding period', () => {
    // $500k → $1M over 10 years ≈ 7.18% p.a.
    const result = annualizedGrowth(
      500_000,
      1_000_000,
      '2010-01-01',
      '2020-01-01',
    )
    expect(result).toBeCloseTo(7.177, 1)
  })

  it('calculates CAGR for a 1-year period', () => {
    // $500k → $550k over 1 year = 10%
    const result = annualizedGrowth(
      500_000,
      550_000,
      '2020-01-01',
      '2021-01-01',
    )
    expect(result).toBeCloseTo(10, 0)
  })

  it('returns negative CAGR when price decreases', () => {
    // $1M → $800k over 2 years
    const result = annualizedGrowth(
      1_000_000,
      800_000,
      '2020-01-01',
      '2022-01-01',
    )
    expect(result).not.toBeNull()
    expect(result!).toBeLessThan(0)
  })

  it('returns null when dateFrom is null', () => {
    expect(annualizedGrowth(500_000, 600_000, null, '2020-01-01')).toBeNull()
  })

  it('returns null when dateTo is null', () => {
    expect(annualizedGrowth(500_000, 600_000, '2020-01-01', null)).toBeNull()
  })

  it('returns null when both dates are null', () => {
    expect(annualizedGrowth(500_000, 600_000, null, null)).toBeNull()
  })

  it('returns null for very short holding periods (< ~5 weeks)', () => {
    // 3 weeks apart — too short to annualize meaningfully
    const result = annualizedGrowth(
      500_000,
      510_000,
      '2020-01-01',
      '2020-01-22',
    )
    expect(result).toBeNull()
  })

  it('handles exact doubling over 7 years (rule of 72 sanity check)', () => {
    // Doubling in 7 years ≈ 10.4% CAGR
    const result = annualizedGrowth(
      400_000,
      800_000,
      '2015-06-01',
      '2022-06-01',
    )
    expect(result).toBeCloseTo(10.4, 0)
  })

  it('returns 0 when price is unchanged', () => {
    const result = annualizedGrowth(
      500_000,
      500_000,
      '2018-01-01',
      '2023-01-01',
    )
    expect(result).toBeCloseTo(0)
  })
})

describe('percentChange', () => {
  it('calculates positive change', () => {
    expect(percentChange(100, 125)).toBeCloseTo(25)
  })

  it('calculates negative change', () => {
    expect(percentChange(200, 150)).toBeCloseTo(-25)
  })

  it('returns 0 for no change', () => {
    expect(percentChange(500_000, 500_000)).toBe(0)
  })

  it('handles 100% increase', () => {
    expect(percentChange(400_000, 800_000)).toBeCloseTo(100)
  })

  it('handles large multipliers', () => {
    expect(percentChange(100_000, 1_000_000)).toBeCloseTo(900)
  })
})

// ---------------------------------------------------------------------------
// logLinearGrowthRate
// ---------------------------------------------------------------------------

describe('logLinearGrowthRate', () => {
  it('detects ~10% annual growth from a compounding series', () => {
    // 10% growth: 100, 110, 121, 133.1 over years 0,1,2,3
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 110 },
      { x: 2, y: 121 },
      { x: 3, y: 133.1 },
    ]
    const result = logLinearGrowthRate(points)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.1, 2)
  })

  it('returns ~0 for a flat market', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 100 },
      { x: 2, y: 100 },
      { x: 3, y: 100 },
    ]
    const result = logLinearGrowthRate(points)
    expect(result).not.toBeNull()
    expect(Math.abs(result!)).toBeLessThan(0.001)
  })

  it('detects ~-10% annual decline', () => {
    // 10% decline: 100, 90, 81, 72.9
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 90 },
      { x: 2, y: 81 },
      { x: 3, y: 72.9 },
    ]
    const result = logLinearGrowthRate(points)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(-0.1, 2)
  })

  it('returns positive growth for noisy but upward-trending data', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 130 },
      { x: 2, y: 95 },
      { x: 3, y: 140 },
      { x: 4, y: 120 },
    ]
    const result = logLinearGrowthRate(points)
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0)
  })

  it('resists the endpoint trap (last-year dip does not flip sign)', () => {
    // Endpoint comparison: 100 → 90 = -10%. But the trend is clearly up.
    const points = [
      { x: 0, y: 100 },
      { x: 1, y: 120 },
      { x: 2, y: 140 },
      { x: 3, y: 160 },
      { x: 4, y: 90 },
    ]
    const result = logLinearGrowthRate(points)
    expect(result).not.toBeNull()
    // Log-linear regression should still show positive growth
    expect(result!).toBeGreaterThan(0)
  })

  it('returns null for a single data point', () => {
    const points = [{ x: 0, y: 100 }]
    expect(logLinearGrowthRate(points)).toBeNull()
  })

  it('returns null when all y-values are null', () => {
    const points: Array<TimeSeriesPoint> = [
      { x: 0, y: null },
      { x: 1, y: null },
      { x: 2, y: null },
    ]
    expect(logLinearGrowthRate(points)).toBeNull()
  })

  it('excludes zero and negative prices', () => {
    // Only 2 valid points remain (100 and 200), zeros/negatives excluded
    const points: Array<TimeSeriesPoint> = [
      { x: 0, y: 0 },
      { x: 1, y: -50 },
      { x: 2, y: 100 },
      { x: 3, y: 200 },
    ]
    const result = logLinearGrowthRate(points)
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0)
  })

  it('returns 0 when all x-values are identical', () => {
    // All observations at the same point in time — no slope computable
    const points = [
      { x: 5, y: 100 },
      { x: 5, y: 200 },
      { x: 5, y: 150 },
    ]
    expect(logLinearGrowthRate(points)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Helper to build a TimeSeriesPoint[] from a simple y-value array
// ---------------------------------------------------------------------------

function pts(values: Array<number | null>): Array<TimeSeriesPoint> {
  return values.map((y, i) => ({ x: i, y }))
}

// ---------------------------------------------------------------------------
// loessSmooth
// ---------------------------------------------------------------------------

describe('loessSmooth', () => {
  it('smooths a linear series to approximately the same values', () => {
    const input = pts([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])
    const result = loessSmooth(input, 0.5)
    // Each smoothed value should be close to the original (linear data is already smooth)
    for (let i = 0; i < input.length; i++) {
      expect(result[i].y).toBeCloseTo(input[i].y!, -1) // within 10
    }
  })

  it('pulls an outlier toward its neighbors', () => {
    // Smooth series with one spike at index 4
    const input = pts([100, 110, 120, 130, 500, 150, 160, 170, 180, 190])
    const result = loessSmooth(input, 0.5)
    // The smoothed value at the outlier position should be much lower than 500
    expect(result[4].y!).toBeLessThan(300)
    // But still above the neighbors (the outlier pulls the fit up somewhat)
    expect(result[4].y!).toBeGreaterThan(100)
  })

  it('returns raw values when fewer than 3 non-null points', () => {
    const input = pts([100, null, 200, null, null])
    const result = loessSmooth(input, 0.5)
    expect(result[0].y).toBe(100)
    expect(result[1].y).toBeNull()
    expect(result[2].y).toBe(200)
  })

  it('preserves null positions in output', () => {
    const input = pts([100, null, 200, null, 300, 400, 500, null, 600, 700])
    const result = loessSmooth(input, 0.5)
    // Null positions stay null
    expect(result[1].y).toBeNull()
    expect(result[3].y).toBeNull()
    expect(result[7].y).toBeNull()
    // Non-null positions get smoothed values
    expect(result[0].y).not.toBeNull()
    expect(result[4].y).not.toBeNull()
  })

  it('returns all nulls when all y-values are null', () => {
    const input = pts([null, null, null, null])
    const result = loessSmooth(input, 0.5)
    for (const p of result) {
      expect(p.y).toBeNull()
    }
  })

  it('preserves x-positions', () => {
    const input = pts([100, 200, 300, 400, 500])
    const result = loessSmooth(input, 0.5)
    for (let i = 0; i < input.length; i++) {
      expect(result[i].x).toBe(i)
    }
  })

  it('with low span (0.15) tracks closer to raw values', () => {
    const input = pts([100, 110, 120, 130, 500, 150, 160, 170, 180, 190])
    const lowSpan = loessSmooth(input, 0.15)
    const highSpan = loessSmooth(input, 0.8)
    // With low span, the outlier at index 4 should be preserved more
    expect(Math.abs(lowSpan[4].y! - 500)).toBeLessThan(
      Math.abs(highSpan[4].y! - 500),
    )
  })

  it('does not mutate the input array', () => {
    const input = pts([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])
    const original = input.map((p) => ({ ...p }))
    loessSmooth(input, 0.5)
    for (let i = 0; i < input.length; i++) {
      expect(input[i].y).toBe(original[i].y)
    }
  })
})

// ---------------------------------------------------------------------------
// movingAverageSmooth
// ---------------------------------------------------------------------------

describe('movingAverageSmooth', () => {
  it('computes correct trailing averages with window=3', () => {
    const input = pts([10, 20, 30, 40, 50])
    const result = movingAverageSmooth(input, 3)
    // Index 0: only 1 value (10), minRequired = ceil(3/2) = 2 → null
    expect(result[0].y).toBeNull()
    // Index 1: 2 values (10, 20), minRequired = 2 → avg = 15
    expect(result[1].y).toBeCloseTo(15)
    // Index 2: 3 values (10, 20, 30) → avg = 20
    expect(result[2].y).toBeCloseTo(20)
    // Index 3: 3 values (20, 30, 40) → avg = 30
    expect(result[3].y).toBeCloseTo(30)
    // Index 4: 3 values (30, 40, 50) → avg = 40
    expect(result[4].y).toBeCloseTo(40)
  })

  it('skips null values in the trailing window', () => {
    const input = pts([10, null, 30, null, 50])
    const result = movingAverageSmooth(input, 3)
    // Index 0: 1 non-null value (10), minRequired = 2 → null
    expect(result[0].y).toBeNull()
    // Index 1: null input → null output
    expect(result[1].y).toBeNull()
    // Index 2: 2 non-null values (10, 30), minRequired = 2 → avg = 20
    expect(result[2].y).toBeCloseTo(20)
    // Index 3: null input → null output
    expect(result[3].y).toBeNull()
    // Index 4: 3 non-null lookback finds (50, 30, 10) → avg = 30
    expect(result[4].y).toBeCloseTo(30)
  })

  it('with window=1 returns raw values', () => {
    const input = pts([100, 200, 300])
    const result = movingAverageSmooth(input, 1)
    expect(result[0].y).toBe(100)
    expect(result[1].y).toBe(200)
    expect(result[2].y).toBe(300)
  })

  it('returns null for all-null input', () => {
    const input = pts([null, null, null])
    const result = movingAverageSmooth(input, 3)
    for (const p of result) {
      expect(p.y).toBeNull()
    }
  })

  it('preserves x-positions', () => {
    const input = pts([100, 200, 300, 400, 500])
    const result = movingAverageSmooth(input, 3)
    for (let i = 0; i < input.length; i++) {
      expect(result[i].x).toBe(i)
    }
  })

  it('does not mutate the input array', () => {
    const input = pts([100, 200, 300, 400, 500])
    const original = input.map((p) => ({ ...p }))
    movingAverageSmooth(input, 3)
    for (let i = 0; i < input.length; i++) {
      expect(input[i].y).toBe(original[i].y)
    }
  })
})

// ---------------------------------------------------------------------------
// applySmoothingToSeries
// ---------------------------------------------------------------------------

describe('applySmoothingToSeries', () => {
  it('returns the same reference for method "none"', () => {
    const input = pts([100, 200, 300])
    const result = applySmoothingToSeries(input, 'none')
    expect(result).toBe(input) // referential equality
  })

  it('applies LOESS when method is "loess"', () => {
    const input = pts([100, 110, 120, 130, 500, 150, 160, 170, 180, 190])
    const result = applySmoothingToSeries(input, 'loess', { span: 0.5 })
    // The outlier should be smoothed
    expect(result[4].y!).toBeLessThan(500)
  })

  it('applies moving average when method is "moving-average"', () => {
    const input = pts([10, 20, 30, 40, 50])
    const result = applySmoothingToSeries(input, 'moving-average', {
      window: 3,
    })
    // Index 2: avg of (10, 20, 30) = 20
    expect(result[2].y).toBeCloseTo(20)
  })

  it('uses default LOESS span when not specified', () => {
    const input = pts([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])
    // Should not throw and should produce smoothed output
    const result = applySmoothingToSeries(input, 'loess')
    expect(result).toHaveLength(10)
    expect(result[0].y).not.toBeNull()
  })

  it('uses default MA window when not specified', () => {
    const input = pts([10, 20, 30, 40, 50])
    const result = applySmoothingToSeries(input, 'moving-average')
    // Default window is 3, so index 2 should be avg of (10,20,30) = 20
    expect(result[2].y).toBeCloseTo(20)
  })
})

// ---------------------------------------------------------------------------
// bayesShrinkageEstimate
// ---------------------------------------------------------------------------

describe('bayesShrinkageEstimate', () => {
  it('returns reference with 100% estimation when no local sales', () => {
    const result = bayesShrinkageEstimate(null, 500_000, 0)
    expect(result.estimate).toBe(500_000)
    expect(result.estimationPct).toBe(100)
    expect(result.localWeight).toBe(0)
  })

  it('blends mostly toward reference with one local sale (n=1, k=15)', () => {
    const result = bayesShrinkageEstimate(600_000, 500_000, 1, 15)
    // w = 1/16 = 0.0625
    // estimate = 0.0625 * 600000 + 0.9375 * 500000 = 506250
    expect(result.estimate).toBeCloseTo(506_250)
    expect(result.estimationPct).toBe(94)
    expect(result.localWeight).toBeCloseTo(1 / 16)
  })

  it('blends 50/50 when n equals k (n=15, k=15)', () => {
    const result = bayesShrinkageEstimate(600_000, 500_000, 15, 15)
    expect(result.estimate).toBeCloseTo(550_000)
    expect(result.estimationPct).toBe(50)
    expect(result.localWeight).toBeCloseTo(0.5)
  })

  it('blends mostly toward local with large n (n=100, k=15)', () => {
    const result = bayesShrinkageEstimate(600_000, 500_000, 100, 15)
    // w = 100/115 ≈ 0.8696
    const expectedW = 100 / 115
    const expected = expectedW * 600_000 + (1 - expectedW) * 500_000
    expect(result.estimate).toBeCloseTo(expected)
    expect(result.estimationPct).toBe(Math.round((1 - expectedW) * 100))
    expect(result.localWeight).toBeCloseTo(expectedW)
  })

  it('respects custom k parameter', () => {
    const result = bayesShrinkageEstimate(600_000, 500_000, 5, 5)
    // w = 5/10 = 0.5
    expect(result.estimate).toBeCloseTo(550_000)
    expect(result.estimationPct).toBe(50)
    expect(result.localWeight).toBeCloseTo(0.5)
  })

  it('returns exact value when local equals reference', () => {
    const result = bayesShrinkageEstimate(500_000, 500_000, 3, 15)
    expect(result.estimate).toBeCloseTo(500_000)
  })

  it('treats zero sale count with non-null value as 100% reference', () => {
    const result = bayesShrinkageEstimate(600_000, 500_000, 0)
    expect(result.estimate).toBe(500_000)
    expect(result.estimationPct).toBe(100)
    expect(result.localWeight).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeBayesSeries
// ---------------------------------------------------------------------------

describe('computeBayesSeries', () => {
  it('returns empty map for empty inputs', () => {
    const result = computeBayesSeries([])
    expect(result.size).toBe(0)
  })

  it('sparse series blends toward dense series in two-series case', () => {
    const dense: BayesSeriesInput = {
      label: 'Dense',
      points: pts([100, 110, 120, 130, 140]),
      saleCounts: [50, 55, 60, 65, 70],
    }
    const sparse: BayesSeriesInput = {
      label: 'Sparse',
      points: pts([90, 200, 110, 50, 160]),
      saleCounts: [2, 1, 3, 1, 2],
    }

    const result = computeBayesSeries([dense, sparse], BAYES_SHRINKAGE_K)

    const sparseBayes = result.get('Sparse')!
    expect(sparseBayes).toHaveLength(5)

    // Sparse series with 1-3 sales should be pulled heavily toward the
    // weighted average (dominated by the dense series)
    for (const pt of sparseBayes) {
      expect(pt.estimationPct).toBeGreaterThan(50)
    }

    // Dense series should have low estimation percentages
    const denseBayes = result.get('Dense')!
    for (const pt of denseBayes) {
      expect(pt.estimationPct).toBeLessThan(30)
    }
  })

  it('returns low estimation percentages when all periods have abundant data', () => {
    const input: BayesSeriesInput = {
      label: 'Abundant',
      points: pts([100, 110, 120, 130, 140]),
      saleCounts: [100, 120, 110, 105, 115],
    }

    const result = computeBayesSeries([input], BAYES_SHRINKAGE_K)
    const series = result.get('Abundant')!

    for (const pt of series) {
      expect(pt.estimationPct).toBeLessThan(20)
    }
  })

  it('returns reference values with 100% estimation when all local values are null', () => {
    const input: BayesSeriesInput = {
      label: 'Empty',
      points: pts([null, null, null, null, null]),
      saleCounts: [0, 0, 0, 0, 0],
    }
    // Need a second series to generate a reference trend
    const reference: BayesSeriesInput = {
      label: 'Reference',
      points: pts([100, 110, 120, 130, 140]),
      saleCounts: [50, 50, 50, 50, 50],
    }

    const result = computeBayesSeries([input, reference], BAYES_SHRINKAGE_K)
    const emptySeries = result.get('Empty')!

    for (const pt of emptySeries) {
      expect(pt.y).not.toBeNull()
      expect(pt.estimationPct).toBe(100)
      expect(pt.rawLocalValue).toBeNull()
    }
  })

  it('preserves raw local values in the result', () => {
    const input: BayesSeriesInput = {
      label: 'Test',
      points: pts([100, 200, 300, 400, 500]),
      saleCounts: [2, 2, 2, 2, 2],
    }

    const result = computeBayesSeries([input], BAYES_SHRINKAGE_K)
    const series = result.get('Test')!

    expect(series[0].rawLocalValue).toBe(100)
    expect(series[2].rawLocalValue).toBe(300)
    expect(series[4].rawLocalValue).toBe(500)
  })
})
