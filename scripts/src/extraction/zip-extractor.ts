/**
 * ZIP extraction module for NSW Valuer General data downloads.
 *
 * Handles all ZIP packaging variants:
 * - 1990-2000: flat ARCHIVE_SALES_YYYY.DAT
 * - 2001: hybrid (date folders + archive folder)
 * - 2002-2018: year subfolder with human-readable date directories
 * - 2019-2020: year subfolder with nested YYYYMMDD.zip files
 * - Weekly (2026): flat per-district DAT files
 *
 * All variants are handled uniformly by processing entries based on their filenames
 * rather than detecting ZIP type upfront.
 */

import { mkdir, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl-promise'
import { yearFromArchiveFilename, dateFromDatFilename } from './date-utils.js'

export interface ExtractionResult {
  zipPath: string
  filesExtracted: number
  filesSkipped: number
  targetDirs: Set<string>
}

export interface ExtractOptions {
  /** Re-extract even if destination files exist. Default: false. */
  force?: boolean
}

/**
 * Extract a single ZIP file into the NSWVGData directory structure.
 * Idempotent: skips files whose target directories already contain DAT files
 * unless force is set.
 */
export async function extractZip(
  zipPath: string,
  dataBasePath: string,
  options?: ExtractOptions,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    zipPath,
    filesExtracted: 0,
    filesSkipped: 0,
    targetDirs: new Set(),
  }

  const zip = await yauzl.open(zipPath)
  try {
    for await (const entry of zip) {
      // Skip directories
      if (entry.filename.endsWith('/')) continue

      const filename = basename(entry.filename)

      // Skip non-data files
      if (filename.toLowerCase() === 'creative_commons.txt') continue

      // Handle nested ZIP files (2019-2020 format)
      if (filename.toLowerCase().endsWith('.zip')) {
        const readStream = await entry.openReadStream()
        const chunks: Buffer[] = []
        for await (const chunk of readStream) {
          chunks.push(chunk as Buffer)
        }
        const buffer = Buffer.concat(chunks)

        const nestedResult = await extractNestedZip(buffer, filename, dataBasePath, options)
        result.filesExtracted += nestedResult.filesExtracted
        result.filesSkipped += nestedResult.filesSkipped
        for (const dir of nestedResult.targetDirs) {
          result.targetDirs.add(dir)
        }
        continue
      }

      // Handle DAT files
      if (!filename.toUpperCase().endsWith('.DAT')) continue

      const target = resolveTarget(filename, dataBasePath)
      if (!target) continue

      result.targetDirs.add(target.dir)

      // Idempotency: skip if file exists (unless forced)
      if (!options?.force) {
        try {
          await access(target.path)
          result.filesSkipped++
          continue
        } catch {
          // File doesn't exist — extract it
        }
      }

      await mkdir(target.dir, { recursive: true })

      const readStream = await entry.openReadStream()
      const writeStream = createWriteStream(target.path)
      await pipeline(readStream, writeStream)
      result.filesExtracted++
    }
  } finally {
    await zip.close()
  }

  return result
}

/**
 * Extract all ZIP files from a downloads directory.
 *
 * @param downloadsPath - Path to downloadedZips/ directory (should contain yearly/ and/or weekly/)
 * @param dataBasePath - Path to NSWVGData/ directory
 */
export async function extractAllZips(
  downloadsPath: string,
  dataBasePath: string,
  options?: ExtractOptions & { yearlyOnly?: boolean; weeklyOnly?: boolean },
): Promise<ExtractionResult[]> {
  const { readdir } = await import('node:fs/promises')
  const results: ExtractionResult[] = []

  if (!options?.weeklyOnly) {
    const yearlyDir = join(downloadsPath, 'yearly')
    try {
      const yearlyFiles = await readdir(yearlyDir)
      const zips = yearlyFiles.filter(f => f.endsWith('.zip')).sort()
      for (const zipFile of zips) {
        const result = await extractZip(join(yearlyDir, zipFile), dataBasePath, options)
        results.push(result)
      }
    } catch {
      // yearly/ directory doesn't exist — skip
    }
  }

  if (!options?.yearlyOnly) {
    const weeklyDir = join(downloadsPath, 'weekly')
    try {
      const weeklyFiles = await readdir(weeklyDir)
      const zips = weeklyFiles.filter(f => f.endsWith('.zip')).sort()
      for (const zipFile of zips) {
        const result = await extractZip(join(weeklyDir, zipFile), dataBasePath, options)
        results.push(result)
      }
    } catch {
      // weekly/ directory doesn't exist — skip
    }
  }

  return results
}

/**
 * Extract DAT files from a nested ZIP buffer (for 2019-2020 format where
 * yearly zips contain inner YYYYMMDD.zip files).
 */
async function extractNestedZip(
  buffer: Buffer,
  nestedZipName: string,
  dataBasePath: string,
  options?: ExtractOptions,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    zipPath: nestedZipName,
    filesExtracted: 0,
    filesSkipped: 0,
    targetDirs: new Set(),
  }

  const zip = await yauzl.fromBuffer(buffer)
  try {
    for await (const entry of zip) {
      if (entry.filename.endsWith('/')) continue

      const filename = basename(entry.filename)
      if (filename.toLowerCase() === 'creative_commons.txt') continue
      if (!filename.toUpperCase().endsWith('.DAT')) continue

      const target = resolveTarget(filename, dataBasePath)
      if (!target) continue

      result.targetDirs.add(target.dir)

      if (!options?.force) {
        try {
          await access(target.path)
          result.filesSkipped++
          continue
        } catch {
          // File doesn't exist — extract it
        }
      }

      await mkdir(target.dir, { recursive: true })

      const readStream = await entry.openReadStream()
      const writeStream = createWriteStream(target.path)
      await pipeline(readStream, writeStream)
      result.filesExtracted++
    }
  } finally {
    await zip.close()
  }

  return result
}

/**
 * Determine the target directory and file path for a DAT file.
 * Derives the year and YYYYMMDD folder from the filename.
 */
function resolveTarget(
  filename: string,
  dataBasePath: string,
): { dir: string; path: string } | null {
  // Check for archived format: ARCHIVE_SALES_YYYY.DAT
  const archiveYear = yearFromArchiveFilename(filename)
  if (archiveYear !== null) {
    const dir = join(dataBasePath, String(archiveYear), 'archive')
    return { dir, path: join(dir, filename) }
  }

  // Check for current format: NNN_SALES_DATA_NNME_DDMMYYYY.DAT
  const dateInfo = dateFromDatFilename(filename)
  if (dateInfo) {
    const dir = join(dataBasePath, String(dateInfo.year), dateInfo.yyyymmdd)
    return { dir, path: join(dir, filename) }
  }

  // Unknown filename pattern — skip
  return null
}
