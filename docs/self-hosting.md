# Self-hosting

NSW RealVision is one Node server (the TanStack Start webapp) reading one DuckDB file. There is no
other database, queue or cache. Build the database once (see [data.md](data.md)), then run the server
wherever you like.

## What you need

- A built `data/realvision.duckdb` (about 1.5 GB). You can build it on your laptop and copy it to the
  server; the server never writes to it.
- Node 22 and pnpm, or Docker.
- About 1-2 GB of RAM for the server. DuckDB's memory is capped by `DUCKDB_MEMORY_LIMIT` (default
  512MB); give it more for faster heatmap and chart queries.
- Internet access from your users' browsers to the map tile servers (see [Map tiles](#map-tiles)).

## Run it locally

```sh
pnpm setup      # installs both packages
pnpm dev        # http://localhost:3000
```

Or a production build:

```sh
pnpm build
node webapp/.output/server/index.mjs     # listens on PORT (default 3000)
```

The server opens `data/realvision.duckdb` by default. Set `DUCKDB_PATH` to use another file.

## Docker

The image contains the app and the DuckDB extensions it loads (`spatial`, `h3`, `httpfs`), so it
needs no internet access at startup. The database is not in the image; mount it.

```sh
docker build -t nsw-realvision .
docker run -d -p 3000:3000 \
  -v "$PWD/data:/data:ro" \
  -e DUCKDB_PATH=/data/realvision.duckdb \
  -e DUCKDB_MEMORY_LIMIT=1GB \
  nsw-realvision
```

`GET /api/health` answers `{"status":"ok"}` for load balancers and health checks.

## Docker Compose

`docker-compose.yml` runs the app with `./data` mounted read-only:

```sh
docker compose up -d                                        # http://localhost:3000
DOMAIN=sales.example.com docker compose --profile tls up -d # adds Caddy with automatic HTTPS
```

With the `tls` profile, point your domain's DNS at the host and open ports 80 and 443. Caddy fetches
and renews the certificate.

## A small VM

Any Linux VM with 2 GB of RAM and Docker works:

1. Copy the repository (or just `Dockerfile`, `docker-compose.yml` and `webapp/`) and your
   `data/realvision.duckdb` to the VM.
2. `docker compose --profile tls up -d` with `DOMAIN` set, or put it behind the reverse proxy you
   already run.

On a platform with volumes (Fly.io, Railway, Render and similar), deploy the `Dockerfile`, attach a
volume holding the database, and set `DUCKDB_PATH` to its path on the volume. Make sure the
machine has at least 1 GB of memory.

## Database on object storage

If your host has no persistent disk, keep the database in S3 or an S3-compatible store (R2, MinIO)
and set `DUCKDB_S3_PATH`:

```sh
docker run -d -p 3000:3000 \
  -e DUCKDB_S3_PATH=s3://your-bucket/realvision.duckdb \
  -e AWS_REGION=ap-southeast-2 \
  -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... \
  nsw-realvision
```

The server attaches the file read-only over DuckDB's `httpfs` extension and reads only the parts
queries need. The first request after startup is slower: it attaches the file and runs one warm-up
query while DuckDB fetches the pages it needs.

## Updating the data

The server holds the database open, and DuckDB allows one writer at a time, so don't run the ETL
against the live file. Instead:

1. Update a copy of the database elsewhere (your laptop is fine): see
   [data.md](data.md#keeping-it-current).
2. Copy the new file next to the old one on the server, then replace it in one step
   (`mv realvision.duckdb.new realvision.duckdb`).
3. Restart the app (`docker compose restart app`).

With `DUCKDB_S3_PATH`, upload the new file under a temporary key, move it over the old key, and
restart.

## Map tiles

The maps load tiles in the browser from free public services that need no API key:

| Used for | Default |
|---|---|
| Property and area maps (light) | OpenStreetMap raster tiles, `tile.openstreetmap.org` |
| Dark theme and the relative performance map | OpenFreeMap styles (`dark`, `positron`) |
| The heatmap's basemap, water, roads and place labels | OpenFreeMap vector tiles (OpenMapTiles schema) |
| Label fonts | `fonts.openmaptiles.org` |

These are fine for personal use and small deployments, but they are community services with usage
policies: the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/), for
one, forbids heavy use from apps. For a public deployment, point the maps at your own tiles (for
example [Protomaps](https://protomaps.com/) PMTiles, or a self-hosted OpenFreeMap) or a keyed
provider (MapTiler, Stadia Maps). The URLs are build-time settings:

| Variable | What |
|---|---|
| `VITE_BASEMAP_LIGHT_URL` | XYZ raster template for the light property and area maps |
| `VITE_MAP_STYLE_DARK_URL` | MapLibre style URL for dark-theme maps |
| `VITE_MAP_STYLE_LIGHT_MONO_URL` | MapLibre style URL for the relative performance map |
| `VITE_VECTOR_TILES_URL` | OpenMapTiles-schema vector tiles: a TileJSON URL, or an XYZ template with `{z}` |
| `VITE_MAP_GLYPHS_URL` | Glyph URL template with `{fontstack}` and `{range}`; must serve `Open Sans Regular` |

Set them when building: `pnpm build` reads them from the environment or `webapp/.env.local`, and
`docker build --build-arg VITE_VECTOR_TILES_URL=...` (or the same variables in your shell for
`docker compose build`) passes them into the image. Keep the attribution controls visible: the tile
licences require them.

## Security

- **There is no sign-in.** Anyone who can reach the server can use it. The data is public, but if the
  app shouldn't be, put it behind something that authenticates people: Cloudflare Access, Tailscale,
  oauth2-proxy, or your reverse proxy's basic auth.
- Server functions validate their inputs with Zod and build parameterised queries. Even so, heavy
  queries (large custom areas, long ranges) use real CPU, so put a public instance behind a rate
  limit.
- Mount the database read-only. The server opens it read-only anyway.

## Configuration reference

| Variable | Default | What |
|---|---|---|
| `DUCKDB_PATH` | `data/realvision.duckdb` (`/data/realvision.duckdb` in Docker) | The database file |
| `DUCKDB_S3_PATH` | unset | Attach the database from S3 instead (read-only) |
| `AWS_REGION` | `ap-southeast-2` | Region for `DUCKDB_S3_PATH`; credentials come from the standard AWS variables or profile |
| `DUCKDB_MEMORY_LIMIT` | `512MB` | DuckDB memory cap |
| `DUCKDB_THREADS` | `2` | DuckDB worker threads |
| `HOST` | all interfaces (`0.0.0.0` in Docker) | Interface to listen on |
| `PORT` | `3000` | Port to listen on |
| `VITE_*` map variables | see [Map tiles](#map-tiles) | Build-time tile, style and font URLs |
| `VITE_DEVTOOLS` | on in dev | Set to `false` to hide the TanStack devtools on a dev server |

See also `webapp/.env.example`.
