import { describe, expect, it } from 'vitest'
import {
  heatmapEndYear,
  lastCompletedQuarter,
  weekFolderToIsoDate,
} from '@/lib/heatmap-queries'

describe('weekFolderToIsoDate', () => {
  it('converts a YYYYMMDD week folder to an ISO date', () => {
    expect(weekFolderToIsoDate('20260216')).toBe('2026-02-16')
  })

  it('returns null for missing or malformed values', () => {
    expect(weekFolderToIsoDate(null)).toBeNull()
    expect(weekFolderToIsoDate(undefined)).toBeNull()
    expect(weekFolderToIsoDate('')).toBeNull()
    expect(weekFolderToIsoDate('2026-02-16')).toBeNull()
    expect(weekFolderToIsoDate('archive')).toBeNull()
    expect(weekFolderToIsoDate('20261399')).toBeNull()
  })
})

describe('heatmapEndYear', () => {
  it("uses the data's latest year when it is known", () => {
    expect(heatmapEndYear({ latestYear: 2026, dataTo: '2026-02-16' })).toBe(2026)
    expect(heatmapEndYear({ latestYear: 2019, dataTo: null })).toBe(2019)
  })

  it('falls back to the last completed quarter without coverage', () => {
    const fallback = Math.floor(lastCompletedQuarter())
    expect(heatmapEndYear(null)).toBe(fallback)
    expect(heatmapEndYear(undefined)).toBe(fallback)
    expect(heatmapEndYear({ latestYear: null, dataTo: null })).toBe(fallback)
  })
})
