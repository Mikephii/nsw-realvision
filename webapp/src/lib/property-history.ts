/**
 * Property sale history query using DuckDB.
 * Returns all sales for a given property ordered by date descending.
 */

import { executeQuery } from './queries'
import type { DuckDBConnection } from '@duckdb/node-api'

export interface PropertySale {
  dealingNumber: string
  contractDate: string | null
  settlementDate: string | null
  purchasePrice: number
  natureOfProperty: string | null
  zoneCode: string | null
  area: number | null
  areaType: string | null
  legalDescription: string | null
  unitNumber: string | null
  houseNumber: string | null
  streetName: string | null
  locality: string | null
  postCode: string | null
}

/**
 * Get full sale history for a property by its ID.
 * Optionally narrow by district code and/or unit number.
 */
export async function queryPropertySaleHistory(
  conn: DuckDBConnection,
  propertyId: string,
  districtCode?: string,
  unitNumber?: string | null,
): Promise<Array<PropertySale>> {
  const conditions = ['property_id = ?', 'purchase_price > 0']
  const params: Array<unknown> = [propertyId]

  if (districtCode) {
    conditions.push('district_code = ?')
    params.push(districtCode)
  }

  if (unitNumber !== undefined) {
    if (unitNumber === null) {
      conditions.push('unit_number IS NULL')
    } else {
      conditions.push('unit_number = ?')
      params.push(unitNumber)
    }
  }

  const sql = `
    SELECT
      dealing_number,
      CAST(contract_date AS VARCHAR) AS contract_date,
      CAST(settlement_date AS VARCHAR) AS settlement_date,
      purchase_price,
      nature_of_property,
      zone_code,
      area,
      area_type,
      legal_description,
      unit_number,
      house_number,
      street_name,
      locality,
      post_code
    FROM fact_property_sale
    WHERE ${conditions.join(' AND ')}
    ORDER BY contract_date DESC NULLS LAST
  `

  const rows = await executeQuery<{
    dealing_number: string
    contract_date: string | null
    settlement_date: string | null
    purchase_price: number
    nature_of_property: string | null
    zone_code: string | null
    area: number | null
    area_type: string | null
    legal_description: string | null
    unit_number: string | null
    house_number: string | null
    street_name: string | null
    locality: string | null
    post_code: string | null
  }>(conn, sql, params)

  return rows.map((r) => ({
    dealingNumber: r.dealing_number,
    contractDate: r.contract_date,
    settlementDate: r.settlement_date,
    purchasePrice: r.purchase_price,
    natureOfProperty: r.nature_of_property,
    zoneCode: r.zone_code,
    area: r.area,
    areaType: r.area_type,
    legalDescription: r.legal_description,
    unitNumber: r.unit_number,
    houseNumber: r.house_number,
    streetName: r.street_name,
    locality: r.locality,
    postCode: r.post_code,
  }))
}
