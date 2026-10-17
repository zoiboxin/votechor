// Avatar look pipeline — ONE source of truth for every High-Fi GLB appearance:
// the wardrobe preview (CharacterPreview), the local player (game.ts) and the
// remotes (game.ts attachRemoteGlb) all resolve through resolveAvatarLook() +
// applyAvatarLook(), so what you style in the wardrobe is what everyone sees.
//
// Two layers:
//  1. TINT — the TEXTURED family (votechor-male-skinned.glb) has baked grayish
//     textures. v54 multiplied them by already-dark palette colors → the model
//     rendered visibly darker than intended (the "little dark" report) and a
//     skin tone LIGHTER than the baked one could never show (multiply can not
//     lighten). Fix: LUMINANCE-NORMALIZED multiply — material.color =
//     target / bakedRef (per channel, measured constants below), so the tinted
//     region's average renders EXACTLY the palette color while keeping every
//     baked shading detail, and both lighten and darken work.
//  2. ATTACHMENTS — hair / headgear / face / footwear / back gear / held items /
//     glasses are built as small procedural meshes parented to the character's
//     actual BONES (Head, HandR, FootL/R, Torso), so they follow the skeletal
//     animation (idle sway, stride, arm swing) with zero network traffic — all
//     derived from the cosmetics fields that already sync.
//
// Fitting constants come from scripts/measure-look-targets.ts (male skinned GLB
// real geometry: head joint y1.58 top 1.957, feet y0, shoulders ±0.215/1.547,
// hands ±0.374/0.83) and the female puppet's node layout (Head y1.40, hands
// 0.76, feet 0.04 → fit factors + fallback bones below).
import * as THREE from 'three'
import { archetypeById } from './shared/constants'
import { policeUniformColors } from '@/lib/cosmetics'

export interface AvatarPalette {
  shirt: string
  pants: string
  skin: string
  accent: string
  /** footwear tint (outfit_shoes mesh) — defaults to clean sneakers */
  shoes?: string
  /** hair attachment color (archetype identity) */
  hairColor?: string
}

export interface AvatarLook {
  palette: AvatarPalette
  gender: 'male' | 'female'
  hat: string
  hair: string
  face: string
  build: string
  outfit: string
  footwear: string
  gear: string
  held: string
  glasses: boolean
  signText?: string
}


// ---------- outfit / footwear tint tables (GLB path; the procedural rig keeps
// its own silhouette-driven styling) ----------
const OUTFIT_TINTS: Record<string, { shirt?: string; pants?: string; accent?: string }> = {
  classic: {}, // archetype kit unchanged
  hawaiian: { shirt: '#e8862e', accent: '#2e6e4e' },
  tank: { shirt: '#f2ede1', pants: '#3a3f46' },
  dress: { shirt: '#b03a63', pants: '#b03a63', accent: '#f2c14e' },
  kurta: { shirt: '#efe6c8', pants: '#e8dcc0', accent: '#8c1f28' },
  suit: { shirt: '#d9c8b4', pants: '#43485a', accent: '#8c1f28' },
  hoodie: { shirt: '#3a4046', pants: '#2b3036', accent: '#2e6e4e' },
  highvis: { shirt: '#dff03c', pants: '#3a3f46', accent: '#6b7280' },
}

const FOOTWEAR_TINTS: Record<string, string> = {
  shoes: '#e8e4d8',
  boots: '#6b4a2e',
  chappal: '#9a6a3e',
  glow: '#2a3038',
}

type LooseCosmetics = unknown

/** Safe field extraction — accepts the profile cosmetics record, the raw join
 *  payload, or the wardrobe's typed PreviewLook alike. */
function fieldStr(o: Record<string, unknown>, k: string, d: string): string {
  return typeof o[k] === 'string' ? (o[k] as string) : d
}

