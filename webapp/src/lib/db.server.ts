/**
 * Server-side DuckDB connection singleton.
 * Used by server functions to query the analytics database.
 *
 * Supports two modes:
 * - **Local**: Opens a DuckDB file on disk (default for development).
 * - **Remote (S3)**: Creates an in-memory instance and attaches a read-only
 *   DuckDB file from S3 via the `httpfs` extension. Activated when the
 *   `DUCKDB_S3_PATH` env var is set (e.g. `s3://your-bucket/realvision.duckdb`).
 *
 * Extensions loaded eagerly on every new connection:
 * - `spatial` — ST_Within, ST_Point, etc. for geometry queries.
 * - `h3` — h3_latlng_to_cell, etc. for hex detail queries.
 * - `httpfs` — S3 remote file access (remote mode only).
 */

import { resolve } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import type { DuckDBConnection } from '@duckdb/node-api'

let instance: DuckDBInstance | null = null
let connection: DuckDBConnection | null = null

const S3_PATH = process.env.DUCKDB_S3_PATH
const LOCAL_PATH =
  process.env.DUCKDB_PATH ??
  resolve(import.meta.dirname, '../../../data/realvision.duckdb')

const MEMORY_LIMIT = process.env.DUCKDB_MEMORY_LIMIT ?? '512MB'
const THREADS = process.env.DUCKDB_THREADS ?? '2'

/**
 * Get a DuckDB connection (creates one if needed).
 * The connection is reused across requests for the lifetime of the server.
 */
export async function getDb(): Promise<DuckDBConnection> {
  if (connection) return connection

  if (S3_PATH) {
    // Remote mode: in-memory instance with S3 read-only attach
    instance = await DuckDBInstance.create(':memory:')
    connection = await instance.connect()

    await connection.run(`SET memory_limit = '${MEMORY_LIMIT}'`)
    await connection.run(`SET threads = ${THREADS}`)

    await connection.run('INSTALL httpfs')
    await connection.run('LOAD httpfs')
    await connection.run(`SET s3_region = '${process.env.AWS_REGION ?? 'ap-southeast-2'}'`)

    await connection.run('INSTALL spatial')
    await connection.run('LOAD spatial')
    await connection.run('INSTALL h3 FROM community')
    await connection.run('LOAD h3')

    await connection.run(`ATTACH '${S3_PATH}' AS rv (READ_ONLY)`)
    await connection.run('USE rv')

    // Warm the buffer pool so the first user request isn't slow
    await connection.run('SELECT COUNT(*) FROM fact_property_sale')
  } else {
    // Local mode: open the DuckDB file read-only. The webapp never writes, and read-only lets the
    // file sit on a read-only mount (Docker `:ro`) and stops a bug from touching the data.
    instance = await DuckDBInstance.create(LOCAL_PATH, { access_mode: 'READ_ONLY' })
    connection = await instance.connect()

    await connection.run('INSTALL spatial')
    await connection.run('LOAD spatial')
    await connection.run('INSTALL h3 FROM community')
    await connection.run('LOAD h3')
  }

  return connection
}
