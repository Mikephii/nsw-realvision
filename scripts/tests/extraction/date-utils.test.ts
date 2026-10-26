import { describe, it, expect } from 'vitest'
import { yearFromArchiveFilename, dateFromDatFilename } from '../../src/extraction/date-utils.js'

describe('yearFromArchiveFilename', () => {
  it('extracts year from ARCHIVE_SALES_YYYY.DAT', () => {
    expect(yearFromArchiveFilename('ARCHIVE_SALES_1995.DAT')).toBe(1995)
    expect(yearFromArchiveFilename('ARCHIVE_SALES_2001.DAT')).toBe(2001)
  })

  it('returns null for non-archive filenames', () => {
    expect(yearFromArchiveFilename('001_SALES_DATA_NNME_01012024.DAT')).toBeNull()
    expect(yearFromArchiveFilename('readme.txt')).toBeNull()
  })
})

describe('dateFromDatFilename', () => {
  it('extracts YYYYMMDD and year from standard DAT filenames', () => {
    const result = dateFromDatFilename('001_SALES_DATA_NNME_18042005.DAT')
    expect(result).toEqual({ yyyymmdd: '20050418', year: 2005 })
  })

  it('handles different dates', () => {
    expect(dateFromDatFilename('077_SALES_DATA_NNME_01012024.DAT')).toEqual({
      yyyymmdd: '20240101',
      year: 2024,
    })
    expect(dateFromDatFilename('001_SALES_DATA_NNME_19072001.DAT')).toEqual({
      yyyymmdd: '20010719',
      year: 2001,
    })
  })

  it('returns null for non-matching filenames', () => {
    expect(dateFromDatFilename('ARCHIVE_SALES_1995.DAT')).toBeNull()
    expect(dateFromDatFilename('readme.txt')).toBeNull()
  })
})
