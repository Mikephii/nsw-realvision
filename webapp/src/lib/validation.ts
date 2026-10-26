/**
 * Zod validation schemas for server function inputs.
 *
 * TanStack Start GET server functions deserialize URL params as strings.
 * All numeric params use z.coerce.number() to ensure proper type coercion.
 * Without this, a resolution of 7 arrives as "7" (string) and fails to
 * match INTEGER columns in DuckDB parameterized queries.
 */

import { z } from 'zod'

// --- Shared enums ---

export const StrataFilterSchema = z.enum(['all', 'freehold', 'strata'])
export const GranularitySchema = z.enum(['year', 'quarter', 'month'])
export const DataSourceSchema = z.enum(['all-sales', 'repeat-sales'])
export const GrowthMetricSchema = z.enum(['median-price', 'price-per-sqm'])

// --- Spatial filter ---

const AreaBoundsSchema = z.object({
  minLat: z.coerce.number(),
  maxLat: z.coerce.number(),
  minLon: z.coerce.number(),
  maxLon: z.coerce.number(),
})

const SpatialFilterSchema = z.object({
  wkt: z.string(),
  bounds: AreaBoundsSchema,
  label: z.string(),
})

// --- Property filter ---

export const PropertyFilterSchema = z.object({
  localities: z.array(z.string()).optional(),
  districtCodes: z.array(z.string()).optional(),
  zoneCategories: z.array(z.string()).optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  natureOfProperty: z.array(z.string()).optional(),
  strataFilter: StrataFilterSchema.optional(),
  spatialFilters: z.array(SpatialFilterSchema).optional(),
})

// --- Server function input schemas ---

export const MedianPriceInputSchema = z.object({
  filter: PropertyFilterSchema,
  granularity: GranularitySchema,
  dataSource: DataSourceSchema.optional(),
})

export const GrowthRatesInputSchema = z.object({
  filter: PropertyFilterSchema,
  yearFrom: z.coerce.number(),
  yearTo: z.coerce.number(),
})

export const SuburbSummaryInputSchema = z.object({
  filter: PropertyFilterSchema,
})

export const LocalitiesInputSchema = z.object({
  prefix: z.string(),
  limit: z.coerce.number().optional(),
})

export const StreetsInputSchema = z.object({
  locality: z.string(),
  prefix: z.string(),
  limit: z.coerce.number().optional(),
})

export const PropertiesInputSchema = z.object({
  locality: z.string(),
  streetName: z.string(),
  limit: z.coerce.number().optional(),
})

export const PropertySaleHistoryInputSchema = z.object({
  propertyId: z.string(),
  districtCode: z.string().optional(),
  unitNumber: z.string().nullable().optional(),
})

export const MapPointsInputSchema = z.object({
  filter: PropertyFilterSchema,
})

export const GrowthMethodSchema = z.enum(['endpoint', 'trend-fit', 'loess'])

export const HexDetailRequestSchema = z.object({
  h3Index: z.string(),
  resolution: z.coerce.number(),
  metric: GrowthMetricSchema,
  strataFilter: StrataFilterSchema,
})

export const HeatmapGrowthRequestSchema = z.object({
  resolution: z.coerce.number(),
  yearsBack: z.coerce.number(),
  metric: GrowthMetricSchema,
  strataFilter: StrataFilterSchema,
  growthMethod: GrowthMethodSchema.optional(),
  viewport: z
    .object({
      minLat: z.coerce.number(),
      maxLat: z.coerce.number(),
      minLng: z.coerce.number(),
      maxLng: z.coerce.number(),
    })
    .optional(),
})

export const LoessHeatmapRequestSchema = z.object({
  resolution: z.coerce.number(),
  metric: GrowthMetricSchema,
  strataFilter: StrataFilterSchema,
  startQuarter: z.coerce.number(),
  endQuarter: z.coerce.number(),
  viewport: z
    .object({
      minLat: z.coerce.number(),
      maxLat: z.coerce.number(),
      minLng: z.coerce.number(),
      maxLng: z.coerce.number(),
    })
    .optional(),
})

export const LoessCurveRequestSchema = z.object({
  h3Index: z.string(),
  resolution: z.coerce.number(),
  metric: GrowthMetricSchema,
  strataFilter: StrataFilterSchema,
})
