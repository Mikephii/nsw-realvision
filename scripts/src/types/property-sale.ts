/**
 * Cleaned, normalised property sale record ready for DuckDB insertion.
 * Produced by the cleaner module from raw parsed records.
 */
export interface PropertySale {
  districtCode: string
  propertyId: string
  dealingNumber: string
  saleCounter: string
  propertyName: string | null
  unitNumber: string | null
  houseNumber: string | null
  streetName: string | null
  locality: string | null
  postCode: string | null
  area: number | null
  areaType: string | null
  contractDate: Date | null
  settlementDate: Date | null
  purchasePrice: number | null
  zoneCode: string | null
  natureOfProperty: string | null
  primaryPurpose: string | null
  strata: string | null
  componentCode: string | null
  saleCode: string | null
  percentInterest: number | null
  legalDescription: string | null
  /** Property dimensions, e.g. "20.72 X 40.23" (archived format only) */
  dimensions: string | null
  /** Old property valuation number (archived format only) */
  valuationNum: string | null
  /** Raw contract_date string preserved when parsing failed (null if parsed OK or input empty) */
  contractDateRaw: string | null
  /** Raw settlement_date string preserved when parsing failed */
  settlementDateRaw: string | null
  /** Raw purchase_price string preserved when parsing failed */
  purchasePriceRaw: string | null
  /** Raw area string preserved when parsing failed */
  areaRaw: string | null
  sourceFile: string
  sourceYear: number
  sourceWeek: string
}

/** Metadata extracted from the file path and name */
export interface FileMetadata {
  /** Absolute path to the .DAT file */
  filePath: string
  /** Year extracted from the folder structure */
  year: number
  /** Week folder name, e.g. "20250120" */
  week: string
  /** District code from filename, e.g. "001", or "ALL" for archived monolithic files */
  districtCode: string
  /** File format era: 'current' for 2001+ weekly files, 'archived' for 1990-2001 monolithic files */
  format: 'current' | 'archived'
}

/**
 * Intermediate type: a single sale with its associated C and D records grouped together.
 * Produced by the record combiner before cleaning.
 */
export interface RawSaleUnit {
  sale: import('./records.js').RecordB
  /** Concatenated legal descriptions (C records joined without spaces) */
  legalDescription: string | null
  /** Associated D records */
  owners: import('./records.js').RecordD[]
}
