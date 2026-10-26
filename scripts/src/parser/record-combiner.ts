/**
 * Groups B, C, and D records into sale units keyed by (districtCode, propertyId, saleCounter).
 * Concatenates multiple C records' legal descriptions without spaces.
 */

import type { ParsedFile, RecordC, RecordD } from '../types/records.js'
import type { RawSaleUnit } from '../types/property-sale.js'

/** Build a grouping key for matching B/C/D records belonging to the same sale */
function saleKey(districtCode: string, propertyId: string, saleCounter: string): string {
  return `${districtCode}|${propertyId}|${saleCounter}`
}

/**
 * Combine parsed file records into sale units.
 * Each sale unit has one B record, concatenated C record descriptions, and associated D records.
 *
 * @param parsed - Output from parseFile/parseFileContent
 * @returns Array of RawSaleUnit, one per sale (B record)
 */
export function combineSaleRecords(parsed: ParsedFile): RawSaleUnit[] {
  // Group C records by sale key
  const cByKey = new Map<string, RecordC[]>()
  for (const c of parsed.descriptions) {
    const key = saleKey(c.districtCode, c.propertyId, c.saleCounter)
    const existing = cByKey.get(key)
    if (existing) {
      existing.push(c)
    } else {
      cByKey.set(key, [c])
    }
  }

  // Group D records by sale key
  const dByKey = new Map<string, RecordD[]>()
  for (const d of parsed.owners) {
    const key = saleKey(d.districtCode, d.propertyId, d.saleCounter)
    const existing = dByKey.get(key)
    if (existing) {
      existing.push(d)
    } else {
      dByKey.set(key, [d])
    }
  }

  // Build sale units from B records
  return parsed.sales.map(sale => {
    const key = saleKey(sale.districtCode, sale.propertyId, sale.saleCounter)

    // Concatenate C record descriptions without spaces (per spec)
    const cRecords = cByKey.get(key) ?? []
    const legalDescription = cRecords.length > 0
      ? cRecords.map(c => c.legalDescription).join('')
      : null

    const owners = dByKey.get(key) ?? []

    return { sale, legalDescription, owners }
  })
}
