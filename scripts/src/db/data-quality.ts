/**
 * Data quality flagging for fact_property_sale.
 *
 * Flags problematic records in-place using boolean columns so all downstream
 * queries (heatmap, charts, summaries) can exclude them. Raw data is never
 * deleted — just flagged. This preserves the ability to audit decisions and
 * adjust thresholds without re-ingesting source files.
 *
 * ## Flags (in pipeline execution order)
 *
 * | Flag                   | What it detects                                                  | Why it matters                                                    |
 * |------------------------|------------------------------------------------------------------|-------------------------------------------------------------------|
 * | `is_nominal_transfer`  | Purchase price $1–$999                                           | Non-market sales that contaminate IQR baselines and medians       |
 * | `is_likely_strata`     | Freehold records that are functionally apartments                | Distorts freehold price-per-sqm and creates fake clustering       |
 * | `is_multi_dealing_dup` | Same freehold property sold same day at same price, extra copies | Inflates LOESS sale-count weights                                 |
 * | `is_bulk_sale`         | 2+ properties with identical (price, date, district)             | Developer acquisitions with total price on each property          |
 * | `is_partial_interest`  | percent_interest is set (< 100% ownership transfer)              | Recorded price is a fraction of market value, distorts medians    |
 * | `is_price_outlier`     | Price beyond 3× IQR of cell-level neighbourhood                  | Statistical outliers from data entry errors or unusual sales      |
 *
 * ## Pipeline Order
 *
 * The flags run in a specific order because later steps exclude records
 * already flagged by earlier steps. This prevents baseline contamination:
 *
 * 1. **Nominal transfers** and **likely strata** — independent, no dependencies
 * 2. **Multi-dealing dups** — depends on strata fix (uses `is_likely_strata`
 *    to correctly identify freehold records)
 * 3. **Bulk sales** — excludes records from steps 1–2 so $1 transfers with
 *    matching prices don't get double-flagged
 * 4. **Partial interest** — independent, but placed after bulk sales so the
 *    flag count is clean
 * 5. **Price outliers** — excludes all previously-flagged records from IQR
 *    computation so nominal transfers and partial interest sales don't widen
 *    the acceptable range
 *
 * @see docs/research/data-cleaning-outlier-detection.md §6 for
 * the full dependency analysis and rationale.
 */

import type { DuckDBConnection } from '@duckdb/node-api'
import { loadH3Extension } from '../heatmap/schema.js'

/**
 * Statistics returned by {@link runDataQuality} — one count per flag.
 *
 * Each count is the number of records with that flag set to TRUE after
 * the pipeline completes. Counts are not mutually exclusive — a record
 * can have multiple flags (e.g. a $1 nominal transfer that is also a
 * bulk sale).
 */
export interface DataQualityStats {
  nominalTransferCount: number
  likelyStrataCount: number
  multiDealingDupCount: number
  bulkSaleCount: number
  partialInterestCount: number
  priceOutlierCount: number
  elapsedMs: number
}

/**
 * All data quality flag column names on fact_property_sale.
 *
 * Used by {@link runDataQuality} to reset all flags before re-running
 * the pipeline. Kept as a constant so schema changes to the flag set
 * only need updating in one place.
 */
const ALL_FLAG_COLUMNS = [
  'is_nominal_transfer',
  'is_likely_strata',
  'is_multi_dealing_dup',
  'is_bulk_sale',
  'is_partial_interest',
  'is_price_outlier',
] as const

/** Helper: count rows where a boolean column is TRUE. */
async function countFlag(conn: DuckDBConnection, column: string): Promise<number> {
  const result = await conn.runAndReadAll(
    `SELECT COUNT(*) FROM fact_property_sale WHERE ${column} = TRUE`,
  )
  return Number(result.getRows()[0]?.[0] ?? 0)
}

// ---------------------------------------------------------------------------
// Individual flag functions
// ---------------------------------------------------------------------------

