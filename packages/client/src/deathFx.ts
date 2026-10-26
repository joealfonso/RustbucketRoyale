import * as THREE from "three";
import type { MechModel } from "./mechModel";
import type { Explosions } from "./fx/explosion";
import type { FxSprites } from "./fx/fxSprites";
import { onVfxQuality, vfxLevel, vfxShare } from "./fx/quality";
import { AXIS } from "./fx/sprites";
import { FRAMES } from "./fx/spriteArt";
import {
  IN_AIR, LANDED, flattestAngle, restHeight, seededRandom, stepPiece, tumbleAt,
  type FlyingPiece, type PieceMotion, type TorsoTumble, type TumblePose,
} from "./wreckMotion";
import { LEFT, MIDDLE, RIGHT, sideOf, splitBySide } from "./wreckSplit";

// A knocked-out mech blows apart (gate 13b): a blast at the torso, the arms and gun and one leg fly off tumbling and
// bounce to rest, and the torso is knocked over along the blow, cartwheels and comes to rest lying on the ground,
// pouring black smoke and sparks, then smoking lightly for as long as the wreck is there. The pieces stay on the
// ground for the wreck's life. Only the drawing moves: the wreck's loot point is the server's.
export interface DeathFxConfig {
  maxWrecks: number; // wrecks drawn blown apart at once; past it the oldest goes back to a plain slumped wreck
  meshesPerPiece: number; // pooled meshes for one side of a kit mech's arms, per level of detail
  middleMeters: number; // arm parts nearer the mech's middle than this fly as one piece (a turret), the rest by side
  blast: { meters: number; sparks: number; popSize: number; popSeconds: number; model: string | null };
  torso: TorsoTumble;
  // `legs`: how many legs fly off (0 or 1). `awayShare`: how much of a piece's throw goes along the blow rather than
  // straight out from the torso. `lift` is metres a second up.
  pieces: PieceMotion & { legs: number; speed: number; awayShare: number; lift: number; spin: number; trailEverySeconds: number; landDustMeters: number; model: string | null };
  // While the torso pours (the first `pourSeconds`), thick black puffs at the effects level's deathSmoke a second and
  // sparks; after that a lighter puff every `lingerEverySeconds`, `lingerShare` the size.
  smoke: {
    pourSeconds: number; sparkEverySeconds: number; sparkCount: number; sparkSpeed: number; lingerEverySeconds: number;
    riseSpeed: number; lifeSeconds: number; startSize: number; endSize: number; lingerShare: number; model: string | null;
  };
}

export function parseDeathFx(raw: unknown): DeathFxConfig {
  const d = raw as Record<string, unknown>;
  const numbers = (obj: unknown, keys: string[], what: string) => {
    const o = obj as Record<string, unknown> | undefined;
    for (const k of keys) {
      const v = o?.[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`deathFx.json: ${what}${k} must be a number, 0 or more`);
    }
  };
  numbers(d, ["maxWrecks", "meshesPerPiece", "middleMeters"], "");
  numbers(d?.blast, ["meters", "sparks", "popSize", "popSeconds"], "blast.");
  numbers(d?.torso, ["seconds", "meters", "degrees", "rollDegrees", "hopMeters", "hopShare"], "torso.");
  numbers(d?.pieces, ["legs", "speed", "awayShare", "lift", "spin", "gravity", "bounce", "friction", "spinKeep", "maxBounces", "settleSpeed", "layFlatSeconds", "trailEverySeconds", "landDustMeters"], "pieces.");
  numbers(d?.smoke, ["pourSeconds", "sparkEverySeconds", "sparkCount", "sparkSpeed", "lingerEverySeconds", "riseSpeed", "lifeSeconds", "startSize", "endSize", "lingerShare"], "smoke.");
  const c = raw as DeathFxConfig;
  for (const [name, v] of [["maxWrecks", c.maxWrecks], ["meshesPerPiece", c.meshesPerPiece], ["pieces.maxBounces", c.pieces.maxBounces]] as const) {
    if (!Number.isInteger(v)) throw new Error(`deathFx.json: ${name} must be a whole number`);
  }
  if (c.pieces.legs !== 0 && c.pieces.legs !== 1) throw new Error("deathFx.json: pieces.legs is 0 or 1");
  if (c.torso.hopShare > 1) throw new Error("deathFx.json: torso.hopShare is a share, 0 to 1");
  for (const group of ["blast", "pieces", "smoke"]) {
    const model = (d[group] as Record<string, unknown>).model;
    if (model !== null && typeof model !== "string") throw new Error(`deathFx.json: ${group}.model must be a name or null`);
  }
  return c;
}

