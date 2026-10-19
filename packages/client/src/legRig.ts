import * as THREE from "three";
import { addOutlineNormals } from "./outlineNormals";

// The legs of a kit mech, for walking. A model marks each leg's joints with empty nodes (Joint_Hip_R, Joint_Knee_R,
// Joint_Ankle_R and an optional Joint_Toe_R; see scripts/mechs/joints.ts). The leg parts stay as they were made, and
// are cut here, once per kit, into thigh, shin and foot pieces by which bone each shape sits nearest. So hit boxes,
// which are measured from the parts, never change, and a model with no joint nodes just does not walk.

export const SEGMENT_THIGH = 0;
export const SEGMENT_SHIN = 1;
export const SEGMENT_FOOT = 2;
export const SEGMENTS_PER_LEG = 3;

export interface LegJoints {
  side: string; // L, R, or FL, FR, BL, BR
  hip: THREE.Vector3;
  knee: THREE.Vector3;
  ankle: THREE.Vector3; // the end of the two-bone chain, where the foot starts (the hock on a bird leg)
  toe: THREE.Vector3; // the far end of the foot
}

const SIDES = ["L", "R", "FL", "FR", "BL", "BR"];

// Every leg whose hip, knee and ankle are all marked, in a fixed order.
export function readLegJoints(scene: THREE.Object3D): LegJoints[] {
  scene.updateMatrixWorld(true);
  const at = (name: string) => scene.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()) ?? null;
  const legs: LegJoints[] = [];
  for (const side of SIDES) {
    const hip = at(`Joint_Hip_${side}`), knee = at(`Joint_Knee_${side}`), ankle = at(`Joint_Ankle_${side}`);
    if (!hip || !knee || !ankle) continue;
    legs.push({ side, hip, knee, ankle, toe: at(`Joint_Toe_${side}`) ?? new THREE.Vector3(ankle.x, 0, ankle.z) });
  }
  return legs;
}

const scratch = new THREE.Vector3();
function distanceToBone(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  scratch.subVectors(b, a);
  const t = Math.max(0, Math.min(1, scratch.dot(p.clone().sub(a)) / Math.max(1e-9, scratch.lengthSq())));
  return p.distanceTo(scratch.multiplyScalar(t).add(a));
}

// Which leg piece a point belongs to: leg * SEGMENTS_PER_LEG + segment, by the nearest bone of any leg.
export function segmentOf(p: THREE.Vector3, legs: readonly LegJoints[]): number {
  let best = 0, bestDistance = Infinity;
  legs.forEach((leg, i) => {
    const bones: [THREE.Vector3, THREE.Vector3][] = [[leg.hip, leg.knee], [leg.knee, leg.ankle], [leg.ankle, leg.toe]];
    bones.forEach(([a, b], segment) => {
      const d = distanceToBone(p, a, b);
      if (d < bestDistance) { bestDistance = d; best = i * SEGMENTS_PER_LEG + segment; }
    });
  });
  return best;
}

// Cuts a part's geometry into pieces by leg and segment. Shapes are kept whole: triangles that share a corner
// position are one shape, and the shape goes to the bone nearest its middle, so a thigh plate never tears at the knee.
// Returns a map from piece (as segmentOf) to its geometry.
export function splitBySegment(geometry: THREE.BufferGeometry, legs: readonly LegJoints[]): Map<number, THREE.BufferGeometry> {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.attributes.position!;
  const normal = flat.attributes.normal!;
  const count = position.count;

  // Union-find over corners, joined by triangle and by position (to the millimetre).
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const byPosition = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    if (i % 3 !== 0) join(i, i - (i % 3));
    const key = `${Math.round(position.getX(i) * 1000)},${Math.round(position.getY(i) * 1000)},${Math.round(position.getZ(i) * 1000)}`;
    const seen = byPosition.get(key);
    if (seen === undefined) byPosition.set(key, i);
    else join(i, seen);
  }

  // The middle of each shape, then its piece.
  const sums = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    const s = sums.get(root) ?? [0, 0, 0, 0];
    s[0]! += position.getX(i); s[1]! += position.getY(i); s[2]! += position.getZ(i); s[3]! += 1;
    sums.set(root, s);
  }
  const pieceOf = new Map<number, number>();
  for (const [root, s] of sums) pieceOf.set(root, segmentOf(new THREE.Vector3(s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!), legs));

  const corners = new Map<number, number[]>();
  for (let i = 0; i < count; i += 3) {
    const piece = pieceOf.get(find(i))!;
    let list = corners.get(piece);
    if (!list) corners.set(piece, (list = []));
    list.push(i, i + 1, i + 2);
  }
  const out = new Map<number, THREE.BufferGeometry>();
  for (const [piece, list] of corners) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(list.length * 3), nor = new Float32Array(list.length * 3);
    list.forEach((corner, j) => {
      pos.set([position.getX(corner), position.getY(corner), position.getZ(corner)], j * 3);
      nor.set([normal.getX(corner), normal.getY(corner), normal.getZ(corner)], j * 3);
    });
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.set(piece, addOutlineNormals(g));
  }
  return out;
}
