import { describe, it, expect } from 'vitest'
import { cleanSaleUnit } from '../../src/cleaner/index.js'
import type { RawSaleUnit, FileMetadata } from '../../src/types/property-sale.js'
import type { RecordB } from '../../src/types/records.js'

/** Build a minimal RecordB with sensible defaults */
function makeRecordB(overrides: Partial<RecordB> = {}): RecordB {
  return {
    type: 'B',
    districtCode: '001',
    propertyId: '12345',
    saleCounter: '1',
    downloadDateTime: '20250101 00:00',
    propertyName: '',
    propertyUnitNumber: '',
    propertyHouseNumber: '42',
    propertyStreetName: 'MAIN STREET',
    propertyLocality: 'CESSNOCK',
    propertyPostCode: '2325',
    areaSize: '650.000',
    areaType: 'M',
    contractDate: '20240315',
    settlementDate: '20240415',
    purchasePrice: '750000',
    zoneCode: 'R2',
    natureOfProperty: 'R',
    primaryPurpose: '',
    strata: '',
    componentCode: '',
    saleCode: '',
    percentInterest: '',
    dealingNumber: 'AB12345',
    ...overrides,
  }
}

const DEFAULT_METADATA: FileMetadata = {
  filePath: '/data/2024/20240101/001_SALES.DAT',
  year: 2024,
  week: '20240101',
  districtCode: '001',
  format: 'current',
}

function makeUnit(overrides: Partial<RecordB> = {}, legal?: string | null): RawSaleUnit {
  return {
    sale: makeRecordB(overrides),
    legalDescription: legal ?? 'LOT 1 DP 123456',
    owners: [],
  }
}

describe('cleanSaleUnit', () => {
  it('produces a valid PropertySale from a standard record', () => {
    const result = cleanSaleUnit(makeUnit(), DEFAULT_METADATA)

    expect(result.districtCode).toBe('001')
    expect(result.propertyId).toBe('12345')
    expect(result.dealingNumber).toBe('AB12345')
    expect(result.houseNumber).toBe('42')
    expect(result.streetName).toBe('MAIN STREET')
    expect(result.locality).toBe('Cessnock') // normalised to title case
    expect(result.postCode).toBe('2325')
    expect(result.area).toBe(650)
    expect(result.areaType).toBe('M')
    expect(result.purchasePrice).toBe(750000)
    expect(result.zoneCode).toBe('R2')
    expect(result.natureOfProperty).toBe('R')
    expect(result.legalDescription).toBe('LOT 1 DP 123456')
    expect(result.sourceFile).toBe('/data/2024/20240101/001_SALES.DAT')
    expect(result.sourceYear).toBe(2024)
    expect(result.sourceWeek).toBe('20240101')
  })

  it('parses contract date correctly', () => {
    const result = cleanSaleUnit(makeUnit({ contractDate: '20240315' }), DEFAULT_METADATA)
    expect(result.contractDate).toBeInstanceOf(Date)
    expect(result.contractDate!.getUTCFullYear()).toBe(2024)
    expect(result.contractDate!.getUTCMonth()).toBe(2) // March = 2
    expect(result.contractDate!.getUTCDate()).toBe(15)
    expect(result.contractDateRaw).toBeNull() // parsed OK → no raw
  })

  it('preserves raw contract date when parsing fails', () => {
    const result = cleanSaleUnit(makeUnit({ contractDate: 'BADDATE' }), DEFAULT_METADATA)
    expect(result.contractDate).toBeNull()
    expect(result.contractDateRaw).toBe('BADDATE')
  })

  it('sets contractDateRaw to null when input is empty', () => {
    const result = cleanSaleUnit(makeUnit({ contractDate: '' }), DEFAULT_METADATA)
    expect(result.contractDate).toBeNull()
    expect(result.contractDateRaw).toBeNull() // empty → no raw
  })

  it('preserves raw price when parsing fails', () => {
    const result = cleanSaleUnit(makeUnit({ purchasePrice: 'NOT_A_NUMBER' }), DEFAULT_METADATA)
    expect(result.purchasePrice).toBeNull()
    expect(result.purchasePriceRaw).toBe('NOT_A_NUMBER')
  })

  it('does not store raw price when parsing succeeds', () => {
    const result = cleanSaleUnit(makeUnit({ purchasePrice: '1200000' }), DEFAULT_METADATA)
    expect(result.purchasePrice).toBe(1200000)
    expect(result.purchasePriceRaw).toBeNull()
  })

  it('preserves raw area when parsing fails', () => {
    const result = cleanSaleUnit(makeUnit({ areaSize: 'big' }), DEFAULT_METADATA)
    expect(result.area).toBeNull()
    expect(result.areaRaw).toBe('big')
  })

  it('normalises locality to title case', () => {
    const result = cleanSaleUnit(makeUnit({ propertyLocality: 'BONDI JUNCTION' }), DEFAULT_METADATA)
    expect(result.locality).toBe('Bondi Junction')
  })

  it('returns null locality for empty string', () => {
    const result = cleanSaleUnit(makeUnit({ propertyLocality: '' }), DEFAULT_METADATA)
    expect(result.locality).toBeNull()
  })

  it('converts empty optional fields to null', () => {
    const result = cleanSaleUnit(makeUnit({
      propertyName: '',
      propertyUnitNumber: '',
      primaryPurpose: '',
      strata: '',
      componentCode: '',
      saleCode: '',
    }), DEFAULT_METADATA)

    expect(result.propertyName).toBeNull()
    expect(result.unitNumber).toBeNull()
    expect(result.primaryPurpose).toBeNull()
    expect(result.strata).toBeNull()
    expect(result.componentCode).toBeNull()
    expect(result.saleCode).toBeNull()
  })

  it('preserves non-empty optional fields', () => {
    const result = cleanSaleUnit(makeUnit({
      propertyName: 'OCEAN VIEW',
      propertyUnitNumber: '5A',
      strata: '12345',
    }), DEFAULT_METADATA)

    expect(result.propertyName).toBe('OCEAN VIEW')
    expect(result.unitNumber).toBe('5A')
    expect(result.strata).toBe('12345')
  })

  it('handles null legal description', () => {
    const unit: RawSaleUnit = { sale: makeRecordB(), legalDescription: null, owners: [] }
    const result = cleanSaleUnit(unit, DEFAULT_METADATA)
    expect(result.legalDescription).toBeNull()
  })

  it('cleans zone code by trimming', () => {
    const result = cleanSaleUnit(makeUnit({ zoneCode: ' R2 ' }), DEFAULT_METADATA)
    expect(result.zoneCode).toBe('R2')
  })

  it('preserves unknown zone codes as-is', () => {
    const result = cleanSaleUnit(makeUnit({ zoneCode: 'XYZ' }), DEFAULT_METADATA)
    expect(result.zoneCode).toBe('XYZ')
  })

  it('returns null zone code for empty string', () => {
    const result = cleanSaleUnit(makeUnit({ zoneCode: '' }), DEFAULT_METADATA)
    expect(result.zoneCode).toBeNull()
  })
})
