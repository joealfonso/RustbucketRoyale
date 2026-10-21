import * as THREE from "three";
import lifeJson from "../../../../data/hangarLife.json";
import { toGeometry } from "../dressing/dressing";
import { rng } from "../dressing/kinds";
import { box, cylinder, merge, turn, type MeshData, type V3 } from "../dressing/shapes";
import { freeze } from "../freeze";
import type { Toon } from "../toonMaterial";
import type { HangarConfig } from "./layout";

// Signs of life (gate V12): a crane trolley sliding along a roof truss with its hook, amber beacons turning on the
// gantries, steam puffing from floor vents, and a drone crossing high now and then. All of it is slow, because it
// sits behind the menu and must never pull the eye off the mechs for long. Numbers in data/hangarLife.json.
// `still` is true when the player asked for reduced motion: then everything stops dead in its rest pose (crane parked
// at its first stop with the hook hanging straight, beacons lit but not turning, no steam, no drone).

type Range = [number, number];

export interface LifeConfig {
  // The crane runs on a rail under one roof truss (`truss` counts from the back wall), along `stops` on x and back.
  crane: {
    truss: number; rail: string; belowRoof: number; railDepth: number; stops: number[]; metersPerSecond: number;
    pauseSeconds: Range; cableMeters: number; swayDamping: number; trolley: string; block: string; hook: string; seed: number;
  };
  // Lamps on top of the gantry beams, each throwing a flat beam card round as it turns. No glow, no light.
  beacons: { spots: V3[]; turnsPerSecond: number; lamp: string; lampSize: Range; base: string; beamMeters: number; beamWidth: Range; beamOpacity: number };
  // Floor vents at (x, z), each sighing out bursts of toon puffs (one every `everySeconds` for `burstSeconds`, then
  // quiet for `restSeconds`) from one shared pool.
  steam: {
    vents: [number, number][]; pool: number; everySeconds: Range; burstSeconds: Range; restSeconds: Range; lifeSeconds: Range; riseMetersPerSecond: Range;
    drift: [number, number]; spread: number; size: Range; color: string; grate: string; hole: string; grateSize: number; seed: number;
  };
  // A small drone flying `from` → `to` (and back on the next pass), with a wait between passes.
  drone: {
    from: V3; to: V3; metersPerSecond: number; everySeconds: Range; firstAfterSeconds: number; bobMeters: number;
    bobSeconds: number; leanDegrees: number; body: string; lamp: string; seed: number;
  };
}