/**
 * Flag nominal transfers: sales with purchase price between $1 and $999.
 *
 * **Why this exists:** $0 records are already excluded by the standard
 * `WHERE purchase_price > 0` filter in all queries. But $1 nominal transfers
 * (property transfers between related parties, estate settlements, etc.)
 * pass through and contaminate price distributions. Sub-$1,000 sales are
 * not arm's-length market transactions in the NSW residential property
 * context — even the cheapest vacant rural land sells for more than $1,000.
 *
 * **How it's derived:** Simple price threshold: `purchase_price > 0 AND
 * purchase_price < 1000`. No temporal or spatial context needed — the
 * threshold is well below any legitimate market price in the dataset.
 *
 * **What it's used for:** Excluded from IQR baseline computation in
 * `flagPriceOutliers()`, excluded from all median calculations and
 * heatmap aggregations via WHERE clause filters.
 *
 * @returns Number of records flagged.
 */
async function flagNominalTransfers(conn: DuckDBConnection): Promise<number> {
  await conn.run(`
    UPDATE fact_property_sale SET is_nominal_transfer = TRUE
    WHERE purchase_price > 0
      AND purchase_price < 1000
  `)
  return countFlag(conn, 'is_nominal_transfer')
}

/**
 * Flag likely strata properties: records that appear to be apartments but
 * have `strata IS NULL` in the source data.
 *
 * **Why this exists:** The NSW Valuer General only sets the `strata` column
 * for properties registered under a formal Strata Plan (SP number). But many
 * apartments in NSW are registered under community title (Lot/DP format),
 * company title, or other non-SP schemes. These have `strata = NULL` despite
 * being functionally apartments — a studio in a community-title building
 * behaves identically to one in a strata-plan building for price analysis.
 *
 * **How it's derived:** `strata IS NULL AND unit_number IS NOT NULL AND
 * unit_number != ''`. The presence of a unit number on a non-strata record
 * is a high-confidence signal that the property is part of a multi-unit
 * building. This catches ~22,600 records. We don't modify the source
 * `strata` column — that's preserved as-is from the VG data.
 *
 * **What it's used for:** All strata/freehold split queries use
 * `strata IS NOT NULL OR is_likely_strata` instead of just
 * `strata IS NOT NULL`. This correctly classifies community-title
 * apartments as strata for analytical purposes, preventing:
 * - Freehold price-per-sqm distortion from apartment internal areas
 * - Fake clustering from multiple units at the same address appearing
 *   as repeated "house" sales
 * - LOESS curve skew in areas with community-title buildings
 *
 * @returns Number of records flagged.
 */
async function flagLikelyStrata(conn: DuckDBConnection): Promise<number> {
  await conn.run(`
    UPDATE fact_property_sale SET is_likely_strata = TRUE
    WHERE strata IS NULL
      AND unit_number IS NOT NULL
      AND unit_number != ''
  `)
  return countFlag(conn, 'is_likely_strata')
}

/**
 * Flag multi-dealing duplicates: freehold records where the same physical
 * sale is registered under multiple dealing numbers.
 *
 * **Why this exists:** When a freehold property sale involves multiple land
 * parcels (lots), the NSW VG registers each lot under a sequential dealing
 * number with the same price and date. This creates 2–3 records for what is
 * economically a single sale. These duplicates inflate the `sale_count` in
 * yearly median calculations, which in turn inflates LOESS kernel weights
 * (since weight = sale_count × tricube). A property with 3 dealing numbers
 * gets 3× the LOESS influence it should have.
 *
 * **How it's derived:** For freehold records (after `is_likely_strata` fix):
 * find groups sharing `(property_id, contract_date, purchase_price)` with 2+
 * records and no unit number. Keep the record with the lowest `dealing_number`
 * (deterministic tie-breaking), flag the rest.
 *
 * **Dependencies:** Must run after `flagLikelyStrata()` — otherwise
 * community-title apartments (which legitimately share property_id) would
 * be incorrectly flagged as duplicates.
 *
 * **What it's used for:** Excluded from all median and LOESS calculations
 * via WHERE clause filters.
 *
 * @returns Number of records flagged.
 */
async function flagMultiDealingDups(conn: DuckDBConnection): Promise<number> {
  await conn.run(`
    UPDATE fact_property_sale fps SET is_multi_dealing_dup = TRUE
    FROM (
      SELECT district_code, property_id, dealing_number
      FROM (
        SELECT
          district_code,
          property_id,
          dealing_number,
          ROW_NUMBER() OVER (
            PARTITION BY property_id, contract_date, purchase_price
            ORDER BY dealing_number
          ) AS rn
        FROM fact_property_sale
        WHERE purchase_price > 0
          AND contract_date IS NOT NULL
          AND strata IS NULL
          AND is_likely_strata = FALSE
          AND (unit_number IS NULL OR unit_number = '')
      ) ranked
      WHERE rn > 1
    ) dups
    WHERE fps.district_code = dups.district_code
      AND fps.property_id = dups.property_id
      AND fps.dealing_number = dups.dealing_number
  `)
  return countFlag(conn, 'is_multi_dealing_dup')
}

