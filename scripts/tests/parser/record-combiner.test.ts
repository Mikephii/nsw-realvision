import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFileContent } from '../../src/parser/file-parser.js'
import { combineSaleRecords } from '../../src/parser/record-combiner.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')

describe('combineSaleRecords', () => {
  it('groups B, C, and D records into sale units', () => {
    const content = readFileSync(join(FIXTURES_DIR, 'sample-small.dat'), 'latin1')
    const parsed = parseFileContent(content)
    const units = combineSaleRecords(parsed)

    expect(units).toHaveLength(3)

    // First sale: 1 C record, 2 D records (1P + 1V)
    expect(units[0].sale.propertyId).toBe('2901108')
    expect(units[0].legalDescription).toBe('4/31/758576')
    expect(units[0].owners).toHaveLength(2)
    expect(units[0].owners[0].purchaserVendor).toBe('P')
    expect(units[0].owners[1].purchaserVendor).toBe('V')

    // Second sale: 1 C record, 2 D records
    expect(units[1].sale.propertyId).toBe('2983744')
    expect(units[1].legalDescription).toBe('2/SP70204')

    // Third sale
    expect(units[2].sale.propertyId).toBe('3464065')
    expect(units[2].legalDescription).toBe('1/1119595')
    expect(units[2].owners).toHaveLength(2)
  })

  it('concatenates multiple C records without spaces', () => {
    const content = readFileSync(join(FIXTURES_DIR, 'sample-edge-cases.dat'), 'latin1')
    const parsed = parseFileContent(content)
    const units = combineSaleRecords(parsed)

    // First sale has 2 C records that should be concatenated
    expect(units[0].legalDescription).toBe(
      '1/SP12345 LOT 1 IN STRATA PLAN 12345 LOCAL GOVERNMENT AREA WAVERLEY PAR' +
      'ISH OF ALEXANDRIA COUNTY OF CUMBERLAND TITLE PART LOT 1'
    )
  })

  it('handles sales with no C records', () => {
    const content = [
      'A;RTSALEDATA;001;20250101 00:00;VALNET;',
      'B;001;123;1;20250101 00:00;;;1;MAIN ST;SUBURB;2000;100;M;20250101;20250101;500000;R2;R;RESIDENCE;;AAA;;0;AX1;',
      'D;001;123;1;20250101 00:00;P;;;;;;',
      'Z;4;1;0;1;',
    ].join('\n')

    const parsed = parseFileContent(content)
    const units = combineSaleRecords(parsed)

    expect(units).toHaveLength(1)
    expect(units[0].legalDescription).toBeNull()
    expect(units[0].owners).toHaveLength(1)
  })

  it('handles sales with no D records', () => {
    const content = [
      'A;RTSALEDATA;001;20250101 00:00;VALNET;',
      'B;001;123;1;20250101 00:00;;;1;MAIN ST;SUBURB;2000;100;M;20250101;20250101;500000;R2;R;RESIDENCE;;AAA;;0;AX1;',
      'C;001;123;1;20250101 00:00;LOT 1/DP999;',
      'Z;4;1;1;0;',
    ].join('\n')

    const parsed = parseFileContent(content)
    const units = combineSaleRecords(parsed)

    expect(units).toHaveLength(1)
    expect(units[0].legalDescription).toBe('LOT 1/DP999')
    expect(units[0].owners).toHaveLength(0)
  })
})