/** Resolve the full AvatarLook from raw cosmetics + archetype + role. */
export function resolveAvatarLook(c: LooseCosmetics, archetypeId: string, role: 'protector' | 'police'): AvatarLook {
  const o = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>
  const arch = archetypeById(archetypeId)
  const pal: AvatarPalette = { shirt: arch.colors.shirt, pants: arch.colors.pants, skin: arch.colors.skin, accent: arch.colors.accent, hairColor: arch.colors.hair }
  const outfit = fieldStr(o, 'outfit', 'classic')
  const footwear = fieldStr(o, 'footwear', 'shoes')
  if (role === 'police') {
    const u = policeUniformColors(fieldStr(o, 'policeOutfit', ''))
    pal.shirt = u.shirt; pal.pants = u.pants; pal.accent = u.accent
  } else {
    const ot = OUTFIT_TINTS[outfit]
    if (ot) { if (ot.shirt) pal.shirt = ot.shirt; if (ot.pants) pal.pants = ot.pants; if (ot.accent) pal.accent = ot.accent }
  }
  const skin = fieldStr(o, 'skinTone', '')
  if (/^#[0-9a-fA-F]{6}$/.test(skin)) pal.skin = skin
  pal.shoes = FOOTWEAR_TINTS[footwear] ?? FOOTWEAR_TINTS.shoes
  return {
    palette: pal,
    gender: o.gender === 'female' ? 'female' : 'male',
    hat: fieldStr(o, 'hat', 'none'),
    hair: fieldStr(o, 'hair', 'bald'),
    face: fieldStr(o, 'face', 'clean'),
    build: fieldStr(o, 'build', 'regular'),
    outfit,
    footwear,
    gear: fieldStr(o, 'gear', 'none'),
    held: fieldStr(o, 'held', 'none'),
    glasses: o.glasses === true,
    signText: typeof o.signText === 'string' ? o.signText : undefined,
  }
}

// ---------- 1. tint ----------
// Mesh names of the RIGGED family (solid-color meshes, e.g. the female puppet)
// → palette key: plain color REPLACE (these meshes have no texture to preserve).
const RIGGED_MAP: Record<string, keyof AvatarPalette> = {
  TorsoMesh: 'shirt', ArmLMesh: 'shirt', ArmRMesh: 'shirt',
  LegLMesh: 'pants', LegRMesh: 'pants',
  HeadMesh: 'skin', ArmLHand: 'skin', ArmRHand: 'skin',
  Sash: 'accent',
}

// Mesh names of the TEXTURED family → palette key, with the MEASURED baked
// reference color of that region (scripts/measure-look-targets.ts, landmark
// vertices sampled in the real PNG textures). tint = target / ref keeps the
// region's average exactly on the palette color instead of stacking darker.
const TEXTURED_MAP: Record<string, { key: keyof AvatarPalette; ref: THREE.Color }> = {
  AvatarHead: { key: 'skin', ref: new THREE.Color('#daa88e') },
  AvatarBody: { key: 'skin', ref: new THREE.Color('#e2b099') },
  outfit_top: { key: 'shirt', ref: new THREE.Color('#8a8a8a') },
  outfit_bottom: { key: 'pants', ref: new THREE.Color('#ababab') },
  outfit_shoes: { key: 'shoes', ref: new THREE.Color('#5c5c64') },
}

/** Pristine per-instance materials — re-tints clone from the original so color
 *  factors never stack (clone-of-clone would multiply twice). */
const pristine = new WeakMap<THREE.Mesh, THREE.Material>()

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined
    const kill = (x: THREE.Material) => {
      const tex = (x as unknown as Record<string, THREE.Texture | null>).map
      if (tex) tex.dispose()
      x.dispose()
    }
    if (Array.isArray(m)) m.forEach(kill)
    else if (m) kill(m)
  })
}

