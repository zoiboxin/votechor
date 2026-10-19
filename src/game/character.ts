// VoteChor procedural character rig — stylized low-poly humanoids with
// procedural animation (walk/run/jump/slide/dazed/celebrate/emotes).
// Shared geometry cache for performance; used for players, NPCs, crowd, and the boss.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { AnimName } from './shared/types'
import { archetypeById } from './shared/constants'
import { policeUniformColors } from '../lib/cosmetics'
import type { BodyBuild } from '../lib/cosmetics'

const G = {
  head: new THREE.SphereGeometry(0.155, 18, 14),
  torso: new THREE.BoxGeometry(0.42, 0.52, 0.24),
  hips: new THREE.BoxGeometry(0.36, 0.16, 0.22),
  arm: new THREE.BoxGeometry(0.11, 0.46, 0.11),
  leg: new THREE.BoxGeometry(0.14, 0.5, 0.15),
  hand: new THREE.SphereGeometry(0.06, 6, 5),
  foot: new THREE.BoxGeometry(0.15, 0.09, 0.26),
  // task 82: cap rim lifted OFF the brow line (π/1.9 ended the shell at eye-brow
  // height and shadowed the arch) — π/2.35 ends the shell just above the brows.
  hair: new THREE.SphereGeometry(0.163, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2.35),
  cap: new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  capBrim: new THREE.BoxGeometry(0.2, 0.02, 0.16),
  glasses: new THREE.BoxGeometry(0.24, 0.05, 0.05),
  signBoard: new THREE.BoxGeometry(0.5, 0.3, 0.02),
  signPole: new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5),
  backpack: new THREE.BoxGeometry(0.3, 0.34, 0.14),
  beard: new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
  lathi: new THREE.CylinderGeometry(0.025, 0.035, 0.95, 6),
  hat: new THREE.CylinderGeometry(0.16, 0.22, 0.12, 10),
  cone: new THREE.CylinderGeometry(0.02, 0.15, 0.24, 10),
  coneBand: new THREE.CylinderGeometry(0.105, 0.125, 0.045, 10),
  crownBand: new THREE.CylinderGeometry(0.155, 0.17, 0.09, 8),
  crownSpike: new THREE.ConeGeometry(0.045, 0.09, 4),
  garland: new THREE.TorusGeometry(0.17, 0.04, 6, 14),
  // ---- wardrobe expansion geometry ----
  bandana: new THREE.SphereGeometry(0.166, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6),
  bandanaKnot: new THREE.BoxGeometry(0.06, 0.05, 0.03),
  hardhat: new THREE.SphereGeometry(0.175, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  hardhatBrim: new THREE.CylinderGeometry(0.21, 0.21, 0.02, 12),
  hardhatRidge: new THREE.BoxGeometry(0.03, 0.05, 0.28),
  moustache: new THREE.BoxGeometry(0.13, 0.028, 0.03),
  warpaint: new THREE.BoxGeometry(0.055, 0.018, 0.02),
  scar: new THREE.BoxGeometry(0.016, 0.09, 0.02),
  kurtaSkirt: new THREE.CylinderGeometry(0.21, 0.26, 0.3, 8),
  kurtaHem: new THREE.TorusGeometry(0.255, 0.018, 5, 14),
  hood: new THREE.SphereGeometry(0.15, 8, 6, 0, Math.PI * 2, Math.PI / 2.6, Math.PI / 2),
  pocket: new THREE.BoxGeometry(0.24, 0.12, 0.05),
  vestBody: new THREE.BoxGeometry(0.45, 0.4, 0.27),
  vestStripe: new THREE.BoxGeometry(0.46, 0.05, 0.28),
  bootCuff: new THREE.CylinderGeometry(0.075, 0.08, 0.08, 6),
  chappal: new THREE.BoxGeometry(0.14, 0.04, 0.24),
  strap: new THREE.BoxGeometry(0.05, 0.5, 0.03),
  sideBag: new THREE.BoxGeometry(0.2, 0.16, 0.08),
  bannerRoll: new THREE.CylinderGeometry(0.05, 0.05, 0.56, 8),
  dhol: new THREE.CylinderGeometry(0.14, 0.16, 0.3, 10),
  dholRim: new THREE.TorusGeometry(0.15, 0.02, 5, 12),
  umbrellaStick: new THREE.CylinderGeometry(0.015, 0.015, 0.66, 6),
  umbrellaFold: new THREE.CylinderGeometry(0.035, 0.015, 0.2, 6),
  umbrellaHandle: new THREE.TorusGeometry(0.05, 0.014, 5, 10, Math.PI),
  bannerCloth: new THREE.PlaneGeometry(0.94, 0.24),
  flagPole: new THREE.CylinderGeometry(0.012, 0.012, 0.85, 5),
  flagCloth: new THREE.PlaneGeometry(0.3, 0.2),
  bat: new THREE.CylinderGeometry(0.028, 0.052, 0.6, 7),
  batKnob: new THREE.CylinderGeometry(0.036, 0.036, 0.03, 7),
  shoppingBag: new THREE.BoxGeometry(0.2, 0.22, 0.1),
  bagHandle: new THREE.TorusGeometry(0.05, 0.012, 5, 10, Math.PI),
  megaCone: new THREE.CylinderGeometry(0.028, 0.11, 0.2, 10),
  megaBody: new THREE.CylinderGeometry(0.032, 0.032, 0.14, 8),
  megaHandle: new THREE.TorusGeometry(0.045, 0.014, 5, 9, Math.PI),
  // ---- round 23: realistic faces, hair styles, police department ----
  eye: new THREE.SphereGeometry(0.0245, 8, 6),
  pupil: new THREE.SphereGeometry(0.0115, 6, 5),
  brow: new THREE.BoxGeometry(0.052, 0.013, 0.016),
  nose: new THREE.SphereGeometry(0.021, 6, 5),
  mouth: new THREE.BoxGeometry(0.062, 0.014, 0.02),
  lip: new THREE.BoxGeometry(0.07, 0.021, 0.026),
  bun: new THREE.SphereGeometry(0.078, 8, 6),
  ponyTail: new THREE.CylinderGeometry(0.028, 0.048, 0.34, 6),
  tailTip: new THREE.SphereGeometry(0.044, 6, 5),
  hairBack: new THREE.SphereGeometry(0.15, 10, 8),
  curl: new THREE.SphereGeometry(0.062, 8, 6),
  braidLink: new THREE.SphereGeometry(0.05, 6, 5),
  // ---- round 24: face v2 (ears/iris/lashes/blush) + hair v2 ----
  ear: new THREE.SphereGeometry(0.036, 6, 5),
  iris: new THREE.SphereGeometry(0.0155, 8, 6),
  spec: new THREE.SphereGeometry(0.0052, 4, 3),
  lash: new THREE.BoxGeometry(0.06, 0.011, 0.013),
  blush: new THREE.SphereGeometry(0.032, 6, 5),
  nostril: new THREE.SphereGeometry(0.008, 4, 3),
  noseBridge: new THREE.BoxGeometry(0.021, 0.08, 0.018),
  fringe: new THREE.BoxGeometry(0.2, 0.05, 0.05),
  hairTie: new THREE.TorusGeometry(0.034, 0.013, 5, 8),
  strand: new THREE.BoxGeometry(0.055, 0.3, 0.05),
  tailSeg: new THREE.CylinderGeometry(0.036, 0.028, 0.18, 6),
  peakDome: new THREE.SphereGeometry(0.165, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  peakTop: new THREE.CylinderGeometry(0.168, 0.168, 0.026, 10),
  peakBand: new THREE.CylinderGeometry(0.166, 0.169, 0.05, 10, 1, true),
  badge: new THREE.CylinderGeometry(0.028, 0.028, 0.014, 8),
  beretBody: new THREE.SphereGeometry(0.155, 10, 6),
  beretStalk: new THREE.CylinderGeometry(0.018, 0.026, 0.05, 6),
  turbanWrap: new THREE.TorusGeometry(0.115, 0.056, 8, 14),
  turbanTop: new THREE.SphereGeometry(0.09, 8, 6),
  helmet: new THREE.SphereGeometry(0.185, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.75),
  helmetRim: new THREE.TorusGeometry(0.172, 0.022, 6, 14),
  helmetVisor: new THREE.BoxGeometry(0.26, 0.1, 0.02),
  tie: new THREE.BoxGeometry(0.075, 0.3, 0.02),
  medalBar: new THREE.BoxGeometry(0.1, 0.032, 0.018),
  beltStrip: new THREE.BoxGeometry(0.445, 0.055, 0.26),
  vestStripeThin: new THREE.BoxGeometry(0.3, 0.035, 0.02),
  // ---- task 82: gender styles + wardrobe detail geometry ----
  hairSpike: new THREE.ConeGeometry(0.026, 0.075, 5),
  mulletBack: new THREE.BoxGeometry(0.24, 0.2, 0.05),
  bobSide: new THREE.BoxGeometry(0.055, 0.24, 0.075),
  dressSkirt: new THREE.CylinderGeometry(0.18, 0.3, 0.5, 10),
  dressHem: new THREE.TorusGeometry(0.295, 0.018, 6, 12),
  waistBelt: new THREE.TorusGeometry(0.172, 0.024, 6, 12),
  bottleCyl: new THREE.CylinderGeometry(0.042, 0.042, 0.14, 8),
}

export interface RigOptions {
  archetype?: string
  colors?: { shirt: string; pants: string; skin: string; hair: string; accent: string }
  scale?: number
  name?: string
  nameColor?: string
  hat?: string // 'cap' | 'topi' | 'cone' | 'crown' | 'garland' | 'bandana' | 'hardhat' | 'none'
  glasses?: boolean
  signText?: string
  npcType?: 'police' | 'security' | 'guard'
  isBoss?: boolean
  // ---- round 23: identity + police department slots ----
  gender?: 'male' | 'female'
  hair?: string      // male: 'default' | 'buzz' | 'spiky' | 'bald' | 'afro' | 'mullet' · female: 'ponytail' | 'bun' | 'bob' | 'curly' | 'long' | 'braid'
  policeOutfit?: string // POLICE_UNIFORMS key — only read when npcType === 'police'
  policeHat?: string    // 'peak' | 'beret' | 'turban' | 'helmet' | 'none' — only when npcType === 'police'
  // hair default: female rigs get a ponytail, male rigs the classic cut
  // ---- wardrobe expansion slots (default when omitted) ----
  face?: string     // 'clean' | 'beard' | 'moustache' | 'warpaint' | 'scar'
  outfit?: string   // 'classic' | 'kurta' | 'highvis' · male: 'hoodie' | 'jacket' · female: 'dress' | 'anarkali'
  footwear?: string // 'shoes' | 'chappal' | 'glow' · male: 'boots' · female: 'heels'
  gear?: string     // 'none' | 'backpack' | 'jhola' | 'bannerroll' | 'dhol' | 'umbrella'
  held?: string     // 'none' | 'sign' | 'banner' | 'flag' | 'bat' | 'lathi' | 'shoppingbag' | 'megaphone'
  build?: string // 'regular' | 'slim' | 'sturdy' — body shape (normalized inside the rig)
}

function mat(color: string, flat = true): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, flatShading: flat })
}