const ARMS = 1;
const LEG = 3; // the piece after the three arm sides
const LEVELS = 3;
const MOVED_MAX = 48;
const EMPTY = new THREE.BufferGeometry();
const NOTHING = new THREE.MeshBasicMaterial();
const UP = new THREE.Vector3(0, 1, 0);

interface Piece {
  carrier: THREE.Group; // moved through the world, its origin on the piece's middle
  offset: THREE.Group; // holds the parts where they sat on the mech, shifted so the middle is the carrier's origin
  meshes: THREE.Mesh[]; // pooled, for a kit's merged arms cut by side
  geometries: THREE.BufferGeometry[][]; materials: THREE.Material[][]; depths: (THREE.Material | undefined)[][]; shadows: boolean[][];
  counts: number[]; distances: number[]; levels: number; level: number; // levels of detail, as the merged arms had
  motion: FlyingPiece;
  axis: THREE.Vector3; start: THREE.Quaternion; turn: THREE.Quaternion; // tumble axis, turn when it blew, turn now
  min: THREE.Vector3; max: THREE.Vector3; // its box round its middle
  used: boolean; flying: boolean; still: boolean;
  trail: number;
}

interface Wreck {
  model: MechModel | null;
  started: number; // which blew first, to find the oldest
  age: number;
  torso: THREE.Group; torsoOffset: THREE.Group;
  stash: THREE.Group; // hidden: the merged arms while their cut pieces stand in for them
  pieces: Piece[];
  moved: THREE.Object3D[]; movedFrom: THREE.Object3D[]; movedCount: number; // everything taken off the mech, to put back
  away: THREE.Vector3; // the way the blow pushed, which the pieces are thrown along
  fall: THREE.Vector3; tipAxis: THREE.Vector3; // the way the torso falls: the mech's own front, back or side nearest the blow
  start: THREE.Vector3; startTurn: THREE.Quaternion; // the torso's middle and turn when it blew
  above: number; // how far above lying on the ground it was knocked out (in the air, or standing)
  at: THREE.Vector3; turn: THREE.Quaternion; support: number; // its middle, turn and resting height now
  min: THREE.Vector3; max: THREE.Vector3;
  settled: boolean;
  pour: number; spark: number; linger: number; // seconds to the next puff or shower
}

const piece = (meshesPerPiece: number, nothing: THREE.Material): Piece => {
  const carrier = new THREE.Group(), offset = new THREE.Group();
  carrier.add(offset);
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < meshesPerPiece; i++) {
    const mesh = new THREE.Mesh(EMPTY, nothing);
    mesh.visible = false;
    offset.add(mesh);
    meshes.push(mesh);
  }
  const grid = <T>(fill: T) => Array.from({ length: LEVELS }, () => new Array<T>(meshesPerPiece).fill(fill));
  return {
    carrier, offset, meshes, geometries: grid(EMPTY), materials: grid<THREE.Material>(nothing), depths: grid<THREE.Material | undefined>(undefined), shadows: grid(false),
    counts: [0, 0, 0], distances: [0, 0, 0], levels: 0, level: 0,
    motion: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, spin: 0, restAngle: 0, bounces: 0, down: false },
    axis: new THREE.Vector3(), start: new THREE.Quaternion(), turn: new THREE.Quaternion(), min: new THREE.Vector3(), max: new THREE.Vector3(),
    used: false, flying: false, still: false, trail: 0,
  };
};

