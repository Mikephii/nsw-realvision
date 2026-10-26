// Records the README demo from the real app: the growth heatmap over Sydney, the North Shore and
// the Northern Beaches, hovering hexes, a hex's detail, and the time range changing the colours.
//
//   VITE_DEVTOOLS=false pnpm --dir ../webapp dev     # in another terminal
//   pnpm record                                      # warm-up pass, then the recorded pass
//   pnpm encode                                      # trims and encodes into out/ and ../docs/media/
//
// The map is driven through the dev-only `window.__rvMap` hook (`?demo=1`), so camera moves are
// smooth; hovers, clicks and drags are real mouse events.
import { chromium } from 'playwright'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { demoStorage } from './fixture.mjs'

const URL = process.env.RV_URL ?? 'http://localhost:3000/boards?demo=1'
const OUT = new globalThis.URL('./out/', import.meta.url).pathname
const PROFILE = join(OUT, 'profile')
const SIZE = { width: 1600, height: 1000 }

/** Places, as [lng, lat]. */
const P = {
  nsw: [150.9, -33.4],
  harbour: [151.215, -33.856],
  mosman: [151.243, -33.829],
  neutralBay: [151.218, -33.835],
  balmain: [151.18, -33.858],
  paddington: [151.228, -33.884],
  chatswood: [151.181, -33.797],
  laneCove: [151.166, -33.815],
  stLeonards: [151.195, -33.823],
  manly: [151.285, -33.797],
  deeWhy: [151.288, -33.752],
  collaroy: [151.299, -33.733],
  monaVale: [151.303, -33.677],
  beaches: [151.275, -33.745],
  sydney: [151.12, -33.83],
}

