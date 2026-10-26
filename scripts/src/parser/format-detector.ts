/**
 * Detects which parser format to use for a .DAT file.
 *
 * - Archived (1990-2001): monolithic files at {year}/archive/ARCHIVE_SALES_*.DAT
 * - Current (2001+): per-district weekly files at {year}/{week}/{district}_SALES_DATA_NNME_*.DAT
 */

export type FileFormat = 'current' | 'archived'

/** Matches archived file paths: /archive/ARCHIVE_SALES_ */
const ARCHIVED_PATH_PATTERN = /\/archive\/ARCHIVE_SALES_/i

/**
 * Detect file format from the file path.
 * Archived files live in an `archive/` subdirectory with ARCHIVE_SALES_ prefix.
 */
export function detectFormatFromPath(filePath: string): FileFormat {
  return ARCHIVED_PATH_PATTERN.test(filePath) ? 'archived' : 'current'
}

/**
 * Detect file format from file content (fallback).
 * Reads the first B record and checks field count:
 * - Archived B records have ~20 fields
 * - Current B records have ~24 fields
 */
export function detectFormatFromContent(content: string): FileFormat {
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('B;')) {
      const fieldCount = trimmed.split(';').length
      // Archived B records: 20 fields + trailing empty = ~21 elements
      // Current B records: 24 fields + trailing empty = ~25 elements
      return fieldCount <= 22 ? 'archived' : 'current'
    }
  }

  // No B records found — default to current
  return 'current'
}