export function parseHangarLife(raw: unknown, hall: HangarConfig["hall"]): LifeConfig {
  const c = raw as LifeConfig;
  const fail = (what: string): never => { throw new Error(`hangarLife.json: ${what}`); };
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const positive = (v: unknown, what: string) => { if (!num(v) || !((v as number) > 0)) fail(`${what} must be a number above 0`); };
  const range = (v: unknown, what: string) => {
    if (!Array.isArray(v) || v.length !== 2 || !num(v[0]) || !num(v[1]) || !(v[0] > 0) || v[0] > v[1]) fail(`${what} must be [low, high], both above 0`);
  };
  const v3 = (v: unknown, what: string) => { if (!Array.isArray(v) || v.length !== 3 || !v.every(num)) fail(`${what} must be [x, y, z]`); };
  const paint = (v: unknown, what: string) => { if (typeof v !== "string" || v.length === 0) fail(`${what} must be a palette name or hex colour`); };
  const insideHall = (x: number, z: number, what: string) => {
    if (Math.abs(x) > hall.halfWidth || z < hall.backZ || z > hall.frontZ) fail(`${what} is outside the hall`);
  };
  if (!c?.crane || !c.beacons || !c.steam || !c.drone) fail("needs crane, beacons, steam and drone");

  const k = c.crane;
  if (!Number.isInteger(k.truss) || k.truss < 0 || hall.backZ + hall.trussSpacing * (k.truss + 0.5) >= hall.frontZ) fail("crane.truss names a truss the hall does not have");
  for (const [v, what] of [[k.belowRoof, "belowRoof"], [k.railDepth, "railDepth"], [k.metersPerSecond, "metersPerSecond"], [k.cableMeters, "cableMeters"], [k.swayDamping, "swayDamping"]] as const) positive(v, `crane.${what}`);
  range(k.pauseSeconds, "crane.pauseSeconds");
  if (!Array.isArray(k.stops) || k.stops.length < 2 || !k.stops.every((x) => num(x) && Math.abs(x) < hall.halfWidth)) fail("crane.stops needs two or more x positions inside the hall");
  if (k.belowRoof + k.railDepth + k.cableMeters + 2 > hall.height) fail("crane hangs its hook into the floor");
  for (const p of ["rail", "trolley", "block", "hook"] as const) paint(k[p], `crane.${p}`);

  const b = c.beacons;
  if (!Array.isArray(b.spots)) fail("beacons.spots must be a list");
  b.spots.forEach((s, i) => { v3(s, `beacons.spots[${i}]`); insideHall(s[0], s[2], `beacons.spots[${i}]`); });
  positive(b.turnsPerSecond, "beacons.turnsPerSecond");
  positive(b.beamMeters, "beacons.beamMeters");
  range(b.beamWidth, "beacons.beamWidth");
  range(b.lampSize, "beacons.lampSize");
  if (!(b.beamOpacity > 0 && b.beamOpacity <= 1)) fail("beacons.beamOpacity must be above 0 and at most 1");
  paint(b.lamp, "beacons.lamp"); paint(b.base, "beacons.base");

  const s = c.steam;
  if (!Array.isArray(s.vents)) fail("steam.vents must be a list");
  s.vents.forEach((v, i) => { if (!Array.isArray(v) || v.length !== 2 || !v.every(num)) fail(`steam.vents[${i}] must be [x, z]`); insideHall(v[0], v[1], `steam.vents[${i}]`); });
  if (!Number.isInteger(s.pool) || s.pool < 1) fail("steam.pool must be a whole number above 0");
  for (const r of ["everySeconds", "burstSeconds", "restSeconds", "lifeSeconds", "riseMetersPerSecond", "size"] as const) range(s[r], `steam.${r}`);
  if (!Array.isArray(s.drift) || s.drift.length !== 2 || !s.drift.every(num)) fail("steam.drift must be [x, z] metres per second");
  if (!num(s.spread) || s.spread < 0) fail("steam.spread must be a number, 0 or more");
  positive(s.grateSize, "steam.grateSize");
  for (const p of ["color", "grate", "hole"] as const) paint(s[p], `steam.${p}`);

  const d = c.drone;
  v3(d.from, "drone.from"); v3(d.to, "drone.to");
  for (const [v, what] of [[d.metersPerSecond, "metersPerSecond"], [d.bobSeconds, "bobSeconds"], [d.firstAfterSeconds, "firstAfterSeconds"]] as const) positive(v, `drone.${what}`);
  range(d.everySeconds, "drone.everySeconds");
  if (!num(d.bobMeters) || !num(d.leanDegrees)) fail("drone.bobMeters and drone.leanDegrees must be numbers");
  if (Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1], d.to[2] - d.from[2]) < 1) fail("drone.from and drone.to are too close together");
  paint(d.body, "drone.body"); paint(d.lamp, "drone.lamp");
  for (const seed of [k.seed, s.seed, d.seed]) if (!Number.isInteger(seed)) fail("every seed must be a whole number");
  return c;
}

// Scratch for the frame loop, so update() allocates nothing.
const at = new THREE.Vector3();
const size = new THREE.Vector3();
const spun = new THREE.Quaternion();
const placed = new THREE.Matrix4();
const gone = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 9.8;
const GOLDEN_ANGLE = 2.39996; // spreads the beacons' starting angles so no two turn in step

type Pieces = Map<string, MeshData[]>;
const add = (pieces: Pieces, paint: string, ...meshes: MeshData[]) => {
  const list = pieces.get(paint);
  if (list) list.push(...meshes);
  else pieces.set(paint, [...meshes]);
};

