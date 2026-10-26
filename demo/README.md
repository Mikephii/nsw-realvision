# Demo recording

The README's demo video, preview GIF and stills are recorded from the real app on a real database.
Nothing is mocked: the recorder opens the dashboard, drives the growth heatmap and encodes what the
browser drew.

## What it records

One full-size Growth Heatmap (LOESS, all property types, 10 years) over NSW. It flies into Sydney
Harbour, hovers hexes around the harbour, pans to the North Shore and then up the Northern Beaches
to Mona Vale. It opens the Dee Why hex detail and drags the range handle, switches the time range
(5, 20 and 10 years) so the colours shift, and pulls back out over Sydney.

## Record it again

You need a built database at `data/realvision.duckdb` (see [docs/data.md](../docs/data.md)) and ffmpeg
on your PATH.

```sh
cd demo
pnpm install
npx playwright install chromium-headless-shell ffmpeg   # once

# In another terminal: the dev server, with the TanStack devtools hidden
VITE_DEVTOOLS=false pnpm --dir ../webapp dev

pnpm record        # a warm-up pass, then the recorded pass: out/raw.webm and out/marks.json
pnpm encode        # out/nsw-realvision-demo.mp4 and .webm, out/stills/, ../docs/media/
```

`node encode.mjs --only=gif,stills` redoes only those parts.

## How it works

| File | What |
|---|---|
| `fixture.mjs` | The demo board, written to the app's localStorage keys before the page loads |
| `record.mjs` | Playwright: the shot list, with timestamps written to `out/marks.json` |
| `encode.mjs` | ffmpeg: trims at the marks, then writes the MP4 (under 10 MB), WebM, GIF, stills and social preview |

- Camera moves use the dev-only `window.__rvMap` hook, which the heatmap exposes only on a dev server
  with `?demo=1` in the URL. Hovers, clicks and drags are real mouse events, and an injected cursor
  makes them visible.
- The recorder waits on the app (`window.__rvHeatmapLoading` and `map.areTilesLoaded()`), not on
  fixed timers.
- It uses Playwright's own headless shell with hardware WebGL (`--use-angle=metal`). System Chrome's
  new headless mode crops recordings to a 1280x720 window, and software WebGL makes the heatmap
  stutter.
- The warm-up pass fills the browser cache, so map tiles don't pop in during the recording.

`out/` is gitignored. Only the files in `docs/media/` are committed.