/**
 * Flag bulk sales: 2+ properties sharing exact (purchase_price, contract_date,
 * district_code).
 *
 * **Why this exists:** Developer acquisitions and portfolio sales where the
 * NSW VG recorded the total deal price against each individual property.
 * For example, a developer buying 16 houses in St Leonards for $110.5M total
 * would have $110.5M recorded against each of the 16 properties.
 *
 * **How it's derived:** Find (purchase_price, contract_date, district_code)
 * tuples that appear on 2+ distinct property records. All records in matching
 * tuples are flagged. Excludes records already flagged as nominal transfers
 * or multi-dealing dups to prevent $1 transfers across properties from
 * double-flagging.
 *
 * **What it's used for:** Excluded from all median and heatmap calculations.
 * These aren't true per-property market prices.
 *
 * @returns Number of records flagged.
 */
async function flagBulkSales(conn: DuckDBConnection): Promise<number> {
  await conn.run(`
    UPDATE fact_property_sale SET is_bulk_sale = TRUE
    WHERE purchase_price > 0
      AND contract_date IS NOT NULL
      AND is_nominal_transfer = FALSE
      AND is_multi_dealing_dup = FALSE
      AND (purchase_price, contract_date, district_code) IN (
        SELECT purchase_price, contract_date, district_code
        FROM fact_property_sale
        WHERE purchase_price > 0
          AND contract_date IS NOT NULL
          AND is_nominal_transfer = FALSE
          AND is_multi_dealing_dup = FALSE
        GROUP BY purchase_price, contract_date, district_code
        HAVING COUNT(*) >= 2
      )
  `)
  return countFlag(conn, 'is_bulk_sale')
}

/**
 * Flag partial-interest sales: records where percent_interest is set,
 * indicating less than 100% ownership was transferred.
 *
 * **Why this exists:** When a partial interest is sold (e.g. 50% of a
 * property), the recorded `purchase_price` represents the partial price,
 * not the property's full market value. A 50% interest sold for $400K
 * on an $800K property would appear as a $400K sale, dragging medians
 * down when mixed with full-value sales. The VG only records
 * `percent_interest` when it's less than 100% (NULL means full ownership).
 *
 * **How it's derived:** `percent_interest IS NOT NULL`. The VG leaves this
 * field NULL for 100% sales, so any non-NULL value indicates a partial
 * interest transfer.
 *
 * **What it's used for:** Excluded from all price aggregations. A future
 * enhancement could scale the price to 100% (`price * 100 / percent_interest`)
 * instead of excluding, but exclusion is the safer default.
 *
 * @returns Number of records flagged.
 */
async function flagPartialInterest(conn: DuckDBConnection): Promise<number> {
  await conn.run(`
    UPDATE fact_property_sale SET is_partial_interest = TRUE
    WHERE percent_interest IS NOT NULL
  `)
  return countFlag(conn, 'is_partial_interest')
}

/**
 * Shared WHERE clause fragment excluding records flagged by earlier pipeline
 * steps. Used by both spatial KNN and locality fallback outlier detection to
 * keep neighbor pools and IQR baselines clean.
 */
const CLEAN_RECORD_FILTER = `
  AND fps.is_nominal_transfer = FALSE
  AND fps.is_partial_interest = FALSE
  AND fps.is_bulk_sale = FALSE
  AND fps.is_multi_dealing_dup = FALSE`

/**
 * Cell-level IQR outlier detection constants.
 *
 * - `MIN_NEIGHBORS`: Minimum sales in the neighbourhood to compute
 *   meaningful IQR. 20 provides stable Q1/Q3 estimates.
 * - `TEMPORAL_WINDOW_YEARS`: Temporal half-window. ±3 years provides
 *   enough sales for stable quartiles without mixing boom/bust periods.
 * - `IQR_MULTIPLIER`: How many IQRs beyond Q1/Q3 to flag. 3× is
 *   conservative — only catches extreme outliers, not merely expensive.
 * - `H3_RESOLUTION`: H3 grid resolution. Res 7 hexagons are ~2.5km
 *   across — `grid_disk(1)` covers ~5km.
 * - `H3_RING_SIZE`: Number of rings to expand around each cell.
 *   1 ring = 7 cells total (center + 6 neighbors).
 *
 * @see docs/research/spatial-outlier-scalability.md §4
 */
