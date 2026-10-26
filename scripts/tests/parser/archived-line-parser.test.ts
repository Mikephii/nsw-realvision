import { describe, it, expect } from 'vitest'
import { parseArchivedLine } from '../../src/parser/archived-line-parser.js'

describe('parseArchivedLine', () => {
  it('parses a Record A line (archived format — no fileType field)', () => {
    const result = parseArchivedLine('A;077;19980115 09:30;SYSTEM;')

    expect(result).toEqual({
      type: 'A',
      fileType: 'ARCHIVE',
      districtCode: '077',
      downloadDateTime: '19980115 09:30',
      submittingUser: 'SYSTEM',
    })
  })

  it('parses a Record B line with all fields', () => {
    const result = parseArchivedLine(
      'B;077;SOURCE;1287600000000;12345;1A;27;BATHURST ROAD;KATOOMBA;2780;19970815;250000;LOT 1 DP 123456;650;M;20.72 X 30.00;01;A;;;',
    )

    expect(result.type).toBe('B')
    if (result.type !== 'B') return

    expect(result.districtCode).toBe('077')
    expect(result.source).toBe('SOURCE')
    expect(result.valuationNum).toBe('1287600000000')
    expect(result.propertyId).toBe('12345')
    expect(result.unitNum).toBe('1A')
    expect(result.houseNum).toBe('27')
    expect(result.streetName).toBe('BATHURST ROAD')
    expect(result.suburbName).toBe('KATOOMBA')
    expect(result.postcode).toBe('2780')
    expect(result.contractDate).toBe('19970815')
    expect(result.purchasePrice).toBe('250000')
    expect(result.landDescription).toBe('LOT 1 DP 123456')
    expect(result.area).toBe('650')
    expect(result.areaType).toBe('M')
    expect(result.dimensions).toBe('20.72 X 30.00')
    expect(result.compCode).toBe('01')
    expect(result.zoneCode).toBe('A')
    expect(result.vendorName).toBe('')
    expect(result.purchaserName).toBe('')
  })

  it('parses a Record B line with empty fields', () => {
    const result = parseArchivedLine('B;077;SOURCE;1287600000001;12346;;15;MAIN STREET;LEURA;2780;19971020;185000;LOT 2 SEC A DP 789012;450.5;M;;02;A;;;')

    expect(result.type).toBe('B')
    if (result.type !== 'B') return

    expect(result.unitNum).toBe('')
    expect(result.dimensions).toBe('')
  })

  it('parses a Record Z line (archived — only total and B counts)', () => {
    const result = parseArchivedLine('Z;5;3;')

    expect(result).toEqual({
      type: 'Z',
      totalRecords: 5,
      totalBRecords: 3,
    })
  })

  it('throws on empty line', () => {
    expect(() => parseArchivedLine('')).toThrow('Empty line')
  })

  it('throws on unknown record type', () => {
    expect(() => parseArchivedLine('X;data;')).toThrow('Unknown record type: "X"')
  })

  it('throws on C record type (not in archived format)', () => {
    expect(() => parseArchivedLine('C;077;12345;1;20010719 09:30;LOT 1;')).toThrow('Unknown record type')
  })
})
