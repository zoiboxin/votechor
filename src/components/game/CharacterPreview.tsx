'use client'

// Live WebGL wardrobe preview — renders the character you will ACTUALLY play as:
//  - High-Fi mode (settings.hiFiModel, protector role): the textured avatar GLB
//    the game spawns, palette-tinted exactly like the in-game pipeline
//    (applyAvatarPalette) and kept alive with the same GlbLocoFallback idle the
//    match uses (breathing sway/bob) — what you see is what you play.
//  - Classic mode (or police): the procedural CharacterRig with the full
//    wardrobe (hat / hair / face / outfit / gear / held) as before.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { CharacterRig } from '@/game/character'
import { archetypeById } from '@/game/shared/constants'
import { policeUniformColors } from '@/lib/cosmetics'
import { sharedGLBAssets, hiFiUrlFor, type GLBInstance } from '@/game/glb'
import { GlbLocoFallback, GLBAnimDriver } from '@/game/anim'
import { applyAvatarLook, resolveAvatarLook } from '@/game/avatar-look'

export interface PreviewLook {
  archetype: string
  hat: string
  glasses: boolean
  face: string
  build: string
  outfit: string
  footwear: string
  gear: string
  held: string
  signText: string
  skinTone?: string
  gender: 'male' | 'female'
  hair: string
  /** when true the preview renders the OFFICER look (uniform + headgear + lathi) */
  police?: boolean
  policeOutfit?: string
  policeHat?: string
}

function disposeRig(rig: CharacterRig) {
  rig.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.Material | THREE.Material[]
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m.dispose()
    }
  })
}

const glbUrlFor = (gender: 'male' | 'female') => hiFiUrlFor(gender)