// A visible cursor: headless recordings have none. Follows real mouse events.
function installCursor() {
  const add = () => {
    const c = document.createElement('div')
    c.id = 'demo-cursor'
    c.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 15 L11.5 21.5 L14 20.3 L11 14 L17 14 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    Object.assign(c.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transform: 'translate(-100px,-100px)',
      transition: 'none',
    })
    document.body.appendChild(c)
    const ring = document.createElement('div')
    Object.assign(ring.style, {
      position: 'fixed',
      width: '34px',
      height: '34px',
      marginLeft: '-17px',
      marginTop: '-17px',
      borderRadius: '50%',
      border: '3px solid rgba(21,93,252,0.85)',
      zIndex: '2147483646',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.35s, transform 0.35s',
    })
    document.body.appendChild(ring)
    document.addEventListener(
      'mousemove',
      (e) => {
        c.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`
      },
      true,
    )
    document.addEventListener(
      'mousedown',
      (e) => {
        ring.style.left = `${e.clientX}px`
        ring.style.top = `${e.clientY}px`
        ring.style.transition = 'none'
        ring.style.opacity = '1'
        ring.style.transform = 'scale(0.6)'
        requestAnimationFrame(() => {
          ring.style.transition = 'opacity 0.45s, transform 0.45s'
          ring.style.opacity = '0'
          ring.style.transform = 'scale(1.4)'
        })
      },
      true,
    )
  }
  if (document.body) add()
  else document.addEventListener('DOMContentLoaded', add)
}

async function run({ record }) {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    // Playwright's own headless shell: system Chrome's new headless mode crops recordings to a
    // 1280x720 window. Set DEMO_CHANNEL=chrome to use an installed Chrome anyway.
    ...(process.env.DEMO_CHANNEL ? { channel: process.env.DEMO_CHANNEL } : {}),
    // Hardware WebGL (Metal on macOS); without it the heatmap renders in software and stutters.
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
    viewport: SIZE,
    deviceScaleFactor: 1,
    ...(record ? { recordVideo: { dir: join(OUT, 'raw'), size: SIZE } } : {}),
  })
  await ctx.addInitScript(
    (s) => {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v)
    },
    demoStorage({ rows: 9 }),
  )
  await ctx.addInitScript(installCursor)

  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const t0 = Date.now()
  const marks = []
  const mark = (name) => {
    marks.push({ name, t: (Date.now() - t0) / 1000 })
    console.log(`${marks.at(-1).t.toFixed(1)}s ${name}`)
  }
  page.on('pageerror', (e) => {
    if (!/Hydration/.test(e.message))
      console.log('page error:', e.message.slice(0, 160))
  })

  await page.goto(URL)
  await page.waitForFunction(() => window.__rvMap?.loaded(), null, {
    timeout: 90_000,
  })

  const settle = async (extra = 900) => {
    await page.waitForFunction(
      () =>
        window.__rvHeatmapLoading === false && window.__rvMap.areTilesLoaded(),
      null,
      { timeout: 90_000, polling: 100 },
    )
    await page.waitForTimeout(extra)
  }
  const fly = async (center, zoom, duration, method = 'flyTo') => {
    await page.evaluate(
      ([c, z, d, m]) =>
        new Promise((resolve) => {
          const map = window.__rvMap
          map.once('moveend', () => resolve())
          map[m]({ center: c, zoom: z, duration: d, essential: true })
        }),
      [center, zoom, duration, method],
    )
  }
  /** Screen position of a place, in page coordinates. */
  const at = async (lngLat) =>
    page.evaluate((ll) => {
      const map = window.__rvMap
      const rect = map.getCanvas().getBoundingClientRect()
      const p = map.project(ll)
      return { x: rect.left + p.x, y: rect.top + p.y }
    }, lngLat)
  const hover = async (lngLat, hold = 1100) => {
    const { x, y } = await at(lngLat)
    await page.mouse.move(x, y, { steps: 28 })
    await page.waitForTimeout(hold)
  }

  // Park the cursor off the map, then start on all of NSW.
  await page.mouse.move(1500, 120)
  await settle(1500)
  mark('start')

  // 1. NSW, a gentle push towards Sydney.
  await page.waitForTimeout(1500)
  await fly([151.0, -33.75], 8.2, 2800, 'easeTo')
  await settle(300)
  mark('nsw')

  // 2. Fly into Sydney Harbour and let the fine hexes load.
  await fly(P.harbour, 11.7, 4200)
  await settle(1200)
  mark('harbour')

  // 3. Hover around the harbour: tooltip and hex border.
  for (const place of [P.balmain, P.neutralBay, P.mosman, P.paddington])
    await hover(place)
  mark('harbour-hovers')

  // 4. North over the bridge to the North Shore.
  await page.mouse.move(1500, 330, { steps: 20 })
  await fly(P.stLeonards, 12.1, 3200, 'easeTo')
  await settle(700)
  for (const place of [P.laneCove, P.chatswood, P.stLeonards])
    await hover(place)
  mark('north-shore')

  // 5. East to Manly, then up the Northern Beaches to Mona Vale.
  await page.mouse.move(1500, 330, { steps: 20 })
  await fly(P.manly, 12.1, 3000, 'easeTo')
  await settle(500)
  await hover(P.manly, 900)
  await fly(P.collaroy, 12.0, 3200, 'easeTo')
  await settle(500)
  await hover(P.deeWhy, 900)
  await fly(P.monaVale, 12.0, 2600, 'easeTo')
  await settle(600)
  mark('beaches')

  // 6. Open a hex's detail and drag the start of the range.
  await fly(P.deeWhy, 12.3, 2200, 'easeTo')
  await settle(500)
  const target = await at(P.deeWhy)
  await page.mouse.move(target.x, target.y, { steps: 25 })
  await page.waitForTimeout(500)
  await page.mouse.click(target.x, target.y)
  await page.waitForSelector('[role="dialog"]', { timeout: 20_000 })
  mark('dialog-open')
  let dragged = false
  try {
    const handle = await page.waitForSelector('[data-range-handle="start"]', {
      timeout: 20_000,
    })
    await page.waitForTimeout(1500)
    const box = await handle.boundingBox()
    if (box) {
      const hx = box.x + box.width / 2
      const hy = box.y + box.height / 2
      await page.mouse.move(hx, hy, { steps: 25 })
      await page.waitForTimeout(400)
      await page.mouse.down()
      await page.mouse.move(hx - 170, hy, { steps: 45 })
      await page.waitForTimeout(500)
      await page.mouse.move(hx - 90, hy, { steps: 30 })
      await page.mouse.up()
      dragged = true
    }
  } catch (e) {
    console.log('range handles not found:', e.message.split('\n')[0])
  }
  await page.waitForTimeout(1800)
  mark(dragged ? 'dialog-dragged' : 'dialog-no-drag')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)

  // 7. Change the time range and watch the colours shift.
  await fly(P.beaches, 11.2, 2200, 'easeTo')
  await settle(800)
  for (const label of ['5yr', '20yr', '10yr']) {
    const button = page.getByRole('button', { name: label, exact: true })
    const box = await button.boundingBox()
    if (box)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 24,
      })
    await page.waitForTimeout(300)
    await button.click()
    await settle(2000)
    mark(`range-${label}`)
  }

  // 8. Pull back out over Sydney.
  await page.mouse.move(1500, 330, { steps: 20 })
  await fly(P.sydney, 9.9, 3600)
  await settle(2200)
  mark('end')

  const video = page.video()
  await ctx.close()
  if (record && video) {
    await rename(await video.path(), join(OUT, 'raw.webm'))
    await writeFile(join(OUT, 'marks.json'), JSON.stringify(marks, null, 2))
    console.log('saved out/raw.webm and out/marks.json')
  }
}

await mkdir(OUT, { recursive: true })
await rm(join(OUT, 'raw'), { recursive: true, force: true })
if (!process.argv.includes('--no-warmup')) {
  console.log('warm-up pass (not recorded)')
  await run({ record: false })
}
console.log('recorded pass')
await run({ record: true })
for (const f of await readdir(join(OUT, 'raw')).catch(() => []))
  console.log('left over:', f)