const MIN_NEIGHBORS = 20
const TEMPORAL_WINDOW_YEARS = 3
const IQR_MULTIPLIER = 3.0
const H3_RESOLUTION = 7
const H3_RING_SIZE = 1

/**
 * Locality fallback constants for ungeocodable records.
 *
 * - `LOCALITY_FALLBACK_MIN_SALES`: Minimum same-segment sales in the
 *   rolling window to compute meaningful IQR. Same as MIN_NEIGHBORS.
 * - `LOCALITY_FALLBACK_WINDOW_YEARS`: Rolling window half-width in years.
 *   5 years (±2.5) aligns with LOESS bandwidth.
 */
const LOCALITY_FALLBACK_MIN_SALES = MIN_NEIGHBORS
const LOCALITY_FALLBACK_WINDOW_YEARS = 5

/**
 * Flag statistical price outliers using cell-level neighbourhood IQR.
 *
 * **Why this exists:** Data entry errors (extra or missing digits) and
 * unusual transactions (e.g. related-party sales at non-market prices)
 * create extreme price values that distort medians and LOESS curves.
 *
 * **How it's derived (geocoded records — 97.9% of dataset):**
 *
 * For each H3 res 7 cell, compute the IQR of LN(price) for all
 * same-segment sales within the 7-cell neighbourhood (grid_disk(1),
 * ~5km) and ±3 year temporal window. Flag any sale whose LN(price) is
 * beyond 3× log-IQR from log-Q1 or log-Q3. Cells with fewer than 20
 * sales in their neighbourhood are left unflagged (insufficient context).
 *
 * **Why log-space:** Property prices are log-normally distributed
 * (right-skewed). In linear space, the wide IQR pushes the lower fence
 * negative — making it impossible to flag suspiciously cheap sales
 * (e.g. unrecorded partial-interest transfers). Log-space IQR gives
 * symmetric, always-positive fences that detect outliers on both sides.
 *
 * This replaced the initial KNN approach (which failed with OOM at scale
 * due to ROW_NUMBER materialising 846M candidate pairs) and the original
 * locality×decade approach (arbitrary decade boundaries, no spatial awareness).
 *
 * **Why cell-level instead of per-record KNN:** At H3 res 7 (~2.5km
 * hexagons), all records in a cell are in the same local market. IQR
 * from ~175 neighbourhood sales is MORE stable than KNN's K=20. The
 * GROUP BY aggregation is O(n) and uses ~1.5 GB peak memory — scalable
 * to the full 4.78M geocoded dataset without batching.
 *
 * **Fallback for ungeocodable records (~2.1%):** Rolling 5-year window
 * IQR per (locality, segment) with the same 3× IQR threshold and minimum
 * 20 sales. Records without enough context are left unflagged.
 *
 * **Baseline exclusions:** Records already flagged by earlier pipeline
 * steps are excluded from the neighbor pool so non-market sales don't
 * contaminate the IQR baselines.
 *
 * @see docs/research/spatial-outlier-scalability.md §4
 * @returns Number of records flagged.
 */