// Indexed rather than destructured: array destructuring walks an iterator, which allocates in the frame loop.
const between = (random: () => number, r: Range) => r[0] + (r[1] - r[0]) * random();

// A toon mesh and its ink outline, the way the hall draws every solid piece.
function inked(toon: Toon, paint: string, meshes: MeshData[]): THREE.Mesh[] {
  const geometry = toGeometry(meshes);
  return [new THREE.Mesh(geometry, toon.material(paint)), new THREE.Mesh(geometry, toon.shellOutline(paint))];
}

export class HangarLife {
  readonly group = new THREE.Group();
  private crane: Crane;
  private beacons: Beacons;
  private steam: Steam;
  private drone: Drone;

  constructor(config: HangarConfig, toon: Toon) {
    const c = parseHangarLife(lifeJson, config.hall);
    // Everything that never moves (the crane rail, beacon bases and lamps, vent grates) in one mesh per paint.
    const pieces: Pieces = new Map();
    this.crane = new Crane(c.crane, config.hall, toon, pieces);
    this.beacons = new Beacons(c.beacons, toon, pieces);
    this.steam = new Steam(c.steam, toon, pieces);
    this.drone = new Drone(c.drone, toon);
    const lamp = pieces.get("@lamp");
    pieces.delete("@lamp");
    const hole = pieces.get("@hole");
    pieces.delete("@hole");
    for (const [paint, meshes] of pieces) for (const mesh of inked(toon, paint, meshes)) this.group.add(freeze(mesh));
    // Lamps are flat light, like the work lamp's face in the hall; the vent holes are too dark to need an outline.
    if (lamp) this.group.add(freeze(new THREE.Mesh(toGeometry(lamp), new THREE.MeshBasicMaterial({ color: toon.color(c.beacons.lamp), fog: false }))));
    if (hole) this.group.add(freeze(new THREE.Mesh(toGeometry(hole), toon.material(c.steam.hole))));
    this.group.add(this.crane.group, this.beacons.mesh, this.steam.puffs, this.steam.outline, this.drone.group);
  }

  update(seconds: number, dt: number, still: boolean): void {
    this.crane.update(dt, still);
    this.beacons.update(seconds, still);
    this.steam.update(dt, still);
    this.drone.update(seconds, dt, still);
  }
}

// The overhead crane: an I-beam rail under a roof truss, a trolley that runs along it from stop to stop and waits,
// and a hook block on its cable that lags when the trolley starts and swings on when it stops, so it feels heavy.
class Crane {
  readonly group = new THREE.Group(); // the trolley; slides along x
  private swing = new THREE.Group(); // the cable and hook; swings about the hoist under the trolley
  private random: () => number;
  private stop = 0; // the stop it is at, or heading for
  private step = 1; // which way along the stops it is working: there and back, like a real job
  private from = 0;
  private x = 0;
  private moving = false;
  private elapsed = 0;
  private duration = 0;
  private wait = 0;
  private angle = 0;
  private spin = 0;
  private length: number;

