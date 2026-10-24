// VoteChor GLB asset pipeline — robust loading, instantiation, and cleanup.
//
// Handles every failure mode the asset spec demands:
//  - invalid/missing model path  → resolves null (caller falls back to procedural rig)
//  - malformed GLB/parse errors  → resolves null, error logged once
//  - missing textures            → material.map stays null (loader per-texture onError)
//  - material arrays             → handled in dispose() (both Material and Material[])
//  - animation-free models       → asset.animations === [], driver falls back clip chain
//  - SKINNED models              → instantiated with SkeletonUtils.clone (a plain
//    Object3D.clone leaves every SkinnedMesh bound to the ORIGINAL skeleton, so
//    every instance would animate in lockstep from one shared bone set); plain
//    clone stays for node-TRS rigs (cheaper, no skeleton re-mapping needed)
//  - asset cleanup               → disposeAsset() frees geometry/material/texture GPU memory
//
// Assets are cached per URL; instantiate() clones the cached scene so many
// characters can share one downloaded asset without re-fetching.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { fetchAssetBuffer } from '@/lib/asset-cache'

export interface GLBAsset {
  url: string
  scene: THREE.Group
  animations: THREE.AnimationClip[]
  bytes: number
  /** true when the graph contains SkinnedMesh (bone-skinning) — instantiate() switches to SkeletonUtils.clone */
  skinned: boolean
}

export interface GLBInstance {
  group: THREE.Group
  mixer: THREE.AnimationMixer
  clips: Map<string, THREE.AnimationClip>
}

export class GLBAssetManager {
  private loader = new GLTFLoader()
  private cache = new Map<string, Promise<GLBAsset | null>>()
  private failedUrls = new Set<string>()
  onAssetError: ((url: string, reason: string) => void) | null = null

  /** Load (or fetch from cache) a GLB. NEVER rejects — resolves null on any failure. */
  load(url: string): Promise<GLBAsset | null> {
    const hit = this.cache.get(url)
    if (hit) return hit
    if (this.failedUrls.has(url)) return Promise.resolve(null) // known-bad — don't re-fetch
    const p = this.doLoad(url)
    this.cache.set(url, p)
    p.then((a) => { if (!a) { this.cache.delete(url); this.failedUrls.add(url) } })
    return p
  }

  hasFailed(url: string): boolean { return this.failedUrls.has(url) }

  private doLoad(url: string): Promise<GLBAsset | null> {
    return new Promise((resolve) => {
      let settled = false
      const done = (a: GLBAsset | null, reason?: string) => {
        if (settled) return
        settled = true
        if (!a && reason) this.onAssetError?.(url, reason)
        resolve(a)
      }
      // hard ceiling — must NEVER block the match forever, but it only exists to
      // catch true HANGS: GLTFLoader emits NO progress during parse, and the 24MB
      // skinned hero decodes 14 baked textures on the CPU (30s+ on weak devices),
      // so a generous 120s ceiling + boot-time preload (game.bootUnsafe) keeps a
      // slow-but-working load alive while a dead fetch still resolves null.
      const timeout = setTimeout(() => done(null, 'timeout after 120s'), 120000)
      const onGltf = (gltf: { scene?: THREE.Object3D; animations?: THREE.AnimationClip[] }) => {
        clearTimeout(timeout)
        try {
          const scene = gltf?.scene as THREE.Group | undefined
          if (!scene) { done(null, 'empty scene'); return }
          // normalize the graph: shadows off (software GPU), sane culling
          let meshes = 0
          let skinned = false
          scene.traverse((o) => {
            const m = o as THREE.Mesh
            if (m.isMesh) {
              meshes++
              m.castShadow = false
              m.receiveShadow = false
              if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
                // skeleton poses move vertices far outside the bind-pose
                // bounding box — stock culling would pop whole limbs off-screen
                skinned = true
                m.frustumCulled = false
              } else {
                m.frustumCulled = true
              }
              // material arrays stay as-is (three handles multi-primitive);
              // just guarantee they are valid instances
              const mats = Array.isArray(m.material) ? m.material : [m.material]
              for (const mat of mats) {
                if (!mat || !(mat as THREE.Material).isMaterial) {
                  m.material = new THREE.MeshStandardMaterial({ color: 0xcccccc })
                }
              }
            }
          })
          if (meshes === 0) { done(null, 'no meshes'); return }
          const anims = Array.isArray(gltf.animations) ? gltf.animations : []
          done({ url, scene, animations: anims, bytes: 0, skinned })
        } catch (e) {
          done(null, `normalize failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      const onErr = (err: unknown) => {
        clearTimeout(timeout)
        done(null, `loader error: ${err instanceof Error ? err.message : String(err)}`)
      }
      // task 97: local-cache fast path — once the user consents via the banner,
      // models stream from the browser's Cache API (instant boots, zero re-fetch).
      // Any miss/failure falls back to the classic loader path unchanged.
      void fetchAssetBuffer(url)
        .then((buf) => {
          if (settled) return
          if (buf) {
            try {
              this.loader.parse(buf, '', onGltf, onErr)
              return
            } catch {
              // parse threw synchronously (corrupt cache entry) — fall through
              // to the classic loader with the timeout still armed
            }
          }
          try {
            this.loader.load(url, onGltf, undefined, onErr)
          } catch (e) {
            clearTimeout(timeout)
            done(null, `load threw: ${e instanceof Error ? e.message : String(e)}`)
          }
        })
        .catch(() => {
          if (settled) return
          try {
            this.loader.load(url, onGltf, undefined, onErr)
          } catch (e) {
            clearTimeout(timeout)
            done(null, `load threw: ${e instanceof Error ? e.message : String(e)}`)
          }
        })
    })
  }

  /**
   * Clone the cached asset into a fresh instance with its own AnimationMixer.
   * Returns null if the asset hasn't loaded — caller falls back to procedural.
   */
  instantiate(asset: GLBAsset): GLBInstance | null {
    try {
      // skinned rigs MUST clone through SkeletonUtils — a plain deep clone shares
      // the source skeleton, so every instance would pose from ONE bone set and
      // all characters would animate in perfect (wrong) lockstep
      const group = (asset.skinned ? skeletonClone(asset.scene) : asset.scene.clone(true)) as THREE.Group
      const mixer = new THREE.AnimationMixer(group)
      const clips = new Map<string, THREE.AnimationClip>()
      for (const c of asset.animations) if (c && typeof c.name === 'string') clips.set(c.name, c)
      return { group, mixer, clips }
    } catch {
      return null
    }
  }

  /** Free every GPU resource of one instance (per-character teardown). */
  disposeInstance(inst: GLBInstance | null) {
    if (!inst) return
    inst.mixer.stopAllAction()
    inst.mixer.uncacheRoot(inst.mixer.getRoot() as THREE.Object3D)
    this.disposeObject(inst.group)
  }

  /** Free the cached asset itself (scene-level teardown / eviction). */
  disposeAsset(asset: GLBAsset | null) {
    if (!asset) return
    this.cache.delete(asset.url)
    this.disposeObject(asset.scene)
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined
      const kill = (x: THREE.Material) => {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
          const tex = (x as unknown as Record<string, THREE.Texture | null>)[key]
          if (tex) tex.dispose()
        }
        x.dispose()
      }
      if (Array.isArray(m)) m.forEach(kill)
      else if (m) kill(m)
    })
  }
}