function tintGroup(group: THREE.Object3D, pal: AvatarPalette) {
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || typeof m.name !== 'string') return
    const solidKey = RIGGED_MAP[m.name]
    const tex = TEXTURED_MAP[m.name]
    if (!solidKey && !tex) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial | undefined
    if (!mat || !(mat as THREE.Material).isMaterial) return
    let base = pristine.get(m)
    if (!base) {
      base = mat
      pristine.set(m, base)
    } else if (m.material !== base) {
      ;(m.material as THREE.Material).dispose() // drop the previous tint clone
    }
    const clone = base.clone() as THREE.MeshStandardMaterial
    const target = new THREE.Color(pal[solidKey ?? tex.key] as string)
    if (solidKey) {
      clone.color.copy(target)
    } else {
      // luminance-normalized multiply: factor = target / bakedRef (per channel,
      // linear space) — region average lands exactly on the palette color;
      // factors above 1 lighten (baked-dark textures, lighter skin tones).
      clone.color.setRGB(target.r / tex.ref.r, target.g / tex.ref.g, target.b / tex.ref.b)
    }
    m.material = clone
  })
}

// ---------- 2. attachments ----------
// Bone lookup with fallbacks (the female puppet has no Hand/Foot/Elbow bones —
// ArmR/LegL stand in with a hand/foot-level offset).
interface BoneSpec { names: string[]; fallbackOffset?: [number, number, number]; fit: number }
const FEMALE_HEAD: BoneSpec = { names: ['Head'], fit: 0.95 }
const FEMALE_HELD: BoneSpec = { names: ['HandR', 'ArmR'], fallbackOffset: [0, -0.58, 0], fit: 0.9 }
const FEMALE_FOOT: BoneSpec = { names: ['FootL', 'LegL'], fallbackOffset: [0, -0.86, 0.03], fit: 0.85 }
const FEMALE_GEAR: BoneSpec = { names: ['Torso'], fit: 0.8 }

const mat = (color: string, rough = 0.85, extra?: { emissive?: string; ei?: number; metal?: number }) => {
  const params: THREE.MeshStandardMaterialParameters = { color, roughness: rough, metalness: extra?.metal ?? 0 }
  if (extra?.emissive) { params.emissive = new THREE.Color(extra.emissive); params.emissiveIntensity = extra.ei ?? 1 }
  return new THREE.MeshStandardMaterial(params)
}

const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
  const me = new THREE.Mesh(geo, m)
  me.position.set(x, y, z); me.scale.set(sx, sy, sz); me.rotation.set(rx, ry, rz)
  return me
}

const SPH = (r: number, w = 12, h = 10) => new THREE.SphereGeometry(r, w, h)
const BOX = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const CYL = (rt: number, rb: number, h: number, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s)
const CONE = (r: number, h: number, s = 10) => new THREE.ConeGeometry(r, h, s)
const TOR = (r: number, t: number, s = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 8, s, arc)
const HSPH = (r: number) => new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2)

