import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { readLegJoints, splitBySegment, type LegJoints } from "./legRig";

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

// A part's paint: a colour name from the kit's own `scheme` (its factory paint, docs/MECH_ROSTER.md), or one of:
// body (the default white), accent (the pilot's marking colour), trim (the default dark frame), weapon (the colour of
// the weapon in hand, so a modelled gun shows what you hold and the game adds no barrel of its own).
// Painted parts rust with their zone unless `rusts: false` (frames and joints). `glow` parts are flat lit colour
// (sensors, visors, energy accents): they never rust and go dark when the torso breaks.
type Paint = string;

export interface KitsData {
  lodDistances: number[]; // metres at which the second and then the third level of detail take over
  roster?: string[]; // the roster mechs' kits, in the order of data/roster.json
  // `noHit` parts (floating drones) get no hit box; `hitboxes` is written by scripts/make-hitboxes.ts.
  kits: Record<string, {
    file?: string; folder?: string; name?: string; scheme?: Record<string, string>;
    parts: Record<string, { zone: string; paint: Paint; noHit?: boolean; glow?: boolean; rusts?: boolean }>;
    hitboxes?: Record<string, { center: number[]; size: number[] }[]>;
  }>;
}

export interface KitState {
  lods: THREE.BufferGeometry[]; // nearest first, one or more
  fx: THREE.Vector3 | null;
  mount: THREE.Vector3 | null;
  // A leg part of a kit with leg joints, cut into thigh, shin and foot pieces per leg (legRig.ts), each with its own
  // levels of detail. The mech bends them at the joints. Absent on every other part.
  pieces?: { piece: number; lods: THREE.BufferGeometry[] }[];
}

export interface KitPart {
  name: string;
  zone: number;
  paint: Paint;
  color: string | null; // the paint's colour from the kit's scheme, or null for body, accent, trim and weapon
  glow: boolean;
  rusts: boolean;
  states: (KitState | null)[]; // intact (always there), damaged, broken
}

export interface LoadedKit {
  id: string; // its name in data/mechKits.json, which also names its walk in data/gait.json
  parts: KitPart[];
  lodDistances: number[];
  legs: LegJoints[]; // empty for a kit whose model marks no leg joints: it glides instead of walking
}

export function parseKits(raw: unknown): KitsData {
  const d = raw as KitsData;
  if (!Array.isArray(d?.lodDistances) || d.lodDistances.length !== 2) throw new Error("mechKits.json: lodDistances needs two distances");
  for (const [id, kit] of Object.entries(d.kits ?? {})) {
    if (!kit.file && !(kit.folder && kit.name)) throw new Error(`mechKits.json: ${id} needs a file, or a folder and a name`);
    for (const [part, p] of Object.entries(kit.parts)) {
      if (!(p.zone in ZONE_INDEX)) throw new Error(`mechKits.json: ${id} ${part} has unknown zone "${p.zone}"`);
      if (!["body", "accent", "trim", "weapon"].includes(p.paint) && !kit.scheme?.[p.paint]) throw new Error(`mechKits.json: ${id} ${part} has paint "${p.paint}", which is not in its scheme`);
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
    if (kit.file) return kitFromScene(id, data, await load(kit.file));
    // One file per part and state. These kits mark no leg joints, so they do not walk.
    const parts: KitPart[] = await Promise.all(Object.entries(kit.parts).map(async ([name, p]) => ({
      name, ...partLook(kit.scheme, p),
      states: await Promise.all(STATES.map(async (state, i) => {
        const file = `${kit.folder}/Mech_${kit.name}_${name}_${state}.glb`;
        // Only the intact part has to exist; a missing damaged or broken file falls back.
        const scene = i === 0 ? await load(file) : await load(file).catch(() => null);
        return scene ? readPartFile(scene) : null;
      })),
    })));
    const missing = parts.filter((p) => !p.states[0]).map((p) => p.name);
    if (missing.length > 0) throw new Error(`no intact ${missing.join(", ")}`);
    return { id, parts, lodDistances: data.lodDistances, legs: [] };
  } catch (error) {
    console.warn(`Mech kit "${id}" could not be loaded, using the grey-box mech:`, error);
    return null;
  }
}

// A one-file kit from its loaded model: every part, and its legs cut at their joints when the model marks them.
// Throws if an intact part is missing.
export function kitFromScene(id: string, data: KitsData, scene: THREE.Object3D): LoadedKit {
  const kit = data.kits[id]!;
  const legs = readLegJoints(scene);
  const parts: KitPart[] = Object.entries(kit.parts).map(([name, p]) => ({ name, ...partLook(kit.scheme, p), states: readOneFileStates(scene, name) }));
  const missing = parts.filter((p) => !p.states[0]).map((p) => p.name);
  if (missing.length > 0) throw new Error(`no intact ${missing.join(", ")}`);
  if (legs.length > 0) for (const part of parts) if (part.zone === ZONE_INDEX.legs) for (const state of part.states) if (state) state.pieces = cutLegs(state.lods, legs);
  return { id, parts, lodDistances: data.lodDistances, legs };
}

// One leg part's levels of detail cut into leg pieces. A piece a simpler level has lost keeps the level before it.
function cutLegs(lods: THREE.BufferGeometry[], legs: LegJoints[]): NonNullable<KitState["pieces"]> {
  const levels = lods.map((g) => splitBySegment(g, legs));
  const pieces = [...new Set(levels.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  return pieces.map((piece) => {
    const out: THREE.BufferGeometry[] = [];
    levels.forEach((m, level) => out.push(m.get(piece) ?? out[level - 1] ?? new THREE.BufferGeometry()));
    return { piece, lods: out };
  });
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

// Every mech in the roster, loaded together, by its roster number (the server sends each mech's number). A kit that
// fails to load draws as the grey-box mech.
export async function loadRoster(data: KitsData, base = "/"): Promise<(mech: number) => LoadedKit | null> {
  const kits = await Promise.all((data.roster ?? []).map((id) => loadKit(id, data, base)));
  return (mech) => kits[mech] ?? null;
}

// How a part is painted and which zone it belongs to, from its kit entry.
function partLook(scheme: Record<string, string> | undefined, p: { zone: string; paint: Paint; glow?: boolean; rusts?: boolean }) {
  return {
    zone: ZONE_INDEX[p.zone]!, paint: p.paint, color: scheme?.[p.paint] ?? null,
    glow: p.glow === true, rusts: p.glow !== true && p.paint !== "weapon" && p.rusts !== false,
  };
}

