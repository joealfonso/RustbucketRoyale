import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// A mech kit: the model a mech is drawn from, split into seven parts (torso, jets, sensor, two legs, two arms), each
// belonging to one hit zone. Two ways to supply it (data/mechKits.json says which):
//  - One file (`file`): the whole mech in one .glb, each part an object named after it (Torso, Leg_L, ...).
//    Optional extras, by name: <Part>_Damaged and <Part>_Broken versions, <Part>_LOD1 / _LOD2 simpler versions,
//    <Part>_Fx (where its sparks and smoke start) and Mount_Gun (where the gun goes).
//  - One file per part and state (`folder`): Mech_<Name>_<Part>_<State>.glb with nodes LOD0..LOD2, Fx, Mount_Gun.
// Only the intact part is required. Without a damaged version a part just darkens, sparks and smokes; without a
// broken one it disappears (legs gone means the mech crawls on its belly). Parts are modelled in place on the
// assembled mech (feet at 0, forward is -Z); any object transforms from the export are applied.

export const STATES = ["Intact", "Damaged", "Broken"] as const;
const ZONE_INDEX: Record<string, number> = { legs: 0, arms: 1, torso: 2 };

type Paint = "body" | "accent" | "trim";

export interface KitsData {
  lodDistances: number[]; // metres at which the second and then the third level of detail take over
  kits: Record<string, { file?: string; folder?: string; name?: string; parts: Record<string, { zone: string; paint: Paint }> }>;
}

export interface KitState {
  lods: THREE.BufferGeometry[]; // nearest first, one or more
  fx: THREE.Vector3 | null;
  mount: THREE.Vector3 | null;
}

export interface KitPart {
  name: string;
  zone: number;
  paint: Paint;
  states: (KitState | null)[]; // intact (always there), damaged, broken
}

export interface LoadedKit {
  parts: KitPart[];
  lodDistances: number[];
}

export function parseKits(raw: unknown): KitsData {
  const d = raw as KitsData;
  if (!Array.isArray(d?.lodDistances) || d.lodDistances.length !== 2) throw new Error("mechKits.json: lodDistances needs two distances");
  for (const [id, kit] of Object.entries(d.kits ?? {})) {
    if (!kit.file && !(kit.folder && kit.name)) throw new Error(`mechKits.json: ${id} needs a file, or a folder and a name`);
    for (const [part, p] of Object.entries(kit.parts)) {
      if (!(p.zone in ZONE_INDEX)) throw new Error(`mechKits.json: ${id} ${part} has unknown zone "${p.zone}"`);
      if (!["body", "accent", "trim"].includes(p.paint)) throw new Error(`mechKits.json: ${id} ${part} has unknown paint "${p.paint}"`);
    }
  }
  return d;
}

// The geometry of an object and everything under it, in the model's own frame, as one mesh. Only position and
// normal are kept, which is all the toon look uses, so meshes from any exporter merge cleanly.
function geometryOf(node: THREE.Object3D): THREE.BufferGeometry | null {
  const pieces: THREE.BufferGeometry[] = [];
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const g = (child.geometry as THREE.BufferGeometry).clone();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    pieces.push(g.applyMatrix4(child.matrixWorld));
  });
  if (pieces.length === 0) return null;
  return pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces.map((g) => (g.index ? g.toNonIndexed() : g)));
}

const pointOf = (scene: THREE.Object3D, name: string): THREE.Vector3 | null => {
  const node = scene.getObjectByName(name);
  return node ? node.getWorldPosition(new THREE.Vector3()) : null;
};

// One state of one part from a loaded scene: its levels of detail by name, nearest first, and its named points.
// Null when the nearest is missing.
export function readKitState(scene: THREE.Object3D, lodNames: string[], fxName: string, mountName = "Mount_Gun"): KitState | null {
  scene.updateMatrixWorld(true);
  const lods: THREE.BufferGeometry[] = [];
  for (const name of lodNames) {
    const node = scene.getObjectByName(name);
    const geometry = node ? geometryOf(node) : null;
    if (!geometry) break; // levels must be consecutive: a missing one ends the list
    lods.push(geometry);
  }
  if (lods.length === 0) return null;
  return { lods, fx: pointOf(scene, fxName), mount: pointOf(scene, mountName) };
}

// Loads a kit. Returns null (and says why in the console) if an intact part is missing, so the game falls back to
// the grey-box mech rather than drawing half a robot.
export async function loadKit(id: string, data: KitsData, base = "/"): Promise<LoadedKit | null> {
  const kit = data.kits[id];
  if (!kit) { console.warn(`No mech kit "${id}" in mechKits.json`); return null; }
  const loader = new GLTFLoader();
  const load = async (file: string) => (await loader.loadAsync(`${base}${file}`)).scene;
  try {
    let parts: KitPart[];
    if (kit.file) {
      const scene = await load(kit.file);
      parts = Object.entries(kit.parts).map(([name, p]) => ({ name, zone: ZONE_INDEX[p.zone]!, paint: p.paint, states: readOneFileStates(scene, name) }));
    } else {
      parts = await Promise.all(Object.entries(kit.parts).map(async ([name, p]) => ({
        name, zone: ZONE_INDEX[p.zone]!, paint: p.paint,
        states: await Promise.all(STATES.map(async (state, i) => {
          const file = `${kit.folder}/Mech_${kit.name}_${name}_${state}.glb`;
          // Only the intact part has to exist; a missing damaged or broken file falls back.
          const scene = i === 0 ? await load(file) : await load(file).catch(() => null);
          return scene ? readPartFile(scene) : null;
        })),
      })));
    }
    const missing = parts.filter((p) => !p.states[0]).map((p) => p.name);
    if (missing.length > 0) throw new Error(`no intact ${missing.join(", ")}`);
    return { parts, lodDistances: data.lodDistances };
  } catch (error) {
    console.warn(`Mech kit "${id}" could not be loaded, using the grey-box mech:`, error);
    return null;
  }
}

// A part's states from a whole-mech file: Torso, Torso_Damaged, Torso_Broken, each with optional _LOD1 and _LOD2.
export function readOneFileStates(scene: THREE.Object3D, part: string): (KitState | null)[] {
  return STATES.map((state) => {
    const base = state === "Intact" ? part : `${part}_${state}`;
    return readKitState(scene, [base, `${base}_LOD1`, `${base}_LOD2`], `${part}_Fx`);
  });
}

// A state from a one-part file: nodes LOD0 to LOD2, or the whole file when it has no LOD nodes.
export function readPartFile(scene: THREE.Object3D): KitState | null {
  if (scene.getObjectByName("LOD0")) return readKitState(scene, ["LOD0", "LOD1", "LOD2"], "Fx");
  scene.updateMatrixWorld(true);
  const whole = geometryOf(scene);
  return whole ? { lods: [whole], fx: pointOf(scene, "Fx"), mount: pointOf(scene, "Mount_Gun") } : null;
}