/** Lighten/darken a hex color by ±0-255 per channel (string in, string out). */
function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex)
  const f = (v: number) => Math.max(0, Math.min(1, v + amt / 255))
  return `#${new THREE.Color(f(c.r), f(c.g), f(c.b)).getHexString()}`
}

// ---- realistic face features (round 23) ----
// Eyes + brows + nose + mouth are merged into ONE vertex-colored geometry per
// unique (skin, hair, gender) triple — a single extra draw call per rig.
function tintedClone(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color)
  const src = geo.clone()
  const count = src.attributes.position.count
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
  }
  src.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return src
}

const faceGeoCache = new Map<string, THREE.BufferGeometry>()
let faceFeatureMat: THREE.MeshStandardMaterial | null = null

/** Geometries shared across every rig — rig.dispose() must never free these. */
const sharedGeo = new WeakSet<THREE.BufferGeometry>()
for (const g of Object.values(G)) sharedGeo.add(g)

function faceMaterialShared(): THREE.MeshStandardMaterial {
  if (!faceFeatureMat) {
    faceFeatureMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 })
  }
  return faceFeatureMat
}

/** Build (or fetch from cache) the merged face-features geometry for a look. */
function faceGeometryFor(skinHex: string, hairHex: string, female: boolean): THREE.BufferGeometry {
  const key = `${skinHex}|${hairHex}|${female ? 'f' : 'm'}`
  const hit = faceGeoCache.get(key)
  if (hit) return hit
  const parts: THREE.BufferGeometry[] = []
  const place = (
    geo: THREE.BufferGeometry, color: string,
    px: number, py: number, pz: number,
    sx = 1, sy = 1, sz = 1, rz = 0,
  ) => {
    const g = tintedClone(geo, color)
    const m = new THREE.Matrix4()
    m.compose(
      new THREE.Vector3(px, py, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)),
      new THREE.Vector3(sx, sy, sz),
    )
    g.applyMatrix4(m)
    parts.push(g)
  }
  const dark = '#241a12'
  // ears — subtle skin-shaded shells on the sides (all genders)
  for (const side of [1, -1]) {
    place(G.ear, shade(skinHex, -22), side * 0.15, 0.1, -0.008, 0.55, 0.82, 0.62)
  }
  // eyes — almond white + brown iris + dark pupil + tiny catchlight dot.
  // Pushed proud of the (now smooth) head sphere so they read at any quality.
  for (const side of [1, -1]) {
    place(G.eye, '#f7f3ea', side * 0.056, 0.112, 0.142, 1, 0.82, 0.5)
    place(G.iris, '#4a2c16', side * 0.056, 0.112, 0.152, 1, 1, 0.55)
    place(G.pupil, dark, side * 0.056, 0.112, 0.158, 1, 1, 0.6)
    place(G.spec, '#ffffff', side * 0.05 + side * -0.008, 0.118, 0.1635)
  }
  // brows — task 82 "double eyebrow" fix: the old lash bar sat right under a
  // two-segment brow arch, stacking TWO dark lines above every eye. One tapered,
  // tilted bar per side now forms a single clean arch (female: thinner + higher).
  for (const side of [1, -1]) {
    place(G.brow, shade(hairHex, 6), side * 0.054, 0.151, 0.148, female ? 0.92 : 1.04, female ? 0.78 : 1, 1, side * -0.13)
  }
  // female-only: soft cheek blush baked as a skin/rose blend (vertex colors only)
  if (female) {
    const blushCol = new THREE.Color(skinHex).lerp(new THREE.Color('#d46a6a'), 0.38).getStyle()
    for (const side of [1, -1]) {
      place(G.blush, blushCol, side * 0.088, 0.068, 0.118, 1, 0.62, 0.42)
    }
  }
  // nose — bridge + snub tip + nostril hints
  place(G.noseBridge, shade(skinHex, -16), 0, 0.115, 0.142, 1, 1, 0.85)
  place(G.nose, shade(skinHex, -26), 0, 0.082, 0.156, 0.9, 1.2, 0.85)
  for (const side of [1, -1]) {
    place(G.nostril, shade(skinHex, -60), side * 0.015, 0.072, 0.152, 1, 0.8, 0.7)
  }
  // mouth — fuller two-tone lips for female, thinner shaded line for male
  if (female) {
    place(G.lip, '#a34e5e', 0, 0.043, 0.149, 1, 0.6, 0.8)
    place(G.lip, '#c96a76', 0, 0.029, 0.15, 0.94, 0.8, 0.85)
  } else {
    place(G.mouth, shade(skinHex, -48), 0, 0.04, 0.149, 1, 1, 0.8)
  }
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry()
  for (const p of parts) p.dispose()
  sharedGeo.add(merged)
  faceGeoCache.set(key, merged)
  return merged
}

// ---- realistic body build (v32) ----
// The original body was plain boxes with legs that stopped 0.335 units short of
// the ground (every character visibly hovered). These builders produce shaped,
// merged geometries with real proportions: tapered ribcage + waist + deltoids,
// pelvis, neck, two-segment arms, full-length legs that ACTUALLY reach y=0.
// Everything is cached per (part, gender, build) — ONE draw call per part.
function xg(
  geo: THREE.BufferGeometry,
  px: number, py: number, pz: number,
  sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0,
): THREE.BufferGeometry {
  const g = geo.clone() // never mutate shared G.* geometry
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  )
  g.applyMatrix4(m)
  return g
}

const bodyGeoCache = new Map<string, THREE.BufferGeometry>()
function cachedMerged(key: string, buildParts: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  const hit = bodyGeoCache.get(key)
  if (hit) return hit
  const parts = buildParts()
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry()
  for (const p of parts) p.dispose()
  sharedGeo.add(merged)
  bodyGeoCache.set(key, merged)
  return merged
}

interface BodyProfile {
  shoulder: number; chest: number; waist: number
  hipTop: number; hipBottom: number
  armW: number; legW: number
}

function bodyProfile(female: boolean, build: BodyBuild): BodyProfile {
  const p: BodyProfile = female
    ? // hourglass: narrower shoulders/chest, pinched waist, wider hips
      { shoulder: 0.19, chest: 0.163, waist: 0.143, hipTop: 0.148, hipBottom: 0.182, armW: 0.86, legW: 0.9 }
    : // classic V: broad shoulders tapering to the waist
      { shoulder: 0.225, chest: 0.185, waist: 0.163, hipTop: 0.166, hipBottom: 0.156, armW: 1, legW: 1 }
  if (build === 'slim') {
    p.shoulder *= 0.92; p.chest *= 0.92; p.waist *= 0.9
    p.hipTop *= 0.92; p.hipBottom *= 0.92; p.armW *= 0.94; p.legW *= 0.92
  } else if (build === 'sturdy') {
    p.shoulder = Math.max(p.shoulder * 1.08, 0.235)
    p.chest *= 1.14; p.waist *= 1.2
    p.hipTop *= 1.1; p.hipBottom *= 1.08; p.armW *= 1.12; p.legW *= 1.12
  }
  return p
}

/** Ribcage + waist taper + deltoid caps merged (shirt material, torsoPivot space). */
function torsoGeometry(female: boolean, build: BodyBuild): THREE.BufferGeometry {
  const p = bodyProfile(female, build)
  return cachedMerged(`torso|${female ? 'f' : 'm'}|${build}`, () => {
    const parts = [
      xg(new THREE.CylinderGeometry(p.shoulder, p.chest, 0.3, 12), 0, 0.33, 0, 1, 1, 0.58), // ribcage
      xg(new THREE.CylinderGeometry(p.chest - 0.008, p.waist, 0.2, 12), 0, 0.08, 0, 1, 1, 0.58), // waist
    ]
    for (const s of [1, -1]) {
      parts.push(xg(new THREE.SphereGeometry(0.07, 8, 6), s * (p.shoulder - 0.038), 0.435, 0, 1, 0.85, 0.92)) // deltoids
    }
    if (female) {
      parts.push(xg(new THREE.SphereGeometry(0.08, 8, 6), 0, 0.335, 0.058, 1.45, 0.6, 0.6)) // subtle chest form
    }
    return parts
  })
}

/** Pelvis/hips bridging torso bottom to the leg pivots (pants material, torsoPivot space). */
function pelvisGeometry(female: boolean, build: BodyBuild): THREE.BufferGeometry {
  const p = bodyProfile(female, build)
  return cachedMerged(`pelvis|${female ? 'f' : 'm'}|${build}`, () => [
    xg(new THREE.CylinderGeometry(p.hipTop, p.hipBottom, 0.2, 12), 0, -0.12, 0, 1, 1, 0.62),
  ])
}

/** Neck cylinder bridging the torso top to the head (skin material, torsoPivot space). */
function neckGeometry(): THREE.BufferGeometry {
  return cachedMerged('neck', () => [
    xg(new THREE.CylinderGeometry(0.05, 0.062, 0.14, 8), 0, 0.52, 0),
  ])
}

/** Deltoid + sleeve merged (shirt material, arm-pivot space). */
function sleeveGeometry(female: boolean, build: BodyBuild): THREE.BufferGeometry {
  const p = bodyProfile(female, build)
  return cachedMerged(`sleeve|${female ? 'f' : 'm'}|${build}`, () => [
    xg(new THREE.SphereGeometry(0.068, 8, 6), 0, -0.015, 0, 1, 0.95, 1),
    xg(new THREE.CylinderGeometry(0.062 * p.armW, 0.05 * p.armW, 0.24, 10), 0, -0.14, 0),
  ])
}

/** Forearm + fist merged (skin material, arm-pivot space; fist center stays at y -0.46). */
function forearmGeometry(female: boolean, build: BodyBuild): THREE.BufferGeometry {
  const p = bodyProfile(female, build)
  return cachedMerged(`forearm|${female ? 'f' : 'm'}|${build}`, () => [
    xg(new THREE.CylinderGeometry(0.047 * p.armW, 0.038 * p.armW, 0.21, 10), 0, -0.345, 0),
    xg(G.hand, 0, -0.46, 0, 1.05, 0.9, 1.05),
  ])
}

