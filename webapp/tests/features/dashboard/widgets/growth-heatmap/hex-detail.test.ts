import { describe, expect, it } from 'vitest'
import { r2Color } from '@/features/dashboard/widgets/growth-heatmap/HexDetailDialog'

// ---------------------------------------------------------------------------
// r2Color — R² confidence badge color mapping
// ---------------------------------------------------------------------------

describe('r2Color', () => {
  it('returns green for R² >= 0.7 (good fit)', () => {
    const result = r2Color(0.7)
    expect(result).toContain('green')
  })

  it('returns green for perfect fit (R² = 1.0)', () => {
    const result = r2Color(1.0)
    expect(result).toContain('green')
  })

  it('returns green for R² = 0.89', () => {
    const result = r2Color(0.89)
    expect(result).toContain('green')
  })

  it('returns amber for R² in [0.4, 0.7) (moderate fit)', () => {
    const result = r2Color(0.5)
    expect(result).toContain('amber')
  })

  it('returns amber at the lower boundary (R² = 0.4)', () => {
    const result = r2Color(0.4)
    expect(result).toContain('amber')
  })

  it('returns amber just below the green threshold (R² = 0.69)', () => {
    const result = r2Color(0.69)
    expect(result).toContain('amber')
  })

  it('returns red for R² < 0.4 (poor fit)', () => {
    const result = r2Color(0.2)
    expect(result).toContain('red')
  })

  it('returns red at the boundary (R² = 0.39)', () => {
    const result = r2Color(0.39)
    expect(result).toContain('red')
  })

  it('returns red for R² = 0', () => {
    const result = r2Color(0)
    expect(result).toContain('red')
  })

  it('includes dark mode variant', () => {
    const green = r2Color(0.8)
    expect(green).toContain('dark:')

    const amber = r2Color(0.5)
    expect(amber).toContain('dark:')

    const red = r2Color(0.2)
    expect(red).toContain('dark:')
  })
})
