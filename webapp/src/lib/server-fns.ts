/**
 * TanStack Start server functions for querying the DuckDB analytics database.
 * These are callable from the client via RPC.
 *
 * All inputs are validated and coerced with Zod schemas (see validation.ts).
 * This is critical because GET server functions deserialize URL params as
 * strings — without Zod coercion, numeric params like resolution=7 arrive
 * as "7" and fail to match INTEGER columns in DuckDB.
 *
 * Server-only modules (db.server, queries, autocomplete) are dynamically
 * imported inside handlers to avoid triggering the import protection plugin.
 */

import { createServerFn } from '@tanstack/react-start'
import {
  GrowthRatesInputSchema,
  HeatmapGrowthRequestSchema,
  HexDetailRequestSchema,
  LocalitiesInputSchema,
  LoessCurveRequestSchema,
  LoessHeatmapRequestSchema,
  MapPointsInputSchema,
  MedianPriceInputSchema,
  PropertiesInputSchema,
  PropertySaleHistoryInputSchema,
  StreetsInputSchema,
  SuburbSummaryInputSchema,
} from './validation'
import type {
  DataSource,
  Granularity,
  PropertyFilter,
  StrataFilter,
} from './queries'
import type {
  DataCoverage,
  GrowthMethod,
  GrowthMetric,
  HeatmapDataPoint,
  HeatmapGrowthRequest,
  HexDetailRequest,
  LoessCurveData,
  LoessCurveRequest,
  LoessHeatmapRequest,
} from './heatmap-queries'

export type { PropertyFilter, Granularity, StrataFilter, DataSource }
export type {
  DataCoverage,
  GrowthMetric,
  GrowthMethod,
  HeatmapGrowthRequest,
  HeatmapDataPoint,
  HexDetailRequest,
  LoessHeatmapRequest,
  LoessCurveRequest,
  LoessCurveData,
}

export const getMedianPriceTimeSeries = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => MedianPriceInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryMedianPriceTimeSeries } = await import('./queries')
    const conn = await getDb()
    return queryMedianPriceTimeSeries(
      conn,
      data.filter as PropertyFilter,
      data.granularity as Granularity,
      {
        repeatSalesOnly: data.dataSource === 'repeat-sales',
      },
    )
  })

export const getMedianPriceSqmTimeSeries = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => MedianPriceInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryMedianPriceSqmTimeSeries } = await import('./queries')
    const conn = await getDb()
    return queryMedianPriceSqmTimeSeries(
      conn,
      data.filter as PropertyFilter,
      data.granularity as Granularity,
      {
        repeatSalesOnly: data.dataSource === 'repeat-sales',
      },
    )
  })

export const getGrowthRates = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => GrowthRatesInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryGrowthRates } = await import('./queries')
    const conn = await getDb()
    return queryGrowthRates(
      conn,
      data.filter as PropertyFilter,
      data.yearFrom,
      data.yearTo,
    )
  })

export const getSuburbSummary = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => SuburbSummaryInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { querySuburbSummary } = await import('./queries')
    const conn = await getDb()
    return querySuburbSummary(conn, data.filter as PropertyFilter)
  })

export const getDatabaseStats = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getDb } = await import('./db.server')
    const { queryDatabaseStats } = await import('./queries')
    const conn = await getDb()
    return queryDatabaseStats(conn)
  },
)

export const getDataCoverage = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getDb } = await import('./db.server')
    const { queryDataCoverage } = await import('./heatmap-queries')
    const conn = await getDb()
    return queryDataCoverage(conn)
  },
)

export const getLocalities = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => LocalitiesInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { searchLocalities } = await import('./autocomplete')
    const conn = await getDb()
    return searchLocalities(conn, data.prefix, data.limit ?? 20)
  })

export const getStreets = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => StreetsInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { searchStreets } = await import('./autocomplete')
    const conn = await getDb()
    return searchStreets(conn, data.locality, data.prefix, data.limit ?? 20)
  })

export const getProperties = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => PropertiesInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { searchProperties } = await import('./autocomplete')
    const conn = await getDb()
    return searchProperties(
      conn,
      data.locality,
      data.streetName,
      data.limit ?? 50,
    )
  })

export const getPropertySaleHistory = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => PropertySaleHistoryInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryPropertySaleHistory } = await import('./property-history')
    const conn = await getDb()
    return queryPropertySaleHistory(
      conn,
      data.propertyId,
      data.districtCode,
      data.unitNumber,
    )
  })

export const getMapPoints = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => MapPointsInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryMapPoints } = await import('./map-queries')
    const conn = await getDb()
    return queryMapPoints(conn, data.filter as PropertyFilter)
  })

export const getHeatmapGrowthData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => HeatmapGrowthRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryHeatmapGrowthData } = await import('./heatmap-queries')
    const conn = await getDb()
    return queryHeatmapGrowthData(conn, data as HeatmapGrowthRequest)
  })

export const getRelativePerformanceData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => HeatmapGrowthRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryRelativePerformanceData } = await import('./heatmap-queries')
    const conn = await getDb()
    return queryRelativePerformanceData(conn, data as HeatmapGrowthRequest)
  })

export const getHexYearlyMedians = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => HexDetailRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryHexYearlyMedians } = await import('./heatmap-queries')
    const conn = await getDb()
    return queryHexYearlyMedians(conn, data as HexDetailRequest)
  })

export const getHexSales = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => HexDetailRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryHexSales } = await import('./heatmap-queries')
    const conn = await getDb()
    return queryHexSales(conn, data as HexDetailRequest)
  })

export const getLoessHeatmapData = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => LoessHeatmapRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryLoessHeatmapData } = await import('./heatmap-queries')
    const conn = await getDb()
    return queryLoessHeatmapData(conn, data as LoessHeatmapRequest)
  })

export const getLoessCurve = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => LoessCurveRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const { getDb } = await import('./db.server')
    const { queryLoessCurve } = await import('./heatmap-queries')
    const conn = await getDb()
    return queryLoessCurve(conn, data as LoessCurveRequest)
  })
