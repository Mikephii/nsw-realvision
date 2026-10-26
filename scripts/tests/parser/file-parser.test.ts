import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { parseFile, parseFileContent } from '../../src/parser/file-parser.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')

describe('parseFileContent', () => {
  it('parses sample-small.dat correctly', () => {
    const content = readFileSync(join(FIXTURES_DIR, 'sample-small.dat'), 'latin1')
    const result = parseFileContent(content, 'sample-small.dat')

    expect(result.header.type).toBe('A')
    expect(result.header.districtCode).toBe('001')
    expect(result.header.fileType).toBe('RTSALEDATA')

    expect(result.sales).toHaveLength(3)
    expect(result.descriptions).toHaveLength(3)
    expect(result.owners).toHaveLength(6)

    expect(result.trailer.totalRecords).toBe(14)
    expect(result.trailer.totalBRecords).toBe(3)
    expect(result.trailer.totalCRecords).toBe(3)
    expect(result.trailer.totalDRecords).toBe(6)
  })

  it('parses edge cases file with multiple C records', () => {
    const content = readFileSync(join(FIXTURES_DIR, 'sample-edge-cases.dat'), 'latin1')
    const result = parseFileContent(content, 'sample-edge-cases.dat')

    expect(result.sales).toHaveLength(2)
    expect(result.descriptions).toHaveLength(3) // 2 C records for first sale + 1 for second
    expect(result.owners).toHaveLength(3)

    // First sale has a property name
    expect(result.sales[0].propertyName).toBe('OCEANVIEW APARTMENTS')

    // Second sale has many empty fields
    expect(result.sales[1].propertyName).toBe('')
    expect(result.sales[1].areaSize).toBe('')
    expect(result.sales[1].settlementDate).toBe('')
  })

  it('adds warning on count mismatch instead of throwing', () => {
    const content = [
      'A;RTSALEDATA;001;20250101 00:00;VALNET;',
      'B;001;123;1;20250101 00:00;;;1;MAIN ST;SUBURB;2000;100;M;20250101;20250101;500000;R2;R;RESIDENCE;;AAA;;0;AX1;',
      'Z;5;1;0;0;', // says 5 total but only 3 (A + B + Z)
    ].join('\n')

    const result = parseFileContent(content)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].error).toContain('Record count mismatch')
    expect(result.warnings[0].error).toContain('total: expected 5, got 3')
    // Records are still returned despite mismatch
    expect(result.sales).toHaveLength(1)
  })

  it('allows skipping validation', () => {
    const content = [
      'A;RTSALEDATA;001;20250101 00:00;VALNET;',
      'B;001;123;1;20250101 00:00;;;1;MAIN ST;SUBURB;2000;100;M;20250101;20250101;500000;R2;R;RESIDENCE;;AAA;;0;AX1;',
      'Z;999;999;999;999;', // wrong counts
    ].join('\n')

    const result = parseFileContent(content, undefined, { skipValidation: true })
    expect(result.sales).toHaveLength(1)
  })

  it('throws if no header record', () => {
    const content = 'B;001;123;1;20250101 00:00;;;1;MAIN ST;SUBURB;2000;100;M;20250101;20250101;500000;R2;R;RESIDENCE;;AAA;;0;AX1;\nZ;2;1;0;0;'
    expect(() => parseFileContent(content)).toThrow('No header (A) record')
  })

  it('throws if no trailer record', () => {
    const content = 'A;RTSALEDATA;001;20250101 00:00;VALNET;\nB;001;123;1;20250101 00:00;;;1;MAIN ST;SUBURB;2000;100;M;20250101;20250101;500000;R2;R;RESIDENCE;;AAA;;0;AX1;'
    expect(() => parseFileContent(content)).toThrow('No trailer (Z) record')
  })

  it('handles empty lines in content', () => {
    const content = [
      'A;RTSALEDATA;001;20250101 00:00;VALNET;',
      '',
      'B;001;123;1;20250101 00:00;;;1;MAIN ST;SUBURB;2000;100;M;20250101;20250101;500000;R2;R;RESIDENCE;;AAA;;0;AX1;',
      '',
      'C;001;123;1;20250101 00:00;LOT 1/DP999;',
      'Z;4;1;1;0;',
      '',
    ].join('\n')

    const result = parseFileContent(content)
    expect(result.sales).toHaveLength(1)
  })
})

describe('parseFile', () => {
  it('reads and parses a .dat file from disk', async () => {
    const result = await parseFile(join(FIXTURES_DIR, 'sample-small.dat'))
    expect(result.header.districtCode).toBe('001')
    expect(result.sales).toHaveLength(3)
  })
})
