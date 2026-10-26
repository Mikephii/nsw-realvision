import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createConnection } from '../../src/db/connection.js'
import { initSchema } from '../../src/db/schema.js'
import { loadSales, loadDimDistricts } from '../../src/db/loader.js'
import { markFileLoaded, getLoadedFilePaths, filterNewFiles, getFactTableCount } from '../../src/db/incremental.js'
import { parseFileContent } from '../../src/parser/file-parser.js'
import { combineSaleRecords } from '../../src/parser/record-combiner.js'
import { cleanSaleUnit } from '../../src/cleaner/index.js'
import type { FileMetadata } from '../../src/types/property-sale.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')

describe('DuckDB loader integration', () => {
  let db: Awaited<ReturnType<typeof createConnection>>

  beforeEach(async () => {
    // Use in-memory database for tests
    db = await createConnection(':memory:')
    await initSchema(db.connection)
  })

  afterEach(() => {
    db.close()
  })

  it('loads parsed sales into DuckDB', async () => {
    const content = readFileSync(join(FIXTURES_DIR, 'sample-small.dat'), 'latin1')
    const parsed = parseFileContent(content)
    const units = combineSaleRecords(parsed)
    const metadata: FileMetadata = {
      filePath: '/test/sample-small.dat',
      year: 2025,
      week: '20250120',
      districtCode: '001',
    }
    const sales = units.map(u => cleanSaleUnit(u, metadata))

    const count = await loadSales(db.connection, sales)
    expect(count).toBe(3)

    // Verify data in fact table
    const factCount = await getFactTableCount(db.connection)
    expect(factCount).toBe(3)

    // Verify specific values
    const reader = await db.connection.runAndReadAll(
      "SELECT locality, purchase_price, zone_code FROM fact_property_sale WHERE property_id = '2901108'"
    )
    const rows = reader.getRows()
    expect(rows).toHaveLength(1)
    expect(String(rows[0][0])).toBe('Kitchener') // normalised locality
    expect(Number(rows[0][1])).toBe(850000)
    expect(String(rows[0][2])).toBe('RU5')
  })

  it('handles deduplication on re-load', async () => {
    const content = readFileSync(join(FIXTURES_DIR, 'sample-small.dat'), 'latin1')
    const parsed = parseFileContent(content)
    const units = combineSaleRecords(parsed)
    const metadata: FileMetadata = {
      filePath: '/test/sample-small.dat',
      year: 2025,
      week: '20250120',
      districtCode: '001',
    }
    const sales = units.map(u => cleanSaleUnit(u, metadata))

    // Load twice
    await loadSales(db.connection, sales)
    await loadSales(db.connection, sales)

    // Should still have only 3 unique sales (deduplication by PK)
    const factCount = await getFactTableCount(db.connection)
    expect(factCount).toBe(3)
  })

  it('tracks loaded files', async () => {
    const metadata: FileMetadata = {
      filePath: '/test/sample-small.dat',
      year: 2025,
      week: '20250120',
      districtCode: '001',
    }

    await markFileLoaded(db.connection, metadata, 3)

    const loaded = await getLoadedFilePaths(db.connection)
    expect(loaded.has('/test/sample-small.dat')).toBe(true)
    expect(loaded.size).toBe(1)
  })

  it('filters new files correctly', async () => {
    const meta1: FileMetadata = {
      filePath: '/test/file1.dat',
      year: 2025,
      week: '20250120',
      districtCode: '001',
    }
    const meta2: FileMetadata = {
      filePath: '/test/file2.dat',
      year: 2025,
      week: '20250120',
      districtCode: '077',
    }

    await markFileLoaded(db.connection, meta1, 10)

    const newFiles = await filterNewFiles(db.connection, [meta1, meta2])
    expect(newFiles).toHaveLength(1)
    expect(newFiles[0].filePath).toBe('/test/file2.dat')
  })

  it('loads dimension data', async () => {
    await loadDimDistricts(db.connection, [
      { code: '001', name: 'Cessnock' },
      { code: '708', name: 'City of Sydney' },
    ])

    const reader = await db.connection.runAndReadAll('SELECT COUNT(*) FROM dim_district')
    const rows = reader.getRows()
    expect(Number(rows[0][0])).toBe(2)
  })

  it('returns 0 for empty sales array', async () => {
    const count = await loadSales(db.connection, [])
    expect(count).toBe(0)
  })
})
