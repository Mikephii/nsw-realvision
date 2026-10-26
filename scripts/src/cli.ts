#!/usr/bin/env node

/**
 * CLI entrypoint for the NSW RealVision ETL pipeline.
 *
 * Commands:
 *   extract           Extract ZIP files from downloadedZips/ into year/week structure
 *   load              Discover, parse, clean, and load .DAT files into DuckDB
 *   load --full       Force full reload (drop and recreate all tables)
 *   parse-only <file> Parse a single .DAT file and print results
 *   status            Show loading status
 *   reset             Drop all tables and reinitialise schema
 *   geocode           Geocode addresses using G-NAF data
 */

import { Command } from 'commander'
import { resolve, join } from 'node:path'
import { getConnection, closeConnection } from './db/connection.js'
import { initSchema, dropAllTables } from './db/schema.js'
import { loadSales, loadDimDistricts, loadDimZones } from './db/loader.js'
import { markFileLoaded, filterNewFiles, getLoadingStatus, getFactTableCount } from './db/incremental.js'
import { discoverDatFiles, summarizeDiscovery } from './discovery/file-discovery.js'
import { parseFile } from './parser/file-parser.js'
import { parseArchivedFile } from './parser/archived-file-parser.js'
import { combineSaleRecords } from './parser/record-combiner.js'
import { cleanSaleUnit } from './cleaner/index.js'
import { cleanArchivedSale } from './cleaner/archived.js'
import { extractAllZips } from './extraction/zip-extractor.js'
import { getAllDistricts } from './reference/districts.js'
import { getAllLepZones, getAllLegacyZones } from './reference/zones.js'
import { extractAddresses, getAddressCount } from './geocode/extract-addresses.js'
import { downloadAndExtractGnaf, findGnafFiles } from './geocode/gnaf-downloader.js'
import { loadGnafStaging, dropGnafStaging } from './geocode/gnaf-loader.js'
import { matchAddresses } from './geocode/address-matcher.js'
import { getGeocodeCoverage, formatCoverage } from './geocode/geocode-status.js'
import type { PropertySale } from './types/property-sale.js'
import { rebuildHeatmapAggregates } from './heatmap/h3-precompute.js'
import { rebuildLoessCurves } from './heatmap/loess-curve-precompute.js'
import { runDataQuality } from './db/data-quality.js'

const DEFAULT_DB_PATH = resolve(import.meta.dirname, '../../data/realvision.duckdb')
const DEFAULT_DATA_PATH = resolve(import.meta.dirname, '../../NSWVGData')
const DEFAULT_GNAF_PATH = resolve(import.meta.dirname, '../../GNAFData')

const program = new Command()
  .name('nsw-realvision-etl')
  .description('NSW property sales data ETL pipeline')
  .version('0.1.0')

program
  .command('extract')
  .description('Extract ZIP files from downloadedZips/ into the NSWVGData year/week structure')
  .option('--data <path>', 'NSWVGData directory path', DEFAULT_DATA_PATH)
  .option('--force', 'Re-extract even if destination files exist')
  .option('--yearly-only', 'Only extract yearly zips')
  .option('--weekly-only', 'Only extract weekly zips')
  .action(async (opts) => {
    const downloadsPath = join(opts.data, 'downloadedZips')
    console.log(`Extracting ZIPs from ${downloadsPath}...`)

    const results = await extractAllZips(downloadsPath, opts.data, {
      force: opts.force,
      yearlyOnly: opts.yearlyOnly,
      weeklyOnly: opts.weeklyOnly,
    })

    let totalExtracted = 0
    let totalSkipped = 0
    for (const result of results) {
      totalExtracted += result.filesExtracted
      totalSkipped += result.filesSkipped
      if (result.filesExtracted > 0) {
        const zipName = result.zipPath.split('/').pop()
        console.log(`  ${zipName}: ${result.filesExtracted} extracted, ${result.filesSkipped} skipped`)
      }
    }

    console.log(`\nDone! ${totalExtracted} files extracted, ${totalSkipped} already existed.`)
    console.log(`Processed ${results.length} ZIP files.`)
  })

