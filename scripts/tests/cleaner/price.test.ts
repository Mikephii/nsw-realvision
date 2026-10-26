import { describe, it, expect } from 'vitest'
import { parsePrice, parseArea, parsePercentInterest } from '../../src/cleaner/price.js'

describe('parsePrice', () => {
  it('parses a valid price', () => {
    expect(parsePrice('850000')).toBe(850000)
  })

  it('parses zero', () => {
    expect(parsePrice('0')).toBe(0)
  })

  it('returns null for empty string', () => {
    expect(parsePrice('')).toBeNull()
  })

  it('returns null for non-numeric', () => {
    expect(parsePrice('abc')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(parsePrice(' 500000 ')).toBe(500000)
  })
})

describe('parseArea', () => {
  it('parses integer area', () => {
    expect(parseArea('1012')).toBe(1012)
  })

  it('parses decimal area', () => {
    expect(parseArea('10.92')).toBe(10.92)
  })

  it('parses area with many decimals', () => {
    expect(parseArea('809.43')).toBe(809.43)
  })

  it('returns null for empty string', () => {
    expect(parseArea('')).toBeNull()
  })

  it('returns null for zero', () => {
    expect(parseArea('0')).toBeNull()
  })

  it('returns null for negative', () => {
    expect(parseArea('-100')).toBeNull()
  })
})

describe('parsePercentInterest', () => {
  it('returns null for "0" (meaning 100%)', () => {
    expect(parsePercentInterest('0')).toBeNull()
  })

  it('returns null for empty (meaning 100%)', () => {
    expect(parsePercentInterest('')).toBeNull()
  })

  it('parses a valid percentage', () => {
    expect(parsePercentInterest('50')).toBe(50)
  })
})
