/**
 * Incremental loading — tracks which files have been loaded
 * and only processes new ones.
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import type { FileMetadata } from '../types/property-sale.js'

/**
 * Record a file as loaded in the ETL tracking table.
 */
export async function markFileLoaded(
  conn: DuckDBConnection,
  metadata: FileMetadata,
  recordCount: number,
): Promise<void> {
  await conn.run(
    `INSERT OR REPLACE INTO etl_loaded_file (file_path, record_count, year, week, district_code)
     VALUES ('${metadata.filePath.replace(/'/g, "''")}', ${recordCount}, ${metadata.year}, '${metadata.week}', '${metadata.districtCode}');`,
  )
}

/**
 * Get the set of file paths that have already been loaded.
 */
export async function getLoadedFilePaths(conn: DuckDBConnection): Promise<Set<string>> {
  const reader = await conn.runAndReadAll('SELECT file_path FROM etl_loaded_file')
  const rows = reader.getRows()
  return new Set(rows.map(row => String(row[0])))
}

/**
 * Filter a list of discovered files to only those not yet loaded.
 */
export async function filterNewFiles(
  conn: DuckDBConnection,
  files: FileMetadata[],
): Promise<FileMetadata[]> {
  const loaded = await getLoadedFilePaths(conn)
  return files.filter(f => !loaded.has(f.filePath))
}

/**
 * Get loading status information.
 */
export async function getLoadingStatus(conn: DuckDBConnection): Promise<{
  totalFilesLoaded: number
  totalRecords: number
  yearRange: { min: number; max: number } | null
  lastLoadedAt: string | null
}> {
  const fileReader = await conn.runAndReadAll(
    'SELECT COUNT(*), SUM(record_count), MIN(year), MAX(year), MAX(loaded_at) FROM etl_loaded_file',
  )
  const row = fileReader.getRows()[0]

  const totalFilesLoaded = Number(row?.[0] ?? 0)
  const totalRecords = Number(row?.[1] ?? 0)
  const minYear = row?.[2] != null ? Number(row[2]) : null
  const maxYear = row?.[3] != null ? Number(row[3]) : null
  const lastLoadedAt = row?.[4] != null ? String(row[4]) : null

  return {
    totalFilesLoaded,
    totalRecords,
    yearRange: minYear != null && maxYear != null ? { min: minYear, max: maxYear } : null,
    lastLoadedAt,
  }
}

/**
 * Get fact table count (total sales in the database).
 */
export async function getFactTableCount(conn: DuckDBConnection): Promise<number> {
  const reader = await conn.runAndReadAll('SELECT COUNT(*) FROM fact_property_sale')
  const rows = reader.getRows()
  return Number(rows[0]?.[0] ?? 0)
}