program
  .command('load')
  .description('Discover, parse, clean, and load .DAT files into DuckDB')
  .option('--full', 'Force full reload (drop and recreate all tables)')
  .option('--db <path>', 'DuckDB database path', DEFAULT_DB_PATH)
  .option('--data <path>', 'NSWVGData directory path', DEFAULT_DATA_PATH)
  .option('--batch-size <n>', 'Files per batch', '100')
  .option('--gnaf <path>', 'G-NAF data directory (for geocoding after load)', DEFAULT_GNAF_PATH)
  .option('--skip-geocode', 'Skip geocoding step after loading')
  .option('--skip-quality', 'Skip data quality flagging step')
  .option('--skip-heatmap', 'Skip heatmap aggregate rebuild after loading')
  .action(async (opts) => {
    const conn = await getConnection(opts.db)

    try {
      if (opts.full) {
        console.log('Full reload: dropping all tables...')
        await dropAllTables(conn)
      }

      await initSchema(conn)
      console.log('Schema initialised.')

      // Load dimension tables
      await loadDimDistricts(conn, getAllDistricts())
      const allZones = [
        ...getAllLepZones().map(z => ({ code: z.code, name: z.name, category: z.category })),
        ...getAllLegacyZones().map(z => ({ code: z.code, name: z.name, category: z.category })),
      ]
      await loadDimZones(conn, allZones)
      console.log('Dimension tables loaded.')

      // Discover files
      console.log(`Scanning ${opts.data} for .DAT files...`)
      const allFiles = await discoverDatFiles(opts.data)
      const summary = summarizeDiscovery(allFiles)
      console.log(`Found ${summary.totalFiles} .DAT files across years ${summary.years.join(', ')}`)
      if (summary.archivedFiles > 0) {
        console.log(`  Including ${summary.archivedFiles} archived format files (1990-2001)`)
      }

      // Filter to new files only (unless full reload)
      const files = opts.full ? allFiles : await filterNewFiles(conn, allFiles)
      console.log(`${files.length} new files to load.`)

      if (files.length === 0) {
        console.log('Nothing to load.')
        return
      }

      // Process files in batches
      const batchSize = parseInt(opts.batchSize, 10)
      let totalLoaded = 0
      let filesProcessed = 0
      let errors = 0
      let totalWarnings = 0

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        const batchSales: PropertySale[] = []

        for (const meta of batch) {
          try {
            let sales: PropertySale[]

            if (meta.format === 'archived') {
              // Archived format (1990-2001): monolithic files can be very large (100k+ records).
              // Load them individually to avoid memory issues with batching.
              const parsed = await parseArchivedFile(meta.filePath, { skipValidation: false })
              if (parsed.warnings.length > 0) {
                totalWarnings += parsed.warnings.length
                console.warn(`\n  ${meta.filePath}: ${parsed.warnings.length} parse warnings`)
              }
              sales = parsed.sales.map((record, idx) =>
                cleanArchivedSale(record, meta, idx),
              )
              const loaded = await loadSales(conn, sales)
              totalLoaded += loaded
              await markFileLoaded(conn, meta, sales.length)
              filesProcessed++
              console.log(`\n  Archived ${meta.year}: ${sales.length} records loaded`)
              continue
            } else {
              // Current format (2001+): standard B/C/D records
              const parsed = await parseFile(meta.filePath, { skipValidation: false })
              if (parsed.warnings.length > 0) {
                totalWarnings += parsed.warnings.length
                console.warn(`\n  ${meta.filePath}: ${parsed.warnings.length} parse warnings`)
              }
              const units = combineSaleRecords(parsed)
              sales = units.map(u => cleanSaleUnit(u, meta))
            }

            for (const sale of sales) {
              batchSales.push(sale)
            }

            // Track file as loaded
            await markFileLoaded(conn, meta, sales.length)
            filesProcessed++
          } catch (err) {
            errors++
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`\nError processing ${meta.filePath}: ${msg}`)
          }
        }

        if (batchSales.length > 0) {
          const loaded = await loadSales(conn, batchSales)
          totalLoaded += loaded
        }

        const pct = Math.round(((i + batch.length) / files.length) * 100)
        process.stdout.write(`\r  Progress: ${i + batch.length}/${files.length} files (${pct}%), ${totalLoaded} records loaded`)
      }

      console.log('\n')
      console.log(`Done! ${filesProcessed} files processed, ${totalLoaded} records loaded.`)
      if (errors > 0) {
        console.log(`${errors} files had errors (see above).`)
      }
      if (totalWarnings > 0) {
        console.log(`${totalWarnings} parse warnings (skipped lines or count mismatches).`)
      }

      // Show final counts
      const factCount = await getFactTableCount(conn)
      console.log(`Total records in database: ${factCount}`)

      // Geocode new addresses
      if (!opts.skipGeocode) {
        console.log('\nGeocoding new addresses...')
        const newAddresses = await extractAddresses(conn)
        const totalAddresses = await getAddressCount(conn)
        console.log(`  ${totalAddresses.toLocaleString()} distinct addresses (${newAddresses.toLocaleString()} new)`)

        const gnafFiles = await findGnafFiles(opts.gnaf)
        if (gnafFiles) {
          console.log('  Loading G-NAF staging...')
          const gnafCount = await loadGnafStaging(conn, gnafFiles.addressDetailPath, gnafFiles.geocodePath, gnafFiles.streetLocalityPath, gnafFiles.localityPath)
          console.log(`  ${gnafCount.toLocaleString()} G-NAF addresses loaded`)

          console.log('  Matching...')
          const stats = await matchAddresses(conn)
          await dropGnafStaging(conn)

          const matched = stats.matchedExact + stats.matchedFuzzy + stats.matchedCentroid
          console.log(`  Exact: ${stats.matchedExact}, Fuzzy: ${stats.matchedFuzzy}, Centroid: ${stats.matchedCentroid}, Unmatched: ${stats.unmatched}`)
          console.log(`  ${matched.toLocaleString()} addresses geocoded in ${(stats.elapsedMs / 1000).toFixed(1)}s`)
        } else {
          console.log(`  No G-NAF data found in ${opts.gnaf}`)
          console.log('  Run: pnpm etl geocode --download    to fetch G-NAF and geocode')
        }
      }

      // Run data quality pipeline (nominal transfers, strata misclassification,
      // duplicates, bulk sales, partial interest, price outliers)
      if (!opts.skipQuality) {
        console.log('\nRunning data quality pipeline...')
        const dqStats = await runDataQuality(conn)
        console.log(`  ${dqStats.nominalTransferCount.toLocaleString()} nominal transfers`)
        console.log(`  ${dqStats.likelyStrataCount.toLocaleString()} likely strata`)
        console.log(`  ${dqStats.multiDealingDupCount.toLocaleString()} multi-dealing dups`)
        console.log(`  ${dqStats.bulkSaleCount.toLocaleString()} bulk sales`)
        console.log(`  ${dqStats.partialInterestCount.toLocaleString()} partial interest`)
        console.log(`  ${dqStats.priceOutlierCount.toLocaleString()} price outliers`)
        console.log(`  Completed in ${(dqStats.elapsedMs / 1000).toFixed(1)}s`)
      }

      // Rebuild heatmap aggregates (H3 growth precomputation)
      if (!opts.skipHeatmap) {
        console.log('\nRebuilding growth heatmap aggregates...')
        const stats = await rebuildHeatmapAggregates(conn)
        console.log(`  ${stats.totalRows} rows across ${stats.combinations} combinations in ${(stats.elapsedMs / 1000).toFixed(1)}s`)

        console.log('\nRebuilding LOESS curve precomputation...')
        const loessStats = await rebuildLoessCurves(conn)
        console.log(`  ${loessStats.totalRows} cells across ${loessStats.combinations} combinations in ${(loessStats.elapsedMs / 1000).toFixed(1)}s`)
      }
    } finally {
      closeConnection()
    }
  })