/** Thigh + calf merged (pants material, leg-pivot space; spans y 0 → -0.84). */
function legGeometry(female: boolean, build: BodyBuild): THREE.BufferGeometry {
  const p = bodyProfile(female, build)
  return cachedMerged(`leg|${female ? 'f' : 'm'}|${build}`, () => [
    xg(new THREE.CylinderGeometry(0.088 * p.legW, 0.07 * p.legW, 0.44, 10), 0, -0.22, 0), // thigh
    xg(new THREE.CylinderGeometry(0.064 * p.legW, 0.05 * p.legW, 0.4, 10), 0, -0.64, 0), // calf
  ])
}

/**
 * Full shoe — ONE vertex-colored merged geometry (leg-pivot space).
 * The sole bottom sits at y -0.9 == world ground (leg pivot is at 0.9).
 * Sneaker anatomy: white midsole + rounded toe, colored upper + toe cap + heel
 * collar, lace rows, side stripes, heel pull tab. The upper takes the ACCENT
 * color so shoes stay customizable through the existing palette system.
 */
function shoeGeometry(footwear: string, accent: string): THREE.BufferGeometry {
  return cachedMerged(`shoe|${footwear}|${accent}`, () => {
    const parts: THREE.BufferGeometry[] = []
    const add = (
      geo: THREE.BufferGeometry, color: string,
      px: number, py: number, pz: number,
      sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0,
    ) => parts.push(xg(tintedClone(geo, color), px, py, pz, sx, sy, sz, rx, ry, rz))
    const white = '#efe9dc', cream = '#e6e0d2', dark = '#241d15'
    if (footwear === 'boots') {
      add(G.hand, '#4a3626', 0, -0.745, 0, 1.5, 2.1, 1.3)      // leather shaft
      add(G.hand, '#5c4632', 0, -0.635, 0, 1.62, 0.6, 1.42)    // folded cuff
      add(G.hand, '#3a2a1c', 0, -0.858, 0.05, 1.32, 0.85, 2.2) // foot body
      add(G.foot, '#241b12', 0, -0.882, 0.05, 1.13, 0.5, 1.2)  // lug sole
      add(G.moustache, accent, 0, -0.7, 0, 1.35, 0.95, 3.9)    // buckle strap
      add(G.moustache, accent, 0, -0.8, 0, 1.35, 0.95, 3.9)    // buckle strap 2
    } else if (footwear === 'chappal') {
      add(G.chappal, '#7a4a2c', 0, -0.878, 0.05)               // leather sole
      add(G.hand, '#7a4a2c', 0, -0.878, 0.135, 1.2, 0.55, 1.5) // rounded toe
      add(G.moustache, '#6b3f24', 0, -0.882, -0.075, 1.15, 1.3, 1.7) // heel block
      add(G.moustache, '#5c3820', 0.042, -0.852, 0.05, 0.34, 0.8, 5.4, 0, -0.38, 0) // V-strap L
      add(G.moustache, '#5c3820', -0.042, -0.852, 0.05, 0.34, 0.8, 5.4, 0, 0.38, 0)  // V-strap R
      add(G.hand, '#4a2c18', 0, -0.845, 0.155, 0.42, 0.42, 0.42) // toe knob
    } else if (footwear === 'heels') {
      // task 82 (female book): low block heels — slim sole, pointed toe, heel
      // peg, toe + ankle straps in the accent, tiny gold buckle
      add(G.foot, '#3a2418', 0, -0.878, 0.05, 1.02, 0.5, 1.1)     // slim sole
      add(G.hand, accent, 0, -0.832, 0.115, 1.1, 0.62, 1.15)      // pointed toe box
      add(G.hand, shade(accent, -30), 0, -0.825, -0.07, 0.34, 1.25, 0.42) // heel peg
      add(G.moustache, accent, 0, -0.802, 0.055, 1.15, 0.55, 1.5) // toe strap
      add(G.moustache, accent, 0, -0.745, -0.005, 1.25, 0.5, 1.3) // ankle strap
      add(G.spec, '#f2c14e', 0.03, -0.798, 0.062, 1.2, 1.2, 1.2)  // buckle sparkle
    } else {
      // sneaker (also the 'glow' base, in night colors)
      const glow = footwear === 'glow'
      const upper = glow ? '#20242e' : accent
      const soleC = glow ? '#16181d' : white
      const laceC = glow ? '#0d0e12' : dark
      add(G.foot, soleC, 0, -0.875, 0.05, 1.07, 0.55, 1.15)            // midsole
      add(G.hand, soleC, 0, -0.875, 0.13, 1.3, 0.9, 1.6)               // rounded toe
      add(G.foot, upper, 0, -0.812, -0.005, 1.0, 0.95, 0.85)           // upper
      add(G.hand, glow ? '#2a3038' : cream, 0, -0.822, 0.1, 1.28, 0.62, 1.5) // toe cap
      add(G.hand, glow ? '#181c24' : shade(accent, -34), 0, -0.762, -0.075, 1.3, 0.72, 1.15) // heel collar
      add(G.moustache, white, 0, -0.728, -0.112, 0.4, 1.5, 0.9)        // heel pull tab
      for (let i = 0; i < 3; i++) {
        add(G.moustache, laceC, 0, -0.757, 0.005 + i * 0.038, 0.72, 0.55, 1.0) // lace rows
      }
      add(G.moustache, glow ? '#39d0ff' : white, 0.079, -0.83, 0.0, 0.17, 0.7, 3.6)  // side stripe R
      add(G.moustache, glow ? '#39d0ff' : white, -0.079, -0.83, 0.0, 0.17, 0.7, 3.6) // side stripe L
    }
    return parts
  })
}

export class CharacterRig {
  group = new THREE.Group()
  private torsoPivot = new THREE.Group()
  private headPivot = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private legL = new THREE.Group()
  private legR = new THREE.Group()
  private signGroup: THREE.Group | null = null
  private lathi: THREE.Group | null = null
  private heldProp: THREE.Group | null = null
  private armBlockR = false
  private armBlockL = false
  private flagClothRef: THREE.Mesh | null = null
  private bannerClothRef: THREE.Mesh | null = null
  private phase = Math.random() * 10
  anim: AnimName = 'idle'
  /** External pose override (e.g. police wind-up telegraph) — wins over the anim arg. */
  forceAnim: AnimName | null = null
  /** Double-jump flourish: remaining seconds of a procedural front-flip (0 = off). */
  private flipTimer = 0
  private flipDur = 0.45
  speedRatio = 0
  private nameSprite: THREE.Sprite | null = null
  private alertIndicator: THREE.Sprite | null = null
  private scaleMul: number
  private baseY = 0

