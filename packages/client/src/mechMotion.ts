import * as THREE from "three";
import swayJson from "../../../data/sway.json";
import { onVfxQuality, vfxConfig, vfxQuality } from "./fx/quality";
import type { MotionPiece } from "./kitMotion";
import { SEGMENTS_PER_LEG } from "./legRig";
import type { MechModel } from "./mechModel";
import { aimEnd } from "./pistons";
import { createSwayState, parseSway, resetSway, stepSway, type SwayProfile, type SwayState } from "./sway";

// The parts of a kit mech that move on their own (gate V9b): leg pistons that slide as the joints bend (pistons.ts)
// and parts that sway behind the mech's moves (sway.ts). A kit lists them (kitMotion.ts) and they are merged apart
// from the rest (mechMerge.ts); here each one's object is hung on a pivot at its mount or base, and turned each frame.
// Only the nearest level of detail moves: past it the parts are drawn fixed in the rest of the mech.

export const swayConfig = parseSway(swayJson, Object.keys(vfxConfig.levels));
let swayOn = !swayConfig.offAtQuality.includes(vfxQuality());
onVfxQuality(() => { swayOn = !swayConfig.offAtQuality.includes(vfxQuality()); });

interface End {
  lod: THREE.LOD; pivot: THREE.Group;
  segment: number; other: number; // the bone this end rides and the bone of the other end (leg pieces, -1 the body)
  there: THREE.Vector3; // the other end's mount in its own bone's frame
  rest: THREE.Vector3; // which way this end points while the legs are as built
}

interface Swayer {
  lod: THREE.LOD; pivot: THREE.Group; segment: number;
  lever: THREE.Vector3; // from its base toward its weight, a unit vector (zero for a straight swing, which only turning moves)
  axis: THREE.Vector3 | null; // a swing's turning line; null for a whip, which bends any way but round itself
  profile: SwayProfile; state: SwayState;
}

interface Rig {
  body: THREE.Group; legs: MechModel["legs"];
  bones: THREE.Matrix4[]; // each leg piece's frame in the body's, worked out once a frame when something needs it
  ends: End[]; sways: Swayer[];
  primed: boolean; still: boolean;
  // Last frame's group position and yaw, the body's place and lean, and the speeds worked out from them.
  last: Float64Array;
  was: Float64Array; // last frame's speeds (x, y, z) and turning (about x, y, z); NaN until there is one
  speed: Float64Array; spin: Float64Array; // this frame's change of each
}

const rigs = new WeakMap<THREE.Object3D, Rig>();
const ORIGIN = new THREE.Vector3();

// Hangs a model's moving pieces on pivots. Call once from createMechModel after the kit's pieces are made. A model with
// nothing moving gets no rig.
export function rigMechMotion(body: THREE.Group, legs: MechModel["legs"], kitPieces: MechModel["kitPieces"]): void {
  if (rigs.has(body)) return; // already hung: a second call would hang the pivots on themselves
  const restOf = (segment: number) => {
    if (segment < 0) return ORIGIN;
    const leg = legs[Math.floor(segment / SEGMENTS_PER_LEG)]!;
    return [leg.restHip, leg.restKnee, leg.restAnkle][segment % SEGMENTS_PER_LEG]!;
  };
  const ends: End[] = [], sways: Swayer[] = [];
  for (const { object } of kitPieces) {
    const lod = object as THREE.LOD;
    const piece = tagOf(lod);
    if (!piece || !lod.parent) continue;
    const { motion, end } = piece;
    const segment = motion.segments[end]!;
    if (segment >= legs.length * SEGMENTS_PER_LEG) continue; // a leg the model has not got
    const base = motion.kind === "piston" ? motion.points[end]! : motion.points[0]!;
    const pivot = new THREE.Group();
    pivot.position.copy(base).sub(restOf(segment));
    lod.parent.add(pivot);
    pivot.add(lod);
    lod.position.copy(base).negate(); // its shapes are in the model's frame: the pivot moves them onto their bone
    if (motion.kind === "piston") {
      const other = motion.segments[1 - end]!, there = motion.points[1 - end]!;
      ends.push({ lod, pivot, segment, other, there: there.clone().sub(restOf(other)), rest: there.clone().sub(base).normalize() });
    } else {
      const points = motion.points, last = points[points.length - 1]!;
      const axis = motion.kind === "swing" ? last.clone().sub(base).normalize() : null;
      // A whip's weight is out toward its tip; a swing's is wherever its middle hangs off the line between its ends.
      const lever = new THREE.Vector3();
      if (axis) {
        for (let i = 1; i + 1 < points.length; i++) lever.add(points[i]!).sub(base);
        lever.addScaledVector(axis, -lever.dot(axis));
      } else lever.copy(last).sub(base);
      lever.normalize();
      const profile = swayConfig.profiles[motion.sway];
      if (!profile) throw new Error(`sway.json has no profile "${motion.sway}" for ${motion.name}`);
      sways.push({ lod, pivot, segment, lever, axis, profile, state: createSwayState() });
    }
  }
  if (ends.length + sways.length === 0) return;
  rigs.set(body, {
    body, legs, bones: Array.from({ length: legs.length * SEGMENTS_PER_LEG }, () => new THREE.Matrix4()), ends, sways,
    primed: false, still: true, last: new Float64Array(9), was: new Float64Array(6).fill(NaN), speed: new Float64Array(3), spin: new Float64Array(3),
  });
}