// Boxes of what a piece holds, in the frame of the group holding it. Event-time only, but kept allocation-free anyway.
const stack = Array.from({ length: 12 }, () => new THREE.Matrix4());
const partBox = new THREE.Box3();
function grow(o: THREE.Object3D, depth: number, box: THREE.Box3): void {
  if (!o.visible || depth >= stack.length) return;
  o.updateMatrix();
  const m = stack[depth]!.multiplyMatrices(stack[depth - 1]!, o.matrix);
  const mesh = o as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry !== EMPTY && mesh.geometry.attributes.position) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(partBox.copy(mesh.geometry.boundingBox!).applyMatrix4(m));
  }
  for (let i = 0; i < o.children.length; i++) grow(o.children[i]!, depth + 1, box);
}
function boxOf(root: THREE.Object3D, box: THREE.Box3): THREE.Box3 {
  box.makeEmpty();
  stack[0]!.identity();
  for (let i = 0; i < root.children.length; i++) grow(root.children[i]!, 1, box);
  return box;
}

export class DeathFx {
  private wrecks: Wreck[] = [];
  private count = 0;
  private random = { seed: 1 };
  private smokeShare = 1;
  private pose: TumblePose = { along: 0, tip: 0, roll: 0, hop: 0, fall: 0, done: false };
  private box = new THREE.Box3();
  private center = new THREE.Vector3();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private inverse = new THREE.Matrix4();
  private groupTurn = new THREE.Quaternion();
  private resting: Piece | null = null;
  private restingAt = (angle: number) => {
    const p = this.resting!;
    return restHeight(p.min, p.max, this.q2.setFromAxisAngle(p.axis, angle).multiply(p.start));
  };

  // `ground` is the height of whatever is under a point (the hillside, a roof), as main.ts's groundBelow.
  constructor(private sprites: FxSprites, private explosions: Explosions, private config: DeathFxConfig, private ground: (x: number, y: number, z: number) => number) {
    for (let i = 0; i < config.maxWrecks; i++) {
      const torso = new THREE.Group(), torsoOffset = new THREE.Group(), stash = new THREE.Group();
      torso.add(torsoOffset);
      stash.visible = false;
      this.wrecks.push({
        model: null, started: 0, age: 0, torso, torsoOffset, stash,
        pieces: [piece(config.meshesPerPiece, NOTHING), piece(config.meshesPerPiece, NOTHING), piece(config.meshesPerPiece, NOTHING), piece(0, NOTHING)],
        moved: new Array<THREE.Object3D>(MOVED_MAX), movedFrom: new Array<THREE.Object3D>(MOVED_MAX), movedCount: 0,
        away: new THREE.Vector3(), fall: new THREE.Vector3(), tipAxis: new THREE.Vector3(), start: new THREE.Vector3(), startTurn: new THREE.Quaternion(), above: 0,
        at: new THREE.Vector3(), turn: new THREE.Quaternion(), support: 0, min: new THREE.Vector3(), max: new THREE.Vector3(),
        settled: false, pour: 0, spark: 0, linger: 0,
      });
    }
    const share = () => { this.smokeShare = vfxShare("deathSmoke"); };
    share();
    onVfxQuality(share);
  }

  // A mech just knocked out, after setMechDamage has shown it dead. (awayX, awayZ) is the way the killing blow pushed
  // it (from the killer towards it), any length; (0, 0) when nobody knows, and the mech's `seed` picks a way.
  blowApart(model: MechModel, awayX: number, awayZ: number, seed: number): void {
    const w = this.take(model);
    if (!w) return;
    this.dress(w, model, awayX, awayZ, seed);
    const { blast } = this.config;
    const floor = this.ground(w.start.x, w.start.y, w.start.z);
    this.explosions.blast(w.start.x, w.start.y, w.start.z, blast.meters, floor);
    this.explosions.pop(w.start.x, w.start.y, w.start.z, blast.popSize, blast.popSeconds, Math.round(blast.sparks * this.smokeShare));
  }

  // A wreck seen for the first time already knocked out (it came into view, or you joined late): drawn as it would
  // have come to rest, with no blast.
  lieDown(model: MechModel, seed: number): void {
    const w = this.take(model);
    if (!w) return;
    this.dress(w, model, 0, 0, seed);
    w.age = Math.max(this.config.torso.seconds, this.config.smoke.pourSeconds); // past the fall and the pouring
    this.poseTorso(w);
    const step = 1 / 30;
    for (const p of w.pieces) {
      if (!p.flying) continue;
      for (let i = 0; i < 600 && !p.still; i++) this.fly(p, step, true);
    }
    this.place(w);
  }