  constructor(private c: LifeConfig["crane"], hall: HangarConfig["hall"], toon: Toon, pieces: Pieces) {
    this.random = rng(c.seed);
    const z = hall.backZ + hall.trussSpacing * (c.truss + 0.5);
    const top = hall.height - c.belowRoof;
    const bottom = top - c.railDepth;
    const flange = 0.07;
    // The rail spans the hall wall to wall, like a real runway beam.
    const span = hall.halfWidth * 2;
    add(pieces, c.rail,
      box([0, top - flange / 2, z], [span, flange, 0.4]),
      box([0, (top + bottom) / 2, z], [span, c.railDepth - flange * 2, 0.08]),
      box([0, bottom + flange / 2, z], [span, flange, 0.4]));
    // The trolley rides the bottom flange on wheels either side of the web, the hoist drum slung under it.
    const hoist = bottom - 0.75;
    const trolley = merge(
      box([0, bottom - 0.28, 0], [1.1, 0.42, 0.85], 0.04),
      box([-0.35, bottom + 0.12, 0.17], [0.22, 0.18, 0.1]),
      box([0.35, bottom + 0.12, 0.17], [0.22, 0.18, 0.1]),
      box([-0.35, bottom + 0.12, -0.17], [0.22, 0.18, 0.1]),
      box([0.35, bottom + 0.12, -0.17], [0.22, 0.18, 0.1]),
      cylinder([0, hoist + 0.1, 0], 0.17, 0.8, "x", 8),
    );
    this.group.add(...inked(toon, c.trolley, [trolley]));
    // Two falls of cable down to the block, and a plain hook under it, all from the hoist at the swing's origin.
    const cable = c.cableMeters;
    const blockHeight = 0.55;
    const hook = merge(
      cylinder([-0.1, -cable / 2, 0], 0.03, cable, "y", 5),
      cylinder([0.1, -cable / 2, 0], 0.03, cable, "y", 5),
      cylinder([0, -cable - blockHeight - 0.12, 0], 0.05, 0.24, "y", 6),
      box([0.04, -cable - blockHeight - 0.33, 0], [0.34, 0.09, 0.09]),
      box([0.17, -cable - blockHeight - 0.25, 0], [0.09, 0.22, 0.09]),
    );
    const block = box([0, -cable - blockHeight / 2, 0], [0.42, blockHeight, 0.3], 0.05);
    this.swing.add(new THREE.Mesh(toGeometry([hook]), toon.material(c.hook)), ...inked(toon, c.block, [block]));
    this.swing.position.y = hoist;
    this.group.add(this.swing);
    this.group.position.z = z;
    // How far the hook's weight sits below the pivot, for the swing's period.
    this.length = cable + blockHeight * 0.6;
    this.rest();
  }

  // Parked at its first stop, hook hanging straight, about to wait.
  private rest(): void {
    this.stop = 0;
    this.step = 1;
    this.x = this.c.stops[0]!;
    this.moving = false;
    this.wait = between(this.random, this.c.pauseSeconds);
    this.angle = 0;
    this.spin = 0;
    this.place();
  }

  private place(): void {
    this.group.position.x = this.x;
    this.swing.rotation.z = this.angle;
  }

  update(dt: number, still: boolean): void {
    if (still) {
      if (this.x !== this.c.stops[0] || this.moving || this.angle !== 0) this.rest();
      return;
    }
    const stops = this.c.stops;
    let pull = 0; // the trolley's acceleration along x, which the hook feels as a push the other way
    if (this.moving) {
      this.elapsed += dt;
      const u = Math.min(1, this.elapsed / this.duration);
      const distance = stops[this.stop]! - this.from;
      // Smoothstep: eases away and eases in, so it never jerks.
      this.x = this.from + distance * u * u * (3 - 2 * u);
      pull = u < 1 ? (distance / (this.duration * this.duration)) * (6 - 12 * u) : 0;
      if (u >= 1) {
        this.moving = false;
        this.wait = between(this.random, this.c.pauseSeconds);
      }
    } else {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.from = this.x;
        if (this.stop + this.step < 0 || this.stop + this.step >= stops.length) this.step = -this.step;
        this.stop += this.step;
        // Smoothstep peaks at 1.5 times its average speed: stretched by that, its top speed is metersPerSecond.
        this.duration = (Math.abs(stops[this.stop]! - this.from) / this.c.metersPerSecond) * 1.5;
        this.elapsed = 0;
        this.moving = this.duration > 0;
      }
    }
    // A damped pendulum driven by the trolley's acceleration.
    const accel = -(GRAVITY / this.length) * Math.sin(this.angle) - this.c.swayDamping * this.spin - (pull / this.length) * Math.cos(this.angle);
    this.spin += accel * dt;
    this.angle += this.spin * dt;
    this.place();
  }
}

// Amber warning beacons: a lamp on a short base, and a pair of flat beam cards (a vertical and a flat blade each
// way, so a beam still reads when it points across the view) turning round it. The cards fade to nothing at the tip.
// All the cards are one instanced mesh, so every beacon's beam costs one draw call together.
class Beacons {
  readonly mesh: THREE.InstancedMesh;
  private centres: THREE.Vector3[];