export default function CharacterPreview({ look, className, hiFi = false }: { look: PreviewLook; className?: string; hiFi?: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const lookRef = useRef(look)
  const hiFiRef = useRef(hiFi)
  const rebuildRef = useRef<(() => void) | null>(null)
  const toggleViewRef = useRef<(() => void) | null>(null)
  const [faceView, setFaceView] = useState(false)
  const [glbLoading, setGlbLoading] = useState(false)
  const [glbActive, setGlbActive] = useState(false)

  // keep the latest look/hifi readable inside effects (no render-phase ref writes)
  useEffect(() => {
    lookRef.current = look
  })
  useEffect(() => {
    hiFiRef.current = hiFi
  })

  // mount once: renderer, lights, pedestal, turntable loop
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.cursor = 'grab'
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30)
    camera.position.set(0.55, 1.35, 2.9)
    camera.lookAt(0, 0.95, 0)

    // soft studio lighting (warm key + cool rim, echoing the game's afternoon sun)
    scene.add(new THREE.HemisphereLight(0xfff3dd, 0xc4a37a, 1.05))
    const key = new THREE.DirectionalLight(0xffe0b0, 2.0)
    key.position.set(2.2, 3.4, 2.6)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xb4c6f0, 0.7)
    rim.position.set(-2.4, 2.2, -2.2)
    scene.add(rim)

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.78, 0.9, 0.12, 28),
      new THREE.MeshStandardMaterial({ color: '#efe6c8', roughness: 0.95 }),
    )
    pedestal.position.y = -0.06
    scene.add(pedestal)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.028, 8, 40),
      new THREE.MeshStandardMaterial({ color: '#8c1f28', roughness: 0.6 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.01
    scene.add(ring)

    const stage = new THREE.Group()
    scene.add(stage)

    let rig: CharacterRig | null = null
    // High-Fi GLB instance + its animation layers (built async from the shared cache).
    // v54: rigged (clipped) models play real skeletal animation through GLBAnimDriver;
    // clip-less models keep the GlbLocoFallback procedural layer.
    let glb: { inst: GLBInstance; loco: GlbLocoFallback; driver: GLBAnimDriver | null } | null = null
    let glbKind: 'male' | 'female' | null = null
    let loadSeq = 0 // stale-load guard (gender flips / setting flips mid-download)

    const isHiFi = () => hiFiRef.current && !lookRef.current.police

    // camera presets: full-body fit check + close-up face check (round 23).
    // The High-Fi avatar stands ~1.96 m tall with its head at 1.58..1.96 (the
    // procedural rig's face cam re-targets off rig scale), so each mode owns
    // its own framing and the loop eases between them.
    const camFull = { pos: new THREE.Vector3(0.55, 1.35, 2.9), look: new THREE.Vector3(0, 0.95, 0) }
    const camFace = { pos: new THREE.Vector3(0.28, 1.72, 1.18), look: new THREE.Vector3(0, 1.66, 0) }
    const camPos = camFull.pos.clone()
    const camLook = camFull.look.clone()
    let faceMode = false
    const retargetCams = () => {
      if (glb && isHiFi()) {
        camFull.pos.set(0.55, 1.45, 3.15)
        camFull.look.set(0, 0.98, 0)
        camFace.pos.set(0.22, 1.92, 1.14)
        camFace.look.set(0, 1.78, 0)
      } else {
        camFull.pos.set(0.55, 1.35, 2.9)
        camFull.look.set(0, 0.95, 0)
        const s = rig?.group.scale.y || 1
        const headY = 1.7 * s
        camFace.look.set(0, headY - 0.01, 0)
        camFace.pos.set(0.24 * s, headY + 0.1, 1.34 * s)
      }
    }

    const showGlb = () => {
      const active = !!(glb && isHiFi())
      if (rig) rig.group.visible = !active
      if (glb) glb.inst.group.visible = active
      setGlbActive(active)
    }

    const disposeGlb = () => {
      if (!glb) return
      stage.remove(glb.inst.group)
      sharedGLBAssets.disposeInstance(glb.inst)
      glb.loco.dispose()
      glb = null
      glbKind = null
    }

    /** (Re)build the High-Fi instance from the shared cache — never blocks, never throws. */
    const ensureGlb = () => {
      const want = isHiFi()
      const gender = lookRef.current.gender
      if (!want) {
        loadSeq++ // invalidate any in-flight load
        disposeGlb()
        showGlb()
        setGlbLoading(false)
        return
      }
      if (glb && glbKind === gender) {
        showGlb() // palette refresh happens in buildRig
        return
      }
      const seq = ++loadSeq
      setGlbLoading(true)
      void sharedGLBAssets
        .load(glbUrlFor(gender))
        .then((asset) => {
          if (seq !== loadSeq) return // superseded mid-download
          setGlbLoading(false)
          if (!asset) return // loader logged the reason; procedural rig stays
          disposeGlb()
          const inst = sharedGLBAssets.instantiate(asset)
          if (!inst) return
          const loco = new GlbLocoFallback()
          loco.patch(inst.group)
          // ONE look pipeline with the in-game model: normalized tint + bone
          // attachments (hair/hat/face/footwear/gear/held/glasses) — the exact
          // AvatarLook the match will resolve for this profile
          applyAvatarLook(inst.group, resolveAvatarLook(lookRef.current, lookRef.current.archetype, lookRef.current.police ? 'police' : 'protector'))
          // rigged asset → play the authored idle clip (real skeletal animation);
          // clip-less asset → the procedural idle layer keeps it alive
          let driver: GLBAnimDriver | null = null
          if (inst.clips.size > 0) {
            driver = new GLBAnimDriver(inst.mixer, inst.clips)
            driver.snap('idle')
          }
          inst.group.visible = false
          stage.add(inst.group)
          glb = { inst, loco, driver }
          glbKind = gender
          showGlb()
          retargetCams()
        })
        .catch(() => {
          if (seq === loadSeq) setGlbLoading(false)
        })
    }

    const buildRig = () => {
      if (rig) {
        stage.remove(rig.group)
        disposeRig(rig)
      }
      const l = lookRef.current
      const colors = { ...archetypeById(l.archetype).colors }
      if (l.skinTone) colors.skin = l.skinTone
      if (l.police) {
        // mirror the in-game officer look exactly (game.ts startMatch)
        const u = policeUniformColors(l.policeOutfit)
        colors.shirt = u.shirt
        colors.pants = u.pants
        colors.accent = u.accent
      }
      rig = new CharacterRig({
        archetype: l.archetype,
        colors,
        hat: l.hat,
        glasses: l.glasses,
        signText: l.police ? undefined : l.signText,
        face: l.face,
        build: l.build,
        outfit: l.police ? undefined : l.outfit,
        footwear: l.footwear,
        gear: l.police ? 'none' : l.gear,
        held: l.police ? undefined : l.held,
        gender: l.gender,
        hair: l.hair,
        ...(l.police ? { npcType: 'police' as const, policeOutfit: l.policeOutfit, policeHat: l.policeHat } : {}),
      })
      stage.add(rig.group)
      // High-Fi look refresh on an already-built GLB (any wardrobe slot change)
      if (glb) applyAvatarLook(glb.inst.group, resolveAvatarLook(l, l.archetype, l.police ? 'police' : 'protector'))
      retargetCams()
      ensureGlb()
    }
    buildRig()
    rebuildRef.current = buildRig
    toggleViewRef.current = () => {
      faceMode = !faceMode
      setFaceView(faceMode)
    }

    // turntable + drag-to-rotate
    let spin = 0.55
    let dragging = false
    let lastX = 0
    const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; renderer.domElement.style.cursor = 'grabbing' }
    const onMove = (e: PointerEvent) => { if (dragging) { spin += (e.clientX - lastX) * 0.012; lastX = e.clientX } }
    const onUp = () => { dragging = false; renderer.domElement.style.cursor = 'grab' }
    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    const resize = () => {
      const w = mount.clientWidth || 260
      const h = mount.clientHeight || 300
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    let last = performance.now()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!dragging) {
        if (faceMode) {
          // Face Check: ease the turntable to the nearest front-facing angle and
          // hold it there, so the close-up actually shows the face (not the ponytail)
          const front = Math.round(spin / (Math.PI * 2)) * Math.PI * 2
          spin += (front - spin) * Math.min(1, dt * 5)
        } else {
          spin += dt * 0.45
        }
      }
      stage.rotation.y = spin
      const glbOn = !!(glb && isHiFi())
      if (glbOn && glb) {
        if (glb.driver) {
          // authored skeletal animation (mixer drives the bones, not the group)
          glb.driver.update(dt)
          // the double-jump flip rides on top of clip animation when triggered
          glb.loco.applyFlipOnly(glb.inst.group, dt)
        } else {
          // clip-less fallback: procedural idle layer. baseY: 0 = the pedestal
          // top; apply() writes position.y ABSOLUTELY (v53) so the idle offset
          // can never accumulate into a float-up drift.
          glb.loco.apply(glb.inst.group, dt, 0, true, { baseY: 0 })
        }
      } else {
        rig?.update(dt, 'idle', 0)
      }
      const t = Math.min(1, dt * 6)
      camPos.lerp(faceMode ? camFace.pos : camFull.pos, t)
      camLook.lerp(faceMode ? camFace.look : camFull.look, t)
      camera.position.copy(camPos)
      camera.lookAt(camLook)
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      rebuildRef.current = null
      toggleViewRef.current = null
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      disposeGlb()
      if (rig) disposeRig(rig)
      pedestal.geometry.dispose()
      ;(pedestal.material as THREE.Material).dispose()
      ring.geometry.dispose()
      ;(ring.material as THREE.Material).dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  // swap the rig whenever the look changes (renderer stays alive)
  useEffect(() => {
    rebuildRef.current?.()
  }, [look])

  // react to the High-Fi toggle without waiting for a look change
  useEffect(() => {
    rebuildRef.current?.()
  }, [hiFi])

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={mountRef} className="h-full w-full" aria-label="Live 3D character preview" role="img" />
      {glbLoading && (
        <div className="absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-full border border-[#1c1a17]/40 bg-[#f5efdc]/90 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#1c1a17]/70">
            Loading High-Fi model…
          </span>
        </div>
      )}
      {glbActive && !glbLoading && (
        <div className="absolute right-2 top-2">
          <span className="rounded-full border border-[#2e6e4e]/60 bg-[#dcebe0]/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#2e6e4e]">
            High-Fi
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => toggleViewRef.current?.()}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-[#1c1a17]/80 bg-[#f5efdc]/95 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-[#1c1a17] shadow-[2px_2px_0_#1c1a17] transition-transform hover:-translate-y-0.5"
      >
        {faceView ? '🧍 Full Body' : '😀 Face Check'}
      </button>
    </div>
  )
}
