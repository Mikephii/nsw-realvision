/**
 * Main cleaner module — transforms a RawSaleUnit into a clean PropertySale.
 */

import type { RawSaleUnit, PropertySale, FileMetadata } from '../types/property-sale.js'
import { parseCCYYMMDD } from './dates.js'
import { parsePrice, parseArea, parsePercentInterest } from './price.js'
import { normaliseLocality, emptyToNull } from './locality.js'
import { cleanZoneCode } from './zones.js'

/**
 * Clean a raw sale unit into a PropertySale ready for DuckDB insertion.
 *
 * @param raw - Combined raw records from the parser
 * @param metadata - File metadata (path, year, week, district code)
 * @returns Cleaned PropertySale
 */
export function cleanSaleUnit(raw: RawSaleUnit, metadata: FileMetadata): PropertySale {
  const { sale } = raw

  const contractDate = parseCCYYMMDD(sale.contractDate)
  const settlementDate = parseCCYYMMDD(sale.settlementDate)
  const purchasePrice = parsePrice(sale.purchasePrice)
  const area = parseArea(sale.areaSize)

  return {
    districtCode: sale.districtCode,
    propertyId: sale.propertyId,
    dealingNumber: sale.dealingNumber,
    saleCounter: sale.saleCounter,
    propertyName: emptyToNull(sale.propertyName),
    unitNumber: emptyToNull(sale.propertyUnitNumber),
    houseNumber: emptyToNull(sale.propertyHouseNumber),
    streetName: emptyToNull(sale.propertyStreetName),
    locality: normaliseLocality(sale.propertyLocality),
    postCode: emptyToNull(sale.propertyPostCode),
    area,
    areaType: emptyToNull(sale.areaType) as PropertySale['areaType'],
    contractDate,
    settlementDate,
    purchasePrice,
    zoneCode: cleanZoneCode(sale.zoneCode),
    natureOfProperty: emptyToNull(sale.natureOfProperty),
    primaryPurpose: emptyToNull(sale.primaryPurpose),
    strata: emptyToNull(sale.strata),
    componentCode: emptyToNull(sale.componentCode),
    saleCode: emptyToNull(sale.saleCode),
    percentInterest: parsePercentInterest(sale.percentInterest),
    legalDescription: raw.legalDescription,
    dimensions: null,
    valuationNum: null,
    // Preserve raw values when parsing failed on non-empty input
    contractDateRaw: contractDate === null ? emptyToNull(sale.contractDate) : null,
    settlementDateRaw: settlementDate === null ? emptyToNull(sale.settlementDate) : null,
    purchasePriceRaw: purchasePrice === null ? emptyToNull(sale.purchasePrice) : null,
    areaRaw: area === null ? emptyToNull(sale.areaSize) : null,
    sourceFile: metadata.filePath,
    sourceYear: metadata.year,
    sourceWeek: metadata.week,
  }
}
