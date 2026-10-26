/**
 * DuckDB connection lifecycle management.
 * Uses @duckdb/node-api (official Node.js driver).
 */

import { DuckDBInstance } from '@duckdb/node-api'
import type { DuckDBConnection } from '@duckdb/node-api'

let instance: DuckDBInstance | null = null
let connection: DuckDBConnection | null = null

/**
 * Open a DuckDB database and return a connection.
 * Reuses the existing connection if already open.
 *
 * @param dbPath - Path to the .duckdb file (created if doesn't exist)
 */
export async function getConnection(dbPath: string): Promise<DuckDBConnection> {
  if (connection) return connection

  instance = await DuckDBInstance.create(dbPath)
  connection = await instance.connect()

  return connection
}

/** Close the connection and database instance. */
export function closeConnection(): void {
  if (connection) {
    connection.closeSync()
    connection = null
  }
  if (instance) {
    instance.closeSync()
    instance = null
  }
}

/**
 * Create a fresh connection (does not use singleton).
 * Useful for tests and parallel operations.
 */
export async function createConnection(dbPath: string): Promise<{
  instance: DuckDBInstance
  connection: DuckDBConnection
  close: () => void
}> {
  const inst = await DuckDBInstance.create(dbPath)
  const conn = await inst.connect()
  return {
    instance: inst,
    connection: conn,
    close: () => {
      conn.closeSync()
      inst.closeSync()
    },
  }
}
