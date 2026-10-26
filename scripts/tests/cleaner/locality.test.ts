import { describe, it, expect } from 'vitest'
import { normaliseLocality, emptyToNull } from '../../src/cleaner/locality.js'

describe('normaliseLocality', () => {
  it('converts UPPERCASE to Title Case', () => {
    expect(normaliseLocality('SYDNEY')).toBe('Sydney')
  })

  it('handles multi-word suburbs', () => {
    expect(normaliseLocality('KURRI KURRI')).toBe('Kurri Kurri')
  })

  it('title-cases abbreviations like ST', () => {
    expect(normaliseLocality('ST IVES')).toBe('St Ives')
  })

  it('handles already title-cased input', () => {
    expect(normaliseLocality('Bondi Junction')).toBe('Bondi Junction')
  })

  it('returns null for empty string', () => {
    expect(normaliseLocality('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(normaliseLocality('   ')).toBeNull()
  })

  it('trims leading and trailing whitespace', () => {
    expect(normaliseLocality('  MANLY  ')).toBe('Manly')
  })

  it('handles hyphenated suburbs', () => {
    expect(normaliseLocality('KU-RING-GAI')).toBe('Ku-Ring-Gai')
  })

  it('handles single-word suburb', () => {
    expect(normaliseLocality('NEWTOWN')).toBe('Newtown')
  })
})

describe('emptyToNull', () => {
  it('returns null for empty string', () => {
    expect(emptyToNull('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(emptyToNull('   ')).toBeNull()
  })

  it('returns trimmed value for non-empty string', () => {
    expect(emptyToNull('  hello  ')).toBe('hello')
  })

  it('returns value unchanged when no padding', () => {
    expect(emptyToNull('test')).toBe('test')
  })
})