  // Moves every wreck on and lets off its smoke. Call each frame before drawing, with the camera position for the
  // pieces' levels of detail. A mech that comes back (a respawn) or whose model is gone gives its wreck back.
  update(dt: number, camera: THREE.Vector3): void {
    for (const w of this.wrecks) {
      const model = w.model;
      if (!model) continue;
      if (!model.dead || !model.group.parent) { this.restore(w); continue; }
      w.age += dt;
      if (!w.settled) this.poseTorso(w);
      for (const p of w.pieces) {
        if (p.flying && !p.still) this.fly(p, dt, false);
        if (p.levels > 1) this.showLevel(p, p.flying ? p.motion : w.at, camera);
      }
      this.place(w);
      this.smoke(w, dt);
    }
  }

  // The wreck already drawing this mech, a free one, or the oldest.
  private take(model: MechModel): Wreck | null {
    let found: Wreck | null = null;
    for (const w of this.wrecks) if (w.model === model) found = w;
    if (!found) for (const w of this.wrecks) if (!w.model) { found = w; break; }
    if (!found) for (const w of this.wrecks) if (!found || w.started < found.started) found = w;
    if (found?.model) this.restore(found);
    return found;
  }

  private move(w: Wreck, object: THREE.Object3D, to: THREE.Object3D): void {
    if (w.movedCount >= MOVED_MAX || !object.parent) return;
    w.moved[w.movedCount] = object;
    w.movedFrom[w.movedCount] = object.parent;
    w.movedCount++;
    to.add(object);
  }

  private dress(w: Wreck, model: MechModel, awayX: number, awayZ: number, seed: number): void {
    const { pieces: cfg, middleMeters } = this.config;
    w.model = model;
    w.started = ++this.count;
    w.age = 0; w.settled = false; w.pour = 0; w.spark = 0; w.linger = 0;
    model.blownApart = true;
    model.group.scale.y = 1;
    this.random.seed = seed | 0;
    const rnd = () => seededRandom(this.random);
    const length = Math.hypot(awayX, awayZ);
    if (length > 1e-6) w.away.set(awayX / length, 0, awayZ / length);
    else { const a = rnd() * Math.PI * 2; w.away.set(Math.cos(a), 0, Math.sin(a)); }
    const body = model.body;
    body.updateWorldMatrix(true, false);

    for (const p of w.pieces) {
      p.used = false; p.flying = false; p.still = false; p.levels = 0; p.level = 0; p.trail = 0;
      p.counts[0] = p.counts[1] = p.counts[2] = 0;
    }
    // A kit's arms: the merged pieces showing now go into hiding, and copies cut by side stand in for them.
    model.group.add(w.stash);
    for (const kp of model.kitPieces) {
      if (kp.zone !== ARMS || !kp.object.visible) continue;
      const lod = kp.object;
      this.move(w, lod, w.stash);
      const levels = Math.min(LEVELS, lod.levels.length);
      for (let level = 0; level < levels; level++) {
        const holder = lod.levels[level]!.object;
        for (const child of holder.children) {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) continue;
          const sides = splitBySide(mesh.geometry, middleMeters);
          for (let s = LEFT; s <= RIGHT; s++) {
            const p = w.pieces[s]!, j = p.counts[level]!;
            if (!sides[s] || j >= p.meshes.length) continue;
            p.geometries[level]![j] = sides[s]!;
            p.materials[level]![j] = mesh.material as THREE.Material;
            p.depths[level]![j] = mesh.customDepthMaterial;
            p.shadows[level]![j] = mesh.castShadow;
            p.counts[level] = j + 1;
            p.distances[level] = lod.levels[level]!.distance;
            p.levels = Math.max(p.levels, level + 1);
            p.used = true;
          }
        }
      }
    }
    for (let s = LEFT; s <= RIGHT; s++) this.showMeshes(w.pieces[s]!, 0);
    // Whole things on the arms go with their side: grey-box arms, a plain gun barrel, arm plates, serials.
    const side = (o: THREE.Object3D) => w.pieces[sideOf(o.position.x, middleMeters)]!;
    const loose = (o: THREE.Object3D | undefined) => { if (o) { const p = side(o); this.move(w, o, p.offset); p.used = true; } };
    for (const o of model.armMeshes) loose(o);
    for (const o of model.gunParts) loose(o);
    for (const o of model.plates[ARMS] ?? []) loose(o);
    for (const s of model.serials) if (s.zone === ARMS) loose(s.object);
    // One leg, while there is still a leg to lose.
    if (cfg.legs > 0 && model.hp[0]! > 0) {
      const legs = model.legs.length > 0 ? model.legs.length : model.legMeshes.length;
      const i = Math.floor(rnd() * legs) % Math.max(1, legs);
      const leg = model.legs.length > 0 ? model.legs[i]?.hip : model.legMeshes[i];
      if (leg) { this.move(w, leg, w.pieces[LEG]!.offset); w.pieces[LEG]!.used = true; }
    }

