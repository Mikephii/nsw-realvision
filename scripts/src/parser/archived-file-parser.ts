/**
 * Parses a complete archived (1990-2001) .DAT file into structured records.
 *
 * Archived files are monolithic: one file per year containing ALL districts.
 * Only A, B, and Z record types exist (no C or D records).
 *
 * Lines that fail to parse are collected as warnings and skipped rather
 * than aborting the entire file. Count mismatches are also warnings.
 *
 * Reference: Archived_Property_Sales_Data_File_Format_1990_to_2001_V2.pdf
 */

import { readFile } from 'node:fs/promises'
import type { RecordA, RecordZ, ParseWarning } from '../types/records.js'
import type { ArchivedRecordB, ArchivedParsedFile } from '../types/archived-records.js'
import { parseArchivedLine } from './archived-line-parser.js'

export interface ParseFileOptions {
  /** If true, skip validation of record counts against trailer. Default: false. */
  skipValidation?: boolean
}

/**
 * Parse a complete archived .DAT file from disk.
 *
 * @param filePath - Absolute path to the .DAT file
 * @param options - Parse options
 * @returns Structured parsed file with header, sales, trailer, and warnings
 */
export async function parseArchivedFile(
  filePath: string,
  options?: ParseFileOptions,
): Promise<ArchivedParsedFile> {
  const content = await readFile(filePath, 'latin1')
  return parseArchivedFileContent(content, filePath, options)
}

/**
 * Parse archived .DAT file content from a string (useful for testing).
 */
export function parseArchivedFileContent(
  content: string,
  sourcePath?: string,
  options?: ParseFileOptions,
): ArchivedParsedFile {
  const lines = content.split('\n').filter(line => line.trim() !== '')

  let header: RecordA | null = null
  const sales: ArchivedRecordB[] = []
  let trailer: RecordZ | null = null
  const warnings: ParseWarning[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    try {
      const record = parseArchivedLine(line)
      switch (record.type) {
        case 'A':
          header = record
          break
        case 'B':
          sales.push(record)
          break
        case 'Z':
          trailer = record
          break
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push({ line: i + 1, raw: line, error: msg })
    }
  }

  if (!header) {
    throw new Error(`No header (A) record found${sourcePath ? ` in ${sourcePath}` : ''}`)
  }
  if (!trailer) {
    throw new Error(`No trailer (Z) record found${sourcePath ? ` in ${sourcePath}` : ''}`)
  }

  const parsed: ArchivedParsedFile = { header, sales, trailer, warnings }

  if (!options?.skipValidation) {
    warnings.push(...validateCounts(parsed, sourcePath))
  }

  return parsed
}

/** Validate that actual record counts match the Z trailer record */
function validateCounts(parsed: ArchivedParsedFile, sourcePath?: string): ParseWarning[] {
  const { trailer, sales } = parsed
  // Total includes A and Z records
  const actualTotal = 1 + sales.length + 1

  const expected = {
    total: trailer.totalRecords,
    b: trailer.totalBRecords,
  }
  const actual = {
    total: actualTotal,
    b: sales.length,
  }

  const mismatches: string[] = []
  if (actual.total !== expected.total) mismatches.push(`total: expected ${expected.total}, got ${actual.total}`)
  if (actual.b !== expected.b) mismatches.push(`B records: expected ${expected.b}, got ${actual.b}`)

  if (mismatches.length > 0) {
    return [{
      line: 0,
      raw: '',
      error: `Record count mismatch${sourcePath ? ` in ${sourcePath}` : ''}: ${mismatches.join('; ')}`,
    }]
  }
  return []
}
