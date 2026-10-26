import type { StrataFilter } from '@/lib/queries'

export type ColorMode = 'price' | 'zone' | 'recency' | 'confidence'

export interface PropertyMapConfig {
  localities: Array<string>
  /** Custom area IDs for spatial polygon filtering. Optional for backward compat. */
  areaIds?: Array<string>
  strataFilter?: StrataFilter
  dateFrom: string | null
  dateTo: string | null
  colorMode: ColorMode
  minPrice: number | null
  maxPrice: number | null
  enableClustering: boolean
  fixedDotSize: boolean
}

export interface MapPointProperties {
  purchasePrice: number
  contractDate: string
  contractYear: number
  zoneCode: string | null
  locality: string
  natureOfProperty: string | null
  geocodeConfidence: string | null
  propertyId: string
  address: string
}

export type MapGeoJSON = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  MapPointProperties
>
