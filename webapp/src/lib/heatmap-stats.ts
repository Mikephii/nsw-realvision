/**
 * H3 hexagonal spatial statistics for the growth heatmap.
 *
 * Computes estimated values for empty H3 cells adjacent to observed cells
 * using sale-count-weighted averaging of observed neighbors. This fills
 * visual gaps in the IDW gradient where data is sparse.
 *
 * Also provides LOESS evaluation for the hex detail chart curve.
 *
 * All functions are pure: no side effects, no React/UI dependencies.
 */

import { cellToLatLng, gridDisk } from 'h3-js'
import type { HeatmapDataPoint } from './heatmap-queries'

/**
 * Minimum number of observed neighbors an empty cell must have before
 * we estimate its value. Prevents single-neighbor extrapolation which
 * would be unreliable.
 */
export const MIN_OBSERVED_NEIGHBORS = 2

/**
 * A client-side estimated hex cell, computed by {@link fillAdjacentHexes}.
 * Deliberately separate from {@link HeatmapDataPoint} (which is server-side)
 * because estimated cells have different provenance and fields.
 */
export interface EstimatedHexCell {
  /** H3 cell index (hex string). */
  h3Index: string
  /** Latitude of H3 cell centroid. */
  lat: number
  /** Longitude of H3 cell centroid. */
  lng: number
  /** Sale-count-weighted average growth from observed neighbors. */
  growth: number
  /** Number of observed neighbors used in the estimate. */
  observedNeighborCount: number
  /** Total sale count across contributing neighbors (for tooltip context). */
  neighborSaleCount: number
}

/**
 * Estimate values for empty H3 cells adjacent to observed cells.
 *
 * Algorithm:
 * 1. Build a lookup from observed cell h3 indices for O(1) membership checks.
 * 2. For each observed cell, find all immediate neighbors via `gridDisk(_, 1)`.
 * 3. Collect neighbor indices that are NOT in the observed set.
 * 4. For each empty neighbor:
 *    a. Find its own neighbors that ARE observed (via `gridDisk(_, 1)`).
 *    b. If >= {@link MIN_OBSERVED_NEIGHBORS}: compute sale-count-weighted average growth.
 *    c. Get centroid via `cellToLatLng()`.
 * 5. Return array of {@link EstimatedHexCell}.
 *
 * Only fills cells immediately adjacent to observed data. Does NOT
 * cascade (estimated cells don't seed further estimation).
 *
 * @param observedCells - Array of observed HeatmapDataPoints with h3Index.
 * @returns Array of estimated cells for empty neighbors.
 */
export function fillAdjacentHexes(
  observedCells: Array<HeatmapDataPoint>,
): Array<EstimatedHexCell> {
  if (observedCells.length === 0) return []

  // Step 1: Build observed lookup
  const observedMap = new Map<string, HeatmapDataPoint>()
  for (const cell of observedCells) {
    observedMap.set(cell.h3Index, cell)
  }

  // Step 2-3: Collect all empty neighbors of observed cells
  const emptyNeighborSet = new Set<string>()
  for (const cell of observedCells) {
    try {
      const neighbors = gridDisk(cell.h3Index, 1)
      for (const n of neighbors) {
        if (!observedMap.has(n)) {
          emptyNeighborSet.add(n)
        }
      }
    } catch {
      // Invalid h3 index — skip silently
    }
  }

  // Step 4: For each empty neighbor, compute weighted average from observed neighbors
  const estimated: Array<EstimatedHexCell> = []

  for (const emptyH3 of emptyNeighborSet) {
    try {
      const disk = gridDisk(emptyH3, 1)
      const observedNeighbors: Array<HeatmapDataPoint> = []
      for (const n of disk) {
        const obs = observedMap.get(n)
        if (obs) observedNeighbors.push(obs)
      }

      if (observedNeighbors.length < MIN_OBSERVED_NEIGHBORS) continue

      // Sale-count-weighted average growth
      let totalWeight = 0
      let weightedGrowth = 0
      for (const obs of observedNeighbors) {
        weightedGrowth += obs.growth * obs.saleCount
        totalWeight += obs.saleCount
      }

      if (totalWeight === 0) continue

      const [lat, lng] = cellToLatLng(emptyH3)

      estimated.push({
        h3Index: emptyH3,
        lat,
        lng,
        growth: weightedGrowth / totalWeight,
        observedNeighborCount: observedNeighbors.length,
        neighborSaleCount: totalWeight,
      })
    } catch {
      // Invalid h3 index or gridDisk failure — skip
    }
  }

  return estimated
}

