/**
 * Bulk data loader using DuckDB Appender API.
 * Loads cleaned PropertySale records into DuckDB via a staging table,
 * then merges into the fact table for deduplication.
 */

import type { DuckDBConnection, DuckDBAppender } from '@duckdb/node-api'
import { dateValue } from '@duckdb/node-api'
import type { PropertySale } from '../types/property-sale.js'
import { createStagingTable, dropStagingTable } from './schema.js'

/**
 * Load an array of PropertySale records into DuckDB.
 * Uses staging table + INSERT OR REPLACE for deduplication.
 *
 * @param conn - DuckDB connection
 * @param sales - Cleaned property sale records
 * @returns Number of records inserted/updated in fact table
 */
export async function loadSales(conn: DuckDBConnection, sales: PropertySale[]): Promise<number> {
  if (sales.length === 0) return 0

  // Create staging table
  await createStagingTable(conn)
  await conn.run('DELETE FROM staging_property_sale;')

  // Bulk insert into staging using Appender
  const appender = await conn.createAppender('staging_property_sale')

  for (const sale of sales) {
    appendSale(appender, sale)
  }

  appender.flushSync()
  appender.closeSync()

  // Merge staging → fact (INSERT OR REPLACE handles dedup by primary key)
  await conn.run(`
    INSERT OR REPLACE INTO fact_property_sale
    SELECT * FROM staging_property_sale;
  `)

  // Get count of what was loaded
  const reader = await conn.runAndReadAll('SELECT COUNT(*) FROM staging_property_sale')
  const rows = reader.getRows()
  const count = Number(rows[0]?.[0] ?? 0)

  // Clean up staging
  await dropStagingTable(conn)

  return count
}

/** Append a single PropertySale to the appender, handling nulls. */
function appendSale(appender: DuckDBAppender, sale: PropertySale): void {
  // district_code VARCHAR NOT NULL
  appender.appendVarchar(sale.districtCode)
  // property_id VARCHAR NOT NULL
  appender.appendVarchar(sale.propertyId)
  // dealing_number VARCHAR NOT NULL
  appender.appendVarchar(sale.dealingNumber)
  // sale_counter VARCHAR NOT NULL
  appender.appendVarchar(sale.saleCounter)
  // property_name VARCHAR
  sale.propertyName !== null ? appender.appendVarchar(sale.propertyName) : appender.appendNull()
  // unit_number VARCHAR
  sale.unitNumber !== null ? appender.appendVarchar(sale.unitNumber) : appender.appendNull()
  // house_number VARCHAR
  sale.houseNumber !== null ? appender.appendVarchar(sale.houseNumber) : appender.appendNull()
  // street_name VARCHAR
  sale.streetName !== null ? appender.appendVarchar(sale.streetName) : appender.appendNull()
  // locality VARCHAR
  sale.locality !== null ? appender.appendVarchar(sale.locality) : appender.appendNull()
  // post_code VARCHAR(4)
  sale.postCode !== null ? appender.appendVarchar(sale.postCode) : appender.appendNull()
  // area DOUBLE
  sale.area !== null ? appender.appendDouble(sale.area) : appender.appendNull()
  // area_type VARCHAR(1)
  sale.areaType !== null ? appender.appendVarchar(sale.areaType) : appender.appendNull()
  // contract_date DATE
  if (sale.contractDate !== null) {
    appender.appendDate(dateValue({
      year: sale.contractDate.getUTCFullYear(),
      month: sale.contractDate.getUTCMonth() + 1,
      day: sale.contractDate.getUTCDate(),
    }))
  } else {
    appender.appendNull()
  }
  // settlement_date DATE
  if (sale.settlementDate !== null) {
    appender.appendDate(dateValue({
      year: sale.settlementDate.getUTCFullYear(),
      month: sale.settlementDate.getUTCMonth() + 1,
      day: sale.settlementDate.getUTCDate(),
    }))
  } else {
    appender.appendNull()
  }
  // purchase_price BIGINT
  sale.purchasePrice !== null ? appender.appendBigInt(BigInt(sale.purchasePrice)) : appender.appendNull()
  // zone_code VARCHAR
  sale.zoneCode !== null ? appender.appendVarchar(sale.zoneCode) : appender.appendNull()
  // nature_of_property VARCHAR(1)
  sale.natureOfProperty !== null ? appender.appendVarchar(sale.natureOfProperty) : appender.appendNull()
  // primary_purpose VARCHAR
  sale.primaryPurpose !== null ? appender.appendVarchar(sale.primaryPurpose) : appender.appendNull()
  // strata VARCHAR
  sale.strata !== null ? appender.appendVarchar(sale.strata) : appender.appendNull()
  // component_code VARCHAR
  sale.componentCode !== null ? appender.appendVarchar(sale.componentCode) : appender.appendNull()
  // sale_code VARCHAR
  sale.saleCode !== null ? appender.appendVarchar(sale.saleCode) : appender.appendNull()
  // percent_interest DOUBLE
  sale.percentInterest !== null ? appender.appendDouble(sale.percentInterest) : appender.appendNull()
  // legal_description VARCHAR
  sale.legalDescription !== null ? appender.appendVarchar(sale.legalDescription) : appender.appendNull()
  // dimensions VARCHAR
  sale.dimensions !== null ? appender.appendVarchar(sale.dimensions) : appender.appendNull()
  // valuation_num VARCHAR
  sale.valuationNum !== null ? appender.appendVarchar(sale.valuationNum) : appender.appendNull()
  // contract_date_raw VARCHAR
  sale.contractDateRaw !== null ? appender.appendVarchar(sale.contractDateRaw) : appender.appendNull()
  // settlement_date_raw VARCHAR
  sale.settlementDateRaw !== null ? appender.appendVarchar(sale.settlementDateRaw) : appender.appendNull()
  // purchase_price_raw VARCHAR
  sale.purchasePriceRaw !== null ? appender.appendVarchar(sale.purchasePriceRaw) : appender.appendNull()
  // area_raw VARCHAR
  sale.areaRaw !== null ? appender.appendVarchar(sale.areaRaw) : appender.appendNull()
  // source_file VARCHAR NOT NULL
  appender.appendVarchar(sale.sourceFile)
  // source_year INTEGER NOT NULL
  appender.appendInteger(sale.sourceYear)
  // source_week VARCHAR NOT NULL
  appender.appendVarchar(sale.sourceWeek)
  // Data quality flags — all default to FALSE at load time.
  // The data quality pipeline (runDataQuality) sets these after loading.
  appender.appendBoolean(false) // is_bulk_sale
  appender.appendBoolean(false) // is_price_outlier
  appender.appendBoolean(false) // is_likely_strata
  appender.appendBoolean(false) // is_nominal_transfer
  appender.appendBoolean(false) // is_partial_interest
  appender.appendBoolean(false) // is_multi_dealing_dup

  appender.endRow()
}

/**
 * Load dimension tables from reference data.
 */
export async function loadDimDistricts(
  conn: DuckDBConnection,
  districts: Array<{ code: string; name: string }>,
): Promise<void> {
  for (const district of districts) {
    await conn.run(
      `INSERT OR REPLACE INTO dim_district VALUES ('${district.code}', '${district.name.replace(/'/g, "''")}');`,
    )
  }
}

export async function loadDimZones(
  conn: DuckDBConnection,
  zones: Array<{ code: string; name: string; category: string }>,
): Promise<void> {
  for (const zone of zones) {
    await conn.run(
      `INSERT OR REPLACE INTO dim_zone VALUES ('${zone.code}', '${zone.name.replace(/'/g, "''")}', '${zone.category}');`,
    )
  }
}