function tagOf(lod: THREE.LOD): MotionPiece | null {
  const holder = lod.levels?.[0]?.object;
  if (!holder) return null;
  for (const child of holder.children) {
    const piece = (child as THREE.Mesh).geometry?.userData.motion as MotionPiece | undefined;
    if (piece) return piece;
  }
  return null;
}

const near = (lod: THREE.LOD) => lod.visible && lod.getCurrentLevel() === 0;
const inverse = new THREE.Matrix4();
const point = new THREE.Vector3();
const turn = new THREE.Quaternion();
const boneTurn = new THREE.Quaternion();
const push = new THREE.Vector3();
const twist = new THREE.Vector3();
const kick = new THREE.Vector3();
const across = new THREE.Vector3();

// Moves a model's pistons and sways for this frame. Call each frame after walking it (mechWalk.ts), with the same
// dt. A blown-apart wreck keeps its parts where they were; a wreck or a low effects level leaves nothing swaying.
// Allocates nothing.
export function moveMechParts(model: MechModel, dt: number): void {
  const rig = rigs.get(model.body);
  if (!rig || model.blownApart) return;
  let bonesReady = false;
  for (const end of rig.ends) {
    if (!near(end.lod)) continue;
    if (!bonesReady) { boneFrames(rig); bonesReady = true; }
    const m = rig.bones;
    // The other mount, from its bone into the body's frame, then into this end's bone.
    point.copy(end.there);
    if (end.other >= 0) point.applyMatrix4(m[end.other]!);
    if (end.segment >= 0) point.applyMatrix4(inverse.copy(m[end.segment]!).invert());
    aimEnd(end.pivot.quaternion, end.rest, end.pivot.position, point);
  }
  if (rig.sways.length === 0) return;
  if (!swayOn || model.dead || dt <= 0) {
    if (!rig.still) {
      for (const s of rig.sways) { resetSway(s.state); s.pivot.quaternion.identity(); }
      rig.still = true;
    }
    rig.primed = false;
    return;
  }
  if (!feel(rig, model.group, dt)) return;
  rig.still = false;
  const { stepSeconds } = swayConfig;
  for (const s of rig.sways) {
    if (!near(s.lod)) continue;
    // The frame's change of speed and turning, from the mech's frame into the frame of the bone the part rides.
    boneTurn.copy(rig.body.quaternion);
    if (s.segment >= 0) {
      if (!bonesReady) { boneFrames(rig); bonesReady = true; }
      boneTurn.multiply(turn.setFromRotationMatrix(rig.bones[s.segment]!));
    }
    boneTurn.invert();
    push.set(rig.speed[0]!, rig.speed[1]!, rig.speed[2]!).applyQuaternion(boneTurn);
    twist.set(rig.spin[0]!, rig.spin[1]!, rig.spin[2]!).applyQuaternion(boneTurn);
    // Left behind when the mech speeds up or turns: the weight keeps going the old way, which swings it about its base.
    kick.crossVectors(s.lever, push).multiplyScalar(-s.profile.push).addScaledVector(twist, -s.profile.turn);
    if (s.axis) kick.copy(s.axis).multiplyScalar(kick.dot(s.axis));
    else kick.addScaledVector(s.lever, -kick.dot(s.lever)); // a whip never twists round itself
    const { angle, spin } = s.state;
    spin[0] = spin[0]! + kick.x; spin[1] = spin[1]! + kick.y; spin[2] = spin[2]! + kick.z;
    stepSway(s.state, s.profile, dt, stepSeconds);
    across.set(angle[0]!, angle[1]!, angle[2]!);
    const size = across.length();
    if (size < 1e-6) s.pivot.quaternion.identity();
    else s.pivot.quaternion.setFromAxisAngle(across.divideScalar(size), size);
  }
}