// ---- HAIR (skull-measured wrap; male head-local: cranium |x|max 0.094 @ y .20–.30,
// back z −0.100, forehead z 0.121, crown y 0.377, brows 0.262–0.302, eyes 0.23–0.26,
// ears y 0.02–0.08. The old floating hemisphere @ y 0.30 read as a beret with the whole
// side/back skull bare — the shell must HUG the cranium and tuck inside the face front.) ----
function buildHair(id: string, color: string): THREE.Group | null {
  if (id === 'bald') return null
  const g = new THREE.Group()
  const c = mat(color, 0.92)
  // Three-piece wrap, puff widens side/back volume slightly (0.97 buzz … 1.05 full):
  //  1. cranium shell — pokes outside on top/sides/back, front surface stays INSIDE the face
  //  2. nape pad — carries the hair down the back of the head to the neck line
  //  3. forehead patch — fills the front-top hairline (emerges above y≈0.29, brows untouched)
  const wrap = (puff = 1) => {
    const h = new THREE.Group()
    h.add(mesh(SPH(0.104, 16, 12), c, 0, 0.285, -0.012, 1.06 * puff, 0.96, 1.1 * puff))
    h.add(mesh(SPH(0.06, 12, 10), c, 0, 0.185, -0.055, 1.5 * puff, 1.35, 0.75 * puff))
    h.add(mesh(SPH(0.104, 16, 12), c, 0, 0.315, 0.042, 1.06 * puff, 0.68, 0.865 * puff))
    return h
  }
  switch (id) {
    case 'buzz':
      g.add(wrap(0.97))
      break
    case 'mullet':
      g.add(wrap(), mesh(BOX(0.16, 0.16, 0.032), c, 0, 0.155, -0.093))
      break
    case 'spiky': {
      g.add(wrap(1.02))
      const cone = CONE(0.02, 0.055, 6)
      for (const [x, z] of [[0, 0.06], [0.05, 0.02], [-0.05, 0.02], [0.03, -0.05], [-0.03, -0.05]] as const)
        g.add(mesh(cone, c, x, 0.408, z))
      break
    }
    case 'bun':
      g.add(wrap(), mesh(SPH(0.048), c, 0, 0.42, -0.02))
      break
    case 'ponytail':
      g.add(wrap(), mesh(new THREE.CapsuleGeometry(0.03, 0.15, 4, 8), c, 0, 0.22, -0.135, 1, 1, 1, 0.55), mesh(SPH(0.033), c, 0, 0.08, -0.175))
      break
    case 'curly': {
      g.add(wrap())
      const s = SPH(0.042)
      for (const [x, y, z] of [[0, 0.405, 0.02], [0.095, 0.375, 0], [-0.095, 0.375, 0], [0.105, 0.315, -0.05], [-0.105, 0.315, -0.05], [0, 0.36, -0.125], [0.06, 0.395, -0.075], [-0.06, 0.395, -0.075]] as const)
        g.add(mesh(s, c, x, y, z))
      break
    }
    case 'long':
      g.add(wrap(), mesh(BOX(0.17, 0.32, 0.035), c, 0, 0.16, -0.115), mesh(BOX(0.035, 0.22, 0.045), c, 0.104, 0.19, 0.005), mesh(BOX(0.035, 0.22, 0.045), c, -0.104, 0.19, 0.005))
      break
    case 'braid': {
      g.add(wrap())
      const s = SPH(0.027)
      for (let i = 0; i < 4; i++) g.add(mesh(s, c, 0.088, 0.27 - i * 0.075, -0.095 - i * 0.012))
      break
    }
    case 'afro':
      g.add(mesh(SPH(0.165, 14, 12), c, 0, 0.365, -0.012, 1, 0.92, 1))
      break
    default: // 'default' — Classic Cut: wrap + fringe peeking over the brow (eyes ~y 0.25–0.27 stay clear)
      g.add(wrap(), mesh(BOX(0.19, 0.036, 0.024), c, 0, 0.303, 0.106, 1, 1, 1, -0.22))
  }
  return g
}

