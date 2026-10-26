import { describe, it, expect, beforeEach } from 'vitest'
import { DuckDBInstance } from '@duckdb/node-api'
import type { DuckDBConnection } from '@duckdb/node-api'

describe('address matching pipeline', () => {
  let conn: DuckDBConnection

  beforeEach(async () => {
    const instance = await DuckDBInstance.create(':memory:')
    conn = await instance.connect()

    // Create dim_address table
    await conn.run(`
      CREATE TABLE dim_address (
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
      );
    `)

    // Create staging_gnaf table (simulates loaded GNAF data)
    await conn.run(`
      CREATE TABLE staging_gnaf (
        gnaf_pid VARCHAR,
        flat_number VARCHAR,
        number_first VARCHAR,
        street_name VARCHAR,
        street_type VARCHAR,
        street_suffix VARCHAR,
        locality_name VARCHAR,
        postcode VARCHAR,
        latitude DOUBLE,
        longitude DOUBLE,
        geocode_type VARCHAR
      );
    `)
  })

  it('exact match: matches house + locality + postcode + street', async () => {
    // Insert a dim_address record
    await conn.run(`
      INSERT INTO dim_address (property_id, unit_number, house_number, street_name, locality, post_code, district_code)
      VALUES ('P001', '', '42', 'MAIN STREET', 'Cessnock', '2325', '001');
    `)

    // Insert a matching GNAF record
    await conn.run(`
      INSERT INTO staging_gnaf VALUES
        ('GNAF001', NULL, '42', 'MAIN', 'STREET', NULL, 'CESSNOCK', '2325', -32.832, 151.350, 'PROPERTY CENTROID');
    `)

    // Run matching
    const { matchAddresses } = await import('../../src/geocode/address-matcher.js')
    const stats = await matchAddresses(conn)

    expect(stats.matchedExact).toBe(1)
    expect(stats.matchedFuzzy).toBe(0)
    expect(stats.matchedCentroid).toBe(0)
    expect(stats.unmatched).toBe(0)

    // Verify the geocode was applied
    const reader = await conn.runAndReadAll(`SELECT latitude, longitude, geocode_source FROM dim_address WHERE property_id = 'P001'`)
    const rows = reader.getRows()
    expect(Number(rows[0]![0])).toBeCloseTo(-32.832, 2)
    expect(Number(rows[0]![1])).toBeCloseTo(151.350, 2)
    expect(rows[0]![2]).toBe('gnaf_exact')
  })

  it('fuzzy match: handles abbreviated street types', async () => {
    // VG data has abbreviated "HIGH ST", GNAF has STREET_TYPE="STREET"
    await conn.run(`
      INSERT INTO dim_address (property_id, unit_number, house_number, street_name, locality, post_code, district_code)
      VALUES ('P002', '', '15', 'HIGH ST', 'Maitland', '2320', '005');
    `)

    await conn.run(`
      INSERT INTO staging_gnaf VALUES
        ('GNAF002', NULL, '15', 'HIGH', 'STREET', NULL, 'MAITLAND', '2320', -32.735, 151.555, 'PROPERTY CENTROID');
    `)

    const { matchAddresses } = await import('../../src/geocode/address-matcher.js')
    const stats = await matchAddresses(conn)

    // Exact tier won't match (UPPER('HIGH ST') LIKE UPPER('HIGH') || ' ' || UPPER('STREET') || '%' = 'HIGH STREET%' — doesn't match 'HIGH ST')
    // But fuzzy tier should match
    expect(stats.matchedExact + stats.matchedFuzzy).toBe(1)
    expect(stats.unmatched).toBe(0)

    const reader = await conn.runAndReadAll(`SELECT geocode_source FROM dim_address WHERE property_id = 'P002'`)
    const rows = reader.getRows()
    expect(['gnaf_exact', 'gnaf_fuzzy']).toContain(rows[0]![0])
  })

  it('locality centroid fallback for unmatched addresses', async () => {
    // One matched address in CESSNOCK (to establish the centroid)
    await conn.run(`
      INSERT INTO dim_address (property_id, unit_number, house_number, street_name, locality, post_code, district_code)
      VALUES
        ('P003', '', '10', 'FIRST AVENUE', 'Cessnock', '2325', '001'),
        ('P004', '', '99', 'UNKNOWN LANE', 'Cessnock', '2325', '001');
    `)

    // Only the first address has a GNAF match
    await conn.run(`
      INSERT INTO staging_gnaf VALUES
        ('GNAF003', NULL, '10', 'FIRST', 'AVENUE', NULL, 'CESSNOCK', '2325', -32.830, 151.355, 'PROPERTY CENTROID');
    `)

    const { matchAddresses } = await import('../../src/geocode/address-matcher.js')
    const stats = await matchAddresses(conn)

    expect(stats.matchedExact + stats.matchedFuzzy).toBeGreaterThanOrEqual(1)
    expect(stats.matchedCentroid).toBe(1) // UNKNOWN LANE gets centroid
    expect(stats.unmatched).toBe(0)

    // Verify the centroid-matched address has low confidence
    const reader = await conn.runAndReadAll(`SELECT geocode_source, geocode_confidence FROM dim_address WHERE property_id = 'P004'`)
    const rows = reader.getRows()
    expect(rows[0]![0]).toBe('locality_centroid')
    expect(rows[0]![1]).toBe('low')
  })

  it('handles unit numbers', async () => {
    await conn.run(`
      INSERT INTO dim_address (property_id, unit_number, house_number, street_name, locality, post_code, district_code)
      VALUES ('P005', '3', '100', 'MAIN ROAD', 'Sydney', '2000', '708');
    `)

    await conn.run(`
      INSERT INTO staging_gnaf VALUES
        ('GNAF005', '3', '100', 'MAIN', 'ROAD', NULL, 'SYDNEY', '2000', -33.870, 151.207, 'PROPERTY CENTROID');
    `)

    const { matchAddresses } = await import('../../src/geocode/address-matcher.js')
    const stats = await matchAddresses(conn)

    expect(stats.matchedExact + stats.matchedFuzzy).toBe(1)
    expect(stats.unmatched).toBe(0)
  })

  it('does not re-match already geocoded addresses', async () => {
    // Pre-geocoded address
    await conn.run(`
      INSERT INTO dim_address (property_id, unit_number, house_number, street_name, locality, post_code, district_code, latitude, longitude, geocode_source)
      VALUES ('P006', '', '1', 'TEST STREET', 'Cessnock', '2325', '001', -32.0, 151.0, 'gnaf_exact');
    `)

    await conn.run(`
      INSERT INTO staging_gnaf VALUES
        ('GNAF006', NULL, '1', 'TEST', 'STREET', NULL, 'CESSNOCK', '2325', -33.0, 152.0, 'PROPERTY CENTROID');
    `)

    const { matchAddresses } = await import('../../src/geocode/address-matcher.js')
    const stats = await matchAddresses(conn)

    // Should not re-match (already has lat/long)
    expect(stats.matchedExact).toBe(0)

    // Original coordinates preserved
    const reader = await conn.runAndReadAll(`SELECT latitude FROM dim_address WHERE property_id = 'P006'`)
    const rows = reader.getRows()
    expect(Number(rows[0]![0])).toBeCloseTo(-32.0)
  })

  it('reports correct unmatched count', async () => {
    // Address with no matching GNAF data and no locality centroid
    await conn.run(`
      INSERT INTO dim_address (property_id, unit_number, house_number, street_name, locality, post_code, district_code)
      VALUES ('P007', '', '1', 'NOWHERE ST', 'Nonexistent', '9999', '999');
    `)

    const { matchAddresses } = await import('../../src/geocode/address-matcher.js')
    const stats = await matchAddresses(conn)

    expect(stats.unmatched).toBe(1)
  })
})
