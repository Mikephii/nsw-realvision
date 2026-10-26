// Encodes out/raw.webm (from record.mjs) into the README media. Needs ffmpeg on PATH.
//   out/nsw-realvision-demo.mp4   the full demo, H.264, under 10 MB (GitHub's inline video limit)
//   out/nsw-realvision-demo.webm  the same, VP9
//   out/stills/*.png              full-size stills
//   ../docs/media/                heatmap-preview.gif, the README stills and social-preview.png
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'

const out = new URL('./out/', import.meta.url).pathname
const media = new URL('../docs/media/', import.meta.url).pathname
const raw = `${out}raw.webm`
const marks = Object.fromEntries(
  JSON.parse(readFileSync(`${out}marks.json`, 'utf8')).map((m) => [
    m.name,
    m.t,
  ]),
)
mkdirSync(`${out}stills`, { recursive: true })
mkdirSync(media, { recursive: true })

const ffmpeg = (...args) =>
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' })
const mb = (f) => (statSync(f).size / 1024 / 1024).toFixed(1)

const start = marks.start
const end = marks.end + 0.6
const length = (end - start).toFixed(2)

// `--only=gif,stills` re-runs just those parts.
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',')
const want = (part) => !only || only.includes(part)

// The full demo. Two-pass at a bitrate that lands under 10 MB for its length.
const kbps = Math.floor((9.3 * 8 * 1024) / Number(length))
const mp4 = `${out}nsw-realvision-demo.mp4`
if (want('video')) {
  const common = [
    '-ss',
    String(start),
    '-t',
    length,
    '-i',
    raw,
    '-vf',
    'fps=30,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-b:v',
    `${kbps}k`,
    '-an',
  ]
  ffmpeg(
    ...common,
    '-pass',
    '1',
    '-passlogfile',
    `${out}x264`,
    '-f',
    'mp4',
    '/dev/null',
  )
  ffmpeg(
    ...common,
    '-pass',
    '2',
    '-passlogfile',
    `${out}x264`,
    '-movflags',
    '+faststart',
    mp4,
  )
  console.log(`mp4  ${mp4} (${mb(mp4)} MB, ${length}s)`)

  const webm = `${out}nsw-realvision-demo.webm`
  ffmpeg(
    '-ss',
    String(start),
    '-t',
    length,
    '-i',
    raw,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    `${kbps}k`,
    '-row-mt',
    '1',
    '-an',
    webm,
  )
  console.log(`webm ${webm} (${mb(webm)} MB)`)
}

// The README preview: the fly-in from NSW to Sydney Harbour.
if (want('gif')) {
  const gif = `${media}heatmap-preview.gif`
  const gStart = marks.nsw - 1.5
  const gLen = (marks.harbour + 1.2 - gStart).toFixed(2)
  const palette = `${out}palette.png`
  const scale = 'fps=10,scale=800:-1:flags=lanczos'
  ffmpeg(
    '-ss',
    String(gStart),
    '-t',
    gLen,
    '-i',
    raw,
    '-vf',
    `${scale},palettegen=stats_mode=diff:max_colors=160`,
    palette,
  )
  ffmpeg(
    '-ss',
    String(gStart),
    '-t',
    gLen,
    '-i',
    raw,
    '-i',
    palette,
    '-lavfi',
    `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    gif,
  )
  console.log(`gif  ${gif} (${mb(gif)} MB, ${gLen}s)`)
}

if (want('stills')) {
  // Stills, at moments chosen from the marks.
  const stills = {
    'heatmap-sydney': marks.harbour + 1.0,
    'heatmap-tooltip': marks.harbour + 2.1,
    'north-shore': marks['north-shore'] - 0.6,
    'hex-detail': (marks['dialog-dragged'] ?? marks['dialog-no-drag']) - 0.4,
    'time-range': marks['range-20yr'] - 0.2,
  }
  for (const [name, t] of Object.entries(stills)) {
    ffmpeg(
      '-ss',
      String(t),
      '-i',
      raw,
      '-frames:v',
      '1',
      `${out}stills/${name}.png`,
    )
  }
  for (const name of ['heatmap-sydney', 'heatmap-tooltip', 'hex-detail']) {
    ffmpeg(
      '-i',
      `${out}stills/${name}.png`,
      '-vf',
      'scale=1200:-1:flags=lanczos',
      `${media}${name}.png`,
    )
  }

  // Social preview: the map area of the Sydney still, cropped to 2:1.
  ffmpeg(
    '-i',
    `${out}stills/heatmap-sydney.png`,
    '-vf',
    'crop=1270:635:292:300,scale=1280:640:flags=lanczos',
    `${media}social-preview.png`,
  )
  console.log('stills and social preview written')
}
