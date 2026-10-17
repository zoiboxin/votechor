'use client'

// Live WebGL wardrobe preview — renders the ACTUAL in-game CharacterRig on a slow
// turntable so what you see is exactly what other protesters will see.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CharacterRig } from '@/game/character'
import { archetypeById } from '@/game/shared/constants'

export interface PreviewLook {
  archetype: string
  hat: string
  glasses: boolean
  face: string
  outfit: string
  footwear: string
  gear: string
  held: string
  signText: string
  skinTone?: string
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

  // keep the latest look readable inside effects (no render-phase ref writes)
  useEffect(() => {
    lookRef.current = look
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
    const buildRig = () => {
      if (rig) {
        stage.remove(rig.group)
        disposeRig(rig)
      }
      const l = lookRef.current
      const colors = { ...archetypeById(l.archetype).colors }
      if (l.skinTone) colors.skin = l.skinTone
      rig = new CharacterRig({
        archetype: l.archetype,
        colors,
        hat: l.hat,
        glasses: l.glasses,
        signText: l.signText,
        face: l.face,
        outfit: l.outfit,
        footwear: l.footwear,
        gear: l.gear,
        held: l.held,
      })
      stage.add(rig.group)
    }
    buildRig()
    rebuildRef.current = buildRig

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
      if (!dragging) spin += dt * 0.45
      stage.rotation.y = spin
      rig?.update(dt, 'idle', 0)
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      rebuildRef.current = null
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

  // swap the rig whenever the look changes (renderer stays alive)
  useEffect(() => {
    rebuildRef.current?.()
  }, [look])

  return <div ref={mountRef} className={className} aria-label="Live 3D character preview" role="img" />
}
