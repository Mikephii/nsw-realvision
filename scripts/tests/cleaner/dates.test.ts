import { describe, it, expect } from 'vitest'
import { parseCCYYMMDD, DATE_YEAR_MIN } from '../../src/cleaner/dates.js'

describe('parseCCYYMMDD', () => {
  it('parses a valid date', () => {
    const result = parseCCYYMMDD('20241022')
    expect(result).toBeInstanceOf(Date)
    expect(result!.getUTCFullYear()).toBe(2024)
    expect(result!.getUTCMonth()).toBe(9) // October = 9
    expect(result!.getUTCDate()).toBe(22)
  })

  it('parses January 1st correctly', () => {
    const result = parseCCYYMMDD('20250101')
    expect(result!.getUTCFullYear()).toBe(2025)
    expect(result!.getUTCMonth()).toBe(0)
    expect(result!.getUTCDate()).toBe(1)
  })

  it('parses December 31st correctly', () => {
    const result = parseCCYYMMDD('20241231')
    expect(result!.getUTCMonth()).toBe(11)
    expect(result!.getUTCDate()).toBe(31)
  })

  it('returns null for empty string', () => {
    expect(parseCCYYMMDD('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseCCYYMMDD('   ')).toBeNull()
  })

  it('returns null for wrong length', () => {
    expect(parseCCYYMMDD('202410')).toBeNull()
    expect(parseCCYYMMDD('202410221')).toBeNull()
  })

  it('returns null for invalid month', () => {
    expect(parseCCYYMMDD('20241301')).toBeNull()
    expect(parseCCYYMMDD('20240001')).toBeNull()
  })

  it('returns null for invalid day', () => {
    expect(parseCCYYMMDD('20241200')).toBeNull()
    expect(parseCCYYMMDD('20241232')).toBeNull()
  })

  it('returns null for Feb 30 (rollover detection)', () => {
    expect(parseCCYYMMDD('20240230')).toBeNull()
  })

  it('handles Feb 29 in leap year', () => {
    const result = parseCCYYMMDD('20240229')
    expect(result).toBeInstanceOf(Date)
    expect(result!.getUTCDate()).toBe(29)
  })

  it('returns null for Feb 29 in non-leap year', () => {
    expect(parseCCYYMMDD('20230229')).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(parseCCYYMMDD('abcdefgh')).toBeNull()
  })

  // Year range validation — NSW VG data starts in 1990.
  // Corrupt years found in actual data: 201, 222, 1024.

  it('returns null for corrupt year 201 (actual data artifact)', () => {
    expect(parseCCYYMMDD('02010315')).toBeNull()
  })

  it('returns null for corrupt year 1024 (actual data artifact)', () => {
    expect(parseCCYYMMDD('10240601')).toBeNull()
  })

  it('returns null for year 1989 (before VG dataset begins)', () => {
    expect(parseCCYYMMDD('19890101')).toBeNull()
  })

  it('parses year 1990 (earliest valid year)', () => {
    const result = parseCCYYMMDD('19900101')
    expect(result).toBeInstanceOf(Date)
    expect(result!.getUTCFullYear()).toBe(1990)
  })

  it('parses current year', () => {
    const currentYear = new Date().getFullYear()
    const dateStr = `${currentYear}0601`
    const result = parseCCYYMMDD(dateStr)
    expect(result).toBeInstanceOf(Date)
    expect(result!.getUTCFullYear()).toBe(currentYear)
  })

  it('parses next year (settlement dates can cross year boundary)', () => {
    const nextYear = new Date().getFullYear() + 1
    const dateStr = `${nextYear}0115`
    const result = parseCCYYMMDD(dateStr)
    expect(result).toBeInstanceOf(Date)
    expect(result!.getUTCFullYear()).toBe(nextYear)
  })

  it('returns null for year two beyond current (too far in future)', () => {
    const tooFar = new Date().getFullYear() + 2
    expect(parseCCYYMMDD(`${tooFar}0101`)).toBeNull()
  })

  it('DATE_YEAR_MIN is 1990', () => {
    expect(DATE_YEAR_MIN).toBe(1990)
  })
})
