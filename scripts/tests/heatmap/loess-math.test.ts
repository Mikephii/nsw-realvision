import { describe, it, expect } from 'vitest'
import {
  tricubeWeight,
  combinedWeight,
  accumulateNormalEquations,
  solveNormalEquations,
  evaluateLocalRegression,
} from '../../src/heatmap/loess-math.js'
import { LOESS_BANDWIDTH, LOESS_MIN_WEIGHTED_POINTS } from '../../src/heatmap/loess-config.js'

// ---------------------------------------------------------------------------
// Tricube kernel
// ---------------------------------------------------------------------------

describe('tricubeWeight', () => {
  it('returns 1.0 at distance = 0', () => {
    expect(tricubeWeight(0, 5)).toBe(1)
  })

  it('returns 0 at distance = bandwidth (exact boundary)', () => {
    expect(tricubeWeight(5, 5)).toBe(0)
  })

  it('returns 0 beyond bandwidth', () => {
    expect(tricubeWeight(6, 5)).toBe(0)
    expect(tricubeWeight(100, 5)).toBe(0)
  })

  it('handles negative distance via absolute value', () => {
    expect(tricubeWeight(-3, 5)).toBe(tricubeWeight(3, 5))
  })

  it('decreases monotonically with distance', () => {
    const bandwidth = LOESS_BANDWIDTH
    let prev = tricubeWeight(0, bandwidth)
    for (let d = 0.5; d <= bandwidth; d += 0.5) {
      const current = tricubeWeight(d, bandwidth)
      expect(current).toBeLessThanOrEqual(prev)
      prev = current
    }
  })

  it('is strictly positive inside bandwidth', () => {
    const bandwidth = 5
    for (let d = 0; d < bandwidth; d += 0.5) {
      expect(tricubeWeight(d, bandwidth)).toBeGreaterThan(0)
    }
  })

  it('produces known golden value at u = 0.5', () => {
    // u = 0.5: (1 - 0.5³)³ = (1 - 0.125)³ = 0.875³ = 0.669921875
    const expected = Math.pow(0.875, 3)
    expect(tricubeWeight(2.5, 5)).toBeCloseTo(expected, 10)
  })

  it('produces known golden value at u = 0.8', () => {
    // u = 0.8: (1 - 0.8³)³ = (1 - 0.512)³ = 0.488³ ≈ 0.116214272
    const expected = Math.pow(0.488, 3)
    expect(tricubeWeight(4, 5)).toBeCloseTo(expected, 10)
  })

  it('produces known golden value at u = 0.2', () => {
    // u = 0.2: (1 - 0.2³)³ = (1 - 0.008)³ = 0.992³ ≈ 0.976191488
    const expected = Math.pow(0.992, 3)
    expect(tricubeWeight(1, 5)).toBeCloseTo(expected, 10)
  })

  it('midpoint weight exceeds near-boundary weight', () => {
    const bandwidth = 5
    expect(tricubeWeight(2.5, bandwidth)).toBeGreaterThan(tricubeWeight(4, bandwidth))
  })

  it('works with different bandwidth values', () => {
    // At u = 0.5 regardless of bandwidth, result should be the same
    const expected = Math.pow(0.875, 3)
    expect(tricubeWeight(1.5, 3)).toBeCloseTo(expected, 10)
    expect(tricubeWeight(5, 10)).toBeCloseTo(expected, 10)
    expect(tricubeWeight(10, 20)).toBeCloseTo(expected, 10)
  })
})

// ---------------------------------------------------------------------------
// Combined weight (case weight × tricube)
// ---------------------------------------------------------------------------

describe('combinedWeight', () => {
  it('equals saleCount × tricube for known values', () => {
    const distance = 2
    const bandwidth = 5
    const saleCount = 50
    const expected = saleCount * tricubeWeight(distance, bandwidth)
    expect(combinedWeight(distance, bandwidth, saleCount)).toBe(expected)
  })

  it('returns 0 outside bandwidth regardless of saleCount', () => {
    expect(combinedWeight(6, 5, 100)).toBe(0)
    expect(combinedWeight(10, 5, 999)).toBe(0)
  })

  it('scales linearly with saleCount', () => {
    const d = 2
    const bw = 5
    const w1 = combinedWeight(d, bw, 1)
    const w50 = combinedWeight(d, bw, 50)
    expect(w50 / w1).toBeCloseTo(50, 10)
  })

  it('saleCount = 1 equals bare tricube', () => {
    const d = 2
    const bw = 5
    expect(combinedWeight(d, bw, 1)).toBe(tricubeWeight(d, bw))
  })

  it('at distance = 0, weight equals saleCount', () => {
    // tricube(0, bw) = 1.0, so combined = saleCount × 1.0 = saleCount
    expect(combinedWeight(0, 5, 42)).toBe(42)
    expect(combinedWeight(0, 10, 1)).toBe(1)
    expect(combinedWeight(0, 3, 200)).toBe(200)
  })

  it('saleCount = 0 produces 0', () => {
    // Edge case: shouldn't occur in practice (yearly_medians always has ≥1)
    expect(combinedWeight(2, 5, 0)).toBe(0)
  })

  it('uses the production bandwidth constant', () => {
    // Verify with the actual LOESS_BANDWIDTH from config
    const w = combinedWeight(0, LOESS_BANDWIDTH, 10)
    expect(w).toBe(10) // At distance=0, tricube=1, so combined=saleCount
  })
})

