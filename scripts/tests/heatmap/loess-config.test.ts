import { describe, it, expect } from 'vitest'
import {
  LOESS_BANDWIDTH,
  LOESS_MIN_WEIGHTED_POINTS,
  LOESS_PRICE_MIN,
  LOESS_PRICE_MAX,
  LOESS_EVAL_START_QUARTER,
  QUARTER_STEP,
} from '../../src/heatmap/loess-config.js'

describe('LOESS configuration constants', () => {
  it('bandwidth is 5 years', () => {
    expect(LOESS_BANDWIDTH).toBe(5)
  })

  it('minimum weighted points is 3', () => {
    expect(LOESS_MIN_WEIGHTED_POINTS).toBe(3)
  })

  it('price bounds are [1, 1_000_000_000]', () => {
    expect(LOESS_PRICE_MIN).toBe(1)
    expect(LOESS_PRICE_MAX).toBe(1_000_000_000)
    expect(LOESS_PRICE_MAX).toBeGreaterThan(LOESS_PRICE_MIN)
  })

  it('eval start quarter is 1990 Q1', () => {
    expect(LOESS_EVAL_START_QUARTER).toBe(1990.0)
  })

  it('quarter step is 0.25', () => {
    expect(QUARTER_STEP).toBe(0.25)
  })

  it('price bounds cover realistic property prices', () => {
    // Australian property prices range ~$50K to ~$50M
    expect(LOESS_PRICE_MIN).toBeLessThanOrEqual(1)
    expect(LOESS_PRICE_MAX).toBeGreaterThan(50_000_000)

    // Typical Sydney house: ~$1.5M — well within bounds
    const typicalPrice = 1_500_000
    expect(typicalPrice).toBeGreaterThan(LOESS_PRICE_MIN)
    expect(typicalPrice).toBeLessThan(LOESS_PRICE_MAX)
  })

  it('bandwidth provides sufficient data density with quarterly data', () => {
    // With quarterly data, bandwidth of 5 years means ±5 years = ±20 quarters
    // That's up to 40 quarterly data points in the kernel window
    const quartersInWindow = (LOESS_BANDWIDTH * 2) / QUARTER_STEP
    expect(quartersInWindow).toBe(40)
    expect(quartersInWindow).toBeGreaterThanOrEqual(LOESS_MIN_WEIGHTED_POINTS * 2)
  })
})
