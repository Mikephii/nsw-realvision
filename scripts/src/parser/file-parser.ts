/**
 * Parses a complete .DAT file into structured record collections.
 * Reads the file, splits into lines, parses each line, and validates
 * record counts against the Z (trailer) record.
 *
 * Lines that fail to parse are collected as warnings and skipped rather
 * than aborting the entire file. Count mismatches are also warnings.
 */

import { readFile } from 'node:fs/promises'
import type { RecordA, RecordB, RecordC, RecordD, RecordZ, ParsedFile, ParseWarning } from '../types/records.js'
import { parseLine } from './line-parser.js'

export interface ParseFileOptions {
  /** If true, skip validation of record counts against trailer. Default: false. */
  skipValidation?: boolean
}

/**
 * Parse a complete .DAT file from disk.
 *
 * @param filePath - Absolute path to the .DAT file
 * @param options - Parse options
 * @returns Structured parsed file with header, sales, descriptions, owners, trailer, and warnings
 */
export async function parseFile(filePath: string, options?: ParseFileOptions): Promise<ParsedFile> {
  const content = await readFile(filePath, 'latin1')
  return parseFileContent(content, filePath, options)
}

/**
 * Parse .DAT file content from a string (useful for testing).
 *
 * @param content - The file content as a string
 * @param sourcePath - Path for error messages
 * @param options - Parse options
 */
export function parseFileContent(content: string, sourcePath?: string, options?: ParseFileOptions): ParsedFile {
  const lines = content.split('\n').filter(line => line.trim() !== '')

  let header: RecordA | null = null
  const sales: RecordB[] = []
  const descriptions: RecordC[] = []
  const owners: RecordD[] = []
  let trailer: RecordZ | null = null
  const warnings: ParseWarning[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    try {
      const record = parseLine(line)
      switch (record.type) {
        case 'A':
          header = record
          break
        case 'B':
          sales.push(record)
          break
        case 'C':
          descriptions.push(record)
          break
        case 'D':
          owners.push(record)
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

  const parsed: ParsedFile = { header, sales, descriptions, owners, trailer, warnings }

  if (!options?.skipValidation) {
    warnings.push(...validateCounts(parsed, sourcePath))
  }

  return parsed
}

/** Validate that actual record counts match the Z trailer record */
function validateCounts(parsed: ParsedFile, sourcePath?: string): ParseWarning[] {
  const { trailer, sales, descriptions, owners } = parsed
  // Total includes A and Z records
  const actualTotal = 1 + sales.length + descriptions.length + owners.length + 1

  const expected = {
    total: trailer.totalRecords,
    b: trailer.totalBRecords,
    c: trailer.totalCRecords ?? 0,
    d: trailer.totalDRecords ?? 0,
  }
  const actual = {
    total: actualTotal,
    b: sales.length,
    c: descriptions.length,
    d: owners.length,
  }

  const mismatches: string[] = []
  if (actual.total !== expected.total) mismatches.push(`total: expected ${expected.total}, got ${actual.total}`)
  if (actual.b !== expected.b) mismatches.push(`B records: expected ${expected.b}, got ${actual.b}`)
  if (actual.c !== expected.c) mismatches.push(`C records: expected ${expected.c}, got ${actual.c}`)
  if (actual.d !== expected.d) mismatches.push(`D records: expected ${expected.d}, got ${actual.d}`)

  if (mismatches.length > 0) {
    return [{
      line: 0,
      raw: '',
      error: `Record count mismatch${sourcePath ? ` in ${sourcePath}` : ''}: ${mismatches.join('; ')}`,
    }]
  }
  return []
}
