import { describe, it, expect } from 'vitest'
import {
  STREET_TYPE_ABBREVIATIONS,
  STREET_TYPE_FULL_TO_ABBREV,
  buildGnafStreetVariants,
  expandStreetAbbreviation,
} from '../../src/geocode/street-normalizer.js'

describe('STREET_TYPE_ABBREVIATIONS', () => {
  it('maps common abbreviations to full forms', () => {
    expect(STREET_TYPE_ABBREVIATIONS['ST']).toBe('STREET')
    expect(STREET_TYPE_ABBREVIATIONS['RD']).toBe('ROAD')
    expect(STREET_TYPE_ABBREVIATIONS['AVE']).toBe('AVENUE')
    expect(STREET_TYPE_ABBREVIATIONS['DR']).toBe('DRIVE')
    expect(STREET_TYPE_ABBREVIATIONS['PL']).toBe('PLACE')
    expect(STREET_TYPE_ABBREVIATIONS['CT']).toBe('COURT')
    expect(STREET_TYPE_ABBREVIATIONS['HWY']).toBe('HIGHWAY')
    expect(STREET_TYPE_ABBREVIATIONS['PDE']).toBe('PARADE')
    expect(STREET_TYPE_ABBREVIATIONS['TCE']).toBe('TERRACE')
    expect(STREET_TYPE_ABBREVIATIONS['LN']).toBe('LANE')
  })

  it('handles multiple abbreviations for crescent', () => {
    expect(STREET_TYPE_ABBREVIATIONS['CR']).toBe('CRESCENT')
    expect(STREET_TYPE_ABBREVIATIONS['CRS']).toBe('CRESCENT')
    expect(STREET_TYPE_ABBREVIATIONS['CRES']).toBe('CRESCENT')
  })
})

describe('STREET_TYPE_FULL_TO_ABBREV', () => {
  it('maps full forms to abbreviations', () => {
    expect(STREET_TYPE_FULL_TO_ABBREV['STREET']).toBeDefined()
    expect(STREET_TYPE_FULL_TO_ABBREV['ROAD']).toBe('RD')
    expect(STREET_TYPE_FULL_TO_ABBREV['AVENUE']).toBe('AVE')
    expect(STREET_TYPE_FULL_TO_ABBREV['HIGHWAY']).toBe('HWY')
  })
})

describe('buildGnafStreetVariants', () => {
  it('builds full and abbreviated variants', () => {
    const result = buildGnafStreetVariants('MAIN', 'STREET', null)
    expect(result.full).toBe('MAIN STREET')
    expect(result.abbreviated).toBe('MAIN ST')
  })

  it('includes suffix when present', () => {
    const result = buildGnafStreetVariants('PRINCES', 'HIGHWAY', 'EAST')
    expect(result.full).toBe('PRINCES HIGHWAY EAST')
    expect(result.abbreviated).toBe('PRINCES HWY EAST')
  })

  it('handles name-only (no type or suffix)', () => {
    const result = buildGnafStreetVariants('THE BOULEVARDE', null, null)
    expect(result.full).toBe('THE BOULEVARDE')
    expect(result.abbreviated).toBe('THE BOULEVARDE')
  })

  it('passes through unknown street types unchanged', () => {
    const result = buildGnafStreetVariants('MAIN', 'ESPLANADE', null)
    expect(result.full).toBe('MAIN ESPLANADE')
    expect(result.abbreviated).toBe('MAIN ESPLANADE')
  })
})

describe('expandStreetAbbreviation', () => {
  it('expands ST to STREET', () => {
    expect(expandStreetAbbreviation('HIGH ST')).toBe('HIGH STREET')
  })

  it('expands RD to ROAD', () => {
    expect(expandStreetAbbreviation('MAIN RD')).toBe('MAIN ROAD')
  })

  it('expands HWY with suffix', () => {
    expect(expandStreetAbbreviation('PRINCES HWY EAST')).toBe('PRINCES HIGHWAY EAST')
  })

  it('leaves already-full types unchanged', () => {
    expect(expandStreetAbbreviation('MAIN ROAD')).toBe('MAIN ROAD')
  })

  it('uppercases input', () => {
    expect(expandStreetAbbreviation('main st')).toBe('MAIN STREET')
  })

  it('handles single-word street names', () => {
    expect(expandStreetAbbreviation('BROADWAY')).toBe('BROADWAY')
  })

  it('does not expand the first word (street name)', () => {
    // "ST" as first word is a street name (St Ives), not an abbreviation
    expect(expandStreetAbbreviation('ST KILDA RD')).toBe('ST KILDA ROAD')
  })

  it('trims whitespace', () => {
    expect(expandStreetAbbreviation('  HIGH ST  ')).toBe('HIGH STREET')
  })
})
