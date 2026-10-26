import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DuckDBConnection } from '@duckdb/node-api'
import { createConnection } from '../../src/db/connection.js'
import { initSchema } from '../../src/db/schema.js'
import { runDataQuality } from '../../src/db/data-quality.js'

/**
 * Insert test records directly into fact_property_sale.
 *
 * Uses a minimal set of required columns. Optional columns default to NULL
 * or FALSE. `district_code` defaults to '001', `sale_counter` defaults to '1'.
 */
async function insertSale(
  conn: DuckDBConnection,
  record: {
    districtCode?: string
    propertyId: string
    dealingNumber: string
    saleCounter?: string
    unitNumber?: string | null
    purchasePrice: number
    contractDate: string
    strata?: string | null
    locality?: string
    percentInterest?: number | null
    sourceFile?: string
    sourceYear?: number
    sourceWeek?: string
  },
): Promise<void> {
  const dc = record.districtCode ?? '001'
  const sc = record.saleCounter ?? '1'
  const un = record.unitNumber ?? null
  const st = record.strata ?? null
  const loc = record.locality ?? 'TESTVILLE'
  const pi = record.percentInterest ?? null
  const sf = record.sourceFile ?? '/test/test.dat'
  const sy = record.sourceYear ?? 2024
  const sw = record.sourceWeek ?? '20240101'

  await conn.run(`
    INSERT INTO fact_property_sale (
      district_code, property_id, dealing_number, sale_counter,
      unit_number, purchase_price, contract_date, strata, locality,
      percent_interest, source_file, source_year, source_week
    ) VALUES (
      '${dc}', '${record.propertyId}', '${record.dealingNumber}', '${sc}',
      ${un === null ? 'NULL' : `'${un}'`},
      ${record.purchasePrice},
      '${record.contractDate}',
      ${st === null ? 'NULL' : `'${st}'`},
      '${loc}',
      ${pi === null ? 'NULL' : pi},
      '${sf}', ${sy}, '${sw}'
    )
  `)
}

/** Count rows where a given flag is TRUE. */
async function countFlag(conn: DuckDBConnection, column: string): Promise<number> {
  const result = await conn.runAndReadAll(
    `SELECT COUNT(*) FROM fact_property_sale WHERE ${column} = TRUE`,
  )
  return Number(result.getRows()[0]?.[0] ?? 0)
}

/** Get total row count. */
async function totalRows(conn: DuckDBConnection): Promise<number> {
  const result = await conn.runAndReadAll('SELECT COUNT(*) FROM fact_property_sale')
  return Number(result.getRows()[0]?.[0] ?? 0)
}

/**
 * Insert a dim_address record for geocoding.
 *
 * `unit_number` and `house_number` default to '' — matching the COALESCE
 * pattern used in fact_property_sale JOINs: `COALESCE(fps.unit_number, '') = da.unit_number`.
 */
async function insertAddress(
  conn: DuckDBConnection,
  record: {
    propertyId: string
    unitNumber?: string
    houseNumber?: string
    latitude: number
    longitude: number
  },
): Promise<void> {
  const un = record.unitNumber ?? ''
  const hn = record.houseNumber ?? ''
  await conn.run(`
    INSERT INTO dim_address (property_id, unit_number, house_number, latitude, longitude)
    VALUES ('${record.propertyId}', '${un}', '${hn}', ${record.latitude}, ${record.longitude})
  `)
}

/**
 * Insert a sale and its matching dim_address entry in one call.
 * Maps the sale's `unitNumber` (null/undefined → '') for the dim_address JOIN.
 */
async function insertGeocodedSale(
  conn: DuckDBConnection,
  record: Parameters<typeof insertSale>[1] & { latitude: number; longitude: number },
): Promise<void> {
  await insertSale(conn, record)
  await insertAddress(conn, {
    propertyId: record.propertyId,
    unitNumber: record.unitNumber == null ? '' : record.unitNumber,
    latitude: record.latitude,
    longitude: record.longitude,
  })
}