  constructor(private c: LifeConfig["beacons"], toon: Toon, pieces: Pieces) {
    const [radius, lampHeight] = c.lampSize;
    const baseHeight = lampHeight * 0.4;
    for (const [x, y, z] of c.spots) {
      add(pieces, c.base, cylinder([x, y + baseHeight / 2, z], radius * 1.5, baseHeight, "y", 8));
      add(pieces, "@lamp", cylinder([x, y + baseHeight + lampHeight / 2, z], radius, lampHeight, "y", 8, radius * 0.7));
    }
    this.centres = c.spots.map(([x, y, z]) => new THREE.Vector3(x, y + baseHeight + lampHeight * 0.45, z));
    const material = new THREE.MeshBasicMaterial({ color: toon.color(c.lamp), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.InstancedMesh(beamCards(c), material, c.spots.length);
    this.mesh.frustumCulled = false; // a few cards turning in place; not worth keeping bounds for
    this.mesh.renderOrder = 1; // after the opaque hall, so the cards blend over it
    this.update(0, true);
  }

  update(seconds: number, still: boolean): void {
    this.mesh.visible = !still; // a beam frozen mid-turn reads as a solid wedge, so at rest only the lamp is lit
    if (still) return;
    const turn = seconds * this.c.turnsPerSecond * Math.PI * 2;
    for (let i = 0; i < this.centres.length; i++) {
      spun.setFromAxisAngle(UP, turn + i * GOLDEN_ANGLE);
      placed.compose(this.centres[i]!, spun, size.set(1, 1, 1));
      this.mesh.setMatrixAt(i, placed);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// One beacon's beams along ±x from just inside the lamp: each a vertical card and a flat card, widening from
// `beamWidth[0]` to `[1]` and fading from `beamOpacity` to clear.
function beamCards(c: LifeConfig["beacons"]): THREE.BufferGeometry {
  const r0 = c.lampSize[0] * 0.8, r1 = c.beamMeters;
  const [w0, w1] = [c.beamWidth[0] / 2, c.beamWidth[1] / 2];
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (const side of [-1, 1]) {
    for (const flat of [false, true]) {
      const base = positions.length / 3;
      const spread = (x: number, w: number) => (flat ? [x * side, 0, w] : [x * side, w, 0]);
      positions.push(...spread(r0, -w0), ...spread(r0, w0), ...spread(r1, w1), ...spread(r1, -w1));
      colors.push(1, 1, 1, c.beamOpacity, 1, 1, 1, c.beamOpacity, 1, 1, 1, 0, 1, 1, 1, 0);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
}

const STRIDE = 9; // numbers kept per steam puff

// Steam from floor vents: toon puffs that rise, swell, drift and shrink away, from a fixed pool in one instanced
// mesh (and its outline), so the whole effect is two draw calls and nothing is made per frame.
class Steam {
  readonly puffs: THREE.InstancedMesh;
  readonly outline: THREE.InstancedMesh;
  private random: () => number;
  private untilNext: Float32Array; // per vent: until its next puff
  private blowing: Uint8Array; // per vent: 1 while it blows, 0 while it rests
  private phaseLeft: Float32Array; // per vent: seconds left blowing or resting
  private state: Float32Array; // per puff: x, y, z, rise speed, age, life, turn, sideways x, sideways z
  private next = 0; // the pool slot the next puff takes

  constructor(private c: LifeConfig["steam"], toon: Toon, pieces: Pieces) {
    this.random = rng(c.seed);
    // A grate on the deck plates over a dark hole: a frame round the edge and bars across.
    const g = c.grateSize, bar = 0.07, lift = 0.04;
    for (const [x, z] of c.vents) {
      add(pieces, "@hole", box([x, 0.004, z], [g, 0.008, g]));
      add(pieces, c.grate,
        box([x, lift / 2, z - g / 2], [g, lift, bar]), box([x, lift / 2, z + g / 2], [g, lift, bar]),
        box([x - g / 2, lift / 2, z], [bar, lift, g]), box([x + g / 2, lift / 2, z], [bar, lift, g]));
      for (let k = 1; k < 5; k++) add(pieces, c.grate, box([x - g / 2 + (g * k) / 5, lift / 2, z], [bar * 0.6, lift * 0.8, g]));
    }
    const geometry = toGeometry([puffShape()]);
    this.puffs = new THREE.InstancedMesh(geometry, toon.instanced(toon.material(c.color)), c.pool);
    this.outline = new THREE.InstancedMesh(geometry, toon.instanced(toon.shellOutline(c.color)), c.pool);
    this.outline.instanceMatrix = this.puffs.instanceMatrix; // one set of matrices drives both
    this.puffs.frustumCulled = this.outline.frustumCulled = false; // the puffs move every frame, so bounds are never right
    this.state = new Float32Array(c.pool * STRIDE);
    this.untilNext = new Float32Array(c.vents.length);
    this.blowing = new Uint8Array(c.vents.length);
    this.phaseLeft = new Float32Array(c.vents.length);
    this.clear();
  }

  // No puffs in the air; each vent starts at a different point in its rhythm.
  private clear(): void {
    for (let i = 0; i < this.c.pool; i++) {
      this.state[i * STRIDE + 4] = 1;
      this.state[i * STRIDE + 5] = 1;
      this.puffs.setMatrixAt(i, gone);
    }
    for (let v = 0; v < this.untilNext.length; v++) {
      this.untilNext[v] = between(this.random, this.c.everySeconds);
      this.blowing[v] = 0;
      this.phaseLeft[v] = between(this.random, this.c.restSeconds);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, still: boolean): void {
    const c = this.c;
    if (still) {
      if (this.puffs.visible) { this.clear(); this.puffs.visible = this.outline.visible = false; }
      return;
    }
    this.puffs.visible = this.outline.visible = true;
    for (let v = 0; v < c.vents.length; v++) {
      // Blowing or resting, each for a while, then the other.
      this.phaseLeft[v]! -= dt;
      if (this.phaseLeft[v]! <= 0) {
        this.blowing[v] = this.blowing[v] ? 0 : 1;
        this.phaseLeft[v] = between(this.random, this.blowing[v] ? c.burstSeconds : c.restSeconds);
      }
      if (!this.blowing[v]) continue;
      this.untilNext[v]! -= dt;
      if (this.untilNext[v]! <= 0) {
        this.untilNext[v] = between(this.random, c.everySeconds);
        this.spawn(c.vents[v]!);
      }
    }
    const driftX = c.drift[0], driftZ = c.drift[1];
    const small = c.size[0], big = c.size[1];
    for (let i = 0; i < c.pool; i++) {
      const p = i * STRIDE;
      if (this.state[p + 4]! >= this.state[p + 5]!) continue;
      this.state[p + 4]! += dt;
      const k = this.state[p + 4]! / this.state[p + 5]!;
      if (k >= 1) { this.puffs.setMatrixAt(i, gone); continue; }
      // Rises fast out of the grate and slows as it cools; drifts with the hall's air.
      // Each puff also wanders a little its own way, so the column loosens as it climbs instead of stacking.
      this.state[p]! += (driftX + this.state[p + 7]! * k) * dt;
      this.state[p + 1]! += this.state[p + 3]! * (1 - 0.6 * k) * dt;
      this.state[p + 2]! += (driftZ + this.state[p + 8]! * k) * dt;
      // Swells quickly, then shrinks to nothing over its last third: a cartoon puff, not a fade.
      const swell = 1 - (1 - Math.min(1, k * 2)) ** 2;
      const scale = (small + (big - small) * swell) * Math.min(1, (1 - k) * 3);
      spun.setFromAxisAngle(UP, this.state[p + 6]! + k * 0.8);
      placed.compose(at.set(this.state[p]!, this.state[p + 1]!, this.state[p + 2]!), spun, size.set(scale, scale, scale));
      this.puffs.setMatrixAt(i, placed);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  private spawn(vent: [number, number]): void {
    const x = vent[0], z = vent[1];
    const i = this.next;
    this.next = (this.next + 1) % this.c.pool;
    const p = i * STRIDE;
    const g = this.c.grateSize * 0.3;
    this.state[p] = x + (this.random() - 0.5) * g;
    this.state[p + 1] = 0.1;
    this.state[p + 2] = z + (this.random() - 0.5) * g;
    this.state[p + 3] = between(this.random, this.c.riseMetersPerSecond);
    this.state[p + 4] = 0;
    this.state[p + 5] = between(this.random, this.c.lifeSeconds);
    this.state[p + 6] = this.random() * Math.PI * 2;
    this.state[p + 7] = (this.random() - 0.5) * this.c.spread * 2;
    this.state[p + 8] = (this.random() - 0.5) * this.c.spread * 2;
  }
}

// A round lump of radius 1: an icosahedron split once (80 triangles), with normals from the centre so the toon
// bands fall on it smoothly like a cloud. Flat faces read as a pile of rocks.
function puffShape(): MeshData {
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const positions = [...sphere.attributes.position!.array];
  sphere.dispose();
  return { positions, normals: positions.slice(), indices: Array.from({ length: positions.length / 3 }, (_, i) => i) };
}

// A small quad-rotor drone in Aegis factory white with one blue status lamp, crossing high over the hall now and
// then: from one end to the other, then back the other way on the next pass. Leans into its flight and bobs a little.
class Drone {
  readonly group = new THREE.Group();
  private random: () => number;
  private wait: number;
  private flying = false;
  private travelled = 0;
  private outward = true;
  private length: number;
  private heading = 0;
  private start: V3; // this pass's ends
  private end: V3;

  constructor(private c: LifeConfig["drone"], toon: Toon) {
    this.random = rng(c.seed);
    const arm = box([0, 0, 0], [0.95, 0.05, 0.07]);
    const rotors: MeshData[] = [];
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) rotors.push(cylinder([x * 0.34, 0.07, z * 0.34], 0.2, 0.025, "y", 10));
    const body = merge(
      box([0, 0, 0], [0.5, 0.16, 0.38], 0.03),
      turn(arm, [0, Math.PI / 4, 0]),
      turn(arm, [0, -Math.PI / 4, 0]),
      ...rotors,
    );
    this.group.add(...inked(toon, c.body, [body]));
    const lamp = new THREE.Mesh(toGeometry([box([0.2, -0.1, 0], [0.1, 0.05, 0.12])]), new THREE.MeshBasicMaterial({ color: toon.color(c.lamp), fog: false }));
    this.group.add(lamp);
    this.length = Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1], c.to[2] - c.from[2]);
    this.wait = c.firstAfterSeconds;
    this.group.visible = false;
    this.start = c.from;
    this.end = c.to;
  }

  update(seconds: number, dt: number, still: boolean): void {
    const c = this.c;
    if (still) {
      // Away out of sight; the next pass starts fresh when motion is back.
      this.group.visible = this.flying = false;
      this.wait = c.firstAfterSeconds;
      return;
    }
    if (!this.flying) {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.flying = true;
      this.travelled = 0;
      this.group.visible = true;
      this.start = this.outward ? c.from : c.to;
      this.end = this.outward ? c.to : c.from;
      this.heading = Math.atan2(-(this.end[2] - this.start[2]), this.end[0] - this.start[0]);
    }
    this.travelled += c.metersPerSecond * dt;
    const u = this.travelled / this.length;
    if (u >= 1) {
      this.flying = this.group.visible = false;
      this.outward = !this.outward;
      this.wait = between(this.random, c.everySeconds);
      return;
    }
    const a = this.start, b = this.end;
    const bob = Math.sin((seconds / c.bobSeconds) * Math.PI * 2) * c.bobMeters;
    this.group.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + bob, a[2] + (b[2] - a[2]) * u);
    // Built facing +x: turned to its heading, nose dipped into the flight.
    this.group.rotation.set(0, this.heading, -THREE.MathUtils.degToRad(c.leanDegrees));
  }
}
