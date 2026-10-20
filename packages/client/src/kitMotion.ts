import * as THREE from "three";
import { SEGMENTS_PER_LEG, type LegJoints } from "./legRig";

// The parts of a kit mech that move on their own (gate V9b), as data/mechKits.json lists them under a kit's `motion`
// (written by the mech scripts, scripts/mechs/motion.ts): leg pistons whose sleeve and rod each ride their own bone and
// slide as the joint bends, and parts that sway (antennas, masts, drones on pylons, hanging hoses and weights). The
// shapes stay in their parts in the model; here they are lifted out of each part's nearest level of detail by where
// they lie, so hit boxes, triangle counts and the simpler levels (which keep them fixed) do not change.

export interface MotionData {
  name: string;
  parts: string[];
  path: number[][]; // a piston's two mounts, sleeve first; a swaying part's base (or a swing's first fitting) first
  radius: number; // a shape is this part's when every corner of it lies within this distance of the path
  piston?: [string, string]; // the sleeve's bone and the rod's: "body", or "thigh_R", "shin_FL", "foot_L" ...
  split?: number; // shapes whose middle lies less than this share of the way along go with the sleeve; 0.5 if left out
  sway?: string; // the spring it sways on, a profile in data/sway.json
  bone?: string; // the bone a swaying part rides
  swing?: boolean; // turns about the line from its first to its last point (a hose fixed at both ends), not its base
}

// A moving part made ready for a model: its bones as leg pieces (legRig.ts numbering, -1 for the body) and its points
// in the model's frame.
export interface KitMotion {
  name: string;
  kind: "piston" | "whip" | "swing";
  segments: number[]; // piston: sleeve's and rod's; sway: its one
  points: THREE.Vector3[]; // piston: the two mounts; sway: its path
  sway: string;
}

// One end of a moving part in a model: a piston's sleeve (0) or rod (1); a swaying part is all end 0.
export interface MotionPiece { motion: KitMotion; end: number }

const BONE = /^(body|(thigh|shin|foot)_(L|R|FL|FR|BL|BR))$/;
const SEGMENT_NAMES = ["thigh", "shin", "foot"];
// A shape's middle may sit a little past the path's ends and still belong: the pins and lugs a piston is mounted on are
// centred on its mount, but their middles land a centimetre or two either side of it.
const END_SLACK_METERS = 0.05;

// Checks one kit's motion list, so a bad data file fails on load. `parts` is the kit's part names.
export function checkMotion(id: string, raw: unknown, parts: string[]): void {
  if (raw === undefined) return;
  const fail = (what: string) => { throw new Error(`mechKits.json: ${id} motion ${what}`); };
  if (!Array.isArray(raw)) fail("must be a list");
  const names = new Set<string>();
  for (const m of raw as MotionData[]) {
    if (typeof m?.name !== "string" || m.name === "" || names.has(m.name)) fail(`entries need a name of their own (${String(m?.name)})`);
    names.add(m.name);
    const at = `${m.name}:`;
    if (!Array.isArray(m.parts) || m.parts.length === 0 || m.parts.some((p) => !parts.includes(p))) fail(`${at} parts must name parts of the kit`);
    const point = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === "number" && Number.isFinite(v));
    if (!Array.isArray(m.path) || m.path.length < 2 || !m.path.every(point)) fail(`${at} path needs two or more [x, y, z] points`);
    if (typeof m.radius !== "number" || !(m.radius > 0)) fail(`${at} radius must be above 0`);
    if ((m.piston === undefined) === (m.sway === undefined)) fail(`${at} is either a piston or a sway`);
    if (m.piston !== undefined) {
      if (!Array.isArray(m.piston) || m.piston.length !== 2 || !m.piston.every((b) => typeof b === "string" && BONE.test(b))) fail(`${at} piston needs two bones (body, or thigh, shin or foot and a side)`);
      if (m.path.length !== 2) fail(`${at} a piston's path is its two mounts`);
      if (m.split !== undefined && !(typeof m.split === "number" && m.split > 0 && m.split < 1)) fail(`${at} split is a share, between 0 and 1`);
    } else {
      if (typeof m.sway !== "string" || m.sway === "") fail(`${at} sway names a profile in sway.json`);
      if (typeof m.bone !== "string" || !BONE.test(m.bone)) fail(`${at} bone must be body, or thigh, shin or foot and a side`);
      if (m.swing !== undefined && typeof m.swing !== "boolean") fail(`${at} swing is true or false`);
    }
  }
}

// A bone name as a leg piece, or -1 for the body. Throws for a leg the kit does not have.
export function segmentOfBone(bone: string, legs: readonly LegJoints[]): number {
  if (bone === "body") return -1;
  const [segment, side] = bone.split("_") as [string, string];
  const leg = legs.findIndex((l) => l.side === side);
  if (leg < 0) throw new Error(`no leg ${side} for bone ${bone}`);
  return leg * SEGMENTS_PER_LEG + SEGMENT_NAMES.indexOf(segment);
}

