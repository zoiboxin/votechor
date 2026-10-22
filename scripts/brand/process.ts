/**
 * VoteChor brand asset pipeline (Task ID: 91-b)
 * - Reads AI-generated masters from public/brand/_gen-*.png
 * - Produces: favicon.ico, favicon PNGs, PWA icons, apple-touch-icon,
 *   og-image (1200x630) with text overlay, instagram post (1080x1080) and
 *   story (1080x1920) with ad copy overlay.
 *
 * Run: bun scripts/brand/process.ts
 */
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import fs from 'fs'
import path from 'path'

const ROOT = '/home/z/my-project'
const BRAND = path.join(ROOT, 'public/brand')
const ICONS = path.join(ROOT, 'public/icons')

const INK = '#1c1a17'
const AMBER = '#f2a541'
const CREAM = '#f5efdc'
const RED = '#8c1f28'

async function ensureDirs() {
  fs.mkdirSync(ICONS, { recursive: true })
}

async function genIcons() {
  const src = path.join(BRAND, '_gen-icon.png')
  if (!fs.existsSync(src)) throw new Error('missing _gen-icon.png')
  const img = sharp(src).resize(1024, 1024, { fit: 'cover' })

  // Straight icons
  for (const size of [512, 192, 96, 48, 32, 16]) {
    await img.clone().resize(size, size).png().toFile(path.join(ICONS, `icon-${size}.png`))
  }
  await img.clone().resize(16, 16).png().toFile(path.join(ICONS, 'favicon-16x16.png'))
  await img.clone().resize(32, 32).png().toFile(path.join(ICONS, 'favicon-32x32.png'))
  await img.clone().resize(180, 180).png().toFile(path.join(ICONS, 'apple-touch-icon.png'))

  // Maskable icon: artwork shrunk into a safe zone over solid brand amber
  const pad = Math.round(1024 * 0.12)
  const inner = await sharp(src)
    .resize(1024 - pad * 2, 1024 - pad * 2, { fit: 'cover' })
    .toBuffer()
  const maskableFull = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: AMBER },
  })
    .composite([{ input: inner, top: pad, left: pad }])
    .png()
    .toBuffer()
  await sharp(maskableFull)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS, 'icon-maskable-512.png'))

  // favicon.ico (16 + 32 + 48)
  const icoBuf = await pngToIco([
    path.join(ICONS, 'favicon-16x16.png'),
    path.join(ICONS, 'favicon-32x32.png'),
    path.join(ICONS, 'icon-48.png'),
  ])
  fs.writeFileSync(path.join(ROOT, 'public/favicon.ico'), icoBuf)
  console.log('icons done')
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textOverlaySVG(
  w: number,
  h: number,
  bands: Array<{ y: number; height: number }>,
  lines: Array<{ text: string; x: number; y: number; size: number; fill: string; weight?: number; anchor?: string; spacing?: number }>,
  badge?: { x: number; y: number; w: number; h: number; fill: string; rx: number },
) {
  const bandRects = bands
    .map(
      (b) =>
        `<rect x="0" y="${b.y}" width="${w}" height="${b.height}" fill="url(#fade)"/>`,
    )
    .join('')
  const badgeRect = badge
    ? `<rect x="${badge.x}" y="${badge.y}" width="${badge.w}" height="${badge.h}" rx="${badge.rx}" fill="${badge.fill}"/>`
    : ''
  const texts = lines
    .map(
      (l) =>
        `<text x="${l.x}" y="${l.y}" font-family="'DejaVu Sans', Arial, Helvetica, sans-serif" font-size="${l.size}" font-weight="${l.weight ?? 800}" fill="${l.fill}" text-anchor="${l.anchor ?? 'start'}" letter-spacing="${l.spacing ?? 0}">${escapeXml(l.text)}</text>`,
    )
    .join('')
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="0.55" stop-color="${INK}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  ${bandRects}${badgeRect}${texts}
</svg>`
}

async function genOg() {
  const src = path.join(BRAND, '_gen-keyart.png')
  if (!fs.existsSync(src)) throw new Error('missing _gen-keyart.png')
  const W = 1200
  const H = 630
  const base = await sharp(src)
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .toBuffer()
  const svg = textOverlaySVG(
    W,
    H,
    [{ y: H - 300, height: 300 }],
    [
      { text: 'VOTECHOR', x: 56, y: H - 176, size: 92, fill: AMBER, weight: 900, spacing: 2 },
      { text: 'The Great Parliament Run', x: 58, y: H - 118, size: 44, fill: CREAM, weight: 700 },
      { text: 'FREE 3D MULTIPLAYER BROWSER GAME — NO DOWNLOAD', x: 60, y: H - 60, size: 26, fill: CREAM, weight: 700, spacing: 1.5 },
    ],
  )
  await sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ quality: 92 })
    .toFile(path.join(BRAND, 'og-image.png'))
  console.log('og done')
}

async function genInstaPost() {
  const src = path.join(BRAND, '_gen-post.png')
  if (!fs.existsSync(src)) throw new Error('missing _gen-post.png')
  const W = 1080
  const H = 1080
  const base = await sharp(src)
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .toBuffer()
  const svg = textOverlaySVG(
    W,
    H,
    [{ y: H - 380, height: 380 }],
    [
      { text: 'THE VOTES ARE MISSING.', x: 64, y: H - 268, size: 58, fill: CREAM, weight: 900 },
      { text: 'THE PROTEST IS ON.', x: 64, y: H - 196, size: 58, fill: CREAM, weight: 900 },
      { text: 'EVERYBODY RUN!', x: 64, y: H - 124, size: 66, fill: AMBER, weight: 900 },
      { text: 'VOTECHOR — FREE 3D MULTIPLAYER', x: 66, y: H - 56, size: 32, fill: CREAM, weight: 700, spacing: 2 },
    ],
    { x: 64, y: H - 420, w: 560, h: 64, fill: RED, rx: 32 },
  )
  // red badge text needs a separate overlay so the rect sits behind its label
  const badgeText = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><text x="82" y="${H - 376}" font-family="'DejaVu Sans', Arial, sans-serif" font-size="30" font-weight="800" fill="#ffffff" letter-spacing="3">PLAY FREE IN BROWSER</text></svg>`,
  )
  await sharp(base)
    .composite([
      { input: Buffer.from(svg), top: 0, left: 0 },
      { input: badgeText, top: 0, left: 0 },
    ])
    .png({ quality: 92 })
    .toFile(path.join(BRAND, 'instagram-post.png'))
  console.log('ig post done')
}

