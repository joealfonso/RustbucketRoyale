import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// A mech kit: one .glb per part per damage state (Mech_<Name>_<Part>_<State>.glb, see DESIGN.md), each holding three
// levels of detail (nodes LOD0, LOD1, LOD2), an effect point (node Fx) and, on the gun arm, a gun mount (Mount_Gun).
// Parts are modelled in place in the mech's own frame (feet at 0, forward is -Z), so they need no placing.
// Which parts a kit has, and which hit zone each belongs to, is in data/mechKits.json.

export const STATES = ["Intact", "Damaged", "Broken"] as const;
const ZONE_INDEX: Record<string, number> = { legs: 0, arms: 1, torso: 2 };

export interface KitsData {
  lodDistances: number[]; // metres at which LOD1 and then LOD2 take over
  kits: Record<string, { folder: string; name: string; parts: Record<string, { zone: string; paint: "body" | "accent" | "trim" }> }>;
}

export interface KitState {
  lods: THREE.BufferGeometry[]; // LOD0 first
  fx: THREE.Vector3 | null;
  mount: THREE.Vector3 | null;
}

export interface KitPart {
  name: string;
  zone: number;
  paint: "body" | "accent" | "trim";
  states: KitState[]; // intact, damaged, broken
}

export interface LoadedKit {
  parts: KitPart[];
  lodDistances: number[];
}

export function parseKits(raw: unknown): KitsData {
  const d = raw as KitsData;
  if (!Array.isArray(d?.lodDistances) || d.lodDistances.length !== 2) throw new Error("mechKits.json: lodDistances needs two distances");
  for (const [id, kit] of Object.entries(d.kits ?? {})) {
    for (const [part, p] of Object.entries(kit.parts)) {
      if (!(p.zone in ZONE_INDEX)) throw new Error(`mechKits.json: ${id} ${part} has unknown zone "${p.zone}"`);
      if (!["body", "accent", "trim"].includes(p.paint)) throw new Error(`mechKits.json: ${id} ${part} has unknown paint "${p.paint}"`);
    }
  }
  return d;
}

// Reads what the kit needs from one loaded part file: its three meshes and its named points.
export function readKitState(scene: THREE.Object3D, file: string): KitState {
  const lods: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const node = scene.getObjectByName(`LOD${i}`);
    const mesh = node instanceof THREE.Mesh ? node : node?.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    if (!mesh) throw new Error(`${file} has no mesh in LOD${i}`);
    lods.push(mesh.geometry as THREE.BufferGeometry);
  }
  const point = (name: string) => scene.getObjectByName(name)?.position.clone() ?? null;
  return { lods, fx: point("Fx"), mount: point("Mount_Gun") };
}

// Loads every part and state of a kit. Returns null (and says why in the console) if anything is missing, so the
// game falls back to the grey-box mech rather than drawing half a robot.
export async function loadKit(id: string, data: KitsData, base = "/"): Promise<LoadedKit | null> {
  const kit = data.kits[id];
  if (!kit) { console.warn(`No mech kit "${id}" in mechKits.json`); return null; }
  const loader = new GLTFLoader();
  try {
    const parts = await Promise.all(Object.entries(kit.parts).map(async ([name, p]) => ({
      name, zone: ZONE_INDEX[p.zone]!, paint: p.paint,
      states: await Promise.all(STATES.map(async (state) => {
        const file = `${base}${kit.folder}/Mech_${kit.name}_${name}_${state}.glb`;
        return readKitState((await loader.loadAsync(file)).scene, file);
      })),
    })));
    return { parts, lodDistances: data.lodDistances };
  } catch (error) {
    console.warn(`Mech kit "${id}" could not be loaded, using the grey-box mech:`, error);
    return null;
  }
}
