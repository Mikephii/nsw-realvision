# NSW RealVision webapp image. The DuckDB database is not baked in: mount it and point
# DUCKDB_PATH at it (or set DUCKDB_S3_PATH). See docs/self-hosting.md.
#   docker build -t nsw-realvision .
#   docker run -p 3000:3000 -v "$PWD/data:/data:ro" -e DUCKDB_PATH=/data/realvision.duckdb nsw-realvision

# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy webapp package files and install dependencies
COPY webapp/package.json webapp/pnpm-lock.yaml webapp/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy webapp source
COPY webapp/ .

# Map tile, style and font URLs are baked into the client at build time. Empty means the default
# (see webapp/src/lib/map-tiles.ts and docs/self-hosting.md).
ARG VITE_BASEMAP_LIGHT_URL=""
ARG VITE_MAP_STYLE_DARK_URL=""
ARG VITE_MAP_STYLE_LIGHT_MONO_URL=""
ARG VITE_VECTOR_TILES_URL=""
ARG VITE_MAP_GLYPHS_URL=""

# Build the application
RUN pnpm build

# Dereference pnpm symlinks for externalized packages (native/WASM deps not bundled by Nitro)
RUN mkdir -p /externals/node_modules/@duckdb && \
    for pkg in node_modules/.pnpm/@duckdb+*/node_modules/@duckdb/*; do \
      cp -rL "$pkg" "/externals/node_modules/@duckdb/$(basename "$pkg")"; \
    done && \
    cp -rL node_modules/h3-js /externals/node_modules/h3-js

# --- Production stage ---
FROM node:22-slim AS runner

WORKDIR /app

# Copy built application
COPY --from=builder /app/.output /app/.output
COPY --from=builder /app/package.json /app/package.json

# Copy externalized packages (dereferenced from pnpm symlinks)
COPY --from=builder /externals/node_modules /app/node_modules

# Bake the DuckDB extensions the server loads (spatial, h3, httpfs) into the image, so the
# container needs no internet access on first start.
RUN node -e "import('@duckdb/node-api').then(async ({ DuckDBInstance }) => { \
      const db = await DuckDBInstance.create(':memory:'); const c = await db.connect(); \
      for (const sql of ['INSTALL spatial', 'INSTALL httpfs', 'INSTALL h3 FROM community']) await c.run(sql); })"

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DUCKDB_PATH=/data/realvision.duckdb

CMD ["node", ".output/server/index.mjs"]