async function genInstaStory() {
  const src = path.join(BRAND, '_gen-story.png')
  if (!fs.existsSync(src)) throw new Error('missing _gen-story.png')
  const W = 1080
  const H = 1920
  const base = await sharp(src)
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .toBuffer()
  const topSvg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${INK}" stop-opacity="0.85"/>
          <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${W}" height="480" fill="url(#tf)"/>
      <text x="80" y="220" font-family="'DejaVu Sans', Arial, sans-serif" font-size="120" font-weight="900" fill="${AMBER}" letter-spacing="4">VOTECHOR</text>
      <text x="84" y="300" font-family="'DejaVu Sans', Arial, sans-serif" font-size="52" font-weight="700" fill="${CREAM}">The Great Parliament Run</text>
      <rect x="84" y="348" width="560" height="70" rx="35" fill="${RED}"/>
      <text x="84" y="396" font-family="'DejaVu Sans', Arial, sans-serif" font-size="36" font-weight="800" fill="#ffffff" letter-spacing="2">PLAY FREE IN BROWSER</text>
    </svg>`,
  )
  const botSvg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bf" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="${INK}" stop-opacity="0.9"/>
          <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${H - 520}" width="${W}" height="520" fill="url(#bf)"/>
      <text x="80" y="${H - 340}" font-family="'DejaVu Sans', Arial, sans-serif" font-size="62" font-weight="900" fill="${CREAM}">The votes are missing.</text>
      <text x="80" y="${H - 260}" font-family="'DejaVu Sans', Arial, sans-serif" font-size="62" font-weight="900" fill="${CREAM}">The protest is on.</text>
      <text x="80" y="${H - 170}" font-family="'DejaVu Sans', Arial, sans-serif" font-size="72" font-weight="900" fill="${AMBER}">EVERYBODY RUN!</text>
      <text x="80" y="${H - 80}" font-family="'DejaVu Sans', Arial, sans-serif" font-size="40" font-weight="700" fill="${CREAM}" letter-spacing="2">VOTECHOR.APP</text>
    </svg>`,
  )
  await sharp(base)
    .composite([
      { input: topSvg, top: 0, left: 0 },
      { input: botSvg, top: 0, left: 0 },
    ])
    .png({ quality: 92 })
    .toFile(path.join(BRAND, 'instagram-story.png'))
  console.log('ig story done')
}

async function main() {
  await ensureDirs()
  await genIcons()
  await genOg()
  await genInstaPost()
  await genInstaStory()
  console.log('ALL BRAND ASSETS DONE')
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
