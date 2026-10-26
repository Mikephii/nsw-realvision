import { describe, it, expect } from 'vitest'
import { cleanZoneCode } from '../../src/cleaner/zones.js'
import { getZoneInfo, isLegacyZoneCode } from '../../src/reference/zones.js'
import { getDistrictName } from '../../src/reference/districts.js'

describe('cleanZoneCode', () => {
  it('returns LEP zone codes as-is', () => {
    expect(cleanZoneCode('R2')).toBe('R2')
    expect(cleanZoneCode('RU5')).toBe('RU5')
    expect(cleanZoneCode('B4')).toBe('B4')
    expect(cleanZoneCode('IN1')).toBe('IN1')
  })

  it('returns legacy zone codes as-is', () => {
    expect(cleanZoneCode('A')).toBe('A')
    expect(cleanZoneCode('B')).toBe('B')
    expect(cleanZoneCode('I')).toBe('I')
    expect(cleanZoneCode('R')).toBe('R')
  })

  it('returns null for empty string', () => {
    expect(cleanZoneCode('')).toBeNull()
  })

  it('returns unknown codes as-is', () => {
    expect(cleanZoneCode('XX')).toBe('XX')
  })

  it('trims whitespace', () => {
    expect(cleanZoneCode(' R2 ')).toBe('R2')
  })
})

describe('getZoneInfo', () => {
  it('returns info for LEP zone', () => {
    const info = getZoneInfo('R2')
    expect(info?.name).toBe('Low Density Residential')
    expect(info?.category).toBe('residential')
  })

  it('returns info for legacy zone', () => {
    const info = getZoneInfo('A')
    expect(info?.name).toBe('Residential')
    expect(info?.category).toBe('residential')
  })

  it('returns undefined for unknown code', () => {
    expect(getZoneInfo('ZZ')).toBeUndefined()
  })
})

describe('isLegacyZoneCode', () => {
  it('identifies legacy codes', () => {
    expect(isLegacyZoneCode('A')).toBe(true)
    expect(isLegacyZoneCode('R')).toBe(true)
  })

  it('rejects multi-char codes', () => {
    expect(isLegacyZoneCode('R2')).toBe(false)
  })
})

describe('getDistrictName', () => {
  it('returns council name for known district', () => {
    expect(getDistrictName('001')).toBe('Cessnock')
    expect(getDistrictName('708')).toBe('City of Sydney')
    expect(getDistrictName('207')).toBe('Randwick')
  })

  it('returns undefined for unknown district', () => {
    expect(getDistrictName('999')).toBeUndefined()
  })
})