    // The biggest pieces fly, as many as the effects level allows; the rest stay on the torso where they were.
    for (const p of w.pieces) {
      if (!p.used) continue;
      p.offset.position.set(0, 0, 0);
      boxOf(p.offset, this.box);
      if (this.box.isEmpty()) { p.used = false; continue; }
      this.box.getCenter(this.center);
      p.offset.position.copy(this.center).negate();
      p.min.copy(this.box.min).sub(this.center);
      p.max.copy(this.box.max).sub(this.center);
      p.carrier.position.copy(this.center);
      p.carrier.quaternion.identity();
    }
    let flying = 0;
    const cap = vfxLevel().deathPieces ?? 0;
    while (flying < cap) {
      let best: Piece | null = null, bestSize = 0;
      for (const p of w.pieces) {
        if (!p.used || p.flying) continue;
        const size = (p.max.x - p.min.x) * (p.max.y - p.min.y) * (p.max.z - p.min.z);
        if (size > bestSize) { best = p; bestSize = size; }
      }
      if (!best) break;
      best.flying = true;
      flying++;
    }
    for (const p of w.pieces) if (p.used && !p.flying) body.add(p.carrier);

    // The torso: everything left on the body, turned about its own middle.
    boxOf(body, this.box);
    if (this.box.isEmpty()) this.box.set(this.v.set(-1, 0, -1), this.center.set(1, 3, 1));
    this.box.getCenter(this.center);
    w.min.copy(this.box.min).sub(this.center);
    w.max.copy(this.box.max).sub(this.center);
    w.start.copy(this.center).applyMatrix4(body.matrixWorld);
    body.getWorldQuaternion(w.startTurn);
    // Falling over along one of its own sides lets a boxy torso land flat; along a slant it would rest on an edge.
    let best = -Infinity;
    for (let k = 0; k < 4; k++) {
      this.v.set(k === 0 ? 1 : k === 1 ? -1 : 0, 0, k === 2 ? 1 : k === 3 ? -1 : 0).applyQuaternion(w.startTurn);
      this.v.y = 0;
      this.v.normalize();
      const dot = this.v.dot(w.away);
      if (dot > best) { best = dot; w.fall.copy(this.v); }
    }
    w.tipAxis.crossVectors(UP, w.fall).normalize();
    const floor = this.ground(w.start.x, w.start.y, w.start.z);
    w.above = Math.max(0, w.start.y - floor - restHeight(w.min, w.max, w.startTurn));
    w.at.copy(w.start);
    w.turn.copy(w.startTurn);
    w.torsoOffset.position.copy(this.center).negate();