// Each leg piece's frame in the body's, from the joints as walking left them.
function boneFrames(rig: Rig): void {
  for (let i = 0; i < rig.legs.length; i++) {
    const leg = rig.legs[i]!, at = i * SEGMENTS_PER_LEG;
    leg.hip.updateMatrix(); leg.knee.updateMatrix(); leg.ankle.updateMatrix();
    rig.bones[at]!.copy(leg.hip.matrix);
    rig.bones[at + 1]!.multiplyMatrices(rig.bones[at]!, leg.knee.matrix);
    rig.bones[at + 2]!.multiplyMatrices(rig.bones[at + 1]!, leg.ankle.matrix);
  }
}

// How the mech's speed and turning changed this frame, in its own frame (rig.speed, metres a second, and rig.spin,
// radians a second), with the body's own bob and lean from walking, each held inside its largest push. False on the
// first frame after a stop and after a cut, when there is nothing to compare with.
function feel(rig: Rig, group: THREE.Object3D, dt: number): boolean {
  const last = rig.last, body = rig.body, was = rig.was;
  const p = group.position, yaw = group.rotation.y;
  const primed = rig.primed && Math.hypot(p.x - last[0]!, p.y - last[1]!, p.z - last[2]!) < swayConfig.jumpMeters;
  // World velocity turned into the mech's frame (the inverse of three's turn about y), plus the body's own moves.
  const wx = (p.x - last[0]!) / dt, wy = (p.y - last[1]!) / dt, wz = (p.z - last[2]!) / dt;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const vx = wx * c - wz * s + (body.position.x - last[4]!) / dt;
  const vy = wy + (body.position.y - last[5]!) / dt;
  const vz = wx * s + wz * c + (body.position.z - last[6]!) / dt;
  // Turning about the body's own axes: its lean forward (x), the mech's turn (y), its roll (z).
  const tx = (body.rotation.x - last[7]!) / dt, ty = Math.atan2(Math.sin(yaw - last[3]!), Math.cos(yaw - last[3]!)) / dt, tz = (body.rotation.z - last[8]!) / dt;
  last[0] = p.x; last[1] = p.y; last[2] = p.z; last[3] = yaw;
  last[4] = body.position.x; last[5] = body.position.y; last[6] = body.position.z; last[7] = body.rotation.x; last[8] = body.rotation.z;
  // The first frame has no last position to measure a speed from, the second no last speed to measure a change.
  if (!primed) {
    rig.primed = true;
    was.fill(NaN);
    return false;
  }
  if (Number.isNaN(was[0]!)) {
    was[0] = vx; was[1] = vy; was[2] = vz; was[3] = tx; was[4] = ty; was[5] = tz;
    return false;
  }
  limit(rig.speed, vx - was[0]!, vy - was[1]!, vz - was[2]!, swayConfig.maxSpeedChange);
  limit(rig.spin, tx - was[3]!, ty - was[4]!, tz - was[5]!, swayConfig.maxTurnChange);
  was[0] = vx; was[1] = vy; was[2] = vz; was[3] = tx; was[4] = ty; was[5] = tz;
  return true;
}

function limit(out: Float64Array, x: number, y: number, z: number, most: number): void {
  const size = Math.hypot(x, y, z);
  const k = size > most ? most / size : 1;
  out[0] = x * k; out[1] = y * k; out[2] = z * k;
}