program
  .command('parse-only <file>')
  .description('Parse a single .DAT file and print results (for debugging)')
  .action(async (file: string) => {
    const filePath = resolve(file)
    console.log(`Parsing: ${filePath}\n`)

    // Detect format from path
    const isArchived = /\/archive\/ARCHIVE_SALES_/i.test(filePath)

    if (isArchived) {
      const parsed = await parseArchivedFile(filePath)
      console.log(`Header: district=${parsed.header.districtCode}, type=${parsed.header.fileType}`)
      console.log(`Records: ${parsed.sales.length} sales (archived format, no C/D records)`)
      console.log(`Trailer: total=${parsed.trailer.totalRecords}, B=${parsed.trailer.totalBRecords}`)

      // Print first few sales
      const limit = Math.min(parsed.sales.length, 5)
      for (let i = 0; i < limit; i++) {
        const s = parsed.sales[i]
        console.log(`\n--- Sale ${i + 1} ---`)
        console.log(`  Property: ${s.houseNum} ${s.streetName}, ${s.suburbName} ${s.postcode}`)
        console.log(`  Price: $${s.purchasePrice}`)
        console.log(`  Contract: ${s.contractDate}`)
        console.log(`  Zone: ${s.zoneCode}`)
        console.log(`  Area: ${s.area} ${s.areaType}`)
        console.log(`  Land desc: ${s.landDescription.substring(0, 80) || '(none)'}`)
        console.log(`  Valuation: ${s.valuationNum}`)
      }

      if (parsed.sales.length > limit) {
        console.log(`\n... and ${parsed.sales.length - limit} more.`)
      }
    } else {
      const parsed = await parseFile(filePath)
      console.log(`Header: district=${parsed.header.districtCode}, type=${parsed.header.fileType}`)
      console.log(`Records: ${parsed.sales.length} sales, ${parsed.descriptions.length} descriptions, ${parsed.owners.length} owners`)
      console.log(`Trailer: total=${parsed.trailer.totalRecords}, B=${parsed.trailer.totalBRecords}, C=${parsed.trailer.totalCRecords ?? 0}, D=${parsed.trailer.totalDRecords ?? 0}`)

      const units = combineSaleRecords(parsed)
      console.log(`\nCombined into ${units.length} sale units.\n`)

      // Print first few sales
      const limit = Math.min(units.length, 5)
      for (let i = 0; i < limit; i++) {
        const u = units[i]
        console.log(`--- Sale ${i + 1} ---`)
        console.log(`  Property: ${u.sale.propertyHouseNumber} ${u.sale.propertyStreetName}, ${u.sale.propertyLocality} ${u.sale.propertyPostCode}`)
        console.log(`  Price: $${u.sale.purchasePrice}`)
        console.log(`  Contract: ${u.sale.contractDate}  Settlement: ${u.sale.settlementDate}`)
        console.log(`  Zone: ${u.sale.zoneCode}  Nature: ${u.sale.natureOfProperty}`)
        console.log(`  Area: ${u.sale.areaSize} ${u.sale.areaType}`)
        console.log(`  Legal: ${u.legalDescription ?? '(none)'}`)
        console.log(`  Dealing: ${u.sale.dealingNumber}`)
      }

      if (units.length > limit) {
        console.log(`\n... and ${units.length - limit} more.`)
      }
    }
  })

