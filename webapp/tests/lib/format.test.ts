import { describe, expect, it } from 'vitest'
import type { PropertyResult } from '@/lib/autocomplete'
import {
  formatAddress,
  formatDate,
  formatPrice,
  natureLabel,
  propertyKey,
} from '@/lib/format'

/** Helper to build a minimal PropertyResult for testing */
function makeProperty(overrides: Partial<PropertyResult> = {}): PropertyResult {
  return {
    propertyId: '12345',
    unitNumber: null,
    houseNumber: '42',
    streetName: 'MAIN STREET',
    locality: 'SYDNEY',
    postCode: '2000',
    saleCount: 3,
    lastSaleYear: 2024,
    ...overrides,
  }
}

describe('formatAddress', () => {
  it('formats a standard address', () => {
    expect(formatAddress(makeProperty())).toBe('42 MAIN STREET')
  })

  it('includes unit number when present', () => {
    expect(formatAddress(makeProperty({ unitNumber: '5' }))).toBe(
      'Unit 5, 42 MAIN STREET',
    )
  })

  it('handles missing house number', () => {
    expect(formatAddress(makeProperty({ houseNumber: null }))).toBe(
      'MAIN STREET',
    )
  })

  it('handles missing street name', () => {
    expect(formatAddress(makeProperty({ streetName: '' }))).toBe('42')
  })

  it('returns "Unknown address" when all fields are empty', () => {
    expect(
      formatAddress(
        makeProperty({
          unitNumber: null,
          houseNumber: null,
          streetName: '',
        }),
      ),
    ).toBe('Unknown address')
  })

  it('handles unit with no house number', () => {
    expect(
      formatAddress(makeProperty({ unitNumber: '3', houseNumber: null })),
    ).toBe('Unit 3, MAIN STREET')
  })
})

describe('formatPrice', () => {
  it('formats a typical house price', () => {
    const result = formatPrice(1_250_000)
    // Should contain the number with thousands separators, no decimals
    expect(result).toContain('1,250,000')
    expect(result).toContain('$')
  })

  it('formats zero', () => {
    const result = formatPrice(0)
    expect(result).toContain('$')
    expect(result).toContain('0')
  })

  it('formats small prices', () => {
    const result = formatPrice(500)
    expect(result).toContain('500')
  })

  it('does not include decimal places', () => {
    const result = formatPrice(999_999.99)
    // maximumFractionDigits: 0 rounds
    expect(result).not.toContain('.')
  })
})

describe('formatDate', () => {
  it('formats a standard ISO date', () => {
    const result = formatDate('2024-03-15')
    // en-AU format: "15 Mar 2024"
    expect(result).toContain('15')
    expect(result).toContain('Mar')
    expect(result).toContain('2024')
  })

  it('returns "Date unknown" for null', () => {
    expect(formatDate(null)).toBe('Date unknown')
  })

  it('returns "Date unknown" for undefined', () => {
    expect(formatDate(undefined)).toBe('Date unknown')
  })

  it('returns "Date unknown" for empty string', () => {
    expect(formatDate('')).toBe('Date unknown')
  })
})

describe('natureLabel', () => {
  it('maps V to Vacant Land', () => {
    expect(natureLabel('V')).toBe('Vacant Land')
  })

  it('maps R to Residence', () => {
    expect(natureLabel('R')).toBe('Residence')
  })

  it('maps 3 to Other', () => {
    expect(natureLabel('3')).toBe('Other')
  })

  it('returns unknown code as-is', () => {
    expect(natureLabel('X')).toBe('X')
  })
})

describe('propertyKey', () => {
  it('generates a composite key', () => {
    const key = propertyKey(makeProperty())
    expect(key).toBe('12345::::42')
  })

  it('includes unit number in key', () => {
    const key = propertyKey(makeProperty({ unitNumber: '5' }))
    expect(key).toBe('12345::5::42')
  })

  it('handles null unit and house number', () => {
    const key = propertyKey(
      makeProperty({ unitNumber: null, houseNumber: null }),
    )
    expect(key).toBe('12345::::')
  })

  it('distinguishes properties with different units', () => {
    const key1 = propertyKey(makeProperty({ unitNumber: '1' }))
    const key2 = propertyKey(makeProperty({ unitNumber: '2' }))
    expect(key1).not.toBe(key2)
  })
})