// ---------------------------------------------------------------------------
// Normal equation accumulation
// ---------------------------------------------------------------------------

describe('accumulateNormalEquations', () => {
  it('returns null when fewer than minPoints observations', () => {
    const obs = [
      { x: 2020, y: 500_000, w: 1 },
      { x: 2021, y: 510_000, w: 1 },
    ]
    expect(accumulateNormalEquations(obs, 3)).toBeNull()
  })

  it('skips zero-weight observations', () => {
    const obs = [
      { x: 2020, y: 500_000, w: 1 },
      { x: 2021, y: 510_000, w: 0 }, // zero weight — should not count
      { x: 2022, y: 520_000, w: 1 },
    ]
    // Only 2 non-zero-weight observations — below minPoints=3
    expect(accumulateNormalEquations(obs, 3)).toBeNull()
  })

  it('computes correct sums for known data', () => {
    // 3 equally-weighted points: (2020, 100), (2021, 200), (2022, 300)
    const obs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 200, w: 1 },
      { x: 2022, y: 300, w: 1 },
    ]
    const sums = accumulateNormalEquations(obs, 3)
    expect(sums).not.toBeNull()

    // sw = 1 + 1 + 1 = 3
    expect(sums!.sw).toBe(3)
    // swx = 1*2020 + 1*2021 + 1*2022 = 6063
    expect(sums!.swx).toBe(6063)
    // swy = 1*100 + 1*200 + 1*300 = 600
    expect(sums!.swy).toBe(600)
    // swxx = 1*2020² + 1*2021² + 1*2022² = 4080441 + 4084441 + 4088484 = 12253366
    expect(sums!.swxx).toBe(2020 * 2020 + 2021 * 2021 + 2022 * 2022)
    // swxy = 1*2020*100 + 1*2021*200 + 1*2022*300 = 202000 + 404200 + 606600 = 1212800
    expect(sums!.swxy).toBe(2020 * 100 + 2021 * 200 + 2022 * 300)
  })

  it('incorporates case weights correctly', () => {
    // Same x,y values but different weights
    const obs = [
      { x: 2020, y: 100, w: 10 }, // 10 sales
      { x: 2021, y: 200, w: 50 }, // 50 sales
      { x: 2022, y: 300, w: 1 },  // 1 sale
    ]
    const sums = accumulateNormalEquations(obs, 3)
    expect(sums).not.toBeNull()

    // sw = 10 + 50 + 1 = 61
    expect(sums!.sw).toBe(61)
    // swx = 10*2020 + 50*2021 + 1*2022 = 20200 + 101050 + 2022 = 123272
    expect(sums!.swx).toBe(10 * 2020 + 50 * 2021 + 1 * 2022)
    // swy = 10*100 + 50*200 + 1*300 = 1000 + 10000 + 300 = 11300
    expect(sums!.swy).toBe(10 * 100 + 50 * 200 + 1 * 300)
  })

  it('accepts minPoints = 1', () => {
    const obs = [{ x: 2020, y: 500_000, w: 1 }]
    expect(accumulateNormalEquations(obs, 1)).not.toBeNull()
  })

  it('uses default minPoints from LOESS config', () => {
    // Default minPoints is 3
    const twoObs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 200, w: 1 },
    ]
    expect(accumulateNormalEquations(twoObs)).toBeNull()

    const threeObs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 200, w: 1 },
      { x: 2022, y: 300, w: 1 },
    ]
    expect(accumulateNormalEquations(threeObs)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Solve normal equations
// ---------------------------------------------------------------------------

describe('solveNormalEquations', () => {
  it('returns null for singular system (all x identical)', () => {
    // If all x are the same, swxx - swx²/sw = 0
    const obs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2020, y: 200, w: 1 },
      { x: 2020, y: 300, w: 1 },
    ]
    const sums = accumulateNormalEquations(obs, 3)!
    expect(solveNormalEquations(sums)).toBeNull()
  })

  it('fits a perfect line through collinear points', () => {
    // y = 100x - 201800 → at x=2020: y=200, at x=2021: y=300, at x=2022: y=400
    const obs = [
      { x: 2020, y: 200, w: 1 },
      { x: 2021, y: 300, w: 1 },
      { x: 2022, y: 400, w: 1 },
    ]
    const sums = accumulateNormalEquations(obs, 3)!
    const solution = solveNormalEquations(sums)!
    expect(solution.slope).toBeCloseTo(100, 6)
    expect(solution.intercept).toBeCloseTo(200 - 100 * 2020, 2)
  })

  it('weighted regression shifts toward high-weight observations', () => {
    // Three points: (2020, 100), (2021, 200), (2022, 1000)
    // Unweighted: all equal influence
    const unweightedObs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 200, w: 1 },
      { x: 2022, y: 1000, w: 1 },
    ]
    const unweightedSums = accumulateNormalEquations(unweightedObs, 3)!
    const unweightedSolution = solveNormalEquations(unweightedSums)!

    // Weighted: heavy weight on the (2022, 1000) point
    const weightedObs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 200, w: 1 },
      { x: 2022, y: 1000, w: 100 },
    ]
    const weightedSums = accumulateNormalEquations(weightedObs, 3)!
    const weightedSolution = solveNormalEquations(weightedSums)!

    // Weighted slope should be steeper (pulled toward the high-weight 1000)
    expect(weightedSolution.slope).toBeGreaterThan(unweightedSolution.slope)

    // Weighted fit at x=2022 should be closer to 1000
    const unweightedAt2022 = unweightedSolution.intercept + unweightedSolution.slope * 2022
    const weightedAt2022 = weightedSolution.intercept + weightedSolution.slope * 2022
    expect(Math.abs(weightedAt2022 - 1000)).toBeLessThan(Math.abs(unweightedAt2022 - 1000))
  })

  it('with uniform weights, matches unweighted result', () => {
    const obs1 = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 250, w: 1 },
      { x: 2022, y: 350, w: 1 },
    ]
    const obs10 = [
      { x: 2020, y: 100, w: 10 },
      { x: 2021, y: 250, w: 10 },
      { x: 2022, y: 350, w: 10 },
    ]

    const sol1 = solveNormalEquations(accumulateNormalEquations(obs1, 3)!)!
    const sol10 = solveNormalEquations(accumulateNormalEquations(obs10, 3)!)!

    // Scaling all weights by the same factor should not change the solution
    expect(sol10.slope).toBeCloseTo(sol1.slope, 10)
    expect(sol10.intercept).toBeCloseTo(sol1.intercept, 6)
  })
})

