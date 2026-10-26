/**
 * Configuration types and constants for the Growth Heatmap widget.
 *
 * The widget displays annualized property growth rates as a smooth IDW
 * (Inverse Distance Weighting) gradient on a MapLibre map. Data is
 * pre-aggregated server-side using H3 hexagonal cells at multiple
 * resolutions and fetched via server functions.
 */

import type { StrataFilter } from '@/lib/queries'
import type { GrowthMethod, GrowthMetric } from '@/lib/heatmap-queries'

export type { GrowthMetric, GrowthMethod }

/** Lookback options for LOESS (superset of the standard 5/10/15/20/25). */
export const LOESS_YEARS_BACK_OPTIONS = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30] as const

/** A single color stop for a custom growth color scale. */
export interface ColorStop {
  /** Growth rate as a decimal (e.g. 0.05 = +5% p.a.) */
  value: number
  /** CSS hex color string (#rrggbb) */
  color: string
}

/**
 * Configuration for the Growth Heatmap widget.
 * Stored in the widget store and persisted across sessions.
 * Each field maps to a control in GrowthHeatmapSettings.
 */
export interface GrowthHeatmapConfig {
  /**
   * Number of years to look back for growth calculation.
   * Determines the start window: (currentYear - yearsBack +/- 1).
   * Longer windows show secular trends; shorter windows show recent momentum.
   */
  yearsBack: 5 | 10 | 15 | 20 | 25

  /**
   * Which price metric to use for growth calculation.
   * 'median-price': raw median sale price (affected by composition changes)
   * 'price-per-sqm': normalised by land area (controls for lot size variation)
   */
  metric: GrowthMetric

  /**
   * Growth computation method.
   * - 'endpoint': CAGR from start vs end window medians (default, backward-compatible).
   * - 'trend-fit': Log-linear regression through ALL yearly medians — robust to endpoint noise.
   */
  growthMethod?: GrowthMethod

  /**
   * Property type segmentation.
   * 'all': all properties
   * 'freehold': houses/land (strata IS NULL)
   * 'strata': units/apartments (strata IS NOT NULL)
   */
  strataFilter: StrataFilter

  /**
   * Which IDW rendering backend to use.
   * 'library': maplibre-gl-interpolate-heatmap
   * 'custom': our own WebGL CustomLayerInterface shader (default)
   */
  renderer: 'library' | 'custom'

  /** Custom color stops. When present, overrides the default GROWTH_COLOR_STOPS. */
  customColorStops?: Array<ColorStop>

  /** Override color scale minimum (growth decimal). Defaults to first stop value. */
  colorMin?: number

  /** Override color scale maximum (growth decimal). Defaults to last stop value. */
  colorMax?: number

  /** Show H3 cell boundary on hover. Renders the hexagonal aggregation area. */
  showH3Borders?: boolean

  /**
   * Fill empty hex cells adjacent to observed cells with estimated values.
   * Estimated cells are rendered as semi-transparent polygons, visually
   * distinct from the IDW gradient. Helps fill gaps in sparse data areas.
   */
  fillSparseHexes?: boolean

  /**
   * Lookback period for LOESS method (years).
   * Supports values beyond the fixed yearsBack options (e.g. 1, 2, 3, 7, 30).
   * Only used when growthMethod === 'loess'. Falls back to yearsBack if unset.
   */
  loessYearsBack?: number

  /**
   * Custom year range for LOESS method.
   * When set, overrides loessYearsBack with an explicit start/end year.
   * Enables arbitrary time period selection (e.g. 2016–2023).
   */
  customRange?: { startYear: number; endYear: number }

  /** Saved map viewport. When set, the map initialises here instead of the default. */
  viewport?: { longitude: number; latitude: number; zoom: number }
}

/**
 * Zoom-to-resolution mapping constants.
 * Three tiers: coarse (suburb), mid (district), fine (neighbourhood).
 */
export const ZOOM_RESOLUTION_MAP = {
  /** Zoom 0-9: wide view -> coarse H3 cells (~5 km²) */
  COARSE_MAX_ZOOM: 9,
  COARSE_RESOLUTION: 7 as const,

  /** Zoom 9-11: mid view -> medium H3 cells (~0.7 km²) */
  MID_MAX_ZOOM: 11,
  MID_RESOLUTION: 8 as const,

  /** Zoom 12+: close view -> fine H3 cells (~105K m²) */
  FINE_RESOLUTION: 9 as const,
} as const

/**
 * Get the H3 resolution for a given map zoom level.
 * Used to determine which pre-aggregated data to fetch.
 */
export function resolutionForZoom(zoom: number): 7 | 8 | 9 {
  if (zoom <= ZOOM_RESOLUTION_MAP.COARSE_MAX_ZOOM)
    return ZOOM_RESOLUTION_MAP.COARSE_RESOLUTION
  if (zoom <= ZOOM_RESOLUTION_MAP.MID_MAX_ZOOM)
    return ZOOM_RESOLUTION_MAP.MID_RESOLUTION
  return ZOOM_RESOLUTION_MAP.FINE_RESOLUTION
}
