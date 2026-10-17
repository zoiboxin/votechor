// VoteChor GLB asset pipeline — robust loading, instantiation, and cleanup.
//
// Handles every failure mode the asset spec demands:
//  - invalid/missing model path  → resolves null (caller falls back to procedural rig)
//  - malformed GLB/parse errors  → resolves null, error logged once
//  - missing textures            → material.map stays null (loader per-texture onError)
//  - material arrays             → handled in dispose() (both Material and Material[])
//  - animation-free models       → asset.animations === [], driver falls back clip chain
//  - asset cleanup               → disposeAsset() frees geometry/material/texture GPU memory
//
// Assets are cached per URL; instantiate() clones the cached scene so many
// characters can share one downloaded asset without re-fetching.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

export interface GLBAsset {
  url: string
  scene: THREE.Group
  animations: THREE.AnimationClip[]
  bytes: number
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
    return p
  }

  hasFailed(url: string): boolean { return this.failedUrls.has(url) }

  private doLoad(url: string): Promise<GLBAsset | null> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (a: GLBAsset | null, reason?: string, retryable = false) => {
        if (settled) return
        settled = true
        if (!a) {
          // timeouts (slow device, big asset) stay retryable — hard errors are one-strike
          this.cache.delete(url)
          if (!retryable) this.failedUrls.add(url)
          this.onAssetError?.(url, reason ?? 'unknown')
        }
        resolve(a)
      }
      // hard timeout — a hung asset fetch must never block the match. Ceiling is
      // generous (45s): realistic high-poly assets (20MB+ of textures) on throttled
      // devices can legitimately exceed the old 12s, and the caller already renders
      // the procedural rig meanwhile — nothing gameplay-side ever waits.
      const timeout = setTimeout(() => finish(null, 'timeout after 45s', true), 45000)
      try {
        this.loader.load(
          url,
          (gltf) => {
            clearTimeout(timeout)
            try {
              const scene = gltf.scene as THREE.Group
              if (!scene) { finish(null, 'empty scene'); return }
              // normalize the graph: shadows off (software GPU), sane culling
              let meshes = 0
              scene.traverse((o) => {
                const m = o as THREE.Mesh
                if (m.isMesh) {
                  meshes++
                  m.castShadow = false
                  m.receiveShadow = false
                  // SkinnedMeshes deform away from their bind-pose bounds — the
                  // per-geometry bounding sphere would wrongly cull them mid-stride
                  if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false
                  else m.frustumCulled = true
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
              if (meshes === 0) { finish(null, 'no meshes'); return }
              const anims = Array.isArray(gltf.animations) ? gltf.animations : []
              const asset: GLBAsset = { url, scene, animations: anims, bytes: 0 }
              if (settled) {
                // a timeout already released the caller — park the freshly parsed
                // asset so the NEXT match's retry resolves instantly (no re-fetch)
                this.cache.set(url, Promise.resolve(asset))
                return
              }
              finish(asset)
            } catch (e) {
              finish(null, `normalize failed: ${e instanceof Error ? e.message : String(e)}`)
            }
          },
          undefined,
          (err) => {
            clearTimeout(timeout)
            finish(null, `loader error: ${err instanceof Error ? err.message : String(err)}`)
          },
        )
      } catch (e) {
        clearTimeout(timeout)
        finish(null, `load threw: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  /**
   * Clone the cached asset into a fresh instance with its own AnimationMixer.
   * Returns null if the asset hasn't loaded — caller falls back to procedural.
   *
   * v54: skinned models MUST clone through SkeletonUtils — plain Object3D.clone()
   * leaves each cloned SkinnedMesh pointing at the CACHED asset's skeleton, whose
   * bones stay at the world origin (measured live: hipsWorld (0,0.95,0) while the
   * instance group sat at the player's (0,0,-8) → the character rendered nowhere).
   * SkeletonUtils re-binds every cloned SkinnedMesh to the CLONED bones so each
   * instance animates and moves independently.
   */
  instantiate(asset: GLBAsset): GLBInstance | null {
    try {
      const hasSkin = (() => {
        let s = false
        asset.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) s = true })
        return s
      })()
      const group = (hasSkin ? SkeletonUtils.clone(asset.scene) : asset.scene.clone(true)) as THREE.Group
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

/**
 * Process-wide shared manager — the game (player + remotes) and the wardrobe
 * preview resolve through the SAME cache, so a 21.5 MB textured avatar is
 * fetched once per session no matter where it is needed first.
 */
export const sharedGLBAssets = new GLBAssetManager()

/**
 * THE High-Fi player model URL per gender (single source of truth — game.ts,
 * CharacterPreview and the GameRoot boot preload all resolve through this).
 * v54: the male slot holds votechor-male-skinned.glb — the SAME textured
 * promptplay appearance baked (scripts/bake-skinned-male.ts) onto a fitted
 * 15-joint humanoid skeleton with computed skin weights and the project's 13
 * authored clips (idle/walk/run/jump/fall/land/slide/hit/detained/recover/
 * celebrate/throw/heal) + synthesized knee/elbow flexion channels. It is a
 * genuinely rigged asset: GLTFLoader builds SkinnedMeshes + AnimationClips and
 * the existing GLBAnimDriver plays real skeletal animation. The original
 * static votechor-male.glb stays on disk as the bake source / rollback.
 * The female slot is the project's own clip-driven character puppet.
 */
export const hiFiUrlFor = (gender: 'male' | 'female'): string =>
  gender === 'female' ? '/models/votechor-female.glb' : '/models/votechor-male-skinned.glb'