// ---- HATS (head-top ~+0.34, brim forward +z) ----
function buildHat(id: string): THREE.Group | null {
  if (id === 'none') return null
  const g = new THREE.Group()
  switch (id) {
    case 'cap': {
      const c = mat('#2e6e4e')
      g.add(mesh(HSPH(0.122), c, 0, 0.318, 0, 1, 0.78, 1.02), mesh(CYL(0.105, 0.105, 0.012, 14), c, 0, 0.302, 0.118, 1, 1, 1.35))
      break
    }
    case 'topi': {
      const c = mat('#1c1a17', 0.7)
      g.add(mesh(CYL(0.112, 0.118, 0.10, 14), c, 0, 0.395, 0), mesh(CYL(0.158, 0.158, 0.014, 16), mat('#2a2622', 0.7), 0, 0.345, 0))
      break
    }
    case 'garland': {
      g.add(mesh(TOR(0.122, 0.024, 16), mat('#e8912e', 0.8), 0, 0.292, 0.01, 1, 1, 1, Math.PI / 2))
      const f = SPH(0.021)
      const y = mat('#f2c14e', 0.8)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        g.add(mesh(f, i % 2 ? y : mat('#f5efdc', 0.8), Math.sin(a) * 0.122, 0.292, Math.cos(a) * 0.122 + 0.01))
      }
      break
    }
    case 'cone': {
      g.add(mesh(CONE(0.125, 0.30, 12), mat('#f28c28', 0.7), 0, 0.475, 0), mesh(TOR(0.075, 0.014, 12), mat('#f5efdc', 0.7), 0, 0.435, 0, 1, 1, 1, Math.PI / 2))
      break
    }
    case 'crown': {
      const gold = mat('#d4a017', 0.35, { metal: 0.7 })
      g.add(mesh(CYL(0.115, 0.115, 0.075, 14), gold, 0, 0.412, 0))
      const sp = CONE(0.018, 0.05, 6)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        g.add(mesh(sp, gold, Math.sin(a) * 0.112, 0.47, Math.cos(a) * 0.112))
      }
      g.add(mesh(SPH(0.018), mat('#c23b2e', 0.4), 0, 0.43, 0.115))
      break
    }
    case 'bandana':
      g.add(mesh(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, 0.95), mat('#c23b2e', 0.85), 0, 0.312, 0, 1.02, 1, 1.04), mesh(BOX(0.035, 0.035, 0.028), mat('#c23b2e', 0.85), 0, 0.30, -0.122))
      break
    case 'hardhat':
      g.add(mesh(HSPH(0.132), mat('#f2c14e', 0.55), 0, 0.322, 0, 1, 0.82, 1.05), mesh(TOR(0.132, 0.018, 16), mat('#f2c14e', 0.55), 0, 0.318, 0, 1, 1, 1.06, Math.PI / 2), mesh(BOX(0.03, 0.045, 0.17), mat('#e8b23a', 0.55), 0, 0.44, 0.02))
      break
  }
  return g
}

// ---- FACE (on the face surface; eyes at local +0.23, chin +0.02, front z≈0.12) ----
function buildFace(id: string): THREE.Group | null {
  if (id === 'clean') return null
  const g = new THREE.Group()
  switch (id) {
    case 'beard':
      // rounded chin pad (flattened sphere) hugs the jaw curvature better than a slab
      g.add(mesh(SPH(0.062, 12, 10), mat('#3a2a1c', 0.95), 0, 0.032, 0.088, 1.02, 0.9, 0.55), mesh(BOX(0.085, 0.02, 0.02), mat('#3a2a1c', 0.95), 0, 0.163, 0.122))
      break
    case 'moustache':
      g.add(mesh(BOX(0.085, 0.022, 0.02), mat('#2a1e14', 0.95), 0, 0.163, 0.122))
      break
    case 'warpaint': {
      const stripes: [string, number][] = [['#f5efdc', 0.252], ['#c23b2e', 0.278], ['#f5efdc', 0.304]]
      for (const [col, y] of stripes) g.add(mesh(BOX(0.11, 0.014, 0.012), mat(col, 0.8), 0, y, 0.104))
      break
    }
    case 'scar':
      g.add(mesh(BOX(0.008, 0.055, 0.012), mat('#b3766a', 0.9), 0.05, 0.16, 0.116, 1, 1, 1, 0, 0, 0.2))
      break
  }
  return g
}

// ---- GLASSES (eyes ±0.042, local y +0.225, front z 0.11) ----
function buildGlasses(): THREE.Group {
  const g = new THREE.Group()
  const rim = mat('#22201c', 0.5, { metal: 0.4 })
  g.add(mesh(TOR(0.033, 0.005, 12), rim, 0.043, 0.225, 0.108), mesh(TOR(0.033, 0.005, 12), rim, -0.043, 0.225, 0.108), mesh(BOX(0.022, 0.006, 0.01), rim, 0, 0.228, 0.114), mesh(BOX(0.012, 0.006, 0.09), rim, 0.098, 0.226, 0.06, 1, 1, 1, 0, 0.25), mesh(BOX(0.012, 0.006, 0.09), rim, -0.098, 0.226, 0.06, 1, 1, 1, 0, -0.25))
  return g
}

