/**
 * Discovers .DAT files in the NSWVGData directory structure.
 * Extracts metadata (year, week, district code, format) from paths and filenames.
 *
 * Handles two file types:
 * - Current format (2001+): NSWVGData/{year}/{week}/{districtCode}_SALES_DATA_NNME_{date}.DAT
 * - Archived format (1990-2001): NSWVGData/{year}/archive/ARCHIVE_SALES_{year}.DAT
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileMetadata } from '../types/property-sale.js'

/** Pattern for current format .DAT filenames */
const DAT_FILENAME_PATTERN = /^(\d{3})_SALES_DATA_NNME_\d{8}\.DAT$/i

/** Pattern for archived format .DAT filenames */
const ARCHIVE_FILENAME_PATTERN = /^ARCHIVE_SALES_\d{4}\.DAT$/i

/**
 * Discover all .DAT files in the data directory (both current and archived formats).
 *
 * @param basePath - Path to the NSWVGData directory
 * @returns Array of FileMetadata sorted by year, week, then district code
 */
export async function discoverDatFiles(basePath: string): Promise<FileMetadata[]> {
  const results: FileMetadata[] = []

  // List year directories
  const yearEntries = await readdir(basePath, { withFileTypes: true })
  const yearDirs = yearEntries
    .filter(e => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map(e => e.name)
    .sort()

  for (const yearDir of yearDirs) {
    const year = parseInt(yearDir, 10)
    const yearPath = join(basePath, yearDir)

    const subEntries = await readdir(yearPath, { withFileTypes: true })

    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory()) continue

      if (subEntry.name === 'archive') {
        // Archived format: {year}/archive/ARCHIVE_SALES_{year}.DAT
        const archivePath = join(yearPath, 'archive')
        const archiveFiles = await readdir(archivePath, { withFileTypes: true })

        for (const archiveFile of archiveFiles) {
          if (!archiveFile.isFile()) continue
          if (!ARCHIVE_FILENAME_PATTERN.test(archiveFile.name)) continue

          results.push({
            filePath: join(archivePath, archiveFile.name),
            year,
            week: 'archive',
            districtCode: 'ALL',
            format: 'archived',
          })
        }
      } else if (/^\d{8}$/.test(subEntry.name)) {
        // Current format: {year}/{YYYYMMDD}/{district}_SALES_DATA_NNME_{date}.DAT
        const weekPath = join(yearPath, subEntry.name)
        const fileEntries = await readdir(weekPath, { withFileTypes: true })

        for (const fileEntry of fileEntries) {
          if (!fileEntry.isFile()) continue

          const match = fileEntry.name.match(DAT_FILENAME_PATTERN)
          if (!match) continue

          results.push({
            filePath: join(weekPath, fileEntry.name),
            year,
            week: subEntry.name,
            districtCode: match[1],
            format: 'current',
          })
        }
      }
    }
  }

  // Sort: archived files first (so current format overwrites via dedup), then by year, week, district
  results.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year
    // 'archive' sorts before numeric week strings
    if (a.week !== b.week) return a.week.localeCompare(b.week)
    return a.districtCode.localeCompare(b.districtCode)
  })

  return results
}

/**
 * Get summary stats about discovered files.
 */
export function summarizeDiscovery(files: FileMetadata[]): {
  totalFiles: number
  years: number[]
  weeksPerYear: Record<number, number>
  districtsFound: number
  archivedFiles: number
} {
  const years = new Set<number>()
  const weeksPerYear: Record<number, Set<string>> = {}
  const districts = new Set<string>()
  let archivedFiles = 0

  for (const file of files) {
    years.add(file.year)
    if (file.districtCode !== 'ALL') {
      districts.add(file.districtCode)
    }
    if (!weeksPerYear[file.year]) weeksPerYear[file.year] = new Set()
    weeksPerYear[file.year].add(file.week)
    if (file.format === 'archived') archivedFiles++
  }

  const weeksCount: Record<number, number> = {}
  for (const [year, weeks] of Object.entries(weeksPerYear)) {
    weeksCount[Number(year)] = weeks.size
  }

  return {
    totalFiles: files.length,
    years: [...years].sort(),
    weeksPerYear: weeksCount,
    districtsFound: districts.size,
    archivedFiles,
  }
}
