/**
 * Raw parsed record types for archived (1990-2001) .DAT files.
 * All fields are raw strings — cleaning/conversion happens in the cleaner module.
 *
 * Key differences from current (2001+) format:
 * - Record A has no fileType field (field order shifted)
 * - Record B has completely different fields (no C/D records exist)
 * - Record Z only has totalRecords and totalBRecords (no C/D counts)
 *
 * Reference: Archived_Property_Sales_Data_File_Format_1990_to_2001_V2.pdf
 */

import type { RecordA, RecordZ, ParseWarning } from './records.js'

/** Record B — Archived property sale record (1990-2001 format) */
export interface ArchivedRecordB {
  type: 'B'
  /** 3-digit district/LGA code */
  districtCode: string
  /** Internal use only (up to 8 chars) */
  source: string
  /** Old property valuation number, e.g. "1287600000000" (up to 16 chars) */
  valuationNum: string
  /** Unique numeric property identifier (up to 10 chars) */
  propertyId: string
  /** Full unit number, e.g. "1A" (up to 6 chars) */
  unitNum: string
  /** Full house number, e.g. "27A", "1-5" (up to 14 chars) */
  houseNum: string
  /** Full street name, e.g. "BATHURST" (up to 30 chars) */
  streetName: string
  /** Suburb name (up to 40 chars) */
  suburbName: string
  /** Postcode (up to 9 chars) */
  postcode: string
  /** Contract date, format: CCYYMMDD (up to 10 chars) */
  contractDate: string
  /** Purchase price (up to 12 digits) */
  purchasePrice: string
  /** Lot/Section/Plan description, e.g. "SEC B LOT 23 DP4748" (up to 1000 chars) */
  landDescription: string
  /** Area measurement, e.g. "1300", "125.30" (up to 10 chars) */
  area: string
  /** "M" = square metres, "H" = hectares (1 char) */
  areaType: string
  /** Property dimensions, e.g. "20.72 X 40.23" (up to 40 chars) */
  dimensions: string
  /** Internal use only (up to 2 chars) */
  compCode: string
  /** Zone code, e.g. "A", "R" (up to 4 chars) */
  zoneCode: string
  /** Removed for privacy (up to 4 chars) */
  vendorName: string
  /** Removed for privacy (up to 40 chars) */
  purchaserName: string
}

/** Union of record types in an archived file */
export type ArchivedDatRecord = RecordA | ArchivedRecordB | RecordZ

/** Result of parsing an archived .DAT file */
export interface ArchivedParsedFile {
  header: RecordA
  sales: ArchivedRecordB[]
  trailer: RecordZ
  /** Lines that failed to parse and validation mismatches */
  warnings: ParseWarning[]
}