// ---- FOOTWEAR (foot-local: sole at y −0.06, toe +z, foot z −0.09..+0.12) ----
function buildFootwear(id: string, tint: string): THREE.Group | null {
  const g = new THREE.Group()
  switch (id) {
    case 'boots': {
      const c = mat(tint, 0.8)
      g.add(mesh(BOX(0.10, 0.17, 0.105), c, 0, 0.02, -0.015), mesh(BOX(0.095, 0.05, 0.21), c, 0, -0.035, 0.03), mesh(BOX(0.102, 0.018, 0.215), mat('#3a2a1c', 0.85), 0, -0.052, 0.03))
      break
    }
    case 'chappal': {
      const c = mat(tint, 0.85)
      g.add(mesh(BOX(0.095, 0.014, 0.20), c, 0, -0.053, 0.03), mesh(BOX(0.012, 0.008, 0.09), mat('#6b3f24', 0.85), 0.022, -0.045, 0.065, 1, 1, 1, 0, 0.45), mesh(BOX(0.012, 0.008, 0.09), mat('#6b3f24', 0.85), -0.022, -0.045, 0.065, 1, 1, 1, 0, -0.45), mesh(BOX(0.028, 0.012, 0.02), mat('#6b3f24', 0.85), 0, -0.044, 0.105))
      break
    }
    case 'glow': {
      g.add(mesh(BOX(0.095, 0.05, 0.21), mat(tint, 0.7), 0, -0.035, 0.03), mesh(BOX(0.10, 0.02, 0.215), mat('#181c24', 0.5, { emissive: '#39d0ff', ei: 0.9 }), 0, -0.052, 0.03))
      break
    }
    default: { // 'shoes' — clean sneakers
      const c = mat(tint, 0.8)
      g.add(mesh(BOX(0.095, 0.05, 0.21), c, 0, -0.035, 0.03), mesh(BOX(0.102, 0.018, 0.215), mat('#c9c2ae', 0.9), 0, -0.052, 0.03), mesh(BOX(0.096, 0.02, 0.06), mat('#c23b2e', 0.8), 0, -0.022, -0.06))
    }
  }
  return g
}

// ---- BACK GEAR (torso-local: back z −0.14, mid-back y +0.35) ----
function buildGear(id: string): THREE.Group | null {
  if (id === 'none') return null
  const g = new THREE.Group()
  switch (id) {
    case 'backpack': {
      const c = mat('#4a6741', 0.85)
      g.add(mesh(BOX(0.26, 0.30, 0.13), c, 0, 0.42, -0.155), mesh(BOX(0.26, 0.10, 0.02), mat('#3a5634', 0.85), 0, 0.50, -0.225), mesh(BOX(0.035, 0.30, 0.02), c, 0.07, 0.47, -0.075, 1, 1, 1, 0.1), mesh(BOX(0.035, 0.30, 0.02), c, -0.07, 0.47, -0.075, 1, 1, 1, 0.1))
      break
    }
    case 'jhola':
      g.add(mesh(BOX(0.16, 0.17, 0.07), mat('#c9b98a', 0.9), -0.235, 0.32, 0), mesh(BOX(0.02, 0.30, 0.02), mat('#a89058', 0.9), -0.165, 0.53, 0, 1, 1, 1, 0, 0, 0.32))
      break
    case 'bannerroll':
      g.add(mesh(CYL(0.05, 0.05, 0.42, 10), mat('#f5efdc', 0.9), 0, 0.48, -0.16, 1, 1, 1, 0, 0, Math.PI / 2), mesh(BOX(0.05, 0.3, 0.02), mat('#8c1f28', 0.9), 0, 0.48, -0.225, 1, 1, 1, 0, 0, Math.PI / 2))
      break
    case 'dhol': {
      g.add(mesh(CYL(0.135, 0.135, 0.26, 14), mat('#8a5a34', 0.85), 0, 0.40, -0.19, 1, 1, 1, Math.PI / 2), mesh(TOR(0.135, 0.012, 14), mat('#c9b98a', 0.85), 0, 0.40, -0.062), mesh(TOR(0.135, 0.012, 14), mat('#c9b98a', 0.85), 0, 0.40, -0.318))
      break
    }
    case 'umbrella':
      g.add(mesh(CYL(0.026, 0.026, 0.55, 8), mat('#2e6e4e', 0.8), 0.05, 0.42, -0.155, 1, 1, 1, 0, 0, 0.35), mesh(TOR(0.045, 0.008, 8, Math.PI), mat('#3a3f46', 0.8), 0.145, 0.13, -0.155, 1, 1, 1, 0, Math.PI / 2, 1.2))
      break
  }
  return g
}

