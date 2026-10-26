import { describe, expect, it } from 'vitest'
import type { PropertyFilter } from '@/lib/queries'
import { buildWhereClause, periodExpression } from '@/lib/queries'

describe('periodExpression', () => {
  it('returns YEAR extraction for year granularity', () => {
    const expr = periodExpression('year')
    expect(expr).toContain('YEAR')
    expect(expr).toContain('contract_date')
  })

  it('returns QUARTER concatenation for quarter granularity', () => {
    const expr = periodExpression('quarter')
    expect(expr).toContain('YEAR')
    expect(expr).toContain('QUARTER')
    expect(expr).toContain('-Q')
  })

  it('returns strftime for month granularity', () => {
    const expr = periodExpression('month')
    expect(expr).toContain('strftime')
    expect(expr).toContain('%Y-%m')
  })
})

describe('buildWhereClause', () => {
  it('returns base conditions for empty filter', () => {
    const { clause, params } = buildWhereClause({})
    expect(clause).toContain('purchase_price > 0')
    expect(clause).toContain('contract_date IS NOT NULL')
    // Data quality flags
    expect(clause).toContain('is_bulk_sale = FALSE')
    expect(clause).toContain('is_price_outlier = FALSE')
    expect(clause).toContain('is_nominal_transfer = FALSE')
    expect(clause).toContain('is_partial_interest = FALSE')
    expect(clause).toContain('is_multi_dealing_dup = FALSE')
    expect(params).toHaveLength(0)
  })

  it('adds locality filter with correct placeholders', () => {
    const filter: PropertyFilter = { localities: ['SYDNEY', 'PARRAMATTA'] }
    const { clause, params } = buildWhereClause(filter)
    expect(clause).toContain('locality IN (?, ?)')
    expect(params).toEqual(['SYDNEY', 'PARRAMATTA'])
  })

  it('adds district code filter', () => {
    const filter: PropertyFilter = { districtCodes: ['001', '708'] }
    const { clause, params } = buildWhereClause(filter)
    expect(clause).toContain('district_code IN (?, ?)')
    expect(params).toEqual(['001', '708'])
  })

  it('adds min price filter', () => {
    const filter: PropertyFilter = { minPrice: 500_000 }
    const { clause, params } = buildWhereClause(filter)
    expect(clause).toContain('purchase_price >= ?')
    expect(params).toContain(500_000)
  })

  it('adds max price filter', () => {
    const filter: PropertyFilter = { maxPrice: 2_000_000 }
    const { clause, params } = buildWhereClause(filter)
    expect(clause).toContain('purchase_price <= ?')
    expect(params).toContain(2_000_000)
  })

  it('adds date range filters', () => {
    const filter: PropertyFilter = {
      dateFrom: '2020-01-01',
      dateTo: '2025-12-31',
    }
    const { clause, params } = buildWhereClause(filter)
    expect(clause).toContain('contract_date >= ?')
    expect(clause).toContain('contract_date <= ?')
    expect(params).toEqual(['2020-01-01', '2025-12-31'])
  })

  it('adds nature of property filter', () => {
    const filter: PropertyFilter = { natureOfProperty: ['R', 'V'] }
    const { clause, params } = buildWhereClause(filter)
    expect(clause).toContain('nature_of_property IN (?, ?)')
    expect(params).toEqual(['R', 'V'])
  })

  it('combines multiple filters with AND', () => {
    const filter: PropertyFilter = {
      localities: ['BONDI'],
      minPrice: 100_000,
      maxPrice: 5_000_000,
      natureOfProperty: ['R'],
    }
    const { clause, params } = buildWhereClause(filter)
    // All conditions joined with AND
    const andCount = (clause.match(/AND/g) || []).length
    // 2 base + 5 quality flags + locality + min + max + nature = 10
    expect(andCount).toBeGreaterThanOrEqual(10)
    expect(params).toEqual(['BONDI', 100_000, 5_000_000, 'R'])
  })

  it('ignores empty arrays', () => {
    const filter: PropertyFilter = { localities: [], districtCodes: [] }
    const { clause, params } = buildWhereClause(filter)
    expect(clause).not.toContain('locality IN')
    expect(clause).not.toContain('district_code IN')
    expect(params).toHaveLength(0)
  })

  it('starts with WHERE', () => {
    const { clause } = buildWhereClause({})
    expect(clause).toMatch(/^WHERE/)
  })

  it('adds strata filter using is_likely_strata for strata', () => {
    const filter: PropertyFilter = { strataFilter: 'strata' }
    const { clause } = buildWhereClause(filter)
    expect(clause).toContain('strata IS NOT NULL OR')
    expect(clause).toContain('is_likely_strata')
  })

  it('adds freehold filter excluding is_likely_strata', () => {
    const filter: PropertyFilter = { strataFilter: 'freehold' }
    const { clause } = buildWhereClause(filter)
    expect(clause).toContain('strata IS NULL AND NOT')
    expect(clause).toContain('is_likely_strata')
  })

  it('does not add strata condition for "all" filter', () => {
    const filter: PropertyFilter = { strataFilter: 'all' }
    const { clause } = buildWhereClause(filter)
    expect(clause).not.toContain('is_likely_strata')
  })

  it('applies prefix to quality flag conditions', () => {
    const { clause } = buildWhereClause({}, { prefix: 'fps' })
    expect(clause).toContain('fps.is_bulk_sale = FALSE')
    expect(clause).toContain('fps.is_nominal_transfer = FALSE')
    expect(clause).toContain('fps.is_partial_interest = FALSE')
  })
})
