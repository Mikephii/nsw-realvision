/**
 * Parses a single semicolon-delimited line from an archived (1990-2001) .DAT file.
 * Returns raw strings — no cleaning or type conversion at this stage.
 *
 * Key differences from the current format parser:
 * - Record A: no fileType field (district_code is at index 1, not 2)
 * - Record B: completely different field layout (20 fields total)
 * - Record Z: only totalRecords and totalBRecords (no C/D counts)
 * - No C or D records exist in archived files
 *
 * Reference: Archived_Property_Sales_Data_File_Format_1990_to_2001_V2.pdf
 */

import type { RecordA, RecordZ } from '../types/records.js'
import type { ArchivedRecordB, ArchivedDatRecord } from '../types/archived-records.js'

/**
 * Parse a single line from an archived .DAT file into a typed record.
 *
 * @param line - A single line from the .DAT file
 * @returns A typed record (A, B, or Z)
 * @throws If the line has an unknown record type or is empty
 */
export function parseArchivedLine(line: string): ArchivedDatRecord {
  const trimmed = line.trim()
  if (!trimmed) {
    throw new Error('Empty line')
  }

  const fields = trimmed.split(';')
  const recordType = fields[0]

  switch (recordType) {
    case 'A':
      return parseArchivedRecordA(fields)
    case 'B':
      return parseArchivedRecordB(fields)
    case 'Z':
      return parseArchivedRecordZ(fields)
    default:
      throw new Error(`Unknown record type: "${recordType}"`)
  }
}

/**
 * Archived A record: A;districtCode;downloadDateTime;submittingUser;
 * (no fileType field — differs from current format)
 */
function parseArchivedRecordA(fields: string[]): RecordA {
  return {
    type: 'A',
    fileType: 'ARCHIVE',
    districtCode: fields[1] ?? '',
    downloadDateTime: fields[2] ?? '',
    submittingUser: fields[3] ?? '',
  }
}

/**
 * Archived B record: 20 fields with completely different layout from current format.
 * B;districtCode;source;valuationNum;propertyId;unitNum;houseNum;streetName;
 * suburbName;postcode;contractDate;purchasePrice;landDescription;area;areaType;
 * dimensions;compCode;zoneCode;vendorName;purchaserName;
 */
function parseArchivedRecordB(fields: string[]): ArchivedRecordB {
  return {
    type: 'B',
    districtCode: fields[1] ?? '',
    source: fields[2] ?? '',
    valuationNum: fields[3] ?? '',
    propertyId: fields[4] ?? '',
    unitNum: fields[5] ?? '',
    houseNum: fields[6] ?? '',
    streetName: fields[7] ?? '',
    suburbName: fields[8] ?? '',
    postcode: fields[9] ?? '',
    contractDate: fields[10] ?? '',
    purchasePrice: fields[11] ?? '',
    landDescription: fields[12] ?? '',
    area: fields[13] ?? '',
    areaType: fields[14] ?? '',
    dimensions: fields[15] ?? '',
    compCode: fields[16] ?? '',
    zoneCode: fields[17] ?? '',
    // Names are parsed so the record shape matches the published format, but they are
    // deliberately never stored: the loader drops them, and fact_property_sale has no name columns.
    vendorName: fields[18] ?? '',
    purchaserName: fields[19] ?? '',
  }
}

/**
 * Archived Z record: Z;totalRecords;totalBRecords;
 * (no C/D counts — only 2 numeric fields)
 */
function parseArchivedRecordZ(fields: string[]): RecordZ {
  return {
    type: 'Z',
    totalRecords: parseInt(fields[1] ?? '0', 10),
    totalBRecords: parseInt(fields[2] ?? '0', 10),
  }
}
