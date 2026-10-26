# DuckDB Skills

## Driver

Use `@duckdb/node-api` (official Neo client). The `duckdb` npm package is deprecated.

All versions are pre-release (e.g. `1.4.4-r.1`), so pin the exact version in package.json — semver ranges like `^1.4.0` won't match.

## Connection Lifecycle

```ts
import { DuckDBInstance } from '@duckdb/node-api'
import type { DuckDBConnection } from '@duckdb/node-api'

const instance = await DuckDBInstance.create('path/to/db.duckdb')
const conn = await instance.connect()

// Use conn...

conn.closeSync()
instance.closeSync()
```

For in-memory databases (tests): `DuckDBInstance.create(':memory:')`

## Running SQL

```ts
// Execute DDL/DML (no results needed)
await conn.run('CREATE TABLE ...')

// Query with results
const reader = await conn.runAndReadAll('SELECT COUNT(*) FROM my_table')
const rows = reader.getRows()  // DuckDBValue[][]
const value = Number(rows[0][0])
```

## Appender API (Bulk Inserts)

Much faster than individual INSERT statements. Use for loading large datasets.

```ts
import type { DuckDBAppender } from '@duckdb/node-api'
import { dateValue } from '@duckdb/node-api'

const appender = await conn.createAppender('table_name')

// Append row by row, column by column
appender.appendVarchar('text')
appender.appendInteger(42)
appender.appendBigInt(BigInt(1000000))
appender.appendDouble(3.14)
appender.appendDate(dateValue({ year: 2024, month: 10, day: 22 }))
appender.appendNull()  // for nullable columns
appender.endRow()

appender.flushSync()
appender.closeSync()
```

Key methods: `appendVarchar()`, `appendInteger()`, `appendBigInt()`, `appendDouble()`, `appendDate()`, `appendNull()`, `endRow()`, `flushSync()`, `closeSync()`

## Deduplication Pattern (Staging Table)

For idempotent loading with a primary key:

1. `CREATE OR REPLACE TABLE staging_xxx (same schema as target)`
2. Appender bulk insert into staging
3. `INSERT OR REPLACE INTO target SELECT * FROM staging`
4. `DROP TABLE staging_xxx`

## Our Schema

- `fact_property_sale` — main fact table, PK: `(district_code, property_id, dealing_number)`
- `dim_district` — district code → council name
- `dim_zone` — zone code → description + category
- `etl_loaded_file` — tracks which .DAT files have been loaded

## Aggregation Patterns

```sql
-- Median price by year and suburb
SELECT
  CAST(EXTRACT(YEAR FROM contract_date) AS VARCHAR) AS period,
  locality,
  CAST(MEDIAN(purchase_price) AS BIGINT) AS median_price,
  COUNT(*) AS sale_count
FROM fact_property_sale
WHERE purchase_price > 0 AND locality IN ('Sydney', 'Randwick')
GROUP BY period, locality
ORDER BY period;

-- Growth rate between two years using FILTER
WITH periods AS (
  SELECT
    locality,
    CAST(MEDIAN(purchase_price) FILTER (WHERE EXTRACT(YEAR FROM contract_date) = 2020) AS BIGINT) AS median_from,
    CAST(MEDIAN(purchase_price) FILTER (WHERE EXTRACT(YEAR FROM contract_date) = 2024) AS BIGINT) AS median_to
  FROM fact_property_sale
  WHERE purchase_price > 0
  GROUP BY locality
)
SELECT locality, median_from, median_to,
  ROUND((median_to - median_from) * 100.0 / median_from, 2) AS growth_pct
FROM periods WHERE median_from > 0 AND median_to > 0;
```

## Prepared Statements

```ts
const prepared = await conn.prepare('SELECT * FROM t WHERE col = ?')
prepared.bindVarchar(1, 'value')  // 1-based index
prepared.bindInteger(1, 42)
prepared.bindBigInt(1, BigInt(100))
prepared.bindDouble(1, 3.14)
const reader = await prepared.runAndReadAll()
const columns = reader.columnNames()   // string[]
const rows = reader.getRows()          // DuckDBValue[][]
```

## Gotchas

- **`REGEXP_REPLACE` only replaces first match by default.** Use the `'g'` flag for global replacement: `REGEXP_REPLACE(col, '[^0-9]', '', 'g')`. Without it, `'12A-14B'` becomes `'12-14B'` instead of `'1214'`.
- **Use `TRY_CAST` for user-facing data.** `CAST('7A' AS INTEGER)` throws; `TRY_CAST('7A' AS INTEGER)` returns NULL. Always prefer `TRY_CAST` when data quality isn't guaranteed.
- **BigInt values from DuckDB.** COUNT(*) and BIGINT columns return JavaScript `bigint`. Always convert with `Number(val)` before sending to the client (JSON doesn't support bigint).

## Server-Side Integration (TanStack Start)

- Singleton connection in `webapp/src/lib/db.server.ts`
- Pin same @duckdb/node-api version (1.4.4-r.1) as scripts to avoid .duckdb file version conflicts
- Use `import.meta.dirname` to resolve DB path relative to source file
