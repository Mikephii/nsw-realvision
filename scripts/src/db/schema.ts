/**
 * DuckDB schema initialization — creates tables if they don't exist.
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import { initHeatmapSchema } from '../heatmap/schema.js'

const CREATE_DIM_DISTRICT = `
CREATE TABLE IF NOT EXISTS dim_district (
  district_code VARCHAR(3) PRIMARY KEY,
  council_name VARCHAR NOT NULL
);`

const CREATE_DIM_ZONE = `
CREATE TABLE IF NOT EXISTS dim_zone (
  zone_code VARCHAR PRIMARY KEY,
  zone_description VARCHAR NOT NULL,
  zone_category VARCHAR
);`

const CREATE_FACT_PROPERTY_SALE = `
CREATE TABLE IF NOT EXISTS fact_property_sale (
  district_code VARCHAR(3) NOT NULL,
  property_id VARCHAR NOT NULL,
  dealing_number VARCHAR NOT NULL,
  sale_counter VARCHAR NOT NULL,
  property_name VARCHAR,
  unit_number VARCHAR,
  house_number VARCHAR,
  street_name VARCHAR,
  locality VARCHAR,
  post_code VARCHAR(4),
  area DOUBLE,
  area_type VARCHAR(1),
  contract_date DATE,
  settlement_date DATE,
  purchase_price BIGINT,
  zone_code VARCHAR,
  nature_of_property VARCHAR(1),
  primary_purpose VARCHAR,
  strata VARCHAR,
  component_code VARCHAR,
  sale_code VARCHAR,
  percent_interest DOUBLE,
  legal_description VARCHAR,
  dimensions VARCHAR,
  valuation_num VARCHAR,
  contract_date_raw VARCHAR,
  settlement_date_raw VARCHAR,
  purchase_price_raw VARCHAR,
  area_raw VARCHAR,
  source_file VARCHAR NOT NULL,
  source_year INTEGER NOT NULL,
  source_week VARCHAR NOT NULL,
  is_bulk_sale BOOLEAN DEFAULT FALSE,
  is_price_outlier BOOLEAN DEFAULT FALSE,
  is_likely_strata BOOLEAN DEFAULT FALSE,
  is_nominal_transfer BOOLEAN DEFAULT FALSE,
  is_partial_interest BOOLEAN DEFAULT FALSE,
  is_multi_dealing_dup BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (district_code, property_id, dealing_number)
);`

const CREATE_DIM_ADDRESS = `
CREATE TABLE IF NOT EXISTS dim_address (
  property_id VARCHAR NOT NULL,
  unit_number VARCHAR NOT NULL DEFAULT '',
  house_number VARCHAR NOT NULL DEFAULT '',
  street_name VARCHAR,
  locality VARCHAR,
  post_code VARCHAR(4),
  district_code VARCHAR(3),
  latitude DOUBLE,
  longitude DOUBLE,
  geocode_source VARCHAR,
  geocode_confidence VARCHAR,
  gnaf_pid VARCHAR,
  geocoded_at TIMESTAMP,
  PRIMARY KEY (property_id, unit_number, house_number)
);`

const CREATE_ETL_LOADED_FILE = `
CREATE TABLE IF NOT EXISTS etl_loaded_file (
  file_path VARCHAR PRIMARY KEY,
  loaded_at TIMESTAMP DEFAULT current_timestamp,
  record_count INTEGER,
  year INTEGER,
  week VARCHAR,
  district_code VARCHAR(3)
);`

const CREATE_STAGING = `
CREATE OR REPLACE TABLE staging_property_sale (
  district_code VARCHAR(3) NOT NULL,
  property_id VARCHAR NOT NULL,
  dealing_number VARCHAR NOT NULL,
  sale_counter VARCHAR NOT NULL,
  property_name VARCHAR,
  unit_number VARCHAR,
  house_number VARCHAR,
  street_name VARCHAR,
  locality VARCHAR,
  post_code VARCHAR(4),
  area DOUBLE,
  area_type VARCHAR(1),
  contract_date DATE,
  settlement_date DATE,
  purchase_price BIGINT,
  zone_code VARCHAR,
  nature_of_property VARCHAR(1),
  primary_purpose VARCHAR,
  strata VARCHAR,
  component_code VARCHAR,
  sale_code VARCHAR,
  percent_interest DOUBLE,
  legal_description VARCHAR,
  dimensions VARCHAR,
  valuation_num VARCHAR,
  contract_date_raw VARCHAR,
  settlement_date_raw VARCHAR,
  purchase_price_raw VARCHAR,
  area_raw VARCHAR,
  source_file VARCHAR NOT NULL,
  source_year INTEGER NOT NULL,
  source_week VARCHAR NOT NULL,
  is_bulk_sale BOOLEAN DEFAULT FALSE,
  is_price_outlier BOOLEAN DEFAULT FALSE,
  is_likely_strata BOOLEAN DEFAULT FALSE,
  is_nominal_transfer BOOLEAN DEFAULT FALSE,
  is_partial_interest BOOLEAN DEFAULT FALSE,
  is_multi_dealing_dup BOOLEAN DEFAULT FALSE
);`

/**
 * Columns added after initial schema — migrate existing databases.
 *
 * Each entry is passed to `ALTER TABLE fact_property_sale ADD COLUMN IF NOT EXISTS`.
 * Order doesn't matter — these are idempotent. New data quality flags are added here
 * so existing databases pick them up on next `initSchema()` call without requiring
 * a full reset.
 */
