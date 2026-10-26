# NSW RealVision

NSW property sales analytics: an ETL that builds a DuckDB database from public NSW Valuer General
sales files (geocoded with G-NAF), and a TanStack Start webapp with dashboards and an H3 growth
heatmap. This file is for coding agents and contributors; people should start with the
[README](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Tech stack

- **Language**: TypeScript, strict, throughout
- **Web framework**: TanStack Start (React 19, TanStack Router, Nitro)
- **Data engine**: DuckDB (`@duckdb/node-api`) with the `spatial` and `h3` extensions
- **Charts**: Apache ECharts. **Maps**: MapLibre via react-map-gl, terra-draw for drawing
- **UI**: shadcn/ui (Radix, Tailwind 4, Hugeicons, Inter)
- **State**: Zustand (one store per feature, persisted to localStorage) and React context

## Layout

```
scripts/        ETL CLI (`pnpm etl ...`): extract, parse, clean, load, data quality, geocode, H3, LOESS
webapp/         TanStack Start app: routes, widgets, server functions, DuckDB queries
demo/           Playwright + ffmpeg recorder for the README demo
docs/           data, self-hosting, architecture, methodology, data format, research and notes
NSWVGData/      raw NSW VG files (gitignored)
GNAFData/       G-NAF NSW tables (gitignored)
data/           realvision.duckdb (gitignored)
```

`scripts/` and `webapp/` are separate pnpm projects with their own lockfiles. The root `package.json`
has convenience scripts: `pnpm setup`, `pnpm dev`, `pnpm etl`, `pnpm test`, `pnpm typecheck`.

Read these before larger changes:

- [docs/architecture.md](docs/architecture.md): pipeline, tables, server functions, widgets
- [docs/methodology.md](docs/methodology.md): the heatmap and LOESS method
- [docs/data-format.md](docs/data-format.md): the `.DAT` format; [docs/reference/](docs/reference/README.md) has the official PDFs
- [docs/notes/](docs/notes/README.md): TanStack Start, DuckDB, shadcn and LOESS gotchas

## Commands

```bash
pnpm setup                 # install both packages
pnpm dev                   # webapp on http://localhost:3000 (VITE_DEVTOOLS=false hides devtools)
pnpm test                  # vitest in both packages
pnpm typecheck             # tsc in both packages

pnpm etl extract           # unzip NSWVGData/downloadedZips into year/week folders
pnpm etl load [--full]     # parse, clean, load, quality flags, geocode, heatmap aggregates
pnpm etl geocode [--download|--status|--refresh]
pnpm etl status
```

The webapp holds `data/realvision.duckdb` open, so stop it before running ETL commands that write.

## Engineering standards

- **Strict types, no `any`.** Interfaces for object shapes, discriminated unions for variants and
  parsed record types.
- **Parse at the boundary.** Raw data becomes typed structures as soon as it is read. Use named
  field access, never positional indexing based on assumed field order.
- **Prefer surfacing data over dropping it.** Parsers collect warnings instead of throwing. Cleaners
  keep the raw value when cleaning fails.
- **Abstractions when the pattern is clear**, each doing one thing, without leaking internals.
  Classes only when they genuinely hold state and behaviour.
- **No barrel exports** (`index.ts` re-exports). Import from the source module. The one exception is
  `widgets/index.ts`, which registers widgets.
- **Document public APIs with JSDoc.** Types are documentation.
- **Tests:** vitest. Backend logic in `scripts/tests/`, query maths and UI helpers in
  `webapp/tests/`.

### Query architecture

- **All DuckDB access is server-side**, through `webapp/src/lib/db.server.ts`. Server functions in
  `webapp/src/lib/server-fns.ts` dynamically import the server-only modules inside their handlers.
- **Server functions validate input with Zod** schemas from `webapp/src/lib/validation.ts`, never an
  identity validator. GET parameters arrive as strings, so numeric fields use `z.coerce.number()`.
  Without it, `resolution=7` arrives as `"7"` and fails to match INTEGER columns.
- **Table-prefixed WHERE clauses:** when a query joins tables, use
  `buildWhereClause(filter, { prefix: 'fps' })`. Never patch prefixes in with string replacement.
- **The client sends filters, the server resolves them.** `resolveSpatialFilters()` currently runs on
  the client, because custom areas live in localStorage.
- **The database is read-only to the webapp.** Never add writes there.

### Heatmap and LOESS

One precomputed curve per cell: the ETL (`scripts/src/heatmap/loess-curve-precompute.ts`) writes
quarterly LOESS curves to `agg_h3_loess_curve`, and every consumer reads from it. There is no
client-side LOESS for the heatmap.

- Algorithm constants: `scripts/src/heatmap/loess-config.ts` (the single source of truth)
- Table schema: `scripts/src/heatmap/schema.ts`
- Server queries: `webapp/src/lib/heatmap-queries.ts`
- Periods end at the data's latest year: use `heatmapEndYear(useDataCoverage())`, not the clock
- Pitfalls and history: [docs/notes/heatmap-loess.md](docs/notes/heatmap-loess.md)

### Webapp

- Small, focused, composable components.
- **React context** for small shared state (theme, data coverage). **Zustand** for feature state,
  one store per concern. Stores must not dictate layout.
- **Every analytical widget supports the standard filters:** suburbs, custom areas, date range, and
  freehold or strata (`StrataFilter` from `queries.ts`).
- A widget is a folder in `webapp/src/features/dashboard/widgets/` with a `definition.tsx` that
  registers its type, default config, layout, component and settings panel.
- Map tile, style and font URLs come from `webapp/src/lib/map-tiles.ts`, never inline.
- shadcn theme: radix-mira style, zinc base, blue theme, Hugeicons, Inter.

## Data

- A **district** is a council (LGA), with a three-digit code that can change when councils merge.
- **Strata vs freehold:** `strata IS NOT NULL` means a unit or apartment; otherwise a house or land.
- Purchaser and vendor names are never stored.
- The sales data is CC BY 3.0 AU (Valuer General NSW) and G-NAF is under the Open G-NAF EULA.
  Keep the attribution in the UI.

Record new gotchas in `docs/notes/`.
