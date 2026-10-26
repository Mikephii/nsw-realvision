# Architecture

Two packages and one database file:

```
NSW Valuer General .DAT files ─┐
                               ├─▶ scripts/ (ETL) ──▶ data/realvision.duckdb ──▶ webapp/ (server functions) ──▶ browser widgets
G-NAF address tables ──────────┘
```

- **`scripts/`** is a TypeScript CLI (`pnpm etl ...`) that turns the public files into one DuckDB
  database, including the precomputed tables the heatmap needs.
- **`webapp/`** is a TanStack Start app. Its server functions query DuckDB; its React widgets render
  charts (ECharts) and maps (MapLibre).
- **`data/realvision.duckdb`** is the only state the app reads. The webapp opens it read-only.

The packages have separate `package.json` files and lockfiles. The root `package.json` only has
convenience scripts (`pnpm setup`, `pnpm dev`, `pnpm etl`, `pnpm test`, `pnpm typecheck`).

## The ETL (`scripts/`)

```
extract ──▶ discover ──▶ parse ──▶ clean ──▶ load ──▶ data quality ──▶ geocode ──▶ H3 growth ──▶ LOESS curves
```

| Stage | Code | What it does |
|---|---|---|
| Extract | `src/extraction/` | Unzips NSW VG ZIPs (including nested ZIPs) into `NSWVGData/<year>/<week>/` |
| Discover | `src/discovery/file-discovery.ts` | Finds `.DAT` files and skips ones in `etl_loaded_file` |
| Parse | `src/parser/` | Reads records A/B/C/D/Z (current format) or A/B/Z (archived), and combines a sale's B and C records |
| Clean | `src/cleaner/` | Dates, prices, localities and zone codes into typed values; keeps the raw value when cleaning fails |
| Load | `src/db/loader.ts`, `incremental.ts` | Appends through a staging table, then `INSERT OR REPLACE` into `fact_property_sale` |
| Data quality | `src/db/data-quality.ts` | Flags nominal transfers, partial interests, bulk sales, duplicates and price outliers |
| Geocode | `src/geocode/` | Normalises street names and matches addresses against G-NAF into `dim_address` |
| H3 growth | `src/heatmap/h3-precompute.ts` | Median prices per H3 cell and period, into `agg_h3_growth` |
| LOESS curves | `src/heatmap/loess-curve-precompute.ts` | A smoothed quarterly price curve per H3 cell, into `agg_h3_loess_curve` |

Parsing collects warnings rather than throwing, so one bad line doesn't stop a load.

### Tables

| Table | Holds |
|---|---|
| `fact_property_sale` | One row per sale: address, contract and settlement dates, price, area, zone, nature of property, strata flag, legal description, raw values and data quality flags. Keyed by district, property and dealing number |
| `dim_district` | District code to council name |
| `dim_zone` | Zone code to description, across the pre-2011 and LEP code systems |
| `dim_address` | Geocoded addresses: latitude, longitude, G-NAF id, match source and confidence |
| `agg_h3_growth` | Precomputed medians and growth per H3 cell, resolution, metric and property type |
| `agg_h3_loess_curve` | Precomputed LOESS curves (quarterly fitted prices) per H3 cell, resolution, metric and property type |
| `etl_loaded_file` | Every `.DAT` file loaded, with its week and record count |

Purchaser and vendor names are never stored. The current format doesn't publish them, and the
archived parser reads them only to match the published layout.

## The webapp (`webapp/`)

```
widget (React) ──RPC──▶ server function (lib/server-fns.ts) ──▶ query module (lib/*queries.ts) ──▶ lib/db.server.ts ──▶ DuckDB
```

- **Server functions** (`src/lib/server-fns.ts`) are the only way the client reaches data. Each
  validates its input with a Zod schema from `src/lib/validation.ts` (GET parameters arrive as
  strings, so numeric fields use `z.coerce.number()`), then dynamically imports the server-only
  modules.
- **Query modules** build parameterised SQL:
  - `src/lib/queries.ts`: price series, growth rates, suburbs, properties.
  - `src/lib/heatmap-queries.ts`: heatmap data, LOESS curves, hex detail, data coverage.
  - `src/lib/map-queries.ts` and `src/lib/property-history.ts`: the property map and sale history.
  - `buildWhereClause(filter, { prefix })` produces table-qualified filters for joins.
- **`src/lib/db.server.ts`** holds one DuckDB connection for the server's lifetime. It opens a local
  file read-only, or attaches a file from S3 when `DUCKDB_S3_PATH` is set, and loads the `spatial`
  and `h3` extensions.

### Routes

| Route | What |
|---|---|
| `/` | Landing page |
| `/dashboard` | Database summary |
| `/boards` | Dashboards: tabs of widgets on a grid (react-grid-layout) |
| `/sale-prices` | Sale history lookup by address |
| `/areas` | Custom areas drawn on a map (terra-draw) |

The `/_app` layout loads the data coverage (latest year, newest weekly file) once and provides it
through `src/lib/data-coverage.tsx`. That way time ranges end where the data does.

### Widgets

Each widget is registered in `src/features/dashboard/widgets/<name>/definition.tsx` with a type, a
default config, a default layout, a component and a settings panel. `widgets/index.ts` imports them
all.

| Type | What |
|---|---|
| `growth-heatmap` | Annualised growth on an H3 hex grid, drawn as a smooth IDW gradient (custom WebGL layer). Hover for a tooltip, click for the hex detail dialog with the LOESS curve |
| `relative-performance` | Growth relative to the metro-wide average, as a diverging heatmap (blue outperforms, red underperforms) |
| `median-price-line` | Median price over time for suburbs, areas or groups, with optional LOESS, moving average, repeat-sales and Bayes estimates |
| `median-price-sqm` | Median price per square metre over time |
| `growth-rate` | Price growth compared across suburbs, each normalised to 0% at the start |
| `property-map` | Individual sales on a clustered map, with drawing tools |

Every analytical widget supports the standard filters: suburbs, custom areas, date range, and
freehold or strata.

### State

- **Zustand stores**, one per feature, persisted to localStorage: dashboards (`rv-dashboards`),
  widgets and their configs (`rv-widgets`), custom areas, and widget data coordination.
- **React context** for small shared state: theme (`rv-theme`), data coverage.

There is no server-side user state. Boards and areas live in the browser.

### Maps

All map tile, style and font URLs come from `src/lib/map-tiles.ts`, which reads build-time `VITE_*`
variables (see [self-hosting.md](self-hosting.md#map-tiles)). The heatmap draws on a quiet no-label
basemap and adds its own water mask, roads and place labels above its colour layer, so labels stay
readable.

## The heatmap in one paragraph

The ETL fits a LOESS curve to each H3 cell's quarterly median prices (at resolutions 7, 8 and 9, for
each metric and property type) and stores the fitted values. At query time, the server evaluates each
curve at the chosen start and end years and returns the annualised growth per cell. The client picks
the resolution from the zoom level, fetches only the cells in view at fine resolutions, and
interpolates between cell centres on the GPU. [methodology.md](methodology.md) has the full method:
filtering, the adaptive bandwidth, weighting, guards and the coverage rules.

## Tests

`pnpm test` runs vitest in both packages: the parsers, cleaners and loaders in `scripts/tests/`, and
the query maths, colour scales and formatting in `webapp/tests/`. CI runs typecheck, tests and the
webapp build on every push and pull request.