// ---------------------------------------------------------------------------
// End-to-end local regression evaluation
// ---------------------------------------------------------------------------

describe('evaluateLocalRegression', () => {
  it('returns null with insufficient data', () => {
    const obs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 200, w: 1 },
    ]
    expect(evaluateLocalRegression(2020.5, obs, 3)).toBeNull()
  })

  it('returns null for singular system', () => {
    const obs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2020, y: 200, w: 1 },
      { x: 2020, y: 300, w: 1 },
    ]
    expect(evaluateLocalRegression(2020, obs, 3)).toBeNull()
  })

  it('interpolates correctly on a perfect line', () => {
    // y = 100x - 201800 → y(2020) = 200, y(2021) = 300, y(2022) = 400
    const obs = [
      { x: 2020, y: 200, w: 1 },
      { x: 2021, y: 300, w: 1 },
      { x: 2022, y: 400, w: 1 },
    ]

    // At x=2020.5 → y = 250
    expect(evaluateLocalRegression(2020.5, obs, 3)).toBeCloseTo(250, 6)
    // At x=2021 → y = 300
    expect(evaluateLocalRegression(2021, obs, 3)).toBeCloseTo(300, 6)
  })

  it('case weights shift the fit toward high-count years', () => {
    // (2020, 500k, count=1), (2021, 600k, count=1), (2022, 400k, count=50)
    // Without case weights (all w=1): the curve would trend upward from 2020–2022
    // With case weights: 2022's low value dominates, pulling the fit down
    const bandwidth = 5

    const unweighted = [
      { x: 2020, y: 500_000, w: tricubeWeight(1, bandwidth) },
      { x: 2021, y: 600_000, w: tricubeWeight(0, bandwidth) },
      { x: 2022, y: 400_000, w: tricubeWeight(1, bandwidth) },
    ]
    const weighted = [
      { x: 2020, y: 500_000, w: combinedWeight(1, bandwidth, 1) },
      { x: 2021, y: 600_000, w: combinedWeight(0, bandwidth, 1) },
      { x: 2022, y: 400_000, w: combinedWeight(1, bandwidth, 50) },
    ]

    const unweightedAt2021 = evaluateLocalRegression(2021, unweighted, 3)!
    const weightedAt2021 = evaluateLocalRegression(2021, weighted, 3)!

    // The weighted fit at 2021 should be lower because the heavily-weighted
    // 2022 observation (400k with 50 sales) pulls the fit downward
    expect(weightedAt2021).toBeLessThan(unweightedAt2021)
  })

  it('uses default minPoints matching LOESS_MIN_WEIGHTED_POINTS', () => {
    // Verify the default parameter value aligns with the config constant
    expect(LOESS_MIN_WEIGHTED_POINTS).toBe(3)

    // 2 points should fail with default minPoints
    const twoObs = [
      { x: 2020, y: 100, w: 1 },
      { x: 2021, y: 200, w: 1 },
    ]
    expect(evaluateLocalRegression(2020.5, twoObs)).toBeNull()
  })
})