async function flagPriceOutliers(conn: DuckDBConnection): Promise<number> {
  // ── Step 1: Load H3 extension (needed for h3_latlng_to_cell, h3_grid_disk) ──
  process.stdout.write('  Outliers: loading H3 extension...\n')
  await loadH3Extension(conn)

  // ── Step 2: Create temp table of clean geocoded sales with H3 cell ──
  // Materializes the base dataset once so downstream joins don't
  // re-evaluate filters on every row.
  process.stdout.write('  Outliers: building clean sales table...\n')
  await conn.run(`
    CREATE OR REPLACE TEMP TABLE _dq_clean_sales AS
    SELECT
      fps.district_code,
      fps.property_id,
      fps.dealing_number,
      fps.purchase_price,
      EXTRACT(YEAR FROM fps.contract_date)::INT AS sale_year,
      h3_latlng_to_cell(da.latitude, da.longitude, ${H3_RESOLUTION})::BIGINT AS h3_cell,
      CASE WHEN fps.strata IS NOT NULL OR fps.is_likely_strata
           THEN 'strata' ELSE 'freehold' END AS segment
    FROM fact_property_sale fps
    JOIN dim_address da
      ON fps.property_id = da.property_id
      AND COALESCE(fps.unit_number, '') = da.unit_number
      AND COALESCE(fps.house_number, '') = da.house_number
    WHERE fps.purchase_price > 0
      AND fps.contract_date IS NOT NULL
      AND da.latitude IS NOT NULL
      AND da.longitude IS NOT NULL
      ${CLEAN_RECORD_FILTER}
  `)

  // ── Step 3: Pre-compute H3 neighbor cell lookup ──
  // Materializes the grid_disk expansion once (~unique cells × 7 neighbors)
  // instead of recomputing per row in the aggregation join.
  process.stdout.write('  Outliers: building H3 neighbor lookup...\n')
  await conn.run(`
    CREATE OR REPLACE TEMP TABLE _dq_h3_neighbors AS
    SELECT DISTINCT
      h3_cell AS source_cell,
      unnest(h3_grid_disk(h3_cell, ${H3_RING_SIZE}))::BIGINT AS neighbor_cell
    FROM (SELECT DISTINCT h3_cell FROM _dq_clean_sales)
  `)

  // ── Step 4: Compute cell-level IQR in log-space ──
  // Property prices are log-normally distributed. Computing IQR on
  // LN(price) gives symmetric, always-positive fences — in linear space
  // the right-skewed tail inflates IQR and pushes the lower fence below
  // zero, making it impossible to detect suspiciously cheap sales.
  process.stdout.write('  Outliers: computing cell-level IQR (log-space)...\n')
  await conn.run(`
    CREATE OR REPLACE TEMP TABLE _dq_cell_iqr AS
    SELECT
      grp.h3_cell,
      grp.segment,
      grp.sale_year,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY LN(n.purchase_price)) AS log_q1,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY LN(n.purchase_price)) AS log_q3,
      COUNT(*) AS neighbor_count
    FROM (SELECT DISTINCT h3_cell, segment, sale_year FROM _dq_clean_sales) grp
    JOIN _dq_h3_neighbors hn ON grp.h3_cell = hn.source_cell
    JOIN _dq_clean_sales n ON n.h3_cell = hn.neighbor_cell
      AND n.segment = grp.segment
      AND ABS(n.sale_year - grp.sale_year) <= ${TEMPORAL_WINDOW_YEARS}
    GROUP BY grp.h3_cell, grp.segment, grp.sale_year
    HAVING COUNT(*) >= ${MIN_NEIGHBORS}
  `)

  // ── Step 5: Flag spatial outliers ──
  // Compare LN(price) against log-space fences. Equivalent to checking
  // whether the price ratio to Q1/Q3 exceeds exp(3 × log_IQR).
  process.stdout.write('  Outliers: flagging spatial outliers...\n')
  await conn.run(`
    UPDATE fact_property_sale fps SET is_price_outlier = TRUE
    FROM _dq_clean_sales cs
    JOIN _dq_cell_iqr ci
      ON cs.h3_cell = ci.h3_cell
      AND cs.segment = ci.segment
      AND cs.sale_year = ci.sale_year
    WHERE fps.district_code = cs.district_code
      AND fps.property_id = cs.property_id
      AND fps.dealing_number = cs.dealing_number
      AND (
        LN(cs.purchase_price) < ci.log_q1 - ${IQR_MULTIPLIER} * (ci.log_q3 - ci.log_q1)
        OR LN(cs.purchase_price) > ci.log_q3 + ${IQR_MULTIPLIER} * (ci.log_q3 - ci.log_q1)
      )
  `)

  // ── Step 6: Locality fallback for ungeocodable records ──
  // ~2.1% of records lack geocoding. For these, fall back to rolling
  // 5-year window IQR per (locality, segment). This is similar to the
  // old locality×decade approach but uses a rolling window instead of
  // fixed decade boundaries, and segments by strata/freehold.
  process.stdout.write('  Outliers: locality fallback for ungeocodable records...\n')
  await conn.run(`
    WITH ungeocodable AS (
      SELECT
        fps.district_code, fps.property_id, fps.dealing_number,
        fps.purchase_price, fps.locality,
        EXTRACT(YEAR FROM fps.contract_date)::INT AS sale_year,
        CASE WHEN fps.strata IS NOT NULL OR fps.is_likely_strata
             THEN 'strata' ELSE 'freehold' END AS segment
      FROM fact_property_sale fps
      LEFT JOIN dim_address da
        ON fps.property_id = da.property_id
        AND COALESCE(fps.unit_number, '') = da.unit_number
        AND COALESCE(fps.house_number, '') = da.house_number
      WHERE (da.latitude IS NULL OR da.longitude IS NULL OR da.property_id IS NULL)
        AND fps.purchase_price > 0
        AND fps.contract_date IS NOT NULL
        AND fps.locality IS NOT NULL
        AND fps.is_price_outlier = FALSE
        ${CLEAN_RECORD_FILTER}
    ),
    locality_stats AS (
      SELECT
        u.district_code, u.property_id, u.dealing_number,
        u.purchase_price,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY LN(peer.purchase_price)) AS log_q1,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY LN(peer.purchase_price)) AS log_q3,
        COUNT(*) AS peer_count
      FROM ungeocodable u
      JOIN ungeocodable peer
        ON peer.locality = u.locality
        AND peer.segment = u.segment
        AND ABS(peer.sale_year - u.sale_year) <= ${LOCALITY_FALLBACK_WINDOW_YEARS}
        AND NOT (
          peer.district_code = u.district_code
          AND peer.property_id = u.property_id
          AND peer.dealing_number = u.dealing_number
        )
      GROUP BY u.district_code, u.property_id, u.dealing_number, u.purchase_price
      HAVING COUNT(*) >= ${LOCALITY_FALLBACK_MIN_SALES}
    )
    UPDATE fact_property_sale fps SET is_price_outlier = TRUE
    FROM locality_stats ls
    WHERE fps.district_code = ls.district_code
      AND fps.property_id = ls.property_id
      AND fps.dealing_number = ls.dealing_number
      AND (
        LN(ls.purchase_price) < ls.log_q1 - ${IQR_MULTIPLIER} * (ls.log_q3 - ls.log_q1)
        OR LN(ls.purchase_price) > ls.log_q3 + ${IQR_MULTIPLIER} * (ls.log_q3 - ls.log_q1)
      )
  `)

  // ── Step 7: Clean up temp tables ──
  await conn.run('DROP TABLE IF EXISTS _dq_cell_iqr')
  await conn.run('DROP TABLE IF EXISTS _dq_h3_neighbors')
  await conn.run('DROP TABLE IF EXISTS _dq_clean_sales')

  return countFlag(conn, 'is_price_outlier')
}