  constructor(opts: RigOptions) {
    const colors = opts.colors ?? archetypeById(opts.archetype ?? 'student').colors
    this.scaleMul = opts.scale ?? (opts.archetype ? archetypeById(opts.archetype).stats.scale : 1)

    const shirt = mat(colors.shirt)
    const pants = mat(colors.pants)
    const skin = mat(colors.skin)
    // head gets its own smooth-shaded skin (soft sheen = living surface vs flat low-poly body)
    const skinHead = new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.58, metalness: 0 })
    // smooth hair with a slight sheen (flat caps read like plastic helmets)
    const hair = new THREE.MeshStandardMaterial({ color: colors.hair, roughness: 0.55, metalness: 0.05 })
    const isFemale = opts.gender === 'female'
    const build: BodyBuild = opts.build === 'slim' || opts.build === 'sturdy' ? opts.build : 'regular'

    // hierarchy: group -> torsoPivot (contains torso, head, arms) ; legs on group
    this.group.add(this.torsoPivot)
    this.torsoPivot.position.y = 0.98

    // shaped torso: ribcage + waist + deltoids merged into ONE mesh (was a plain box)
    const torso = new THREE.Mesh(torsoGeometry(isFemale, build), shirt)
    torso.castShadow = true
    this.torsoPivot.add(torso)

    // pelvis (pants) bridges the torso bottom to the leg pivots — kills the old
    // gap between shirt hem and trouser tops
    const pelvis = new THREE.Mesh(pelvisGeometry(isFemale, build), pants)
    this.torsoPivot.add(pelvis)
    // neck (skin) — no more floating-head look under the hairline
    this.torsoPivot.add(new THREE.Mesh(neckGeometry(), skin))

    // accent stripe (protest sash)
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.54, 0.22), mat(colors.accent))
    sash.position.set(0.06, 0.26, 0.02)
    sash.rotation.z = 0.4
    if (isFemale) sash.scale.x = 0.9
    this.torsoPivot.add(sash)

    // police department extras — badge on every officer, kit per uniform
    if (opts.npcType === 'police') {
      const u = policeUniformColors(opts.policeOutfit)
      const chestBadge = new THREE.Mesh(G.badge, mat('#d4a017', false))
      chestBadge.material.metalness = 0.55
      chestBadge.material.roughness = 0.35
      chestBadge.rotation.x = Math.PI / 2
      chestBadge.position.set(0.1, 0.38, 0.132)
      this.torsoPivot.add(chestBadge)
      if (u.id === 'swat') {
        // riot kit: heavy black vest over the dark uniform
        const vest = new THREE.Mesh(G.vestBody, mat('#1b1d21', false))
        vest.position.y = 0.27
        vest.castShadow = true
        this.torsoPivot.add(vest)
        const plate = new THREE.Mesh(G.vestStripe, mat('#3a3f46', false))
        plate.position.y = 0.33
        this.torsoPivot.add(plate)
      } else if (u.id === 'commandant') {
        // medal bars above the left pocket
        for (let i = 0; i < 2; i++) {
          const bar = new THREE.Mesh(G.medalBar, mat(i === 0 ? '#8c1f28' : '#2e6e4e', false))
          bar.position.set(-0.1 + i * 0.115, 0.42, 0.134)
          this.torsoPivot.add(bar)
        }
      } else if (u.id === 'plain') {
        // detective: shirt + tie under charcoal suit
        const collar = new THREE.Mesh(G.vestStripeThin, mat('#f5efdc', false))
        collar.position.set(0, 0.47, 0.13)
        this.torsoPivot.add(collar)
        const tie = new THREE.Mesh(G.tie, mat(u.accent, false))
        tie.position.set(0, 0.3, 0.132)
        this.torsoPivot.add(tie)
      } else if (u.id === 'navy') {
        // parade belt + buckle
        const belt = new THREE.Mesh(G.beltStrip, mat('#10151f', false))
        belt.position.y = 0.02
        this.torsoPivot.add(belt)
        const buckle = new THREE.Mesh(G.badge, mat('#d4a017', false))
        buckle.material.metalness = 0.55
        buckle.position.set(0, 0.02, 0.128)
        this.torsoPivot.add(buckle)
      } else if (u.id === 'traffic') {
        // high-visibility shoulder bands for intersection duty
        for (const y of [0.4, 0.14]) {
          const band = new THREE.Mesh(G.vestStripeThin, mat('#f2c14e', false))
          band.position.set(0.13, y, 0.132)
          this.torsoPivot.add(band)
        }
      }
    }

    // head
    this.headPivot.position.y = 0.62
    this.torsoPivot.add(this.headPivot)
    const head = new THREE.Mesh(G.head, skinHead)
    head.position.y = 0.1
    head.castShadow = true
    this.headPivot.add(head)

    // ---- hair styles (round 24) — 'bald' skips the cap entirely ----
    // default is gender-aware: female rigs wear a ponytail, male rigs the classic cut
    const hairSlot = opts.hair ?? (isFemale ? 'ponytail' : 'default')
    if (hairSlot !== 'bald') {
      const cap = new THREE.Mesh(G.hair, hair)
      if (hairSlot === 'buzz') {
        cap.scale.set(1.005, 0.62, 1.005)
        cap.position.y = 0.128
      } else {
        cap.position.y = 0.13
      }
      this.headPivot.add(cap)
      // swept fringe for the feminine gathered styles (bun / ponytail / long / braid / bob)
      // task 82: raised from EYE level (0.122 — read as a second brow!) to the
      // hairline, where it hangs from the cap rim as real bangs.
      const femaleStyle = hairSlot === 'bun' || hairSlot === 'ponytail' || hairSlot === 'long' || hairSlot === 'braid' || hairSlot === 'bob'
      if (femaleStyle) {
        const fringe = new THREE.Mesh(G.fringe, hair)
        fringe.position.set(0, 0.178, 0.126)
        fringe.rotation.x = 0.4
        fringe.scale.set(0.95, 0.9, 0.8)
        this.headPivot.add(fringe)
      }
      if (hairSlot === 'bun') {
        const bun = new THREE.Mesh(G.bun, hair)
        bun.position.set(0, 0.24, -0.12)
        bun.castShadow = true
        this.headPivot.add(bun)
      } else if (hairSlot === 'ponytail') {
        // v2: rounded crown segment + scrunchie ring + tapered tail + tip
        const crown = new THREE.Mesh(G.tailSeg, hair)
        crown.position.set(0, 0.16, -0.13)
        crown.rotation.x = -0.9
        const tail = new THREE.Mesh(G.ponyTail, hair)
        tail.position.set(0, 0.08, -0.19)
        tail.rotation.x = 0.5
        tail.castShadow = true
        const tie = new THREE.Mesh(G.hairTie, mat(colors.accent, false))
        tie.position.set(0, 0.155, -0.16)
        tie.rotation.x = Math.PI / 2 - 0.45
        const tip = new THREE.Mesh(G.tailTip, hair)
        tip.position.set(0, -0.09, -0.28)
        this.headPivot.add(crown, tail, tie, tip)
      } else if (hairSlot === 'long') {
        const back = new THREE.Mesh(G.hairBack, hair)
        back.scale.set(1.02, 1.5, 0.55)
        back.position.set(0, -0.1, -0.09)
        back.castShadow = true
        this.headPivot.add(back)
        // front strands framing the face
        for (const side of [1, -1]) {
          const strand = new THREE.Mesh(G.strand, hair)
          strand.position.set(side * 0.138, 0.02, 0.055)
          strand.rotation.z = side * -0.07
          strand.castShadow = true
          this.headPivot.add(strand)
        }
      } else if (hairSlot === 'curly') {
        const offs: [number, number, number][] = [
          [0, 0.21, 0], [0.11, 0.17, 0.06], [-0.11, 0.17, 0.06], [0.09, 0.16, -0.11], [-0.09, 0.16, -0.11],
        ]
        for (const [x, y, z] of offs) {
          const curl = new THREE.Mesh(G.curl, hair)
          curl.position.set(x, y, z)
          this.headPivot.add(curl)
        }
      } else if (hairSlot === 'braid') {
        for (let i = 0; i < 3; i++) {
          const link = new THREE.Mesh(G.braidLink, hair)
          link.position.set(0.105, 0.19 - i * 0.078, -0.12 - i * 0.012)
          this.headPivot.add(link)
        }
        const band = new THREE.Mesh(G.moustache, mat(colors.accent))
        band.scale.setScalar(0.62)
        band.position.set(0.105, 0.005, -0.15)
        this.headPivot.add(band)
      } else if (hairSlot === 'spiky') {
        // task 82 (male book): gel spikes across the crown
        for (const [x, z, r] of [[0, 0.1, 0.5], [0.075, 0.05, -0.35], [-0.075, 0.05, 0.35], [0.045, -0.06, -0.15], [-0.045, -0.06, 0.15], [0, -0.02, 0]] as const) {
          const spike = new THREE.Mesh(G.hairSpike, hair)
          spike.position.set(x, 0.262, z)
          spike.rotation.z = r
          this.headPivot.add(spike)
        }
      } else if (hairSlot === 'mullet') {
        // task 82 (male book): business up front (the cap) + party at the back
        const back = new THREE.Mesh(G.mulletBack, hair)
        back.position.set(0, 0.02, -0.135)
        back.castShadow = true
        const nape = new THREE.Mesh(G.mulletBack, hair)
        nape.position.set(0, -0.1, -0.115)
        nape.scale.set(0.8, 0.7, 0.75)
        this.headPivot.add(back, nape)
      } else if (hairSlot === 'afro') {
        // task 82 (male book): one proud puff pushed back off the face + curl ring
        const puff = new THREE.Mesh(G.hairBack, hair)
        puff.position.set(0, 0.17, -0.05)
        puff.scale.set(1.15, 1.05, 1.15)
        puff.castShadow = true
        this.headPivot.add(puff)
        for (const [x, y, z] of [[0, 0.32, 0], [0.14, 0.26, 0.03], [-0.14, 0.26, 0.03], [0.1, 0.29, -0.12], [-0.1, 0.29, -0.12]] as const) {
          const curl = new THREE.Mesh(G.curl, hair)
          curl.position.set(x, y, z)
          curl.scale.setScalar(0.8)
          this.headPivot.add(curl)
        }
      } else if (hairSlot === 'bob') {
        // task 82 (female book): chin-length curtain + face-framing side flaps
        const back = new THREE.Mesh(G.hairBack, hair)
        back.position.set(0, 0.02, -0.05)
        back.scale.set(1.08, 0.92, 0.78)
        back.castShadow = true
        this.headPivot.add(back)
        for (const side of [1, -1]) {
          const flap = new THREE.Mesh(G.bobSide, hair)
          flap.position.set(side * 0.132, 0.02, 0.052)
          flap.rotation.z = side * -0.05
          flap.castShadow = true
          this.headPivot.add(flap)
        }
      }
    }

    // ---- realistic face features: eyes, brows, nose, mouth (one merged mesh) ----
    const faceFeatures = new THREE.Mesh(faceGeometryFor(colors.skin, colors.hair, isFemale), faceMaterialShared())
    this.headPivot.add(faceFeatures)

    if (opts.npcType) {
      // ---- police & guard headgear (round 23): peaked cap / beret / turban / helmet / none ----
      const ph = opts.policeHat ?? 'peak'
      const capCol = policeUniformColors(opts.policeOutfit).capColor
      const badgeGold = () => {
        const b = new THREE.Mesh(G.badge, mat('#d4a017', false))
        b.material.metalness = 0.55
        b.material.roughness = 0.35
        b.rotation.x = Math.PI / 2
        return b
      }
      if (ph === 'peak') {
        const dome = new THREE.Mesh(G.peakDome, mat(capCol))
        dome.scale.set(1, 0.82, 1)
        dome.position.y = 0.16
        const top = new THREE.Mesh(G.peakTop, mat(shade(capCol, -14), false))
        top.position.y = 0.295
        const band = new THREE.Mesh(G.peakBand, mat(shade(capCol, -30), false))
        band.position.y = 0.185
        const visor = new THREE.Mesh(G.capBrim, mat('#15130f', false))
        visor.position.set(0, 0.162, 0.155)
        const badge = badgeGold()
        badge.position.set(0, 0.235, 0.15)
        this.headPivot.add(dome, top, band, visor, badge)
      } else if (ph === 'beret') {
        const b = new THREE.Mesh(G.beretBody, mat(capCol))
        b.scale.set(1.06, 0.42, 1.06)
        b.position.set(0.012, 0.218, -0.012)
        b.rotation.z = 0.17
        const stalk = new THREE.Mesh(G.beretStalk, mat(capCol))
        stalk.position.set(0.012, 0.272, -0.012)
        const badge = badgeGold()
        badge.position.set(0.05, 0.22, 0.135)
        this.headPivot.add(b, stalk, badge)
      } else if (ph === 'turban') {
        const w1 = new THREE.Mesh(G.turbanWrap, mat(capCol))
        w1.position.y = 0.185
        w1.rotation.x = Math.PI / 2
        w1.rotation.z = Math.PI / 2
        const w2 = new THREE.Mesh(G.turbanWrap, mat(shade(capCol, 16)))
        w2.position.y = 0.23
        w2.scale.setScalar(0.86)
        w2.rotation.x = Math.PI / 2
        w2.rotation.z = Math.PI / 2
        const knot = new THREE.Mesh(G.turbanTop, mat(capCol))
        knot.position.y = 0.3
        const badge = badgeGold()
        badge.position.set(0, 0.205, 0.145)
        this.headPivot.add(w1, w2, knot, badge)
      } else if (ph === 'helmet') {
        const dome = new THREE.Mesh(G.helmet, mat(capCol, false))
        dome.position.y = 0.12
        dome.castShadow = true
        const rim = new THREE.Mesh(G.helmetRim, mat(shade(capCol, -22), false))
        rim.rotation.x = Math.PI / 2
        rim.position.y = 0.15
        const visor = new THREE.Mesh(G.helmetVisor, new THREE.MeshStandardMaterial({ color: '#141d27', roughness: 0.25, metalness: 0.35 }))
        visor.position.set(0, 0.09, 0.152)
        this.headPivot.add(dome, rim, visor)
      }
      // 'none' → bare head; hair still renders
    } else if (opts.hat === 'cap') {
      const cap = new THREE.Mesh(G.cap, mat(colors.accent))
      cap.position.y = 0.17
      this.headPivot.add(cap)
      const brim = new THREE.Mesh(G.capBrim, mat('#14251c'))
      brim.position.set(0, 0.17, 0.16)
      this.headPivot.add(brim)
      // task 82 polish: crown button + brim stitch line + side eyelets
      const button = new THREE.Mesh(G.badge, mat(shade(colors.accent, 18), false))
      button.position.set(0, 0.345, 0)
      this.headPivot.add(button)
      const stitch = new THREE.Mesh(G.moustache, mat(shade(colors.accent, -30), false))
      stitch.scale.set(1.45, 0.45, 0.5)
      stitch.position.set(0, 0.163, 0.225)
      this.headPivot.add(stitch)
      for (const side of [1, -1]) {
        const eyelet = new THREE.Mesh(G.spec, mat('#14251c', false))
        eyelet.scale.setScalar(1.5)
        eyelet.position.set(side * 0.115, 0.22, 0.105)
        this.headPivot.add(eyelet)
      }
    } else if (opts.hat === 'topi') {
      const hat = new THREE.Mesh(G.hat, mat('#f0e6d2'))
      hat.position.y = 0.24
      this.headPivot.add(hat)
      // task 82 polish: ribbon band + gold front emblem
      const band = new THREE.Mesh(G.dholRim, mat('#8c1f28'))
      band.rotation.x = Math.PI / 2
      band.scale.setScalar(1.28)
      band.position.y = 0.195
      this.headPivot.add(band)
      const emblem = new THREE.Mesh(G.badge, mat('#d4a017', false))
      emblem.material.metalness = 0.55
      emblem.rotation.x = Math.PI / 2
      emblem.position.set(0, 0.26, 0.2)
      this.headPivot.add(emblem)
    } else if (opts.hat === 'cone') {
      // Traffic Cone of Shame — earned through 10 glorious detentions
      const cone = new THREE.Mesh(G.cone, mat('#e8641c'))
      cone.position.y = 0.3
      cone.castShadow = true
      this.headPivot.add(cone)
      const band = new THREE.Mesh(G.coneBand, mat('#f5efdc'))
      band.position.y = 0.26
      this.headPivot.add(band)
      const base = new THREE.Mesh(G.coneBand, mat('#c8500f'))
      base.position.y = 0.19
      base.scale.set(1.15, 0.6, 1.15)
      this.headPivot.add(base)
    } else if (opts.hat === 'crown') {
      // Crown of Chaos — gold with jewels, for committee dissolvers
      const band = new THREE.Mesh(G.crownBand, mat('#d4a017', false))
      band.material.metalness = 0.55
      band.material.roughness = 0.35
      band.position.y = 0.24
      band.castShadow = true
      this.headPivot.add(band)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        const spike = new THREE.Mesh(G.crownSpike, mat('#d4a017', false))
        spike.material.metalness = 0.55
        spike.material.roughness = 0.35
        spike.position.set(Math.cos(a) * 0.13, 0.3, Math.sin(a) * 0.13)
        this.headPivot.add(spike)
        const jewel = new THREE.Mesh(G.hand, mat(i % 2 ? '#8c1f28' : '#2e6e4e', false))
        jewel.scale.setScalar(0.55)
        jewel.position.set(Math.cos(a) * 0.165, 0.24, Math.sin(a) * 0.165)
        this.headPivot.add(jewel)
      }
    } else if (opts.hat === 'bandana') {
      // Rebel Bandana — snug cap + knot at the back
      const band = new THREE.Mesh(G.bandana, mat(colors.accent))
      band.position.y = 0.15
      this.headPivot.add(band)
      const knot = new THREE.Mesh(G.bandanaKnot, mat(colors.accent))
      knot.position.set(0, 0.14, -0.16)
      this.headPivot.add(knot)
      // task 82 polish: knotted tails + wax-print dots
      for (const side of [1, -1]) {
        const tail = new THREE.Mesh(G.bobSide, mat(colors.accent))
        tail.position.set(side * 0.045, 0.045, -0.17)
        tail.rotation.x = 0.35
        tail.rotation.z = side * 0.18
        tail.scale.set(0.8, 0.7, 0.55)
        this.headPivot.add(tail)
      }
      for (const [x, z] of [[0.105, 0.115], [-0.105, 0.115], [0, 0.155]] as const) {
        const dot = new THREE.Mesh(G.spec, mat('#f5efdc', false))
        dot.scale.setScalar(1.7)
        dot.position.set(x, 0.2, z)
        this.headPivot.add(dot)
      }
    } else if (opts.hat === 'hardhat') {
      // Site Hardhat — yellow dome + brim + ridge
      const dome = new THREE.Mesh(G.hardhat, mat('#f2c14e'))
      dome.position.y = 0.14
      dome.castShadow = true
      this.headPivot.add(dome)
      const brim = new THREE.Mesh(G.hardhatBrim, mat('#d9a428'))
      brim.position.y = 0.15
      this.headPivot.add(brim)
      const ridge = new THREE.Mesh(G.hardhatRidge, mat('#d9a428'))
      ridge.position.y = 0.3
      this.headPivot.add(ridge)
    } else if (opts.hat === 'garland') {
      // Marigold mala around the neck — for squad medics
      const mala = new THREE.Mesh(G.garland, mat('#f2a541'))
      mala.position.y = 0.52
      mala.rotation.x = Math.PI / 2.6
      mala.scale.set(1.25, 1, 1.1)
      mala.castShadow = true
      this.torsoPivot.add(mala)
      const malaBack = new THREE.Mesh(G.garland, mat('#e8912c'))
      malaBack.position.y = 0.44
      malaBack.rotation.x = Math.PI / 2.2
      malaBack.scale.set(1.2, 1, 0.9)
      this.torsoPivot.add(malaBack)
    }
    if (opts.glasses) {
      const gl = new THREE.Mesh(G.glasses, mat('#222', false))
      gl.position.set(0, 0.11, 0.15)
      this.headPivot.add(gl)
    }

    // ---- face slot (archetype uncle keeps his iconic beard even on 'clean') ----
    const faceSlot = opts.face ?? (opts.archetype === 'uncle' ? 'beard' : 'clean')
    if (faceSlot === 'beard') {
      const beard = new THREE.Mesh(G.beard, hair)
      beard.position.set(0, 0.06, 0.03)
      this.headPivot.add(beard)
    } else if (faceSlot === 'moustache') {
      const mo = new THREE.Mesh(G.moustache, hair)
      mo.position.set(0, 0.075, 0.145)
      this.headPivot.add(mo)
    } else if (faceSlot === 'warpaint') {
      const stripes = [new THREE.Vector3(-0.075, 0.1, 0.128), new THREE.Vector3(0.075, 0.1, 0.128), new THREE.Vector3(0, 0.165, 0.13)]
      for (const p of stripes) {
        const st = new THREE.Mesh(G.warpaint, mat(colors.accent))
        st.position.copy(p)
        st.rotation.z = p.x === 0 ? 0 : p.x > 0 ? -0.3 : 0.3
        this.headPivot.add(st)
      }
    } else if (faceSlot === 'scar') {
      const sc = new THREE.Mesh(G.scar, mat('#a4543c'))
      sc.position.set(0.085, 0.09, 0.128)
      sc.rotation.z = 0.25
      this.headPivot.add(sc)
    }

    // ---- outfit slot (worn over the archetype colors) ----
    const outfitSlot = opts.outfit ?? 'classic'
    if (outfitSlot === 'kurta') {
      const skirt = new THREE.Mesh(G.kurtaSkirt, shirt)
      skirt.position.y = 0.02
      skirt.castShadow = true
      this.torsoPivot.add(skirt)
      const hem = new THREE.Mesh(G.kurtaHem, mat(colors.accent))
      hem.rotation.x = Math.PI / 2
      hem.position.y = -0.13
      this.torsoPivot.add(hem)
    } else if (outfitSlot === 'hoodie') {
      const hood = new THREE.Mesh(G.hood, shirt)
      hood.position.set(0, 0.56, -0.15)
      hood.rotation.x = -0.35
      hood.castShadow = true
      this.torsoPivot.add(hood)
      const pocket = new THREE.Mesh(G.pocket, shirt)
      pocket.position.set(0, 0.08, 0.13)
      this.torsoPivot.add(pocket)
    } else if (outfitSlot === 'highvis') {
      const vest = new THREE.Mesh(G.vestBody, mat('#f2a541'))
      vest.position.y = 0.27
      vest.castShadow = true
      this.torsoPivot.add(vest)
      for (const y of [0.36, 0.19]) {
        const stripe = new THREE.Mesh(G.vestStripe, mat('#e8e6df'))
        stripe.position.y = y
        this.torsoPivot.add(stripe)
      }
    } else if (outfitSlot === 'jacket') {
      // task 82 (male book): denim layer — folded collar, half-zip placket,
      // chest pockets and a shoulder yoke over the archetype tee
      const denim = mat(shade(colors.shirt, -26))
      const denimDark = mat(shade(colors.shirt, -44))
      for (const side of [1, -1]) {
        const collar = new THREE.Mesh(G.pocket, denim)
        collar.position.set(side * 0.075, 0.5, 0.115)
        collar.scale.set(0.42, 0.5, 0.6)
        collar.rotation.z = side * 0.5
        collar.rotation.x = 0.25
        this.torsoPivot.add(collar)
        const chestPocket = new THREE.Mesh(G.pocket, denim)
        chestPocket.position.set(side * 0.13, 0.3, 0.125)
        chestPocket.scale.set(0.55, 0.62, 0.5)
        this.torsoPivot.add(chestPocket)
      }
      const placket = new THREE.Mesh(G.tie, denimDark)
      placket.position.set(0, 0.26, 0.128)
      placket.scale.set(0.5, 0.85, 1)
      this.torsoPivot.add(placket)
      const zip = new THREE.Mesh(G.scar, mat('#9aa3ad', false))
      zip.material.metalness = 0.5
      zip.material.roughness = 0.4
      zip.scale.set(0.9, 4.6, 0.8)
      zip.position.set(0, 0.28, 0.142)
      this.torsoPivot.add(zip)
      const yoke = new THREE.Mesh(G.vestStripeThin, denim)
      yoke.position.set(0, 0.435, 0.1)
      yoke.scale.set(1.45, 1.15, 1.35)
      this.torsoPivot.add(yoke)
    } else if (outfitSlot === 'dress' || outfitSlot === 'anarkali') {
      // task 82 (female book): A-line skirt from the waist + accent belt + hem
      const long = outfitSlot === 'anarkali'
      const skirt = new THREE.Mesh(G.dressSkirt, shirt)
      skirt.position.y = long ? -0.33 : -0.27
      skirt.scale.set(1, long ? 1.35 : 1, 1)
      skirt.castShadow = true
      this.torsoPivot.add(skirt)
      const hem = new THREE.Mesh(G.dressHem, mat(colors.accent))
      hem.rotation.x = Math.PI / 2
      hem.position.y = long ? -0.665 : -0.52
      hem.scale.setScalar(long ? 1.12 : 1)
      this.torsoPivot.add(hem)
      const belt = new THREE.Mesh(G.waistBelt, mat(colors.accent))
      belt.rotation.x = Math.PI / 2
      belt.position.y = -0.03
      this.torsoPivot.add(belt)
    }

    // arms — pivot at shoulder; sleeve (shirt) + forearm+fist (skin), both merged
    this.armL.position.set(0.265, 0.46, 0)
    this.armR.position.set(-0.265, 0.46, 0)
    for (const arm of [this.armL, this.armR]) {
      const sleeve = new THREE.Mesh(sleeveGeometry(isFemale, build), shirt)
      sleeve.castShadow = true
      arm.add(sleeve)
      arm.add(new THREE.Mesh(forearmGeometry(isFemale, build), skin))
      this.torsoPivot.add(arm)
    }

    // legs — pivot at hip; FULL-LENGTH tapered limb (thigh+calf merged) reaching the
    // shoe at y -0.9 == ground (the old rig's legs stopped 0.335 short → hover)
    const footwearSlot = opts.footwear ?? 'shoes'
    const shoeMat = faceMaterialShared() // vertex-colored shoes, one shared material
    const buildFoot = (): THREE.Object3D => {
      if (footwearSlot === 'glow') {
        const fg = new THREE.Group()
        const base = new THREE.Mesh(shoeGeometry('glow', colors.accent), shoeMat)
        if (isFemale) base.scale.set(0.92, 1, 0.92)
        fg.add(base)
        const glowMat = new THREE.MeshStandardMaterial({ color: '#101214', emissive: '#39d0ff', emissiveIntensity: 1.3, roughness: 0.5 })
        const under = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.27), glowMat)
        under.position.set(0, -0.893, 0.05)
        const laceGlow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.014, 0.13), glowMat)
        laceGlow.position.set(0, -0.757, 0.028)
        if (isFemale) { under.scale.set(0.92, 1, 0.92); laceGlow.scale.set(0.92, 1, 0.92) }
        fg.add(under, laceGlow)
        return fg
      }
      const shoe = new THREE.Mesh(shoeGeometry(footwearSlot, colors.accent), shoeMat)
      if (isFemale) shoe.scale.set(0.92, 1, 0.92)
      return shoe
    }
    this.legL.position.set(0.1, 0.9, 0)
    this.legR.position.set(-0.1, 0.9, 0)
    const legGeo = legGeometry(isFemale, build)
    for (const leg of [this.legL, this.legR]) {
      const limb = new THREE.Mesh(legGeo, pants)
      limb.castShadow = true
      leg.add(limb)
      leg.add(buildFoot())
      this.group.add(leg)
    }

    // ---- back gear slot (student/journalist keep their signature backpack when slot untouched) ----
    const gearSlot = opts.gear ?? ((opts.archetype === 'student' || opts.archetype === 'journalist') ? 'backpack' : 'none')
    if (gearSlot === 'backpack') {
      const bpColor = opts.archetype === 'student' ? '#c94f34' : opts.archetype === 'journalist' ? '#3d3a30' : colors.accent
      const bp = new THREE.Mesh(G.backpack, mat(bpColor))
      bp.position.set(0, 0.28, -0.2)
      bp.castShadow = true
      this.torsoPivot.add(bp)
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.03), mat('#2c2c2c'))
      flap.position.set(0, 0.38, -0.275)
      this.torsoPivot.add(flap)
      // task 82 polish: rounded top lid, side bottle pocket, chest straps +
      // shoulder straps visible from the front, gold buckle pin on the flap
      const lid = new THREE.Mesh(G.hand, mat(shade(bpColor, -14)))
      lid.position.set(0, 0.455, -0.21)
      lid.scale.set(1.75, 0.8, 0.95)
      this.torsoPivot.add(lid)
      const bottle = new THREE.Mesh(G.bottleCyl, mat('#3d5a80'))
      bottle.position.set(0.18, 0.24, -0.2)
      this.torsoPivot.add(bottle)
      const bottleCap = new THREE.Mesh(G.spec, mat('#c9c2ae', false))
      bottleCap.scale.setScalar(2.6)
      bottleCap.position.set(0.18, 0.33, -0.2)
      this.torsoPivot.add(bottleCap)
      for (const side of [1, -1]) {
        const strap = new THREE.Mesh(G.strap, mat(shade(bpColor, -22)))
        strap.position.set(side * 0.09, 0.3, 0.135)
        strap.scale.set(0.6, 0.85, 0.8)
        this.torsoPivot.add(strap)
      }
      const chest = new THREE.Mesh(G.vestStripeThin, mat(shade(bpColor, -22)))
      chest.position.set(0, 0.36, 0.135)
      chest.scale.set(0.75, 0.75, 0.7)
      this.torsoPivot.add(chest)
      const pin = new THREE.Mesh(G.badge, mat('#d4a017', false))
      pin.material.metalness = 0.5
      pin.position.set(0, 0.385, -0.288)
      this.torsoPivot.add(pin)
    } else if (gearSlot === 'jhola') {
      const strap = new THREE.Mesh(G.strap, mat('#8a6b4a'))
      strap.position.set(0.08, 0.24, 0.13)
      strap.rotation.z = 0.55
      this.torsoPivot.add(strap)
      const bag = new THREE.Mesh(G.sideBag, mat('#c9b98a'))
      bag.position.set(-0.26, -0.06, 0.04)
      bag.castShadow = true
      this.torsoPivot.add(bag)
      // task 82 polish: cloth fold lines + stitched strap edge + buttoned flap
      for (const dy of [0.02, -0.03]) {
        const fold = new THREE.Mesh(G.scar, mat(shade('#c9b98a', -18)))
        fold.scale.set(12, 0.35, 0.5)
        fold.position.set(-0.26, -0.06 + dy, 0.082)
        this.torsoPivot.add(fold)
      }
      const stitch = new THREE.Mesh(G.scar, mat('#6b4a2e'))
      stitch.scale.set(0.5, 5.2, 0.6)
      stitch.rotation.z = 0.55
      stitch.position.set(0.095, 0.24, 0.148)
      this.torsoPivot.add(stitch)
      const button = new THREE.Mesh(G.spec, mat('#8c1f28', false))
      button.scale.setScalar(1.6)
      button.position.set(-0.26, 0, 0.085)
      this.torsoPivot.add(button)
    } else if (gearSlot === 'bannerroll') {
      const roll = new THREE.Mesh(G.bannerRoll, mat('#e8e2d0'))
      roll.rotation.z = Math.PI / 2.3
      roll.position.set(0, 0.3, -0.2)
      roll.castShadow = true
      this.torsoPivot.add(roll)
      const rollEdge = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 8), mat('#8c1f28'))
      rollEdge.rotation.z = Math.PI / 2.3
      rollEdge.position.set(-0.24, 0.36, -0.2)
      this.torsoPivot.add(rollEdge)
      // task 82 polish: binding strap around the roll + paper core on the end
      const bind = new THREE.Mesh(G.hairTie, mat('#8c1f28'))
      bind.rotation.y = Math.PI / 2
      bind.scale.setScalar(1.6)
      bind.position.set(0.1, 0.25, -0.2)
      this.torsoPivot.add(bind)
      const core = new THREE.Mesh(G.spec, mat('#b8a888', false))
      core.scale.setScalar(3.2)
      core.position.set(-0.245, 0.36, -0.2)
      this.torsoPivot.add(core)
    } else if (gearSlot === 'dhol') {
      const drum = new THREE.Mesh(G.dhol, mat('#b3854a'))
      drum.rotation.x = Math.PI / 2
      drum.position.set(0, 0.24, -0.26)
      drum.castShadow = true
      this.torsoPivot.add(drum)
      for (const dz of [-0.15, 0.15]) {
        const rim = new THREE.Mesh(G.dholRim, mat('#e8e2d0'))
        rim.position.set(0, 0.24, -0.26 + dz)
        this.torsoPivot.add(rim)
      }
      const rope = new THREE.Mesh(G.strap, mat('#d9a428'))
      rope.position.set(0, 0.24, -0.26)
      rope.rotation.z = 0.4
      this.torsoPivot.add(rope)
    } else if (gearSlot === 'umbrella') {
      const stick = new THREE.Mesh(G.umbrellaStick, mat('#3a4046'))
      stick.rotation.z = 0.65
      stick.position.set(-0.02, 0.26, -0.2)
      this.torsoPivot.add(stick)
      const fold = new THREE.Mesh(G.umbrellaFold, mat(colors.accent))
      fold.rotation.z = 0.65
      fold.position.set(-0.2, 0.42, -0.2)
      this.torsoPivot.add(fold)
      const handle = new THREE.Mesh(G.umbrellaHandle, mat('#7a5230'))
      handle.rotation.z = 0.65 - Math.PI
      handle.position.set(0.16, 0.08, -0.2)
      this.torsoPivot.add(handle)
    }

    // ---- held slot: what the protester carries in their hands ----
    // Back-compat: profiles that only set signText still raise the classic sign.
    const heldSlot = opts.held !== undefined && opts.held !== null
      ? opts.held
      : (opts.signText ? 'sign' : 'none')
    const slogan = (opts.signText || '').trim() || 'PROTEST'
    if ((heldSlot === 'sign' || (!opts.held && opts.signText)) && opts.npcType === undefined) {
      this.signGroup = new THREE.Group()
      const pole = new THREE.Mesh(G.signPole, mat('#8a6b4a'))
      pole.position.y = 0.25
      const board = new THREE.Mesh(G.signBoard, mat('#f5efdc'))
      board.position.y = 0.55
      const text = this.makeTextTexture(slogan)
      const texMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.28), new THREE.MeshBasicMaterial({ map: text, transparent: true }))
      texMesh.position.set(0, 0.55, 0.012)
      const texMesh2 = texMesh.clone()
      texMesh2.rotation.y = Math.PI
      this.signGroup.add(pole, board, texMesh, texMesh2)
      // task 82 polish: rear cross-brace, corner bolts, pole grip wrap
      const brace = new THREE.Mesh(G.scar, mat('#8a6b4a'))
      brace.scale.set(0.5, 6.5, 0.55)
      brace.rotation.z = 0.62
      brace.position.set(0, 0.55, -0.014)
      this.signGroup.add(brace)
      for (const [bx, by] of [[-0.21, 0.66], [0.21, 0.66], [-0.21, 0.44], [0.21, 0.44]] as const) {
        const bolt = new THREE.Mesh(G.spec, mat('#3a2d1a', false))
        bolt.scale.setScalar(1.4)
        bolt.position.set(bx, by, 0.013)
        this.signGroup.add(bolt)
      }
      const grip = new THREE.Mesh(G.moustache, mat('#5c3a24'))
      grip.scale.set(0.5, 1.1, 1.6)
      grip.position.set(0, 0.06, 0)
      this.signGroup.add(grip)
      this.signGroup.position.y = -0.45
      this.armR.add(this.signGroup)
      this.armR.rotation.x = -0.9
      this.armBlockR = true
    } else if (heldSlot === 'sign' && opts.npcType !== undefined) {
      // NPCs with a sign slot fall through — signs are a protester thing
    } else if (heldSlot === 'banner') {
      this.heldProp = new THREE.Group()
      const pole = new THREE.Mesh(G.flagPole, mat('#8a6b4a'))
      pole.position.y = 0.42
      const cloth = new THREE.Mesh(G.bannerCloth, new THREE.MeshStandardMaterial({ map: this.makeTextTextureWide(slogan), side: THREE.DoubleSide, roughness: 0.9 }))
      cloth.position.set(-0.36, 0.78, 0)
      cloth.castShadow = true
      this.heldProp.add(pole, cloth)
      // task 82 polish: gold finial on the pole top
      const finial = new THREE.Mesh(G.spec, mat('#f2c14e', false))
      finial.material.metalness = 0.5
      finial.scale.setScalar(2.2)
      finial.position.set(0, 0.865, 0)
      this.heldProp.add(finial)
      const backCloth = cloth.clone()
      backCloth.rotation.y = Math.PI
      backCloth.position.z = -0.005
      this.heldProp.add(backCloth)
      this.heldProp.position.y = -0.4
      this.armR.add(this.heldProp)
      this.armR.rotation.x = -0.85
      this.armBlockR = true
      this.bannerClothRef = cloth
    } else if (heldSlot === 'flag') {
      this.heldProp = new THREE.Group()
      const pole = new THREE.Mesh(G.flagPole, mat('#8a6b4a'))
      pole.position.y = 0.42
      const cloth = new THREE.Mesh(G.flagCloth, new THREE.MeshStandardMaterial({ color: colors.accent, side: THREE.DoubleSide, roughness: 0.9 }))
      cloth.position.set(0.15, 0.72, 0)
      this.heldProp.add(pole, cloth)
      // task 82 polish: contrast stripe riding the rippling cloth (child mesh)
      const stripe = new THREE.Mesh(G.flagCloth, mat('#f5efdc'))
      stripe.scale.set(1.01, 0.28, 1)
      stripe.position.set(0, -0.055, 0.004)
      cloth.add(stripe)
      const tip = new THREE.Mesh(G.hand, mat('#f2c14e', false))
      tip.scale.setScalar(0.5)
      tip.position.y = 0.85
      this.heldProp.add(tip)
      this.heldProp.position.y = -0.4
      this.armR.add(this.heldProp)
      this.armR.rotation.x = -0.55
      this.armBlockR = true
      this.flagClothRef = cloth
    } else if (heldSlot === 'bat') {
      this.heldProp = new THREE.Group()
      const barrel = new THREE.Mesh(G.bat, mat('#c9a06a'))
      barrel.position.y = 0.28
      barrel.castShadow = true
      const knob = new THREE.Mesh(G.batKnob, mat('#8a6b4a'))
      knob.position.y = 0
      this.heldProp.add(barrel, knob)
      // task 82 polish: tape rings on the grip
      for (const gy of [0.06, 0.1]) {
        const tape = new THREE.Mesh(G.hairTie, mat('#2c2c2c'))
        tape.rotation.x = Math.PI / 2
        tape.scale.setScalar(1.15)
        tape.position.y = gy
        this.heldProp.add(tape)
      }
      this.heldProp.rotation.x = -0.45
      this.heldProp.position.y = -0.44
      this.armR.add(this.heldProp)
      this.armBlockR = true
    } else if (heldSlot === 'lathi' && !opts.npcType) {
      this.heldProp = new THREE.Group()
      const stick = new THREE.Mesh(G.lathi, mat('#7a5230'))
      stick.position.y = 0.3
      stick.castShadow = true
      this.heldProp.add(stick)
      // task 82 polish: grip tape rings near the top
      for (const gy of [0.5, 0.54]) {
        const tape = new THREE.Mesh(G.hairTie, mat('#2c2c2c'))
        tape.rotation.x = Math.PI / 2
        tape.scale.setScalar(0.8)
        tape.position.y = gy
        this.heldProp.add(tape)
      }
      this.heldProp.rotation.x = -0.35
      this.heldProp.position.y = -0.44
      this.armR.add(this.heldProp)
      this.armBlockR = true
    } else if (heldSlot === 'shoppingbag') {
      this.heldProp = new THREE.Group()
      const bag = new THREE.Mesh(G.shoppingBag, mat('#e8b6a0'))
      bag.position.y = -0.1
      bag.castShadow = true
      for (const hx of [-0.05, 0.05]) {
        const h = new THREE.Mesh(G.bagHandle, mat('#a4715a'))
        h.position.set(hx, 0.02, 0)
        this.heldProp.add(h)
      }
      const greens = new THREE.Mesh(G.hand, mat('#5c8a4e'))
      greens.scale.set(0.7, 0.45, 0.7)
      greens.position.set(0.02, -0.02, 0.01)
      this.heldProp.add(greens)
      this.heldProp.position.y = -0.5
      this.armL.add(this.heldProp)
      this.armBlockL = true
    } else if (heldSlot === 'megaphone') {
      this.heldProp = new THREE.Group()
      const cone = new THREE.Mesh(G.megaCone, mat('#f2a541'))
      cone.rotation.x = Math.PI / 2 - 0.5
      cone.position.set(0, 0.06, 0.1)
      const body = new THREE.Mesh(G.megaBody, mat('#8c1f28'))
      body.rotation.x = Math.PI / 2 - 0.5
      body.position.set(0, 0.02, -0.02)
      const handle = new THREE.Mesh(G.megaHandle, mat('#3a4046'))
      handle.position.set(0, -0.04, 0)
      handle.rotation.x = Math.PI / 2
      this.heldProp.add(cone, body, handle)
      // task 82 polish: lanyard loop under the handle
      const loop = new THREE.Mesh(G.hairTie, mat('#3a4046'))
      loop.scale.setScalar(1.15)
      loop.position.set(0, -0.14, 0.05)
      loop.rotation.x = 0.5
      this.heldProp.add(loop)
      this.heldProp.position.y = -0.48
      this.armR.add(this.heldProp)
      this.armR.rotation.x = -1.35
      this.armBlockR = true
    }

    // police lathi (NPCs only — protesters equip the 'lathi' held slot)
    if (opts.npcType) {
      this.lathi = new THREE.Group()
      const stick = new THREE.Mesh(G.lathi, mat('#7a5230'))
      stick.position.y = -0.35
      this.lathi.add(stick)
      this.lathi.position.y = -0.4
      this.armR.add(this.lathi)
      this.armBlockR = true
    }

    // name tag
    if (opts.name) {
      const sprite = this.makeNameSprite(opts.name, opts.nameColor ?? '#fff')
      sprite.position.y = 2.15
      this.group.add(sprite)
      this.nameSprite = sprite
    }

    // alert indicator (for NPCs) — exclamation
    {
      const canvas = document.createElement('canvas')
      canvas.width = 64; canvas.height = 64
      const ctx = canvas.getContext('2d')!
      ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'center'
      ctx.fillStyle = '#ff3b30'
      ctx.fillText('!', 32, 50)
      const tex = new THREE.CanvasTexture(canvas)
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
      sp.position.y = 2.5
      sp.scale.set(0.5, 0.5, 1)
      sp.visible = false
      this.group.add(sp)
      this.alertIndicator = sp
    }

    this.group.scale.setScalar(this.scaleMul)
  }

  private makeTextTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 148
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f5efdc'
    ctx.fillRect(0, 0, 256, 148)
    ctx.strokeStyle = '#3a2d1a'; ctx.lineWidth = 6
    ctx.strokeRect(4, 4, 248, 140)
    ctx.fillStyle = '#8c1f28'
    ctx.font = 'bold 30px Arial'
    ctx.textAlign = 'center'
    const words = text.split(' ')
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 14) { lines.push(cur.trim()); cur = w }
      else cur += ' ' + w
    }
    if (cur.trim()) lines.push(cur.trim())
    lines.forEach((l, i) => ctx.fillText(l, 128, 62 - (lines.length - 1) * 17 + i * 34))
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4 // crisp signage at grazing angles (three clamps to device max)
    return tex
  }

  /** Wide single-line texture for cloth banners. */
  private makeTextTextureWide(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#b54a32'
    ctx.fillRect(0, 0, 512, 128)
    ctx.fillStyle = '#f5efdc'
    ctx.font = 'bold 56px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text.slice(0, 22).toUpperCase(), 256, 68)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return tex
  }

  private makeNameSprite(name: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.font = 'bold 30px Arial'
    ctx.textAlign = 'center'
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'
    ctx.strokeText(name, 128, 42)
    ctx.fillStyle = color
    ctx.fillText(name, 128, 42)
    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = 4
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
    sp.scale.set(1.9, 0.48, 1)
    return sp
  }

  setAlert(v: boolean) { if (this.alertIndicator) this.alertIndicator.visible = v }

  /**
   * Free everything this rig uniquely owns (per-rig materials, inline geometries,
   * canvas textures). Shared module-level caches (G.* + face geometry) are protected
   * via the sharedGeo WeakSet. Call after removing rig.group from the scene.
   */
  dispose() {
    const mats = new Set<THREE.Material>()
    const sharedFace = faceMaterialShared()
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry && !sharedGeo.has(mesh.geometry)) mesh.geometry.dispose()
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(m)) m.forEach((x) => mats.add(x))
      else if (m) mats.add(m)
    })
    for (const m of mats) {
      if (m === sharedFace) continue // one material serves every rig's face mesh
      const map = (m as unknown as { map?: THREE.Texture | null }).map
      if (map) map.dispose()
      m.dispose()
    }
  }

  /** Procedural double-jump flourish — a quick front-flip of the torso (no assets). */
  flip() {
    this.flipTimer = this.flipDur
  }
  setNameVisible(v: boolean) { if (this.nameSprite) this.nameSprite.visible = v }
  /**
   * Hide the procedural BODY while keeping the name tag + alert sprites rendered —
   * used when a High-Fi GLB model replaces the box body (remote players keep their
   * name tag overhead). Only top-level body pivots are toggled; sprites are skipped.
   */
  setBodyVisible(v: boolean) {
    for (const child of this.group.children) {
      if (child === this.nameSprite || child === this.alertIndicator) continue
      child.visible = v
    }
  }
  /** Rebuild the name sprite with a new color (squadmates get green tags). */
  setNameColor(name: string, color: string) {
    if (!this.nameSprite || this.nameSprite.userData.color === color) return
    this.nameSprite.userData.color = color
    const rebuilt = this.makeNameSprite(name, color)
    rebuilt.position.copy(this.nameSprite.position)
    const group = this.nameSprite.parent
    if (group) {
      group.remove(this.nameSprite)
    }
    // free the replaced sprite's GPU resources before dropping it
    this.nameSprite.material.map?.dispose()
    this.nameSprite.material.dispose()
    if (group) group.add(rebuilt)
    this.nameSprite = rebuilt
  }

  update(dt: number, anim: AnimName, moveSpeed: number) {
    this.anim = anim
    if (this.forceAnim) anim = this.forceAnim
    this.speedRatio = Math.min(1, moveSpeed / 9)
    const p = (this.phase += dt * (anim === 'run' ? 11 : anim === 'walk' ? 7.2 : 1.6))
    const s = Math.sin(p), c = Math.cos(p)
    const swing = anim === 'run' ? 1.05 : anim === 'walk' ? 0.62 : 0

    const set = (o: THREE.Object3D, x: number, z = 0) => { o.rotation.x += (x - o.rotation.x) * Math.min(1, dt * 14); if (z !== 0 || o.rotation.z !== 0) o.rotation.z += (0 - o.rotation.z) * Math.min(1, dt * 14) }

    switch (anim) {
      case 'walk':
      case 'run': {
        const lean = anim === 'run' ? 0.22 : 0.08
        this.torsoPivot.rotation.x += (lean - this.torsoPivot.rotation.x) * Math.min(1, dt * 8)
        set(this.legL, s * swing)
        set(this.legR, -s * swing)
        if (!this.armBlockR) {
          set(this.armR, s * swing * 0.9)
        }
        set(this.armL, this.armBlockL ? 0.15 : -s * swing * 0.9)
        this.group.position.y = this.baseY + Math.abs(s) * (anim === 'run' ? 0.06 : 0.03)
        break
      }
      case 'jump': {
        this.torsoPivot.rotation.x += (0.1 - this.torsoPivot.rotation.x) * Math.min(1, dt * 8)
        set(this.legL, -0.5); set(this.legR, 0.25)
        set(this.armL, -2.6); set(this.armR, -2.6)
        // double-jump front-flip flourish (procedural, rides on top of the jump pose)
        if (this.flipTimer > 0) {
          this.flipTimer = Math.max(0, this.flipTimer - dt)
          const t = 1 - this.flipTimer / this.flipDur
          const eased = t < 0.7 ? (t / 0.7) * (Math.PI * 2) : Math.PI * 2 // flip then hold
          this.torsoPivot.rotation.x = eased
        }
        break
      }
      case 'slide': {
        this.torsoPivot.rotation.x += (-1.15 - this.torsoPivot.rotation.x) * Math.min(1, dt * 10)
        set(this.legL, 0.4); set(this.legR, -0.15)
        set(this.armL, -2.9); set(this.armR, -2.7)
        break
      }
      case 'fall': {
        // airborne flail — distinct from the jump pose, mirrors the GLB 'fall' clip
        this.torsoPivot.rotation.x += (-0.14 - this.torsoPivot.rotation.x) * Math.min(1, dt * 8)
        this.headPivot.rotation.x += (-0.22 - this.headPivot.rotation.x) * Math.min(1, dt * 8)
        set(this.armL, -2.35 + Math.sin(p * 3) * 0.35, 0.35)
        set(this.armR, -2.35 + Math.sin(p * 3 + 1.6) * 0.35, -0.35)
        set(this.legL, -0.3); set(this.legR, 0.22)
        break
      }
      case 'land': {
        // absorb crouch → rise (deep knee bend, arms forward for balance)
        this.torsoPivot.rotation.x += (0.42 - this.torsoPivot.rotation.x) * Math.min(1, dt * 12)
        set(this.legL, -1.0); set(this.legR, -0.9)
        set(this.armL, -1.3); set(this.armR, -1.3)
        this.group.position.y = this.baseY - 0.22
        break
      }
      case 'recover': {
        // getup — crouched rising to neutral (after dazed/detained release)
        this.torsoPivot.rotation.x += (0.18 - this.torsoPivot.rotation.x) * Math.min(1, dt * 7)
        set(this.legL, -0.55); set(this.legR, -0.5)
        set(this.armL, -0.5); set(this.armR, -0.5)
        this.group.position.y = this.baseY - 0.1
        break
      }
      case 'dazed':
      case 'down': {
        this.torsoPivot.rotation.x += (-0.55 - this.torsoPivot.rotation.x) * Math.min(1, dt * 6)
        this.headPivot.rotation.z = Math.sin(p * 2) * 0.25
        set(this.legL, 0.35); set(this.legR, -0.3)
        set(this.armL, 0.6); set(this.armR, -0.6)
        break
      }
      case 'detained': {
        this.torsoPivot.rotation.x += (0.12 - this.torsoPivot.rotation.x) * Math.min(1, dt * 6)
        set(this.armL, 0.55, 0); set(this.armR, 0.55, 0)
        this.armL.rotation.z = 0.5; this.armR.rotation.z = -0.5
        this.headPivot.rotation.x = 0.35
        break
      }
      case 'celebrate': {
        this.torsoPivot.rotation.x += (0 - this.torsoPivot.rotation.x) * Math.min(1, dt * 8)
        set(this.armL, -2.9 + s * 0.3); set(this.armR, -2.9 - s * 0.3)
        this.group.position.y = this.baseY + Math.abs(c) * 0.14
        this.headPivot.rotation.x = 0
        break
      }
      case 'throw': {
        set(this.armR, -2.4); set(this.armL, 0.4)
        this.torsoPivot.rotation.x += (0.15 - this.torsoPivot.rotation.x) * dt * 10
        break
      }
      case 'heal': {
        set(this.armL, -1.7); set(this.armR, -1.7)
        this.headPivot.rotation.x = 0.1
        break
      }
      default: { // idle
        this.torsoPivot.rotation.x += (0.03 - this.torsoPivot.rotation.x) * Math.min(1, dt * 6)
        this.headPivot.rotation.x = Math.sin(p * 0.5) * 0.04
        set(this.legL, 0); set(this.legR, 0)
        if (!this.armBlockL) {
          set(this.armL, 0.04 + Math.sin(p * 0.8) * 0.03)
        }
        if (!this.armBlockR) {
          set(this.armR, 0.04 - Math.sin(p * 0.8) * 0.03)
        }
        this.group.position.y = this.baseY + Math.sin(p * 0.9) * 0.012
      }
    }

    // cloth life: flag ripples, banner sways with the stride
    if (this.flagClothRef) {
      this.flagClothRef.rotation.y = Math.sin(p * 1.4) * 0.35 + 0.12
      this.flagClothRef.rotation.z = Math.sin(p * 0.9) * 0.06
    }
    if (this.bannerClothRef) {
      this.bannerClothRef.rotation.z = Math.sin(p * 0.8) * 0.05
      this.bannerClothRef.rotation.x = Math.sin(p * 1.1) * 0.04
    }
  }

  setBaseY(y: number) {
    this.baseY = y
  }
}