// ---- HELD ITEMS (hand-local: palm at −0.06, pole along local Y = world up at rest) ----
function makeSloganTexture(text: string, wide: boolean): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = wide ? 512 : 256
  canvas.height = wide ? 192 : 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#f5efdc'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#1c1a17'
  ctx.lineWidth = 8
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8)
  ctx.fillStyle = '#8c1f28'
  ctx.font = `black ${wide ? 44 : 34}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const t = (text || 'VOTE CHOR!').toUpperCase()
  if (wide && t.length > 14) {
    const mid = Math.ceil(t.length / 2)
    ctx.fillText(t.slice(0, mid), canvas.width / 2, canvas.height / 2 - 26)
    ctx.fillText(t.slice(mid), canvas.width / 2, canvas.height / 2 + 26)
  } else {
    ctx.fillText(t, canvas.width / 2, canvas.height / 2, canvas.width - 24)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function buildHeld(id: string, signText: string): THREE.Group | null {
  if (id === 'none') return null
  const g = new THREE.Group()
  const wood = mat('#6b4a2e', 0.85)
  switch (id) {
    case 'sign': {
      g.add(mesh(CYL(0.012, 0.012, 0.75, 8), wood, 0, 0.10, 0.01), mesh(BOX(0.36, 0.24, 0.016), mat('#e8dcc0', 0.9), 0, 0.48, 0.012))
      const tex = makeSloganTexture(signText, false)
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.21), tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }) : mat('#f5efdc', 0.9))
      face.position.set(0, 0.48, 0.021)
      g.add(face)
      break
    }
    case 'banner': {
      g.add(mesh(CYL(0.011, 0.011, 0.95, 8), wood, 0, 0.16, 0))
      const tex = makeSloganTexture(signText, true)
      const clothMat = tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }) : mat('#f5efdc', 0.9)
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24), clothMat)
      cloth.position.set(0.09, 0.60, 0)
      g.add(cloth)
      break
    }
    case 'flag':
      g.add(mesh(CYL(0.010, 0.010, 0.85, 8), wood, 0, 0.14, 0), mesh(new THREE.PlaneGeometry(0.26, 0.16), mat('#c23b2e', 0.85), 0.135, 0.72, 0, 1, 1, 1, 0, -Math.PI / 2))
      break
    case 'bat':
      g.add(mesh(CYL(0.032, 0.020, 0.58, 10), mat('#c9955c', 0.75), 0, 0.16, 0))
      break
    case 'lathi':
      g.add(mesh(CYL(0.016, 0.014, 0.80, 8), mat('#4a3626', 0.8), 0, 0.18, 0))
      break
    case 'shoppingbag': {
      const c = mat('#d9c8b4', 0.9)
      g.add(mesh(BOX(0.17, 0.20, 0.09), c, 0, -0.20, 0.02), mesh(TOR(0.035, 0.006, 10, Math.PI), mat('#b8a888', 0.9), 0.045, -0.10, 0.02), mesh(TOR(0.035, 0.006, 10, Math.PI), mat('#b8a888', 0.9), -0.045, -0.10, 0.02))
      break
    }
    case 'megaphone':
      g.add(mesh(CONE(0.075, 0.18, 12), mat('#f2c14e', 0.6), 0, 0.02, 0.13, 1, 1, 1, Math.PI / 2), mesh(CYL(0.028, 0.028, 0.08, 10), mat('#8c1f28', 0.6), 0, 0.02, 0.02, 1, 1, 1, Math.PI / 2), mesh(BOX(0.02, 0.08, 0.03), mat('#3a3f46', 0.7), 0, -0.05, 0.05))
      break
  }
  return g
}

function attachTo(bone: THREE.Object3D | null, built: THREE.Group | null, fit: number, offset?: [number, number, number]) {
  if (!bone || !built) return
  built.userData.vcCosmetic = true
  built.scale.multiplyScalar(fit)
  if (offset) built.position.set(offset[0], offset[1], offset[2])
  bone.add(built)
}

// ---------- the single entry point ----------
/**
 * Apply the full cosmetic look to a High-Fi GLB instance. Idempotent per group:
 * previous tint clones are discarded via the pristine map and previous
 * attachments (userData.vcCosmetic) are removed + disposed first.
 */
export function applyAvatarLook(group: THREE.Object3D, look: AvatarLook) {
  // 0. remove previous attachments
  const doomed: THREE.Object3D[] = []
  group.traverse((o) => { if ((o.userData as { vcCosmetic?: boolean } | undefined)?.vcCosmetic) doomed.push(o) })
  for (const d of doomed) { d.parent?.remove(d); disposeObject(d) }

  // 1. tint (normalized multiply on the textured family, solid replace on the rigged one)
  tintGroup(group, look.palette)

  // 2. body build scale (visual only — collision untouched)
  const bs = look.build === 'slim' ? [0.94, 1, 0.94] : look.build === 'sturdy' ? [1.06, 1.02, 1.06] : [1, 1, 1]
  group.scale.set(bs[0], bs[1], bs[2])

  // 3. female puppet's own static hair meshes: hidden unless the style is 'default'
  const female = look.gender === 'female'
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && (m.name === 'Hair' || m.name === 'Ponytail')) m.visible = look.hair === 'default'
  })

  // 4. bone attachments
  const bone = (names: string[]) => names.map((n) => group.getObjectByName(n)).find(Boolean) ?? null
  const hairColor = look.palette.hairColor ?? '#191512'
  const headSpec = female ? FEMALE_HEAD : { names: ['Head'], fit: 1 }
  const head = bone(headSpec.names)
  attachTo(head, buildHair(look.hair, hairColor), headSpec.fit)
  if (look.hat !== 'none') attachTo(head, buildHat(look.hat), headSpec.fit)
  if (look.face !== 'clean') attachTo(head, buildFace(look.face), headSpec.fit)
  if (look.glasses) attachTo(head, buildGlasses(), headSpec.fit)
  // held item
  const heldSpec = female ? FEMALE_HELD : { names: ['HandR'], fit: 1 }
  attachTo(bone(heldSpec.names), buildHeld(look.held, look.signText ?? ''), heldSpec.fit, heldSpec.fallbackOffset)
  // footwear (mirrored — the two foot bones share the same local space; the
  // female puppet has no Foot bones so LegL/LegR stand in with a foot-level offset)
  const footFit = female ? 0.62 : 1
  const footOffset = female ? ([0, -0.86, 0.03] as [number, number, number]) : undefined
  attachTo(bone(female ? ['FootL', 'LegL'] : ['FootL']), buildFootwear(look.footwear, look.palette.shoes ?? '#e8e4d8'), footFit, footOffset)
  attachTo(bone(female ? ['FootR', 'LegR'] : ['FootR']), buildFootwear(look.footwear, look.palette.shoes ?? '#e8e4d8'), footFit, footOffset)
  // back gear
  const gearSpec = female ? FEMALE_GEAR : { names: ['Torso'], fit: 1 }
  attachTo(bone(gearSpec.names), buildGear(look.gear), gearSpec.fit)
}