    // The pieces that fly start where they were, thrown out from the torso and along the blow, tumbling end over end.
    for (const p of w.pieces) {
      if (!p.flying) continue;
      const m = p.motion;
      this.v.copy(p.carrier.position).applyMatrix4(body.matrixWorld);
      m.x = this.v.x; m.y = this.v.y; m.z = this.v.z;
      let ox = m.x - w.start.x, oz = m.z - w.start.z;
      const out = Math.hypot(ox, oz);
      if (out > 1e-3) { ox /= out; oz /= out; } else { ox = 0; oz = 0; }
      let dx = ox + w.away.x * cfg.awayShare + (rnd() - 0.5) * 0.4, dz = oz + w.away.z * cfg.awayShare + (rnd() - 0.5) * 0.4;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      const speed = cfg.speed * (0.7 + rnd() * 0.6);
      m.vx = dx * speed; m.vz = dz * speed; m.vy = cfg.lift * (0.7 + rnd() * 0.6);
      m.angle = 0; m.spin = cfg.spin * (0.6 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1);
      m.bounces = 0; m.down = false;
      p.axis.set(dx, 0, dz).cross(UP).normalize();
      p.start.copy(w.startTurn);
      p.turn.copy(w.startTurn);
      model.group.add(p.carrier);
    }
    this.move(w, body, w.torsoOffset);
    model.group.add(w.torso);
    this.place(w);
  }

  private poseTorso(w: Wreck): void {
    const pose = tumbleAt(w.age, this.config.torso, this.pose);
    w.at.x = w.start.x + w.fall.x * pose.along;
    w.at.z = w.start.z + w.fall.z * pose.along;
    w.turn.copy(this.q.setFromAxisAngle(w.fall, pose.roll)).multiply(this.q2.setFromAxisAngle(w.tipAxis, pose.tip)).multiply(w.startTurn);
    w.support = restHeight(w.min, w.max, w.turn);
    w.at.y = this.ground(w.at.x, w.start.y, w.at.z) + w.support + pose.hop + w.above * (1 - pose.fall);
    w.settled = pose.done;
  }

  private fly(p: Piece, dt: number, quiet: boolean): void {
    const m = p.motion;
    p.turn.setFromAxisAngle(p.axis, m.angle).multiply(p.start);
    const ground = this.ground(m.x, m.y, m.z);
    const hit = stepPiece(m, dt, ground + restHeight(p.min, p.max, p.turn), this.config.pieces);
    if (hit === LANDED) {
      this.resting = p;
      m.restAngle = flattestAngle(m.angle, this.restingAt);
    }
    p.turn.setFromAxisAngle(p.axis, m.angle).multiply(p.start);
    if (m.down && m.angle === m.restAngle) p.still = true;
    if (quiet) return;
    if (hit !== IN_AIR) this.sprites.dustPuff(m.x, ground, m.z, this.config.pieces.landDustMeters, 0.6);
    // A smoking trail while it flies, so it can be followed through the air.
    const every = this.config.pieces.trailEverySeconds;
    if (!m.down && every > 0 && this.smokeShare > 0 && (p.trail -= dt) <= 0) {
      p.trail = every / this.smokeShare;
      this.puff(m.x, m.y, m.z, 0.5, 0.5, 0);
    }
  }

  // Each carrier where its piece is in the world, in the frame of the mech's group, which the game keeps moving to
  // the wreck's loot point.
  private place(w: Wreck): void {
    const group = w.model!.group;
    group.updateWorldMatrix(true, false);
    this.inverse.copy(group.matrixWorld).invert();
    group.getWorldQuaternion(this.groupTurn).invert();
    w.torso.position.copy(w.at).applyMatrix4(this.inverse);
    w.torso.quaternion.copy(this.groupTurn).multiply(w.turn);
    for (const p of w.pieces) {
      if (!p.flying) continue;
      p.carrier.position.set(p.motion.x, p.motion.y, p.motion.z).applyMatrix4(this.inverse);
      p.carrier.quaternion.copy(this.groupTurn).multiply(p.turn);
    }
  }

  // The cut arms' level of detail, by distance as the merged arms had it (THREE.LOD's own choice, done by hand
  // because the pooled meshes swap geometry rather than hold every level).
  private showLevel(p: Piece, at: { x: number; y: number; z: number }, camera: THREE.Vector3): void {
    const d = Math.hypot(at.x - camera.x, at.y - camera.y, at.z - camera.z);
    let level = 0;
    while (level + 1 < p.levels && d >= p.distances[level + 1]!) level++;
    if (level !== p.level) this.showMeshes(p, level);
  }

  private showMeshes(p: Piece, level: number): void {
    p.level = level;
    const n = p.counts[level]!;
    for (let j = 0; j < p.meshes.length; j++) {
      const mesh = p.meshes[j]!;
      mesh.visible = j < n;
      mesh.geometry = j < n ? p.geometries[level]![j]! : EMPTY;
      mesh.material = j < n ? p.materials[level]![j]! : NOTHING;
      mesh.customDepthMaterial = j < n ? p.depths[level]![j] : undefined;
      mesh.castShadow = j < n && p.shadows[level]![j]!;
    }
  }

  private smoke(w: Wreck, dt: number): void {
    const { smoke } = this.config;
    if (this.smokeShare <= 0) return;
    const top = w.at.y + w.support * 0.6;
    if (w.age < smoke.pourSeconds) {
      const rate = vfxLevel().deathSmoke ?? 0;
      if (rate > 0 && (w.pour -= dt) <= 0) {
        w.pour = 1 / rate;
        this.puff(w.at.x, top, w.at.z, 1, 1, 1);
      }
      if ((w.spark -= dt) <= 0) {
        w.spark = smoke.sparkEverySeconds / this.smokeShare;
        for (let i = 0; i < smoke.sparkCount; i++) this.spark(w.at.x, top, w.at.z);
      }
    } else if (smoke.lingerEverySeconds > 0 && (w.linger -= dt) <= 0) {
      w.linger = (smoke.lingerEverySeconds / this.smokeShare) * (0.7 + Math.random() * 0.6);
      this.puff(w.at.x, top, w.at.z, smoke.lingerShare, 0.7, 0.6); // short-lived, so a wreck's wisp stays low
    }
  }

  // A black puff `share` the full size, rising; `shade` darkens it as it goes.
  private puff(x: number, y: number, z: number, share: number, lifeShare: number, shade: number): void {
    const s = this.sprites.smoke.spawn();
    if (!s) return;
    const { smoke } = this.config;
    s.x = x + (Math.random() - 0.5) * 0.6; s.y = y; s.z = z + (Math.random() - 0.5) * 0.6;
    s.vx = (Math.random() - 0.5) * 0.8; s.vy = smoke.riseSpeed * (0.8 + Math.random() * 0.4); s.vz = (Math.random() - 0.5) * 0.8;
    s.life = smoke.lifeSeconds * lifeShare * (0.8 + Math.random() * 0.4);
    s.size0 = smoke.startSize * share; s.size1 = smoke.endSize * share;
    s.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
    s.spin = Math.random() * Math.PI * 2; s.spinRate = (Math.random() - 0.5) * 0.8;
    s.shade1 = shade;
    s.fadeShare = 0.4;
  }

  private spark(x: number, y: number, z: number): void {
    const p = this.sprites.sparks.spawn();
    if (!p) return;
    const speed = this.config.smoke.sparkSpeed;
    p.mode = AXIS; p.streak = 0.035;
    p.x = x; p.y = y; p.z = z;
    p.vx = (Math.random() - 0.5) * speed; p.vy = Math.random() * speed * 0.9; p.vz = (Math.random() - 0.5) * speed;
    p.gravity = 20;
    p.life = 0.3 + Math.random() * 0.3;
    p.size0 = p.size1 = 0.1; p.aspect = 2;
    p.frame0 = FRAMES.spark.first;
    p.fadeShare = 0.3;
  }

  // Everything back on the mech as it was built, for a respawn or a model that is gone.
  private restore(w: Wreck): void {
    const model = w.model!;
    for (let i = w.movedCount - 1; i >= 0; i--) {
      w.movedFrom[i]!.add(w.moved[i]!);
      w.moved[i] = w.movedFrom[i] = undefined as unknown as THREE.Object3D;
    }
    w.movedCount = 0;
    w.torso.removeFromParent();
    w.stash.removeFromParent();
    for (const p of w.pieces) {
      p.carrier.removeFromParent();
      p.counts[0] = p.counts[1] = p.counts[2] = 0;
      this.showMeshes(p, 0);
      p.used = p.flying = false;
    }
    model.blownApart = false;
    model.group.scale.y = model.dead ? 0.35 : 1;
    w.model = null;
  }
}
