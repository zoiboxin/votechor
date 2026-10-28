'use client'

// Live WebGL wardrobe preview — renders the ACTUAL in-game body on a slow
// turntable so what you see is exactly what other protesters will see.
// v112 CARTOON REBUILD: the GLB body pipeline is retired — the preview always
// renders the procedural CharacterRig (the same rig the game uses), styled by
// the full wardrobe.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { CharacterRig } from '@/game/character'
import { archetypeById } from '@/game/shared/constants'
import { policeUniformColors } from '@/lib/cosmetics'

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

export default function CharacterPreview({ look, className }: { look: PreviewLook; className?: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const lookRef = useRef(look)
  const rebuildRef = useRef<(() => void) | null>(null)
  const toggleViewRef = useRef<(() => void) | null>(null)
  const [faceView, setFaceView] = useState(false)
  // head height (world m) for the Face Check camera — re-measured on every body build
  const headHeightRef = useRef(1.7)
  // body scale factor for the face-camera distance (archetypes scale the whole rig)
  const headDistRef = useRef(1)

  // keep the latest look readable inside effects (no render-phase ref writes)
  useEffect(() => {
    lookRef.current = look
  })

  // mount once: renderer, lights, pedestal, turntable loop
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
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

    // camera presets: full-body fit check + close-up face check (round 23).
    // camFace is re-targeted to the body's actual head height on every rebuild —
    // archetypes scale the whole rig.
    const camFull = { pos: new THREE.Vector3(0.55, 1.35, 2.9), look: new THREE.Vector3(0, 0.95, 0) }
    const camFace = { pos: new THREE.Vector3(0.28, 1.72, 1.18), look: new THREE.Vector3(0, 1.66, 0) }
    const retargetFaceCam = () => {
      const headY = headHeightRef.current
      const s = headDistRef.current
      camFace.look.set(0, headY - 0.01, 0)
      camFace.pos.set(0.24 * s, headY + 0.1, 1.34 * s)
    }
    const camPos = camFull.pos.clone()
    const camLook = camFull.look.clone()
    let faceMode = false

    const buildRig = () => {
      // tear down whatever is on the pedestal
      if (rig) {
        stage.remove(rig.group)
        disposeRig(rig)
        rig = null
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
      headHeightRef.current = 1.7 * (rig.group.scale.y || 1)
      headDistRef.current = rig.group.scale.y || 1
      retargetFaceCam()
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
      rig?.update(dt, 'idle', 0)
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
      if (rig) disposeRig(rig)
      pedestal.geometry.dispose()
      ;(pedestal.material as THREE.Material).dispose()
      ring.geometry.dispose()
      ;(ring.material as THREE.Material).dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  // swap the body whenever the look changes (renderer stays alive)
  useEffect(() => {
    rebuildRef.current?.()
  }, [look])

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={mountRef} className="h-full w-full" aria-label="Live 3D character preview" role="img" />
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
