import { describe, it, expect } from 'vitest'
import { detectFormatFromPath, detectFormatFromContent } from '../../src/parser/format-detector.js'

describe('detectFormatFromPath', () => {
  it('detects archived format from path', () => {
    expect(detectFormatFromPath('/data/1995/archive/ARCHIVE_SALES_1995.DAT')).toBe('archived')
    expect(detectFormatFromPath('/data/2001/archive/ARCHIVE_SALES_2001.DAT')).toBe('archived')
  })

  it('detects current format from path', () => {
    expect(detectFormatFromPath('/data/2024/20240101/001_SALES_DATA_NNME_01012024.DAT')).toBe('current')
    expect(detectFormatFromPath('/data/2001/20010719/001_SALES_DATA_NNME_19072001.DAT')).toBe('current')
  })
})

describe('detectFormatFromContent', () => {
  it('detects archived format from B record field count', () => {
    const content = [
      'A;077;19980115 09:30;SYSTEM;',
      'B;077;SOURCE;1287600000000;12345;1A;27;BATHURST ROAD;KATOOMBA;2780;19970815;250000;LOT 1;650;M;;01;A;;;',
    ].join('\n')

    expect(detectFormatFromContent(content)).toBe('archived')
  })

  it('detects current format from B record field count', () => {
    const content = [
      'A;RTSALEDATA;077;20240101 09:30;SYSTEM;',
      'B;077;12345;1;20240101 09:30;Property;2;27;Main St;Sydney;2000;100;M;20240101;20240201;500000;R1;R;Residential;N;;;V;D12345;',
    ].join('\n')

    expect(detectFormatFromContent(content)).toBe('current')
  })

  it('defaults to current when no B records found', () => {
    const content = 'A;RTSALEDATA;077;20240101 09:30;SYSTEM;\nZ;2;0;0;0;\n'
    expect(detectFormatFromContent(content)).toBe('current')
  })
})
