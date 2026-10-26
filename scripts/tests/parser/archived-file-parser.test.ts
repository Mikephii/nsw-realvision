import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { parseArchivedFile, parseArchivedFileContent } from '../../src/parser/archived-file-parser.js'

const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/sample-archived.dat')

describe('parseArchivedFileContent', () => {
  it('parses a complete archived file from content', () => {
    const content = [
      'A;077;19980115 09:30;SYSTEM;',
      'B;077;SOURCE;1287600000000;12345;1A;27;BATHURST ROAD;KATOOMBA;2780;19970815;250000;LOT 1 DP 123456;650;M;20.72 X 30.00;01;A;;;',
      'B;077;SOURCE;1287600000001;12346;;15;MAIN STREET;LEURA;2780;19971020;185000;LOT 2;450.5;M;;02;A;;;',
      'Z;4;2;',
    ].join('\n')

    const result = parseArchivedFileContent(content)

    expect(result.header.type).toBe('A')
    expect(result.header.districtCode).toBe('077')
    expect(result.header.fileType).toBe('ARCHIVE')
    expect(result.sales).toHaveLength(2)
    expect(result.sales[0].suburbName).toBe('KATOOMBA')
    expect(result.sales[1].suburbName).toBe('LEURA')
    expect(result.trailer.totalRecords).toBe(4)
    expect(result.trailer.totalBRecords).toBe(2)
  })

  it('adds warning on count mismatch instead of throwing', () => {
    const content = [
      'A;077;19980115 09:30;SYSTEM;',
      'B;077;SOURCE;1287600000000;12345;1A;27;BATHURST ROAD;KATOOMBA;2780;19970815;250000;LOT 1;650;M;;01;A;;;',
      'Z;10;5;', // Wrong counts
    ].join('\n')

    const result = parseArchivedFileContent(content)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].error).toContain('Record count mismatch')
    // Records are still returned despite mismatch
    expect(result.sales).toHaveLength(1)
  })

  it('skips validation when requested', () => {
    const content = [
      'A;077;19980115 09:30;SYSTEM;',
      'B;077;SOURCE;1287600000000;12345;1A;27;BATHURST ROAD;KATOOMBA;2780;19970815;250000;LOT 1;650;M;;01;A;;;',
      'Z;99;99;', // Wrong counts
    ].join('\n')

    const result = parseArchivedFileContent(content, undefined, { skipValidation: true })
    expect(result.sales).toHaveLength(1)
  })

  it('throws if no header record', () => {
    const content = [
      'B;077;SOURCE;1287600000000;12345;1A;27;BATHURST ROAD;KATOOMBA;2780;19970815;250000;LOT 1;650;M;;01;A;;;',
      'Z;3;1;',
    ].join('\n')

    expect(() => parseArchivedFileContent(content)).toThrow('No header')
  })

  it('throws if no trailer record', () => {
    const content = [
      'A;077;19980115 09:30;SYSTEM;',
      'B;077;SOURCE;1287600000000;12345;1A;27;BATHURST ROAD;KATOOMBA;2780;19970815;250000;LOT 1;650;M;;01;A;;;',
    ].join('\n')

    expect(() => parseArchivedFileContent(content)).toThrow('No trailer')
  })
})

describe('parseArchivedFile', () => {
  it('parses a file from disk', async () => {
    const result = await parseArchivedFile(FIXTURE_PATH)

    expect(result.header.districtCode).toBe('077')
    expect(result.sales).toHaveLength(3)
    expect(result.trailer.totalRecords).toBe(5)
    expect(result.trailer.totalBRecords).toBe(3)
  })
})
