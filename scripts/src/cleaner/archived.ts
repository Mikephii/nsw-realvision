/**
 * Cleaner for archived (1990-2001) format records.
 * Maps ArchivedRecordB → PropertySale, setting unavailable fields to null.
 *
 * Reuses existing cleaner utilities for dates, prices, localities, and zones.
 */

import type { ArchivedRecordB } from '../types/archived-records.js'
import type { PropertySale, FileMetadata } from '../types/property-sale.js'
import { parseCCYYMMDD } from './dates.js'
import { parsePrice, parseArea } from './price.js'
import { normaliseLocality, emptyToNull } from './locality.js'
import { cleanZoneCode } from './zones.js'

/**
 * Clean an archived B record into a PropertySale ready for DuckDB insertion.
 *
 * @param record - Raw archived B record from the parser
 * @param metadata - File metadata (path, year, week, district code)
 * @param index - Sequential index of this record in the file (used for synthetic keys)
 * @returns Cleaned PropertySale
 */
export function cleanArchivedSale(
  record: ArchivedRecordB,
  metadata: FileMetadata,
  index: number,
): PropertySale {
  const contractDate = parseCCYYMMDD(record.contractDate)
  const purchasePrice = parsePrice(record.purchasePrice)
  const area = parseArea(record.area)

  return {
    districtCode: record.districtCode,
    propertyId: record.propertyId,
    dealingNumber: `ARC-${metadata.year}-${index}`,
    saleCounter: String(index),
    propertyName: null,
    unitNumber: emptyToNull(record.unitNum),
    houseNumber: emptyToNull(record.houseNum),
    streetName: emptyToNull(record.streetName),
    locality: normaliseLocality(record.suburbName),
    postCode: emptyToNull(record.postcode),
    area,
    areaType: emptyToNull(record.areaType),
    contractDate,
    settlementDate: null,
    purchasePrice,
    zoneCode: cleanZoneCode(record.zoneCode),
    natureOfProperty: null,
    primaryPurpose: null,
    strata: null,
    componentCode: emptyToNull(record.compCode),
    saleCode: null,
    percentInterest: null,
    legalDescription: emptyToNull(record.landDescription),
    dimensions: emptyToNull(record.dimensions),
    valuationNum: emptyToNull(record.valuationNum),
    // Preserve raw values when parsing failed on non-empty input
    contractDateRaw: contractDate === null ? emptyToNull(record.contractDate) : null,
    settlementDateRaw: null, // archived format has no settlement date
    purchasePriceRaw: purchasePrice === null ? emptyToNull(record.purchasePrice) : null,
    areaRaw: area === null ? emptyToNull(record.area) : null,
    sourceFile: metadata.filePath,
    sourceYear: metadata.year,
    sourceWeek: metadata.week,
  }
}
