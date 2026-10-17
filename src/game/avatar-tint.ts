// Shared GLB character palette application — ONE source of truth for both the
// in-game rigs (game.ts) and the wardrobe preview (CharacterPreview.tsx).
//
// Two asset families live in public/models:
//  - RIGGED (votechor-male-rigged / votechor-female): flat-colored meshes named
//    TorsoMesh / ArmLMesh / LegLMesh / HeadMesh / Sash … → SOLID color replace.
//  - TEXTURED (votechor-male — the user-supplied realistic avatar): baked PNG
//    textures on AvatarHead / AvatarBody / outfit_top / outfit_bottom → MULTIPLY
//    tint (three.js: final = material.color × texture), which keeps all baked
//    shading/detail while shifting the hue to the player's palette. Skin only
//    darkens toward the chosen tone (a multiply can not lighten past the baked
//    texture), eyelashes/teeth/eyes stay untouched.
import * as THREE from 'three'

export interface AvatarPalette {
  shirt: string
  pants: string
  skin: string
  accent: string
}

/** Solid-color mesh names of the RIGGED family → palette key. */
const RIGGED_MAP: Record<string, keyof AvatarPalette> = {
  TorsoMesh: 'shirt', ArmLMesh: 'shirt', ArmRMesh: 'shirt',
  LegLMesh: 'pants', LegRMesh: 'pants',
  HeadMesh: 'skin', ArmLHand: 'skin', ArmRHand: 'skin',
  Sash: 'accent',
}

/** Baked-texture mesh names of the TEXTURED family → palette key (multiply). */
const TEXTURED_MAP: Record<string, keyof AvatarPalette> = {
  AvatarHead: 'skin', AvatarBody: 'skin',
  outfit_top: 'shirt',
  outfit_bottom: 'pants',
}

/** Pristine per-instance materials — re-tints restore them first so color
 *  multiplies never stack (clone-of-clone would tint² and darken wrongly). */
const pristine = new WeakMap<THREE.Mesh, THREE.Material>()

/**
 * Tint every recognized mesh of a GLB instance group to the player's palette.
 * Safe to call on ANY model — unrecognized meshes keep their own materials.
 * Idempotent per instance: repeated calls (wardrobe archetype/skin changes)
 * re-clone from the pristine material instead of stacking tint on tint.
 */
export function applyAvatarPalette(group: THREE.Object3D, pal: AvatarPalette) {
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || typeof m.name !== 'string') return
    const solidKey = RIGGED_MAP[m.name]
    const texKey = TEXTURED_MAP[m.name]
    if (!solidKey && !texKey) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial | undefined
    if (!mat || !(mat as THREE.Material).isMaterial) return
    let base = pristine.get(m)
    if (!base) {
      base = mat
      pristine.set(m, base)
    } else if (m.material !== base) {
      (m.material as THREE.Material).dispose() // drop the previous tint clone
    }
    const clone = base.clone() as THREE.MeshStandardMaterial
    clone.color = new THREE.Color(pal[solidKey ?? texKey!])
    m.material = clone
  })
}
