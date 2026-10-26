import { describe, expect, it } from 'vitest'
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js'
import type { HeatmapDataPoint } from '@/lib/heatmap-queries'
import {
  MIN_OBSERVED_NEIGHBORS,
  fillAdjacentHexes,
} from '@/lib/heatmap-stats'

/** Helper: create a minimal HeatmapDataPoint from an H3 index. */
function makePoint(
  h3Index: string,
  growth: number,
  saleCount: number,
): HeatmapDataPoint {
  const [lat, lng] = cellToLatLng(h3Index)
  return {
    lat,
    lng,
    growth,
    saleCount,
    medianStart: 500_000,
    medianEnd: 600_000,
    locality: null,
    h3Index,
  }
}

describe('fillAdjacentHexes', () => {
  // Use real H3 cells at resolution 7 near Sydney CBD
  const center = latLngToCell(-33.87, 151.21, 7)
  const ring1 = gridDisk(center, 1).filter((h) => h !== center)

  it('returns empty array for empty input', () => {
    expect(fillAdjacentHexes([])).toEqual([])
  })

  it('returns empty array for a single observed cell (each neighbor has < 2 observed)', () => {
    const observed = [makePoint(center, 0.05, 100)]
    // Each neighbor of center sees only 1 observed neighbor (center itself)
    const estimated = fillAdjacentHexes(observed)
    expect(estimated).toEqual([])
  })

  it('fills empty neighbors when >= 2 observed neighbors exist', () => {
    // Place observed cells at center + two adjacent ring-1 cells
    const observed = [
      makePoint(center, 0.06, 100),
      makePoint(ring1[0], 0.04, 80),
      makePoint(ring1[1], 0.08, 120),
    ]

    const estimated = fillAdjacentHexes(observed)
    expect(estimated.length).toBeGreaterThan(0)

    // All estimated cells must have >= MIN_OBSERVED_NEIGHBORS
    for (const cell of estimated) {
      expect(cell.observedNeighborCount).toBeGreaterThanOrEqual(
        MIN_OBSERVED_NEIGHBORS,
      )
    }
  })

  it('does not include observed cells in the result', () => {
    const observed = [
      makePoint(center, 0.05, 100),
      makePoint(ring1[0], 0.04, 80),
      makePoint(ring1[1], 0.06, 120),
    ]
    const observedIndices = new Set(observed.map((p) => p.h3Index))
    const estimated = fillAdjacentHexes(observed)

    for (const cell of estimated) {
      expect(observedIndices.has(cell.h3Index)).toBe(false)
    }
  })

  it('computes sale-count-weighted average growth', () => {
    // Use all ring-1 cells as observed so ring-2 cells get estimated
    // with well-defined weights
    const allDisk1 = gridDisk(center, 1)
    const observed = allDisk1.map((h) =>
      makePoint(h, h === center ? 0.1 : 0.02, h === center ? 200 : 50),
    )

    const estimated = fillAdjacentHexes(observed)
    expect(estimated.length).toBeGreaterThan(0)

    // All estimated values should be between min and max observed growth
    for (const cell of estimated) {
      expect(cell.growth).toBeGreaterThanOrEqual(0.02)
      expect(cell.growth).toBeLessThanOrEqual(0.1)
    }
  })

  it('returns valid lat/lng centroids', () => {
    const observed = [
      makePoint(center, 0.05, 100),
      makePoint(ring1[0], 0.04, 80),
      makePoint(ring1[1], 0.06, 120),
    ]
    const estimated = fillAdjacentHexes(observed)

    for (const cell of estimated) {
      expect(cell.lat).toBeGreaterThan(-90)
      expect(cell.lat).toBeLessThan(90)
      expect(cell.lng).toBeGreaterThan(-180)
      expect(cell.lng).toBeLessThan(180)
      expect(cell.h3Index).toBeTruthy()
    }
  })

  it('fills ring-2 cells when full disk-1 is observed', () => {
    // When all 7 cells of a disk are observed, ring-2 cells should
    // get estimated values (each has 2-3 observed ring-1 neighbors)
    const allDisk1 = gridDisk(center, 1)
    const observed = allDisk1.map((h, i) => makePoint(h, 0.05 + i * 0.01, 50))

    const estimated = fillAdjacentHexes(observed)
    expect(estimated.length).toBeGreaterThan(0)

    // None of the estimated cells should be in the observed set
    const observedSet = new Set(allDisk1)
    for (const cell of estimated) {
      expect(observedSet.has(cell.h3Index)).toBe(false)
    }
  })

  it('reports correct neighborSaleCount', () => {
    const allDisk1 = gridDisk(center, 1)
    const observed = allDisk1.map((h) => makePoint(h, 0.05, 100))

    const estimated = fillAdjacentHexes(observed)
    // Each estimated cell's neighborSaleCount should be sum of its observed neighbors' sale counts
    for (const cell of estimated) {
      expect(cell.neighborSaleCount).toBe(cell.observedNeighborCount * 100)
    }
  })
})