program
  .command('status')
  .description('Show loading status')
  .option('--db <path>', 'DuckDB database path', DEFAULT_DB_PATH)
  .action(async (opts) => {
    const conn = await getConnection(opts.db)

    try {
      await initSchema(conn)
      const status = await getLoadingStatus(conn)
      const factCount = await getFactTableCount(conn)

      console.log('NSW RealVision ETL Status')
      console.log('=====================')
      console.log(`Database: ${opts.db}`)
      console.log(`Files loaded: ${status.totalFilesLoaded}`)
      console.log(`Records tracked in ETL: ${status.totalRecords}`)
      console.log(`Records in fact table: ${factCount}`)
      if (status.yearRange) {
        console.log(`Year range: ${status.yearRange.min}–${status.yearRange.max}`)
      }
      if (status.lastLoadedAt) {
        console.log(`Last loaded: ${status.lastLoadedAt}`)
      }
    } finally {
      closeConnection()
    }
  })

program
  .command('reset')
  .description('Drop all tables and reinitialise schema')
  .option('--db <path>', 'DuckDB database path', DEFAULT_DB_PATH)
  .action(async (opts) => {
    const conn = await getConnection(opts.db)

    try {
      console.log('Dropping all tables...')
      await dropAllTables(conn)
      console.log('Reinitialising schema...')
      await initSchema(conn)
      console.log('Done. Database is empty and ready.')
    } finally {
      closeConnection()
    }
  })