// ---------------------------------------------------------------------------
// Pipeline orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the complete data quality pipeline.
 *
 * Resets all flags to FALSE, then runs each flag function in dependency order.
 * Call after loading data and before rebuilding heatmap/LOESS aggregates.
 *
 * @see Module-level JSDoc for the full pipeline order and rationale.
 */
export async function runDataQuality(conn: DuckDBConnection): Promise<DataQualityStats> {
  const startTime = Date.now()

  // Reset all flags to FALSE before re-running the pipeline.
  // This ensures idempotency — running the pipeline twice produces
  // the same result as running it once.
  const resetCols = ALL_FLAG_COLUMNS.map((col) => `${col} = FALSE`).join(', ')
  await conn.run(`UPDATE fact_property_sale SET ${resetCols}`)

  // Pipeline order matters — see module JSDoc for dependency analysis.
  const nominalTransferCount = await flagNominalTransfers(conn)
  const likelyStrataCount = await flagLikelyStrata(conn)
  const multiDealingDupCount = await flagMultiDealingDups(conn) // depends on is_likely_strata
  const bulkSaleCount = await flagBulkSales(conn) // excludes nominal + multi-dealing
  const partialInterestCount = await flagPartialInterest(conn)
  const priceOutlierCount = await flagPriceOutliers(conn) // excludes all above

  return {
    nominalTransferCount,
    likelyStrataCount,
    multiDealingDupCount,
    bulkSaleCount,
    partialInterestCount,
    priceOutlierCount,
    elapsedMs: Date.now() - startTime,
  }
}
