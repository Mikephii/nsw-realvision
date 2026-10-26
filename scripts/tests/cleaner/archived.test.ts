import { describe, it, expect } from 'vitest'
import { cleanArchivedSale } from '../../src/cleaner/archived.js'
import type { ArchivedRecordB } from '../../src/types/archived-records.js'
import type { FileMetadata } from '../../src/types/property-sale.js'

const sampleRecord: ArchivedRecordB = {
  type: 'B',
  districtCode: '077',
  source: 'SOURCE',
  valuationNum: '1287600000000',
  propertyId: '12345',
  unitNum: '1A',
  houseNum: '27',
  streetName: 'BATHURST ROAD',
  suburbName: 'KATOOMBA',
  postcode: '2780',
  contractDate: '19970815',
  purchasePrice: '250000',
  landDescription: 'LOT 1 DP 123456',
  area: '650',
  areaType: 'M',
  dimensions: '20.72 X 30.00',
  compCode: '01',
  zoneCode: 'A',
  vendorName: '',
  purchaserName: '',
}

const sampleMetadata: FileMetadata = {
  filePath: '/data/1997/archive/ARCHIVE_SALES_1997.DAT',
  year: 1997,
  week: 'archive',
  districtCode: 'ALL',
  format: 'archived',
}

describe('cleanArchivedSale', () => {
  it('maps core fields correctly', () => {
    const sale = cleanArchivedSale(sampleRecord, sampleMetadata, 0)

    expect(sale.districtCode).toBe('077')
    expect(sale.propertyId).toBe('12345')
    expect(sale.unitNumber).toBe('1A')
    expect(sale.houseNumber).toBe('27')
    expect(sale.streetName).toBe('BATHURST ROAD')
    expect(sale.locality).toBe('Katoomba')
    expect(sale.postCode).toBe('2780')
    expect(sale.purchasePrice).toBe(250000)
    expect(sale.area).toBe(650)
    expect(sale.areaType).toBe('M')
    expect(sale.legalDescription).toBe('LOT 1 DP 123456')
    expect(sale.dimensions).toBe('20.72 X 30.00')
    expect(sale.valuationNum).toBe('1287600000000')
  })

  it('parses contract date', () => {
    const sale = cleanArchivedSale(sampleRecord, sampleMetadata, 0)
    expect(sale.contractDate).toBeInstanceOf(Date)
    expect(sale.contractDate!.getUTCFullYear()).toBe(1997)
    expect(sale.contractDate!.getUTCMonth()).toBe(7) // August = 7
    expect(sale.contractDate!.getUTCDate()).toBe(15)
  })

  it('generates synthetic dealing number', () => {
    const sale0 = cleanArchivedSale(sampleRecord, sampleMetadata, 0)
    const sale1 = cleanArchivedSale(sampleRecord, sampleMetadata, 1)

    expect(sale0.dealingNumber).toBe('ARC-1997-0')
    expect(sale1.dealingNumber).toBe('ARC-1997-1')
    expect(sale0.saleCounter).toBe('0')
    expect(sale1.saleCounter).toBe('1')
  })

  it('sets unavailable fields to null', () => {
    const sale = cleanArchivedSale(sampleRecord, sampleMetadata, 0)

    expect(sale.settlementDate).toBeNull()
    expect(sale.natureOfProperty).toBeNull()
    expect(sale.primaryPurpose).toBeNull()
    expect(sale.strata).toBeNull()
    expect(sale.saleCode).toBeNull()
    expect(sale.percentInterest).toBeNull()
    expect(sale.propertyName).toBeNull()
  })

  it('sets source metadata', () => {
    const sale = cleanArchivedSale(sampleRecord, sampleMetadata, 0)

    expect(sale.sourceFile).toBe('/data/1997/archive/ARCHIVE_SALES_1997.DAT')
    expect(sale.sourceYear).toBe(1997)
    expect(sale.sourceWeek).toBe('archive')
  })

  it('handles empty fields', () => {
    const record: ArchivedRecordB = {
      ...sampleRecord,
      unitNum: '',
      dimensions: '',
      landDescription: '',
    }

    const sale = cleanArchivedSale(record, sampleMetadata, 0)
    expect(sale.unitNumber).toBeNull()
    expect(sale.dimensions).toBeNull()
    expect(sale.legalDescription).toBeNull()
  })
})
