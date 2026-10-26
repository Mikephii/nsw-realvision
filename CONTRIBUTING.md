# Contributing

Thanks for helping. Contributions are welcome: bug fixes, new widgets, better statistics, data
cleaning, docs and self-hosting notes. NSW RealVision is maintained by one person in their spare time,
so reviews may take a while. For anything large (a new widget, a change to the ETL schema or the
heatmap method), open an issue or a discussion first so we can agree on the shape before you build
it.

Please read the [code of conduct](CODE_OF_CONDUCT.md), and report security problems as
[SECURITY.md](SECURITY.md) says, not in an issue.

## Getting going

You need Node 22+, pnpm and about 8 GB of free disk for the data.

```sh
pnpm setup            # installs scripts/ and webapp/
pnpm test             # vitest in both packages; no data needed
pnpm typecheck
```

To run the app you need a database. Build one from the public files with [docs/data.md](docs/data.md)
(download the NSW Valuer General ZIPs, then `pnpm etl extract`, `pnpm etl geocode --download` and
`pnpm etl load --full`). A handful of recent yearly files is enough for most UI work. Then:

```sh
pnpm dev              # http://localhost:3000
```

## Where things go

- `scripts/src/`: the ETL. `parser/` and `cleaner/` for the `.DAT` files, `db/` for schema and
  loading, `geocode/` for G-NAF matching, `heatmap/` for the H3 and LOESS precompute, `cli.ts` for
  commands. Tests in `scripts/tests/`.
- `webapp/src/lib/`: server functions (`server-fns.ts`), Zod schemas (`validation.ts`), query modules
  (`queries.ts`, `heatmap-queries.ts`, `map-queries.ts`), the DuckDB connection (`db.server.ts`),
  map tile config (`map-tiles.ts`).
- `webapp/src/features/`: `dashboard/` (stores, grid, widgets) and `areas/` (custom areas).
- `webapp/src/routes/`: pages. Tests in `webapp/tests/`.
- `docs/`: user and contributor docs. `docs/notes/` collects gotchas; add to it.

[docs/architecture.md](docs/architecture.md) explains how it fits together, and
[CLAUDE.md](CLAUDE.md) has the conventions in one place.

## Conventions

- **Strict TypeScript, no `any`.** Interfaces for object shapes, discriminated unions for variants.
- **DuckDB stays on the server.** Add a query function in a `lib/*queries.ts` module and expose it
  through a server function in `server-fns.ts` that validates its input with a Zod schema from
  `validation.ts` (`z.coerce.number()` for numbers).
- **Parameterised SQL only.** Use `buildWhereClause(filter, { prefix })` for joined queries.
- **No barrel exports.** Import from the source module.
- **One Zustand store per feature.** React context for small shared state.
- **Every analytical widget supports the standard filters:** suburbs, custom areas, date range and
  freehold or strata.
- **The ETL surfaces data rather than dropping it:** collect parse warnings, keep raw values when
  cleaning fails, flag questionable sales instead of deleting them.
- **Never store purchaser or vendor names.**

### Adding a widget

1. Create `webapp/src/features/dashboard/widgets/<name>/` with the component, a settings panel, a
   config type and `definition.tsx` calling `registerWidget({ type, label, icon, defaultLayout,
   defaultConfig, component, settingsPanel, getTags })`.
2. Import the definition in `widgets/index.ts`.
3. Support the standard filters in its config and settings panel.
4. Add tests for any data shaping or maths.

### Changing the heatmap method

The LOESS constants live in `scripts/src/heatmap/loess-config.ts`, and the curves are precomputed by
the ETL. After changing the method, run `pnpm etl recompute-loess`, and update
[docs/methodology.md](docs/methodology.md). Read [docs/notes/heatmap-loess.md](docs/notes/heatmap-loess.md)
first: it lists the ways the heatmap, tooltip and dialog have drifted apart before.

## Pull requests

- One change per pull request. A bug fix and a refactor are two.
- `pnpm typecheck` and `pnpm test` pass. CI also builds the webapp.
- Say what you verified and how: the tests you added, and what you checked by hand (which widget,
  which data).
- Update the docs in the same pull request when behaviour or setup changes.
- If you change the README demo, re-record it with `demo/` (see [demo/README.md](demo/README.md)).

## Reporting bugs and data problems

Use the issue templates. For data problems (a wrong price, a suburb in the wrong place, geocoding
misses), include which files you loaded and the output of `pnpm etl status` and
`pnpm etl geocode --status`. Questions and ideas are welcome in Discussions.

## Licence

By contributing you agree that your contribution is licensed under the project's
[MIT licence](LICENSE).
