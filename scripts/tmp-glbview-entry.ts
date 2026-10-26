/**
 * TEMP visual-QA harness for the human character GLBs (shoulders/feet/shoes audit).
 * Served from public/tmp-glbview/index.html + bundle.js (bun build).
 * URL params:
 *   model  — GLB url (default male)
 *   cam    — hero | front | side | back | face | shoulder-front | shoulder-side | shoe-front | shoe-side | shoe-top | run
 *   clip   — clip name to play (paused at t)
 *   t      — pause time in seconds
 *   azim/elev/dist/ty — override camera spherical
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const q = new URLSearchParams(location.search)
const model = q.get('model') || '/models/votechor-human-male.glb'
const camName = q.get('cam') || 'hero'
const clipName = q.get('clip')
const tPause = q.get('t') ? parseFloat(q.get('t') as string) : null

const app = document.getElementById('app') as HTMLDivElement
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf5efdc)
const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8577, 1.05)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffffff, 1.6)
sun.position.set(2.4, 4.2, 2.8)
scene.add(sun)
const fill = new THREE.DirectionalLight(0xfff2dd, 0.5)
fill.position.set(-2.6, 2.0, -1.6)
scene.add(fill)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 48),
  new THREE.MeshStandardMaterial({ color: 0xe6dfc8, roughness: 0.95 })
)
ground.rotation.x = -Math.PI / 2
scene.add(ground)
const grid = new THREE.GridHelper(3, 30, 0xb9b09a, 0xcfc7ae)
grid.position.y = 0.001
scene.add(grid)

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.01, 60)

interface CamSpec { azim: number; elev: number; dist: number; ty: number }
const CAMS: Record<string, CamSpec> = {
  hero: { azim: 0.62, elev: 0.22, dist: 2.6, ty: 0.95 },
  front: { azim: 0, elev: 0.08, dist: 2.4, ty: 0.95 },
  side: { azim: Math.PI / 2, elev: 0.08, dist: 2.4, ty: 0.95 },
  back: { azim: Math.PI, elev: 0.08, dist: 2.4, ty: 0.95 },
  face: { azim: 0.12, elev: 0.1, dist: 0.85, ty: 1.68 },
  'shoulder-front': { azim: 0.25, elev: 0.14, dist: 0.75, ty: 1.52 },
  'shoulder-side': { azim: Math.PI / 2 + 0.35, elev: 0.14, dist: 0.75, ty: 1.52 },
  'shoe-front': { azim: 0.3, elev: 0.18, dist: 0.6, ty: 0.08 },
  'shoe-side': { azim: Math.PI / 2, elev: 0.1, dist: 0.62, ty: 0.06 },
  'shoe-top': { azim: 0.05, elev: 1.05, dist: 0.75, ty: 0.02 },
  run: { azim: 0.5, elev: 0.15, dist: 2.2, ty: 0.95 },
}
const ov = document.getElementById('label') as HTMLDivElement
ov.textContent = `${model.split('/').pop()} · cam=${camName} · clip=${clipName || '(bind pose)'}` + (tPause != null ? ` · t=${tPause}` : '')

let mixer: THREE.AnimationMixer | null = null
const clock = new THREE.Clock()

function applyCam() {
  const base = CAMS[camName] || CAMS.hero
  const azim = q.get('azim') ? parseFloat(q.get('azim') as string) : base.azim
  const elev = q.get('elev') ? parseFloat(q.get('elev') as string) : base.elev
  const dist = q.get('dist') ? parseFloat(q.get('dist') as string) : base.dist
  const ty = q.get('ty') ? parseFloat(q.get('ty') as string) : base.ty
  const tz = q.get('tz') ? parseFloat(q.get('tz') as string) : 0
  camera.position.set(Math.sin(azim) * Math.cos(elev) * dist, ty + Math.sin(elev) * dist, tz + Math.cos(azim) * Math.cos(elev) * dist)
  camera.lookAt(0, ty, tz)
}

new GLTFLoader().load(model, (gltf) => {
  const root = gltf.scene
  if (q.get('debug') === '1') {
    // color-code every mesh by name hash to identify parts
    const palette = [0xe63946, 0xf1c232, 0x43aa8b, 0x577590, 0xf9844a, 0x9d4edd, 0x43b929, 0xffffff]
    let i = 0
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.material = new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.7 })
        i++
      }
    })
  }
  scene.add(root)
  ;(window as unknown as Record<string, unknown>).__scene = scene
  const box = new THREE.Box3().setFromObject(root)
  const h = box.max.y - box.min.y
  ov.textContent += ` · height=${h.toFixed(3)}m`
  if (clipName) {
    mixer = new THREE.AnimationMixer(root)
    const clip = gltf.animations.find((c) => c.name === clipName) || gltf.animations[0]
    const act = mixer.clipAction(clip)
    act.play()
    if (tPause != null) act.time = tPause
    else act.paused = false
    if (tPause != null) mixer.update(0)
  }
  applyCam()
  renderer.setAnimationLoop(() => {
    if (mixer && tPause == null) mixer.update(clock.getDelta())
    renderer.render(scene, camera)
  })
}, undefined, (err) => {
  ov.textContent = 'LOAD ERROR: ' + String(err)
})

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})
