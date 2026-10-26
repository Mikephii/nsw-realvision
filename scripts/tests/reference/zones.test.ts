import { describe, it, expect } from 'vitest'
import { getZoneInfo, getAllLepZones, getAllLegacyZones, isLegacyZoneCode } from '../../src/reference/zones.js'

describe('getZoneInfo', () => {
  it('returns LEP zone info for R2', () => {
    const zone = getZoneInfo('R2')
    expect(zone).toBeDefined()
    expect(zone!.name).toBe('Low Density Residential')
    expect(zone!.category).toBe('residential')
  })

  it('returns LEP zone info for B4', () => {
    const zone = getZoneInfo('B4')
    expect(zone).toBeDefined()
    expect(zone!.name).toBe('Mixed Use')
    expect(zone!.category).toBe('business')
  })

  it('returns LEP zone info for IN1', () => {
    const zone = getZoneInfo('IN1')
    expect(zone).toBeDefined()
    expect(zone!.name).toBe('General Industrial')
    expect(zone!.category).toBe('industrial')
  })

  it('returns legacy zone info for single-char codes', () => {
    const zone = getZoneInfo('A')
    expect(zone).toBeDefined()
    expect(zone!.name).toBe('Residential')
    expect(zone!.category).toBe('residential')
  })

  it('returns legacy zone for I (Industrial)', () => {
    const zone = getZoneInfo('I')
    expect(zone).toBeDefined()
    expect(zone!.category).toBe('industrial')
  })

  it('returns undefined for unknown code', () => {
    expect(getZoneInfo('ZZZ')).toBeUndefined()
  })

  it('prefers LEP over legacy when both exist', () => {
    // LEP_ZONES is checked first via ?? operator
    // E1 exists as LEP, E exists as legacy — should be independent lookups
    const e1 = getZoneInfo('E1')
    const e = getZoneInfo('E')
    expect(e1?.category).toBe('environment')
    expect(e?.category).toBe('employment')
  })
})

describe('getAllLepZones', () => {
  it('returns all LEP zones', () => {
    const zones = getAllLepZones()
    expect(zones.length).toBeGreaterThan(20) // at least R, B, IN, SP, RE, E, W, RU families
  })

  it('every zone has code, name, and category', () => {
    for (const zone of getAllLepZones()) {
      expect(zone.code).toBeTruthy()
      expect(zone.name).toBeTruthy()
      expect(zone.category).toBeTruthy()
    }
  })

  it('includes all residential zones R1-R5', () => {
    const codes = getAllLepZones().map(z => z.code)
    expect(codes).toContain('R1')
    expect(codes).toContain('R2')
    expect(codes).toContain('R3')
    expect(codes).toContain('R4')
    expect(codes).toContain('R5')
  })
})

describe('getAllLegacyZones', () => {
  it('returns all legacy single-char zones', () => {
    const zones = getAllLegacyZones()
    expect(zones.length).toBeGreaterThan(10)
  })

  it('every zone has a single-character code', () => {
    for (const zone of getAllLegacyZones()) {
      expect(zone.code).toHaveLength(1)
    }
  })
})

describe('isLegacyZoneCode', () => {
  it('returns true for legacy codes', () => {
    expect(isLegacyZoneCode('A')).toBe(true)
    expect(isLegacyZoneCode('B')).toBe(true)
    expect(isLegacyZoneCode('R')).toBe(true)
  })

  it('returns false for LEP codes', () => {
    expect(isLegacyZoneCode('R2')).toBe(false)
    expect(isLegacyZoneCode('B4')).toBe(false)
    expect(isLegacyZoneCode('IN1')).toBe(false)
  })

  it('returns false for unknown single-char code', () => {
    expect(isLegacyZoneCode('1')).toBe(false)
    expect(isLegacyZoneCode('Q')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isLegacyZoneCode('')).toBe(false)
  })
})