/** Build the Great Vote Collector boss — an oversized cartoon bureaucrat. */
export function buildBoss(): { group: THREE.Group; torsoPivot: THREE.Group; armR: THREE.Group; armL: THREE.Group; headPivot: THREE.Group; stamp: THREE.Group } {
  const group = new THREE.Group()
  const suit = mat('#2b2f3a')
  const skin = mat('#c68a5c')
  const accent = mat('#b54a32')

  const torsoPivot = new THREE.Group()
  torsoPivot.position.y = 5.4
  group.add(torsoPivot)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 1.6), suit)
  torso.position.y = 1.2
  torso.castShadow = true
  torsoPivot.add(torso)
  // tie
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.1), accent)
  tie.position.set(0, 1.1, 0.82)
  torsoPivot.add(tie)
  // medals (vote badges)
  for (let i = 0; i < 3; i++) {
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12), mat('#f2c14e'))
    badge.rotation.x = Math.PI / 2
    badge.position.set(0.7 - i * 0.55, 1.9, 0.84)
    torsoPivot.add(badge)
  }
  // head
  const headPivot = new THREE.Group()
  headPivot.position.y = 3.15
  torsoPivot.add(headPivot)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), skin)
  head.position.y = 0.35
  head.castShadow = true
  headPivot.add(head)
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), mat('#4a4a48'))
  hairM.position.y = 0.42
  headPivot.add(hairM)
  // monocle
  const mono = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14), mat('#f2c14e'))
  mono.position.set(0.22, 0.34, 0.56)
  headPivot.add(mono)
  // giant collar
  const collar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.1), mat('#f5f0e0'))
  collar.position.y = 2.85
  torsoPivot.add(collar)

  // arms
  const armL = new THREE.Group(); armL.position.set(1.62, 2.5, 0)
  const armR = new THREE.Group(); armR.position.set(-1.62, 2.5, 0)
  for (const arm of [armL, armR]) {
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.4, 0.55), suit)
    upper.position.y = -1.1
    upper.castShadow = true
    arm.add(upper)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), skin)
    hand.position.y = -2.45
    arm.add(hand)
    torsoPivot.add(arm)
  }

  // GIANT STAMP in right hand
  const stamp = new THREE.Group()
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 8), mat('#7a5230'))
  handle.position.y = 1.3
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.9, 12), mat('#8c1f28'))
  base.position.y = -0.45
  stamp.add(handle, base)
  stamp.position.y = -2.4
  stamp.rotation.z = 0.3
  armR.add(stamp)

  // legs
  for (const side of [1, -1]) {
    const leg = new THREE.Group()
    leg.position.set(0.65 * side, 5.4, 0)
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.72, 4.6, 0.72), mat('#33384a'))
    upper.position.y = -2.3
    upper.castShadow = true
    leg.add(upper)
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.4, 1.35), mat('#1c1a17'))
    shoe.position.set(0, -4.75, 0.25)
    leg.add(shoe)
    group.add(leg)
  }

  // ballot shield ring floating around torso
  const shield = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.16, 8, 36), mat('#4e9b6e'))
  shield.rotation.x = Math.PI / 2
  shield.position.y = 5.6
  shield.name = 'shield'
  group.add(shield)

  return { group, torsoPivot, armR, armL, headPivot, stamp }
}
