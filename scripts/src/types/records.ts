/**
 * Raw parsed record types from NSW Valuer General .DAT files.
 * All fields are raw strings — cleaning/conversion happens in the cleaner module.
 *
 * File format: semicolon-delimited flat ASCII with trailing delimiter.
 * Reference: Current_Property_Sales_Data_File_Format_2001_to_Current.pdf
 */

/** Record A — Header record (first record in file) */
export interface RecordA {
  type: 'A'
  /** Always "RTSALEDATA" */
  fileType: string
  /** 3-digit district/LGA code, e.g. "001" */
  districtCode: string
  /** File creation timestamp, format: CCYYMMDD HH24:MI */
  downloadDateTime: string
  /** Submitter username (optional) */
  submittingUser: string
}

/** Record B — Property sale record */
export interface RecordB {
  type: 'B'
  /** 3-digit district/LGA code */
  districtCode: string
  /** Unique property identifier (up to 10 chars) */
  propertyId: string
  /** Unique within file (up to 7 chars) */
  saleCounter: string
  /** File creation timestamp, format: CCYYMMDD HH24:MI */
  downloadDateTime: string
  /** Property name (up to 40 chars) */
  propertyName: string
  /** Concatenation of unit number and suffix, e.g. "2 A" (up to 10 chars) */
  propertyUnitNumber: string
  /** Concatenation of prefix + number + suffix, e.g. "A125B" (up to 10 chars) */
  propertyHouseNumber: string
  /** Concatenated street name, type, suffix, location descriptor (up to 38 chars) */
  propertyStreetName: string
  /** Suburb name (up to 40 chars) */
  propertyLocality: string
  /** 4-digit postcode */
  propertyPostCode: string
  /** Area size, format: 7777777.333 */
  areaSize: string
  /** "M" = square metres, "H" = hectares */
  areaType: string
  /** Contract date, format: CCYYMMDD */
  contractDate: string
  /** Settlement date, format: CCYYMMDD */
  settlementDate: string
  /** Purchase price (up to 12 digits) */
  purchasePrice: string
  /** Zone code (up to 4 chars) — pre-2011 single-char or post-2011 LEP code */
  zoneCode: string
  /** "V" = Vacant, "R" = Residence, "3" = Other */
  natureOfProperty: string
  /** Description when nature = "3" (up to 20 chars) */
  primaryPurpose: string
  /** Strata lot number (up to 5 chars) */
  strata: string
  /** Component code (up to 3 chars) */
  componentCode: string
  /** Sale code (up to 3 chars) */
  saleCode: string
  /** Null/empty if 100% (up to 3 chars) */
  percentInterest: string
  /** Unique dealing/transaction identifier (up to 10 chars) */
  dealingNumber: string
}

/** Record C — Legal description (may be multiple per property sale) */
export interface RecordC {
  type: 'C'
  districtCode: string
  propertyId: string
  saleCounter: string
  downloadDateTime: string
  /** Legal description fragment, cut at 70 chars. Multiple C records join without spaces. */
  legalDescription: string
}

/** Record D — Owner record (personal details suppressed in current data) */
export interface RecordD {
  type: 'D'
  districtCode: string
  propertyId: string
  saleCounter: string
  downloadDateTime: string
  /** "P" = Purchaser, "V" = Vendor */
  purchaserVendor: string
}

/** Record Z — Trailer record (last record in file, used for validation) */
export interface RecordZ {
  type: 'Z'
  /** Total records in file including A and Z records */
  totalRecords: number
  /** Total B (sale) records */
  totalBRecords: number
  /** Total C (legal description) records (undefined in archived 1990-2001 format) */
  totalCRecords?: number
  /** Total D (owner) records (undefined in archived 1990-2001 format) */
  totalDRecords?: number
}

/** Union of all record types */
export type DatRecord = RecordA | RecordB | RecordC | RecordD | RecordZ

/** Warning generated during parsing (skipped line or count mismatch) */
export interface ParseWarning {
  /** Line number (1-based), or 0 for file-level warnings */
  line: number
  /** Raw line content (empty for file-level warnings) */
  raw: string
  /** Description of the issue */
  error: string
}

/** Result of parsing an entire .DAT file */
export interface ParsedFile {
  header: RecordA
  sales: RecordB[]
  descriptions: RecordC[]
  owners: RecordD[]
  trailer: RecordZ
  /** Lines that failed to parse and validation mismatches */
  warnings: ParseWarning[]
}
