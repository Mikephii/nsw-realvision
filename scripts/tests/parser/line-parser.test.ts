import { describe, it, expect } from 'vitest'
import { parseLine } from '../../src/parser/line-parser.js'

describe('parseLine', () => {
  describe('Record A', () => {
    it('parses a header record', () => {
      const result = parseLine('A;RTSALEDATA;001;20250120 01:06;VALNET;')
      expect(result).toEqual({
        type: 'A',
        fileType: 'RTSALEDATA',
        districtCode: '001',
        downloadDateTime: '20250120 01:06',
        submittingUser: 'VALNET',
      })
    })
  })

  describe('Record B', () => {
    it('parses a sale record with all fields', () => {
      const line = 'B;001;2901108;1;20250120 01:06;;;66;ABERDARE ST;KITCHENER;2325;1012;M;20241022;20250110;850000;RU5;R;RESIDENCE;;RAB;;0;AU739170;'
      const result = parseLine(line)
      expect(result.type).toBe('B')
      if (result.type !== 'B') return
      expect(result.districtCode).toBe('001')
      expect(result.propertyId).toBe('2901108')
      expect(result.saleCounter).toBe('1')
      expect(result.propertyName).toBe('')
      expect(result.propertyUnitNumber).toBe('')
      expect(result.propertyHouseNumber).toBe('66')
      expect(result.propertyStreetName).toBe('ABERDARE ST')
      expect(result.propertyLocality).toBe('KITCHENER')
      expect(result.propertyPostCode).toBe('2325')
      expect(result.areaSize).toBe('1012')
      expect(result.areaType).toBe('M')
      expect(result.contractDate).toBe('20241022')
      expect(result.settlementDate).toBe('20250110')
      expect(result.purchasePrice).toBe('850000')
      expect(result.zoneCode).toBe('RU5')
      expect(result.natureOfProperty).toBe('R')
      expect(result.primaryPurpose).toBe('RESIDENCE')
      expect(result.strata).toBe('')
      expect(result.componentCode).toBe('RAB')
      expect(result.saleCode).toBe('')
      expect(result.percentInterest).toBe('0')
      expect(result.dealingNumber).toBe('AU739170')
    })

    it('parses a sale record with many empty fields', () => {
      const line = 'B;077;9999999;2;20240301 10:30;;;;MAIN ST;NOWHERE;2000;;;20240101;;0;;V;;;;;;;AX999999;'
      const result = parseLine(line)
      if (result.type !== 'B') return
      expect(result.propertyName).toBe('')
      expect(result.propertyUnitNumber).toBe('')
      expect(result.propertyHouseNumber).toBe('')
      expect(result.areaSize).toBe('')
      expect(result.areaType).toBe('')
      expect(result.settlementDate).toBe('')
      expect(result.purchasePrice).toBe('0')
      expect(result.zoneCode).toBe('')
      expect(result.natureOfProperty).toBe('V')
    })

    it('parses a sale with unit number and strata', () => {
      const line = 'B;077;1234567;1;20240301 10:30;OCEANVIEW APARTMENTS;5;100;BEACH RD;BONDI;2026;250;M;20240215;20240301;2500000;R3;R;RESIDENCE;5;AAA;;0;AX123456;'
      const result = parseLine(line)
      if (result.type !== 'B') return
      expect(result.propertyName).toBe('OCEANVIEW APARTMENTS')
      expect(result.propertyUnitNumber).toBe('5')
      expect(result.strata).toBe('5')
      expect(result.purchasePrice).toBe('2500000')
    })
  })

  describe('Record C', () => {
    it('parses a legal description record', () => {
      const result = parseLine('C;001;2901108;1;20250120 01:06;4/31/758576;')
      expect(result).toEqual({
        type: 'C',
        districtCode: '001',
        propertyId: '2901108',
        saleCounter: '1',
        downloadDateTime: '20250120 01:06',
        legalDescription: '4/31/758576',
      })
    })
  })

  describe('Record D', () => {
    it('parses an owner record with suppressed data', () => {
      const result = parseLine('D;001;2901108;1;20250120 01:06;P;;;;;;')
      expect(result).toEqual({
        type: 'D',
        districtCode: '001',
        propertyId: '2901108',
        saleCounter: '1',
        downloadDateTime: '20250120 01:06',
        purchaserVendor: 'P',
      })
    })

    it('parses vendor records', () => {
      const result = parseLine('D;001;2901108;1;20250120 01:06;V;;;;;;')
      if (result.type !== 'D') return
      expect(result.purchaserVendor).toBe('V')
    })
  })

  describe('Record Z', () => {
    it('parses a trailer record', () => {
      const result = parseLine('Z;212;41;41;128;')
      expect(result).toEqual({
        type: 'Z',
        totalRecords: 212,
        totalBRecords: 41,
        totalCRecords: 41,
        totalDRecords: 128,
      })
    })
  })

  describe('error handling', () => {
    it('throws on empty line', () => {
      expect(() => parseLine('')).toThrow('Empty line')
    })

    it('throws on whitespace-only line', () => {
      expect(() => parseLine('   ')).toThrow('Empty line')
    })

    it('throws on unknown record type', () => {
      expect(() => parseLine('X;unknown;data;')).toThrow('Unknown record type: "X"')
    })
  })
})