describe('Data quality pipeline', () => {
  let db: Awaited<ReturnType<typeof createConnection>>
  let conn: DuckDBConnection

  beforeEach(async () => {
    db = await createConnection(':memory:')
    conn = db.connection
    await initSchema(conn)
  })

  afterEach(() => {
    db.close()
  })

  // -------------------------------------------------------------------------
  // Nominal transfers
  // -------------------------------------------------------------------------

  describe('flagNominalTransfers', () => {
    it('flags $1 nominal transfer', async () => {
      await insertSale(conn, { propertyId: '1', dealingNumber: 'A', purchasePrice: 1, contractDate: '2024-01-01' })
      await insertSale(conn, { propertyId: '2', dealingNumber: 'B', purchasePrice: 500000, contractDate: '2024-01-01' })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_nominal_transfer')).toBe(1)
    })

    it('flags $500 sale', async () => {
      await insertSale(conn, { propertyId: '1', dealingNumber: 'A', purchasePrice: 500, contractDate: '2024-01-01' })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_nominal_transfer')).toBe(1)
    })

    it('flags $999 sale (just below threshold)', async () => {
      await insertSale(conn, { propertyId: '1', dealingNumber: 'A', purchasePrice: 999, contractDate: '2024-01-01' })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_nominal_transfer')).toBe(1)
    })

    it('does NOT flag $1000 sale (at threshold)', async () => {
      await insertSale(conn, { propertyId: '1', dealingNumber: 'A', purchasePrice: 1000, contractDate: '2024-01-01' })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_nominal_transfer')).toBe(0)
    })

    it('does NOT flag $0 sale (already excluded by purchase_price > 0)', async () => {
      await insertSale(conn, { propertyId: '1', dealingNumber: 'A', purchasePrice: 0, contractDate: '2024-01-01' })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_nominal_transfer')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Likely strata
  // -------------------------------------------------------------------------

  describe('flagLikelyStrata', () => {
    it('flags freehold record with unit_number set', async () => {
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A', purchasePrice: 500000,
        contractDate: '2024-01-01', unitNumber: '5', strata: null,
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_likely_strata')).toBe(1)
    })

    it('does NOT flag record with strata already set', async () => {
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A', purchasePrice: 500000,
        contractDate: '2024-01-01', unitNumber: '5', strata: 'SP12345',
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_likely_strata')).toBe(0)
    })

    it('does NOT flag freehold without unit_number', async () => {
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A', purchasePrice: 500000,
        contractDate: '2024-01-01', unitNumber: null, strata: null,
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_likely_strata')).toBe(0)
    })

    it('does NOT flag freehold with empty string unit_number', async () => {
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A', purchasePrice: 500000,
        contractDate: '2024-01-01', unitNumber: '', strata: null,
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_likely_strata')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Multi-dealing duplicates
  // -------------------------------------------------------------------------

  describe('flagMultiDealingDups', () => {
    it('flags duplicate dealing numbers for same property/date/price', async () => {
      // Same property, same day, same price, different dealing numbers
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D001', purchasePrice: 800000,
        contractDate: '2024-06-15', unitNumber: null, strata: null,
      })
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D002', purchasePrice: 800000,
        contractDate: '2024-06-15', unitNumber: null, strata: null,
      })
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D003', purchasePrice: 800000,
        contractDate: '2024-06-15', unitNumber: null, strata: null,
      })

      await runDataQuality(conn)
      // Should flag 2 (keep lowest dealing_number D001, flag D002 and D003)
      expect(await countFlag(conn, 'is_multi_dealing_dup')).toBe(2)
    })

    it('does NOT flag records with different prices', async () => {
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D001', purchasePrice: 800000,
        contractDate: '2024-06-15', unitNumber: null, strata: null,
      })
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D002', purchasePrice: 900000,
        contractDate: '2024-06-15', unitNumber: null, strata: null,
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_multi_dealing_dup')).toBe(0)
    })

    it('does NOT flag strata records (legitimate multi-unit sales)', async () => {
      await insertSale(conn, {
        propertyId: '200', dealingNumber: 'D001', purchasePrice: 500000,
        contractDate: '2024-06-15', unitNumber: '1', strata: 'SP12345',
      })
      await insertSale(conn, {
        propertyId: '200', dealingNumber: 'D002', purchasePrice: 500000,
        contractDate: '2024-06-15', unitNumber: '2', strata: 'SP12345',
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_multi_dealing_dup')).toBe(0)
    })

    it('does NOT flag likely-strata records', async () => {
      // Records with unit_number but no strata — flagged as likely_strata first
      await insertSale(conn, {
        propertyId: '300', dealingNumber: 'D001', purchasePrice: 500000,
        contractDate: '2024-06-15', unitNumber: '1', strata: null,
      })
      await insertSale(conn, {
        propertyId: '300', dealingNumber: 'D002', purchasePrice: 500000,
        contractDate: '2024-06-15', unitNumber: '2', strata: null,
      })

      await runDataQuality(conn)
      // These should be flagged as likely_strata, NOT as multi-dealing dups
      expect(await countFlag(conn, 'is_likely_strata')).toBe(2)
      expect(await countFlag(conn, 'is_multi_dealing_dup')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Bulk sales
  // -------------------------------------------------------------------------

  describe('flagBulkSales', () => {
    it('flags 2+ properties with identical (price, date, district)', async () => {
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D001', purchasePrice: 5000000,
        contractDate: '2024-01-15', districtCode: '001',
      })
      await insertSale(conn, {
        propertyId: '200', dealingNumber: 'D002', purchasePrice: 5000000,
        contractDate: '2024-01-15', districtCode: '001',
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_bulk_sale')).toBe(2)
    })

    it('does NOT flag records with different prices', async () => {
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D001', purchasePrice: 5000000,
        contractDate: '2024-01-15', districtCode: '001',
      })
      await insertSale(conn, {
        propertyId: '200', dealingNumber: 'D002', purchasePrice: 5500000,
        contractDate: '2024-01-15', districtCode: '001',
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_bulk_sale')).toBe(0)
    })

    it('does NOT double-flag nominal transfers as bulk sales', async () => {
      // Two $1 transfers on the same day in the same district
      await insertSale(conn, {
        propertyId: '100', dealingNumber: 'D001', purchasePrice: 1,
        contractDate: '2024-01-15', districtCode: '001',
      })
      await insertSale(conn, {
        propertyId: '200', dealingNumber: 'D002', purchasePrice: 1,
        contractDate: '2024-01-15', districtCode: '001',
      })

      await runDataQuality(conn)
      // Should be flagged as nominal transfers, NOT bulk sales
      expect(await countFlag(conn, 'is_nominal_transfer')).toBe(2)
      expect(await countFlag(conn, 'is_bulk_sale')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Partial interest
  // -------------------------------------------------------------------------

  describe('flagPartialInterest', () => {
    it('flags record with percent_interest set', async () => {
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A', purchasePrice: 400000,
        contractDate: '2024-01-01', percentInterest: 50,
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_partial_interest')).toBe(1)
    })

    it('does NOT flag record with NULL percent_interest (100% ownership)', async () => {
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A', purchasePrice: 800000,
        contractDate: '2024-01-01', percentInterest: null,
      })

      await runDataQuality(conn)
      expect(await countFlag(conn, 'is_partial_interest')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Pipeline ordering
  // -------------------------------------------------------------------------

  describe('pipeline ordering', () => {
    it('excludes nominal transfers from price outlier IQR computation', async () => {
      // Insert 15 normal sales in the same locality and decade
      for (let i = 0; i < 15; i++) {
        await insertSale(conn, {
          propertyId: `N${i}`, dealingNumber: `DN${i}`,
          purchasePrice: 500000 + i * 10000,
          contractDate: '2024-01-01', locality: 'NORMALTOWN',
        })
      }
      // Insert a $1 nominal transfer — should NOT contaminate IQR
      await insertSale(conn, {
        propertyId: 'NOM1', dealingNumber: 'DNOM1',
        purchasePrice: 1, contractDate: '2024-01-01',
        locality: 'NORMALTOWN',
      })

      const stats = await runDataQuality(conn)
      expect(stats.nominalTransferCount).toBe(1)
      // The $1 record should NOT be flagged as price outlier (it's already
      // flagged as nominal transfer and excluded from the IQR computation)
      expect(stats.priceOutlierCount).toBe(0)
    })

    it('runs all flags and returns complete stats', async () => {
      // Insert a mix of records that trigger different flags
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A1', purchasePrice: 1,
        contractDate: '2024-01-01',
      }) // nominal
      await insertSale(conn, {
        propertyId: '2', dealingNumber: 'A2', purchasePrice: 500000,
        contractDate: '2024-01-01', unitNumber: '5', strata: null,
      }) // likely strata
      await insertSale(conn, {
        propertyId: '3', dealingNumber: 'A3', purchasePrice: 300000,
        contractDate: '2024-01-01', percentInterest: 50,
      }) // partial interest

      const stats = await runDataQuality(conn)

      expect(stats.nominalTransferCount).toBe(1)
      expect(stats.likelyStrataCount).toBe(1)
      expect(stats.partialInterestCount).toBe(1)
      expect(stats.elapsedMs).toBeGreaterThanOrEqual(0)
    })

    it('is idempotent — running twice produces same counts', async () => {
      await insertSale(conn, {
        propertyId: '1', dealingNumber: 'A1', purchasePrice: 1,
        contractDate: '2024-01-01',
      })
      await insertSale(conn, {
        propertyId: '2', dealingNumber: 'A2', purchasePrice: 500000,
        contractDate: '2024-01-01', unitNumber: '5', strata: null,
      })

      const stats1 = await runDataQuality(conn)
      const stats2 = await runDataQuality(conn)

      expect(stats1.nominalTransferCount).toBe(stats2.nominalTransferCount)
      expect(stats1.likelyStrataCount).toBe(stats2.likelyStrataCount)
      expect(stats1.bulkSaleCount).toBe(stats2.bulkSaleCount)
      expect(stats1.partialInterestCount).toBe(stats2.partialInterestCount)
      expect(stats1.priceOutlierCount).toBe(stats2.priceOutlierCount)
      expect(stats1.multiDealingDupCount).toBe(stats2.multiDealingDupCount)
    })
  })

  // -------------------------------------------------------------------------
  // Price outliers — spatial cell-level IQR
  // -------------------------------------------------------------------------

  describe('flagPriceOutliers — spatial cell-level IQR', () => {
    /**
     * Insert a cluster of geocoded sales at nearby coordinates.
     * Each sale gets a unique propertyId (`${prefix}${i}`) and unique price
     * (`basePrice + i * priceStep`). Coordinates are spaced ~17m apart in
     * latitude — well within one H3 res 7 cell (~2.5km across).
     * All sales in the cluster share the same cell, so the cell-level IQR
     * aggregation pools them into one neighbourhood.
     */
    async function insertCluster(opts: {
      count: number
      baseLat: number
      baseLng: number
      basePrice: number
      priceStep: number
      year: string
      prefix: string
      segment?: 'freehold' | 'strata'
    }): Promise<void> {
      for (let i = 0; i < opts.count; i++) {
        const isStrata = opts.segment === 'strata'
        await insertGeocodedSale(conn, {
          propertyId: `${opts.prefix}${i}`,
          dealingNumber: `D${opts.prefix}${i}`,
          purchasePrice: opts.basePrice + i * opts.priceStep,
          contractDate: `${opts.year}-06-15`,
          unitNumber: isStrata ? `${i + 1}` : null,
          strata: isStrata ? 'SP99999' : null,
          latitude: opts.baseLat + i * 0.00015,
          longitude: opts.baseLng,
        })
      }
    }

    it('flags extreme price among geocoded cluster', async () => {
      // 21 normal freehold sales ($500K–$600K) clustered near Sydney CBD.
      // Cell neighbourhood IQR ≈ $50K, so 3×IQR fence is ~$725K.
      // The $50M outlier far exceeds this.
      await insertCluster({
        count: 21,
        baseLat: -33.868,
        baseLng: 151.209,
        basePrice: 500_000,
        priceStep: 5_000,
        year: '2024',
        prefix: 'N',
      })
      // Extreme outlier at the same location
      await insertGeocodedSale(conn, {
        propertyId: 'OUT1',
        dealingNumber: 'DOUT1',
        purchasePrice: 50_000_000,
        contractDate: '2024-06-15',
        latitude: -33.868,
        longitude: 151.2091,
      })

      const stats = await runDataQuality(conn)
      expect(stats.priceOutlierCount).toBe(1)

      // Verify it's the right record
      const result = await conn.runAndReadAll(
        'SELECT property_id FROM fact_property_sale WHERE is_price_outlier = TRUE',
      )
      expect(result.getRows().map((r) => r[0])).toEqual(['OUT1'])
    })

    it('does not flag when fewer than 20 neighbors in cell', async () => {
      // 15 sales — only 15 in the cell neighbourhood, below the 20-sale
      // HAVING gate. Even an extreme price won't be flagged without context.
      await insertCluster({
        count: 15,
        baseLat: -33.868,
        baseLng: 151.209,
        basePrice: 500_000,
        priceStep: 5_000,
        year: '2024',
        prefix: 'S',
      })
      await insertGeocodedSale(conn, {
        propertyId: 'OUT1',
        dealingNumber: 'DOUT1',
        purchasePrice: 50_000_000,
        contractDate: '2024-06-15',
        latitude: -33.868,
        longitude: 151.2091,
      })

      const stats = await runDataQuality(conn)
      expect(stats.priceOutlierCount).toBe(0)
    })

    it('isolates strata from freehold neighborhoods', async () => {
      // 21 strata sales nearby — plenty for cell IQR, but wrong segment.
      // A freehold sale with extreme price has 0 freehold neighbors in cell.
      await insertCluster({
        count: 21,
        baseLat: -33.868,
        baseLng: 151.209,
        basePrice: 300_000,
        priceStep: 3_000,
        year: '2024',
        prefix: 'ST',
        segment: 'strata',
      })
      // Freehold sale at extreme price — no freehold neighbors exist
      await insertGeocodedSale(conn, {
        propertyId: 'FH1',
        dealingNumber: 'DFH1',
        purchasePrice: 50_000_000,
        contractDate: '2024-06-15',
        latitude: -33.868,
        longitude: 151.2091,
      })

      const stats = await runDataQuality(conn)
      // Freehold outlier: 0 freehold neighbors → not flagged
      // Strata sales: reasonable prices → not flagged
      expect(stats.priceOutlierCount).toBe(0)
    })

    it('respects temporal window — distant years excluded', async () => {
      // 21 sales in 2015 — too far from the 2024 target (9 years > ±3 window)
      await insertCluster({
        count: 21,
        baseLat: -33.868,
        baseLng: 151.209,
        basePrice: 500_000,
        priceStep: 5_000,
        year: '2015',
        prefix: 'OLD',
      })
      // Extreme sale in 2024 — no neighbors within ±3 years
      await insertGeocodedSale(conn, {
        propertyId: 'NEW1',
        dealingNumber: 'DNEW1',
        purchasePrice: 50_000_000,
        contractDate: '2024-06-15',
        latitude: -33.868,
        longitude: 151.2091,
      })

      const stats = await runDataQuality(conn)
      expect(stats.priceOutlierCount).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Price outliers — locality fallback
  // -------------------------------------------------------------------------

  describe('flagPriceOutliers — locality fallback', () => {
    it('flags extreme price for ungeocodable records', async () => {
      // 21 ungeocodable sales (no dim_address) in the same locality/segment.
      // Each has 20 peers. IQR from $500K–$600K ≈ $50K. 3×IQR fence ≈ $725K.
      for (let i = 0; i < 21; i++) {
        await insertSale(conn, {
          propertyId: `UG${i}`,
          dealingNumber: `DUG${i}`,
          purchasePrice: 500_000 + i * 5_000,
          contractDate: '2024-06-15',
          locality: 'TESTBURGH',
        })
      }
      // Extreme ungeocodable sale in same locality
      await insertSale(conn, {
        propertyId: 'UGOUT',
        dealingNumber: 'DUGOUT',
        purchasePrice: 50_000_000,
        contractDate: '2024-06-15',
        locality: 'TESTBURGH',
      })

      const stats = await runDataQuality(conn)
      expect(stats.priceOutlierCount).toBe(1)

      const result = await conn.runAndReadAll(
        'SELECT property_id FROM fact_property_sale WHERE is_price_outlier = TRUE',
      )
      expect(result.getRows().map((r) => r[0])).toEqual(['UGOUT'])
    })

    it('does not flag with insufficient locality peers', async () => {
      // 10 ungeocodable sales — only 9 peers, below the 20-sale minimum.
      for (let i = 0; i < 10; i++) {
        await insertSale(conn, {
          propertyId: `UG${i}`,
          dealingNumber: `DUG${i}`,
          purchasePrice: 500_000 + i * 5_000,
          contractDate: '2024-06-15',
          locality: 'TINYTON',
        })
      }
      await insertSale(conn, {
        propertyId: 'UGOUT',
        dealingNumber: 'DUGOUT',
        purchasePrice: 50_000_000,
        contractDate: '2024-06-15',
        locality: 'TINYTON',
      })

      const stats = await runDataQuality(conn)
      expect(stats.priceOutlierCount).toBe(0)
    })
  })
})
