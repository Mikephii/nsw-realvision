import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverDatFiles, summarizeDiscovery } from '../../src/discovery/file-discovery.js'

describe('discoverDatFiles', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'realvision-test-'))

    // Create test directory structure
    // 2024/20240101/001_SALES_DATA_NNME_01012024.DAT
    // 2024/20240101/077_SALES_DATA_NNME_01012024.DAT
    // 2024/20240108/001_SALES_DATA_NNME_08012024.DAT
    // 2025/20250120/001_SALES_DATA_NNME_20012025.DAT

    await mkdir(join(tempDir, '2024', '20240101'), { recursive: true })
    await mkdir(join(tempDir, '2024', '20240108'), { recursive: true })
    await mkdir(join(tempDir, '2025', '20250120'), { recursive: true })

    await writeFile(join(tempDir, '2024', '20240101', '001_SALES_DATA_NNME_01012024.DAT'), 'test')
    await writeFile(join(tempDir, '2024', '20240101', '077_SALES_DATA_NNME_01012024.DAT'), 'test')
    await writeFile(join(tempDir, '2024', '20240108', '001_SALES_DATA_NNME_08012024.DAT'), 'test')
    await writeFile(join(tempDir, '2025', '20250120', '001_SALES_DATA_NNME_20012025.DAT'), 'test')

    // Non-matching files that should be ignored
    await writeFile(join(tempDir, '2024', '20240101', 'readme.txt'), 'ignore')
    await writeFile(join(tempDir, '2024', '20240101', 'not_a_dat.DAT'), 'ignore')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  it('discovers all .DAT files', async () => {
    const files = await discoverDatFiles(tempDir)
    expect(files).toHaveLength(4)
  })

  it('extracts correct metadata', async () => {
    const files = await discoverDatFiles(tempDir)

    expect(files[0]).toEqual({
      filePath: join(tempDir, '2024', '20240101', '001_SALES_DATA_NNME_01012024.DAT'),
      year: 2024,
      week: '20240101',
      districtCode: '001',
      format: 'current',
    })
  })

  it('sorts by year, week, district', async () => {
    const files = await discoverDatFiles(tempDir)

    expect(files[0].year).toBe(2024)
    expect(files[0].week).toBe('20240101')
    expect(files[0].districtCode).toBe('001')

    expect(files[1].week).toBe('20240101')
    expect(files[1].districtCode).toBe('077')

    expect(files[2].week).toBe('20240108')

    expect(files[3].year).toBe(2025)
  })

  it('ignores non-matching files', async () => {
    const files = await discoverDatFiles(tempDir)
    const names = files.map(f => f.filePath)
    expect(names.every(n => n.endsWith('.DAT'))).toBe(true)
    expect(names.every(n => n.includes('SALES_DATA_NNME'))).toBe(true)
  })

  it('ignores zip files and non-directory entries', async () => {
    // Create a zip file in the year directory (mimics real data structure)
    await writeFile(join(tempDir, '2024', '20240101.zip'), 'fake zip')
    const files = await discoverDatFiles(tempDir)
    expect(files).toHaveLength(4) // unchanged
  })
})

describe('summarizeDiscovery', () => {
  it('summarizes file discovery results', () => {
    const files = [
      { filePath: '/a/2024/20240101/001.DAT', year: 2024, week: '20240101', districtCode: '001', format: 'current' as const },
      { filePath: '/a/2024/20240101/077.DAT', year: 2024, week: '20240101', districtCode: '077', format: 'current' as const },
      { filePath: '/a/2024/20240108/001.DAT', year: 2024, week: '20240108', districtCode: '001', format: 'current' as const },
      { filePath: '/a/2025/20250120/001.DAT', year: 2025, week: '20250120', districtCode: '001', format: 'current' as const },
    ]

    const summary = summarizeDiscovery(files)
    expect(summary.totalFiles).toBe(4)
    expect(summary.years).toEqual([2024, 2025])
    expect(summary.weeksPerYear[2024]).toBe(2)
    expect(summary.weeksPerYear[2025]).toBe(1)
    expect(summary.districtsFound).toBe(2) // 001, 077
    expect(summary.archivedFiles).toBe(0)
  })
})