program
  .command('geocode')
  .description('Geocode addresses using G-NAF data (extract addresses, match lat/long)')
  .option('--db <path>', 'DuckDB database path', DEFAULT_DB_PATH)
  .option('--gnaf <path>', 'Directory containing G-NAF NSW PSV files', DEFAULT_GNAF_PATH)
  .option('--download', 'Download latest G-NAF from data.gov.au before geocoding')
  .option('--refresh', 'Clear all existing geocodes and re-match from scratch')
  .option('--status', 'Show geocoding coverage statistics only')
  .action(async (opts) => {
    const conn = await getConnection(opts.db)

    try {
      await initSchema(conn)

      // Status-only mode
      if (opts.status) {
        const coverage = await getGeocodeCoverage(conn)
        console.log(formatCoverage(coverage))
        return
      }

      // Download GNAF if requested
      if (opts.download) {
        await downloadAndExtractGnaf(opts.gnaf)
      }

      // Check GNAF files exist
      const gnafFiles = await findGnafFiles(opts.gnaf)
      if (!gnafFiles) {
        console.error(`No G-NAF NSW PSV files found in ${opts.gnaf}`)
        console.error('Run with --download to fetch from data.gov.au, or provide --gnaf <path>')
        process.exit(1)
      }

      // Refresh: clear existing geocodes
      if (opts.refresh) {
        console.log('Clearing existing geocodes...')
        await conn.run(`
          UPDATE dim_address SET
            latitude = NULL, longitude = NULL,
            geocode_source = NULL, geocode_confidence = NULL,
            gnaf_pid = NULL, geocoded_at = NULL;
        `)
      }

      // Step 1: Extract addresses from fact table
      console.log('Extracting addresses from fact_property_sale...')
      const newAddresses = await extractAddresses(conn)
      const totalAddresses = await getAddressCount(conn)
      console.log(`  Found ${totalAddresses.toLocaleString()} distinct addresses (${newAddresses.toLocaleString()} new)`)

      if (totalAddresses === 0) {
        console.log('No addresses to geocode. Load sales data first with: pnpm etl load')
        return
      }

      // Step 2: Load GNAF into staging
      console.log('Loading G-NAF NSW into staging...')
      const gnafCount = await loadGnafStaging(conn, gnafFiles.addressDetailPath, gnafFiles.geocodePath, gnafFiles.streetLocalityPath, gnafFiles.localityPath)
      console.log(`  ${gnafCount.toLocaleString()} geocoded NSW addresses loaded`)

      // Step 3: Run matching
      console.log('Matching addresses...')
      const stats = await matchAddresses(conn)
      stats.newAddressesExtracted = newAddresses

      console.log(`  Tier 1 (exact):    ${stats.matchedExact.toLocaleString()} matched`)
      console.log(`  Tier 2 (fuzzy):    ${stats.matchedFuzzy.toLocaleString()} matched`)
      console.log(`  Tier 3 (centroid): ${stats.matchedCentroid.toLocaleString()} matched`)
      console.log(`  Unmatched:         ${stats.unmatched.toLocaleString()}`)

      // Clean up staging
      await dropGnafStaging(conn)

      const matched = stats.matchedExact + stats.matchedFuzzy + stats.matchedCentroid
      console.log(`\nDone! ${matched.toLocaleString()} addresses geocoded in ${(stats.elapsedMs / 1000).toFixed(1)}s.`)
    } finally {
      closeConnection()
    }
  })

program
  .command('data-quality')
  .description('Run data quality pipeline: flag nominal transfers, strata misclassification, duplicates, bulk sales, partial interest, and price outliers')
  .option('--db <path>', 'DuckDB database path', DEFAULT_DB_PATH)
  .action(async (opts) => {
    const conn = await getConnection(opts.db)

    try {
      await initSchema(conn)
      console.log('Running data quality pipeline...')
      const stats = await runDataQuality(conn)
      console.log(`\nData quality flags:`)
      console.log(`  ${stats.nominalTransferCount.toLocaleString()} nominal transfers (price < $1,000)`)
      console.log(`  ${stats.likelyStrataCount.toLocaleString()} likely strata (community/company title apartments)`)
      console.log(`  ${stats.multiDealingDupCount.toLocaleString()} multi-dealing duplicates`)
      console.log(`  ${stats.bulkSaleCount.toLocaleString()} bulk sales`)
      console.log(`  ${stats.partialInterestCount.toLocaleString()} partial interest sales`)
      console.log(`  ${stats.priceOutlierCount.toLocaleString()} price outliers (3× IQR)`)
      console.log(`\nCompleted in ${(stats.elapsedMs / 1000).toFixed(1)}s`)
    } finally {
      closeConnection()
    }
  })

program
  .command('recompute-heatmap')
  .description('Rebuild the H3 growth heatmap aggregates from scratch (~18s)')
  .option('--db <path>', 'DuckDB database path', DEFAULT_DB_PATH)
  .action(async (opts) => {
    const conn = await getConnection(opts.db)

    try {
      await initSchema(conn)
      console.log('Rebuilding growth heatmap aggregates...')
      const stats = await rebuildHeatmapAggregates(conn)
      console.log(`\nDone! ${stats.totalRows} rows across ${stats.combinations} combinations in ${(stats.elapsedMs / 1000).toFixed(1)}s`)
    } finally {
      closeConnection()
    }
  })

program
  .command('recompute-loess')
  .description('Rebuild the LOESS curve precomputation from scratch')
  .option('--db <path>', 'DuckDB database path', DEFAULT_DB_PATH)
  .action(async (opts) => {
    const conn = await getConnection(opts.db)

    try {
      await initSchema(conn)
      console.log('Rebuilding LOESS curve precomputation...')
      const stats = await rebuildLoessCurves(conn)
      console.log(`\nDone! ${stats.totalRows} cells across ${stats.combinations} combinations in ${(stats.elapsedMs / 1000).toFixed(1)}s`)
    } finally {
      closeConnection()
    }
  })

program.parse()
