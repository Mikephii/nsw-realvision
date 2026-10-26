/**
 * Shared date preset helpers for time-series widgets that use dateFrom/dateTo.
 *
 * Heatmap widgets (which use yearsBack) define their own preset logic inline
 * since they have a fundamentally different date model.
 */

/** Standard preset options for time-series charts. */
export const TIME_SERIES_PRESETS = [3, 5, 10, 20]

/** Convert a preset or 'all' into dateFrom/dateTo config values. */
export function timeSeriesDatePresets(
  years: number | 'all',
): { dateFrom: string | null; dateTo: string | null } {
  if (years === 'all') return { dateFrom: null, dateTo: null }
  const startYear = new Date().getFullYear() - years
  return { dateFrom: `${startYear}-01-01`, dateTo: null }
}

/**
 * Derive active preset state from a config with dateFrom/dateTo.
 * Returns the matching preset number, 'all', or null (custom).
 *
 * @param config Widget config with dateFrom/dateTo
 * @param presets Array of valid preset year values to check against
 */
export function timeSeriesFromConfig(
  config: { dateFrom: string | null; dateTo: string | null },
  presets: Array<number> = TIME_SERIES_PRESETS,
): {
  preset: number | 'all' | null
  customRange: { startYear: number; endYear: number } | null
} {
  const { dateFrom, dateTo } = config

  // No dateFrom and no dateTo → "All"
  if (!dateFrom && !dateTo) {
    return { preset: 'all', customRange: null }
  }

  // Has a dateFrom of format "YYYY-01-01" with no dateTo → could be a preset
  if (dateFrom && !dateTo) {
    const startYear = parseInt(dateFrom.slice(0, 4), 10)
    const currentYear = new Date().getFullYear()
    const yearsBack = currentYear - startYear

    if (dateFrom === `${startYear}-01-01` && presets.includes(yearsBack)) {
      return { preset: yearsBack, customRange: null }
    }
  }

  // Otherwise it's a custom range
  const startYear = dateFrom ? parseInt(dateFrom.slice(0, 4), 10) : 2001
  const endYear = dateTo
    ? parseInt(dateTo.slice(0, 4), 10)
    : new Date().getFullYear()

  return { preset: null, customRange: { startYear, endYear } }
}

/** Convert a custom year range into dateFrom/dateTo config values. */
export function timeSeriesCustomToConfig(
  startYear: number,
  endYear: number,
): { dateFrom: string | null; dateTo: string | null } {
  const currentYear = new Date().getFullYear()
  return {
    dateFrom: `${startYear}-01-01`,
    dateTo: endYear >= currentYear ? null : `${endYear}-12-31`,
  }
}