const MIGRATION_COLUMNS = [
  'contract_date_raw VARCHAR',
  'settlement_date_raw VARCHAR',
  'purchase_price_raw VARCHAR',
  'area_raw VARCHAR',
  'is_bulk_sale BOOLEAN DEFAULT FALSE',
  'is_price_outlier BOOLEAN DEFAULT FALSE',
  'is_likely_strata BOOLEAN DEFAULT FALSE',
  'is_nominal_transfer BOOLEAN DEFAULT FALSE',
  'is_partial_interest BOOLEAN DEFAULT FALSE',
  'is_multi_dealing_dup BOOLEAN DEFAULT FALSE',
]

/** Initialize all tables in the database. */
export async function initSchema(conn: DuckDBConnection): Promise<void> {
  await conn.run(CREATE_DIM_DISTRICT)
  await conn.run(CREATE_DIM_ZONE)
  await conn.run(CREATE_DIM_ADDRESS)
  await conn.run(CREATE_FACT_PROPERTY_SALE)
  await conn.run(CREATE_ETL_LOADED_FILE)

  // Migrate existing databases: add columns if they don't exist
  for (const col of MIGRATION_COLUMNS) {
    await conn.run(`ALTER TABLE fact_property_sale ADD COLUMN IF NOT EXISTS ${col};`)
  }

  // Migrate agg_h3_growth: add metro_avg_growth if it doesn't exist
  try {
    await conn.run('ALTER TABLE agg_h3_growth ADD COLUMN IF NOT EXISTS metro_avg_growth DOUBLE;')
  } catch {
    // Table may not exist yet — that's fine, initHeatmapSchema will create it
  }

  // H3 heatmap precomputation table (created empty; populated by rebuildHeatmapAggregates)
  await initHeatmapSchema(conn)
}

/** Create or replace the staging table for bulk loading. */
export async function createStagingTable(conn: DuckDBConnection): Promise<void> {
  await conn.run(CREATE_STAGING)
}

/** Drop the staging table. */
export async function dropStagingTable(conn: DuckDBConnection): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS staging_property_sale;')
}

/** Drop all tables (for reset). */
export async function dropAllTables(conn: DuckDBConnection): Promise<void> {
  await conn.run('DROP TABLE IF EXISTS agg_h3_growth;')
  await conn.run('DROP TABLE IF EXISTS staging_property_sale;')
  await conn.run('DROP TABLE IF EXISTS staging_gnaf;')
  await conn.run('DROP TABLE IF EXISTS etl_loaded_file;')
  await conn.run('DROP TABLE IF EXISTS fact_property_sale;')
  await conn.run('DROP TABLE IF EXISTS dim_address;')
  await conn.run('DROP TABLE IF EXISTS dim_zone;')
  await conn.run('DROP TABLE IF EXISTS dim_district;')
}
