/**
 * Parses a single semicolon-delimited line from a .DAT file into a typed record.
 * Returns raw strings — no cleaning or type conversion at this stage.
 */

import type { RecordA, RecordB, RecordC, RecordD, RecordZ, DatRecord } from '../types/records.js'

/**
 * Parse a single line from a .DAT file into a typed record.
 * Lines are semicolon-delimited with a trailing delimiter.
 *
 * @param line - A single line from the .DAT file
 * @returns A typed record (A, B, C, D, or Z)
 * @throws If the line has an unknown record type or is empty
 */
export function parseLine(line: string): DatRecord {
  const trimmed = line.trim()
  if (!trimmed) {
    throw new Error('Empty line')
  }

  // Split on semicolons. Trailing delimiter means last element is empty string.
  const fields = trimmed.split(';')

  const recordType = fields[0]

  switch (recordType) {
    case 'A':
      return parseRecordA(fields)
    case 'B':
      return parseRecordB(fields)
    case 'C':
      return parseRecordC(fields)
    case 'D':
      return parseRecordD(fields)
    case 'Z':
      return parseRecordZ(fields)
    default:
      throw new Error(`Unknown record type: "${recordType}"`)
  }
}

function parseRecordA(fields: string[]): RecordA {
  return {
    type: 'A',
    fileType: fields[1] ?? '',
    districtCode: fields[2] ?? '',
    downloadDateTime: fields[3] ?? '',
    submittingUser: fields[4] ?? '',
  }
}

function parseRecordB(fields: string[]): RecordB {
  return {
    type: 'B',
    districtCode: fields[1] ?? '',
    propertyId: fields[2] ?? '',
    saleCounter: fields[3] ?? '',
    downloadDateTime: fields[4] ?? '',
    propertyName: fields[5] ?? '',
    propertyUnitNumber: fields[6] ?? '',
    propertyHouseNumber: fields[7] ?? '',
    propertyStreetName: fields[8] ?? '',
    propertyLocality: fields[9] ?? '',
    propertyPostCode: fields[10] ?? '',
    areaSize: fields[11] ?? '',
    areaType: fields[12] ?? '',
    contractDate: fields[13] ?? '',
    settlementDate: fields[14] ?? '',
    purchasePrice: fields[15] ?? '',
    zoneCode: fields[16] ?? '',
    natureOfProperty: fields[17] ?? '',
    primaryPurpose: fields[18] ?? '',
    strata: fields[19] ?? '',
    componentCode: fields[20] ?? '',
    saleCode: fields[21] ?? '',
    percentInterest: fields[22] ?? '',
    dealingNumber: fields[23] ?? '',
  }
}

function parseRecordC(fields: string[]): RecordC {
  return {
    type: 'C',
    districtCode: fields[1] ?? '',
    propertyId: fields[2] ?? '',
    saleCounter: fields[3] ?? '',
    downloadDateTime: fields[4] ?? '',
    legalDescription: fields[5] ?? '',
  }
}

function parseRecordD(fields: string[]): RecordD {
  // D records have extra empty fields after purchaserVendor (suppressed personal data).
  // We only extract the defined fields per the spec.
  return {
    type: 'D',
    districtCode: fields[1] ?? '',
    propertyId: fields[2] ?? '',
    saleCounter: fields[3] ?? '',
    downloadDateTime: fields[4] ?? '',
    purchaserVendor: fields[5] ?? '',
  }
}

function parseRecordZ(fields: string[]): RecordZ {
  return {
    type: 'Z',
    totalRecords: parseInt(fields[1] ?? '0', 10),
    totalBRecords: parseInt(fields[2] ?? '0', 10),
    totalCRecords: parseInt(fields[3] ?? '0', 10),
    totalDRecords: parseInt(fields[4] ?? '0', 10),
  }
}
