import { describe, it, expect } from 'vitest'
import { getDistrictName, getAllDistricts } from '../../src/reference/districts.js'

describe('getDistrictName', () => {
  it('returns name for known district codes', () => {
    expect(getDistrictName('001')).toBe('Cessnock')
    expect(getDistrictName('708')).toBe('City of Sydney')
    expect(getDistrictName('207')).toBe('Randwick')
  })

  it('returns undefined for unknown code', () => {
    expect(getDistrictName('999')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(getDistrictName('')).toBeUndefined()
  })

  it('handles merged council codes', () => {
    // Canterbury-Bankstown is a merged council with code 258
    expect(getDistrictName('258')).toBe('Canterbury-Bankstown')
  })
})

describe('getAllDistricts', () => {
  it('returns all districts', () => {
    const districts = getAllDistricts()
    expect(districts.length).toBeGreaterThan(100) // ~130 districts
  })

  it('every district has code and name', () => {
    for (const d of getAllDistricts()) {
      expect(d.code).toBeTruthy()
      expect(d.name).toBeTruthy()
    }
  })

  it('all codes are 3 characters', () => {
    for (const d of getAllDistricts()) {
      expect(d.code).toHaveLength(3)
    }
  })

  it('includes key districts', () => {
    const names = getAllDistricts().map(d => d.name)
    expect(names).toContain('City of Sydney')
    expect(names).toContain('Randwick')
    expect(names).toContain('Blacktown')
    expect(names).toContain('Penrith')
  })
})
