// VoteChor procedural character rig — stylized low-poly humanoids with
// procedural animation (walk/run/jump/slide/dazed/celebrate/emotes).
// Shared geometry cache for performance; used for players, NPCs, crowd, and the boss.
import * as THREE from 'three'
import type { AnimName } from './shared/types'
import { archetypeById } from './shared/constants'

const G = {
  head: new THREE.SphereGeometry(0.155, 10, 8),
  torso: new THREE.BoxGeometry(0.42, 0.52, 0.24),
  hips: new THREE.BoxGeometry(0.36, 0.16, 0.22),
  arm: new THREE.BoxGeometry(0.11, 0.46, 0.11),
  leg: new THREE.BoxGeometry(0.14, 0.5, 0.15),
  hand: new THREE.SphereGeometry(0.06, 6, 5),
  foot: new THREE.BoxGeometry(0.15, 0.09, 0.26),
  hair: new THREE.SphereGeometry(0.163, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.9),
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
  // ---- wardrobe expansion slots (default when omitted) ----
  face?: string     // 'clean' | 'beard' | 'moustache' | 'warpaint' | 'scar'
  outfit?: string   // 'classic' | 'kurta' | 'hoodie' | 'highvis'
  footwear?: string // 'shoes' | 'boots' | 'chappal' | 'glow'
  gear?: string     // 'none' | 'backpack' | 'jhola' | 'bannerroll' | 'dhol' | 'umbrella'
  held?: string     // 'none' | 'sign' | 'banner' | 'flag' | 'bat' | 'lathi' | 'shoppingbag' | 'megaphone'
}

function mat(color: string, flat = true): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, flatShading: flat })
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
    const hair = mat(colors.hair)

    // hierarchy: group -> torsoPivot (contains torso, head, arms) ; legs on group
    this.group.add(this.torsoPivot)
    this.torsoPivot.position.y = 0.98

    const torso = new THREE.Mesh(G.torso, shirt)
    torso.position.y = 0.26
    torso.castShadow = true
    this.torsoPivot.add(torso)

    // accent stripe (protest sash)
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.54, 0.26), mat(colors.accent))
    sash.position.set(0.06, 0.26, 0.02)
    sash.rotation.z = 0.4
    this.torsoPivot.add(sash)

    // head
    this.headPivot.position.y = 0.62
    this.torsoPivot.add(this.headPivot)
    const head = new THREE.Mesh(G.head, skin)
    head.position.y = 0.1
    head.castShadow = true
    this.headPivot.add(head)
    const hairMesh = new THREE.Mesh(G.hair, hair)
    hairMesh.position.y = 0.13
    this.headPivot.add(hairMesh)

    if (opts.hat === 'cap' || opts.npcType) {
      const cap = new THREE.Mesh(G.cap, opts.npcType ? mat('#1f3a2e') : mat(colors.accent))
      cap.position.y = 0.17
      this.headPivot.add(cap)
      const brim = new THREE.Mesh(G.capBrim, mat('#14251c'))
      brim.position.set(0, 0.17, 0.16)
      this.headPivot.add(brim)
    } else if (opts.hat === 'topi') {
      const hat = new THREE.Mesh(G.hat, mat('#f0e6d2'))
      hat.position.y = 0.24
      this.headPivot.add(hat)
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
    }

    // arms — pivot at shoulder
    this.armL.position.set(0.265, 0.46, 0)
    this.armR.position.set(-0.265, 0.46, 0)
    for (const [arm, side] of [[this.armL, 1], [this.armR, -1]] as const) {
      const upper = new THREE.Mesh(G.arm, shirt)
      upper.position.y = -0.2
      upper.castShadow = true
      arm.add(upper)
      const hand = new THREE.Mesh(G.hand, skin)
      hand.position.y = -0.46
      arm.add(hand)
      this.torsoPivot.add(arm)
      void side
    }

    // legs — pivot at hip on group (footwear slot swaps the shoe build)
    const footwearSlot = opts.footwear ?? 'shoes'
    const buildFoot = (): THREE.Group => {
      const fg = new THREE.Group()
      if (footwearSlot === 'boots') {
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.17), mat('#4a3626'))
        shaft.position.set(0, -0.46, 0)
        const foot = new THREE.Mesh(G.foot, mat('#3a2a1c'))
        foot.position.set(0, -0.53, 0.05)
        fg.add(shaft, foot)
      } else if (footwearSlot === 'chappal') {
        const sole = new THREE.Mesh(G.chappal, mat('#7a4a2c'))
        sole.position.set(0, -0.54, 0.03)
        const toe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), mat('#5c3820'))
        toe.position.set(0, -0.51, 0.12)
        fg.add(sole, toe)
      } else {
        const foot = new THREE.Mesh(G.foot, footwearSlot === 'glow' ? new THREE.MeshStandardMaterial({ color: '#2c2f38', emissive: '#39d0ff', emissiveIntensity: 0.9, roughness: 0.6 }) : mat('#3a2d22'))
        foot.position.set(0, -0.52, 0.04)
        if (footwearSlot === 'glow') {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.06), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#39d0ff', emissiveIntensity: 1.2 }))
          stripe.position.set(0, -0.55, 0.04)
          fg.add(stripe)
        }
        fg.add(foot)
      }
      return fg
    }
    this.legL.position.set(0.1, 0.9, 0)
    this.legR.position.set(-0.1, 0.9, 0)
    for (const leg of [this.legL, this.legR]) {
      const upper = new THREE.Mesh(G.leg, pants)
      upper.position.y = -0.25
      upper.castShadow = true
      leg.add(upper)
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
    } else if (gearSlot === 'jhola') {
      const strap = new THREE.Mesh(G.strap, mat('#8a6b4a'))
      strap.position.set(0.08, 0.24, 0.13)
      strap.rotation.z = 0.55
      this.torsoPivot.add(strap)
      const bag = new THREE.Mesh(G.sideBag, mat('#c9b98a'))
      bag.position.set(-0.26, -0.06, 0.04)
      bag.castShadow = true
      this.torsoPivot.add(bag)
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
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
    sp.scale.set(1.9, 0.48, 1)
    return sp
  }

  setAlert(v: boolean) { if (this.alertIndicator) this.alertIndicator.visible = v }

  /** Procedural double-jump flourish — a quick front-flip of the torso (no assets). */
  flip() {
    this.flipTimer = this.flipDur
  }
  setNameVisible(v: boolean) { if (this.nameSprite) this.nameSprite.visible = v }
  /** Rebuild the name sprite with a new color (squadmates get green tags). */
  setNameColor(name: string, color: string) {
    if (!this.nameSprite || this.nameSprite.userData.color === color) return
    this.nameSprite.userData.color = color
    const rebuilt = this.makeNameSprite(name, color)
    rebuilt.position.copy(this.nameSprite.position)
    const group = this.nameSprite.parent
    if (group) {
      group.remove(this.nameSprite)
      group.add(rebuilt)
    }
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