export function readyMotion(m: MotionData, legs: readonly LegJoints[]): KitMotion {
  const points = m.path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  if (m.piston) return { name: m.name, kind: "piston", segments: m.piston.map((b) => segmentOfBone(b, legs)), points, sway: "" };
  return { name: m.name, kind: m.swing ? "swing" : "whip", segments: [segmentOfBone(m.bone!, legs)], points, sway: m.sway! };
}

const OFFSET = 65536, SPAN = 131072;
const keyOf = (x: number, y: number, z: number) =>
  Math.round(x * 1000) + OFFSET + (Math.round(y * 1000) + OFFSET) * SPAN + (Math.round(z * 1000) + OFFSET) * SPAN * SPAN;

const ab = new THREE.Vector3(), ap = new THREE.Vector3();
// How far `p` is from the path, and where along it the nearest point lies, in metres from the path's start, with
// points before the start or past the end counted beyond it (negative, or more than the path's length).
function nearest(p: THREE.Vector3, path: readonly THREE.Vector3[]): { distance: number; along: number; length: number } {
  let distance = Infinity, along = 0, walked = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    ab.subVectors(b, a);
    const l = ab.length();
    const t = ap.subVectors(p, a).dot(ab) / Math.max(1e-9, l * l);
    const first = i === 0, last = i + 2 === path.length;
    const clamped = Math.max(first ? -Infinity : 0, Math.min(last ? Infinity : 1, t));
    const inside = Math.max(0, Math.min(1, t));
    const d = ap.subVectors(p, a).addScaledVector(ab, -inside).length();
    if (d < distance) { distance = d; along = walked + clamped * l; }
    walked += l;
  }
  return { distance, along, length: walked };
}

export interface Lifted { piece: MotionPiece; geometry: THREE.BufferGeometry }

// Takes the shapes of a part's geometry that belong to `motions` out of it. Shapes are kept whole (triangles that
// share a corner position are one shape, as in legRig.ts). Returns what is left and one geometry per moving end, or
// null when nothing in this geometry moves. Runs once per kit.
export function liftShapes(geometry: THREE.BufferGeometry, motions: { motion: KitMotion; radius: number; split: number }[]): { rest: THREE.BufferGeometry; lifted: Lifted[] } | null {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.attributes.position;
  if (!position || motions.length === 0) return null;
  const count = position.count;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byPosition = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    if (i % 3 !== 0) join(i, i - (i % 3));
    const key = keyOf(position.getX(i), position.getY(i), position.getZ(i));
    const seen = byPosition.get(key);
    if (seen === undefined) byPosition.set(key, i);
    else join(i, seen);
  }
  // Each shape's middle and the farthest any of its corners lies from each path.
  const sums = new Map<number, number[]>();
  const far = new Map<number, Float64Array>();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    p.fromBufferAttribute(position, i);
    let s = sums.get(root);
    if (!s) { sums.set(root, (s = [0, 0, 0, 0])); far.set(root, new Float64Array(motions.length)); }
    s[0]! += p.x; s[1]! += p.y; s[2]! += p.z; s[3]! += 1;
    const f = far.get(root)!;
    motions.forEach(({ motion }, m) => { f[m] = Math.max(f[m]!, nearest(p, motion.points).distance); });
  }
  // Which moving end each shape goes to, as an index into `ends`, or -1 to stay.
  const ends: MotionPiece[] = [];
  const endOf = new Map<number, number>();
  for (const [root, s] of sums) {
    p.set(s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!);
    const f = far.get(root)!;
    const m = motions.findIndex(({ radius }, k) => f[k]! <= radius);
    if (m < 0) continue;
    const { motion, split } = motions[m]!;
    const { along, length } = nearest(p, motion.points);
    if (along < -END_SLACK_METERS || along > length + END_SLACK_METERS) continue;
    const end = motion.kind === "piston" && along > split * length ? 1 : 0;
    let e = ends.findIndex((x) => x.motion === motion && x.end === end);
    if (e < 0) e = ends.push({ motion, end }) - 1;
    endOf.set(root, e);
  }
  if (ends.length === 0) return null;
  const groups: number[][] = ends.map(() => []);
  const rest: number[] = [];
  for (let i = 0; i < count; i += 3) (groups[endOf.get(find(i)) ?? -1] ?? rest).push(i);
  return { rest: copyCorners(flat, rest), lifted: ends.map((piece, e) => ({ piece, geometry: copyCorners(flat, groups[e]!) })) };
}

// The listed triangles (by first corner) of a flat geometry, every attribute kept. Shapes share no corner positions,
// so the outline normals worked out for the whole part are already right for each piece.
function copyCorners(flat: THREE.BufferGeometry, firsts: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(flat.attributes)) {
    const size = attribute.itemSize;
    const values = new Float32Array(firsts.length * 3 * size);
    let at = 0;
    for (const first of firsts) for (let c = first; c < first + 3; c++) for (let k = 0; k < size; k++) values[at++] = attribute.getComponent(c, k);
    g.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  return g;
}
