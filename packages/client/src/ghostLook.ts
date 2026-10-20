import * as THREE from "three";
import type { AbilityFxConfig } from "./abilityFx";
import type { MechModel } from "./mechModel";

type Tintable = THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number };

// Draws one mech see-through and faintly tinted: how an Arbiter sees its own decoys, so it never loses track of the
// real one. Only this model changes. Its own materials (zones, paint, gun, glows) are changed in place; materials it
// shares with other mechs (toon.material by colour, outlines, plates) are swapped for copies of its own, so every
// other mech of that colour stays solid. Outlines are hidden: a hologram has no ink line, and no shadow. Run once per model.
// Returns the copies it made, for disposing when the model goes.
export function makeGhost(model: MechModel, look: AbilityFxConfig["ghost"]): THREE.Material[] {
  const owned = new Set<THREE.Material>([...model.zoneMaterials, model.gunMaterial, ...model.paints.map((p) => p.material), ...model.glows.map((g) => g.material)]);
  const changed = new Set<THREE.Material>(); // owned ones already made ghostly: one material can be on many meshes
  const copies = new Map<THREE.Material, THREE.Material>();
  const tint = new THREE.Color(look.tint);
  const ghostly = (m: Tintable) => {
    m.transparent = true;
    m.opacity = look.opacity;
    m.depthWrite = false; // so the far side of the body shows through the near side
    // Emissive, not colour: damage rewrites a zone's colour every snapshot and would wipe a colour tint out.
    if (m.emissive) { m.emissive.copy(tint); m.emissiveIntensity = look.tintStrength; }
    m.needsUpdate = true;
  };
  model.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = false; // a hologram casts no sun shadow
    const m = o.material as THREE.Material;
    if (m.side === THREE.BackSide) { o.visible = false; return; }
    if (owned.has(m)) {
      if (!changed.has(m)) { ghostly(m); changed.add(m); }
      return;
    }
    let copy = copies.get(m);
    if (!copy) {
      copy = m.clone();
      // Keeps the toon rim light, which lives in a shader hook that clone() does not carry over.
      copy.onBeforeCompile = m.onBeforeCompile;
      copy.customProgramCacheKey = m.customProgramCacheKey;
      ghostly(copy);
      copies.set(m, copy);
    }
    o.material = copy;
  });
  return [...copies.values()];
}
