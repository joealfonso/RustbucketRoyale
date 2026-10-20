import * as THREE from "three";
import { createGrenade, stepGrenade, type CarStats, type GrenadeState, type World } from "@rustbucket/shared";
import type { FxSprites } from "./fx/fxSprites";
import { vfxShare } from "./fx/quality";
import { FRAMES } from "./fx/spriteArt";
import { castShadows } from "./sunShadows";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readKitState } from "./mechKit";
import type { Toon } from "./toonMaterial";
import type { TitanLook } from "./titanLook";

// A scrap car as the Titan throws it. From the Titan kit's car model (data/mechKits.json titan.car) once that loads,
// grey-box toon boxes until then. Built round its middle with its length along x, so it tumbles about its own centre.
// `paint` are the meshes whose colour changes from car to car, `hulls` their outlines.
export interface Car { group: THREE.Group; paint: THREE.Mesh[]; hulls: THREE.Mesh[]; shell: boolean }

// The car model's parts, each with its levels of detail and its paint, `body` for the one painted per car.
export interface CarModel { parts: { lods: THREE.BufferGeometry[]; color: string; body: boolean }[]; lodDistances: number[]; center: THREE.Vector3; turn: number }

interface CarKit { file?: string; scheme?: Record<string, string>; car?: { file: string; parts: Record<string, { paint: string }> } }

// Loads the car of a kit that has one. Null (and says why in the console) if it has none or will not load.
export async function loadCarModel(kits: { lodDistances: number[]; kits: Record<string, unknown> }, kitId: string, base = "/"): Promise<CarModel | null> {
  const kit = kits.kits[kitId] as CarKit | undefined;
  if (!kit?.car) return null;
  try {
    const scene = (await new GLTFLoader().loadAsync(`${base}${kit.car.file}`)).scene;
    const parts: CarModel["parts"] = [];
    const box = new THREE.Box3();
    for (const [name, p] of Object.entries(kit.car.parts)) {
      const state = readKitState(scene, [name, `${name}_LOD1`, `${name}_LOD2`], "");
      if (!state) throw new Error(`no ${name}`);
      for (const g of state.lods) { g.computeBoundingBox(); box.union(g.boundingBox!); }
      // The first part is the body, the one each car paints its own colour.
      parts.push({ lods: state.lods, color: kit.scheme?.[p.paint] ?? p.paint, body: parts.length === 0 });
    }
    const size = box.getSize(new THREE.Vector3());
    return { parts, lodDistances: kits.lodDistances, center: box.getCenter(new THREE.Vector3()), turn: size.z > size.x ? Math.PI / 2 : 0 };
  } catch (error) {
    console.warn(`The Titan's car could not be loaded, using grey boxes:`, error);
    return null;
  }
}

export function buildCar(toon: Toon, look: TitanLook["throw"], model: CarModel | null): Car {
  const group = new THREE.Group();
  const color = look.carColors[0]!;
  if (model) {
    // Turned so its length lies along x, and moved so its middle is the group's.
    const inner = new THREE.Group();
    inner.rotation.y = model.turn;
    const middle = new THREE.Group();
    middle.position.copy(model.center).negate();
    inner.add(middle);
    group.add(inner);
    const paint: THREE.Mesh[] = [], hulls: THREE.Mesh[] = [];
    for (const part of model.parts) {
      const lod = new THREE.LOD();
      part.lods.forEach((g, level) => {
        const holder = new THREE.Group();
        const mesh = new THREE.Mesh(g, toon.material(part.body ? color : part.color));
        const hull = new THREE.Mesh(g, toon.shellOutline(part.body ? color : part.color));
        holder.add(mesh, hull);
        if (part.body) { paint.push(mesh); hulls.push(hull); }
        lod.addLevel(holder, level === 0 ? 0 : model.lodDistances[level - 1]!);
      });
      middle.add(lod);
    }
    return { group, paint, hulls, shell: true };
  }
  const [length, height, width] = look.carMeters as [number, number, number];
  const body = toon.box(group, [0, -height * 0.15, 0], [length, height * 0.55, width], color);
  const cab = toon.box(group, [-length * 0.08, height * 0.3, 0], [length * 0.5, height * 0.45, width * 0.9], color);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) toon.box(group, [sx * length * 0.32, -height * 0.42, sz * width * 0.45], [height * 0.45, height * 0.45, width * 0.18], "soot");
  return { group, paint: [body.mesh, cab.mesh], hulls: [body.hull, cab.hull], shell: false };
}

export function paintCar(toon: Toon, car: Car, color: string): void {
  for (const mesh of car.paint) mesh.material = toon.material(color);
  for (const hull of car.hulls) hull.material = car.shell ? toon.shellOutline(color) : toon.outlineMaterial(color);
}

// How long a thrown car flies before it lands, as the server aims it (shared titan.ts aimCar): a whole number of
// steps, the fuse half a step short so it cannot miss the last one by a rounding.
export function carFuseSeconds(flightSeconds: number, step: number): number {
  return (Math.max(1, Math.round(flightSeconds / step)) - 0.5) * step;
}

// Where a car thrown from (x, y, z) at (vx, vy, vz) comes down: the same steps the server and `step` take, run ahead
// at the moment of the throw (a few hundred small steps, once per throw). Writes into `out`.
const ahead = createGrenade();
export function carLanding(x: number, y: number, z: number, vx: number, vy: number, vz: number, car: CarStats, fuseSeconds: number, step: number, world: World, out: { x: number; y: number; z: number }): void {
  Object.assign(ahead, { x, y, z, vx, vy, vz, timeLeft: fuseSeconds });
  for (let i = 0; i < 10000 && !stepGrenade(ahead, car, step, world); i++);
  out.x = ahead.x; out.y = ahead.y; out.z = ahead.z;
}

interface Flying {
  car: Car;
  state: GrenadeState;
  active: boolean;
  settled: boolean;
  hideIn: number; // landed here without word from the server: gone after this long anyway
  axis: THREE.Vector3; // tumbles end over end about this
  heading: THREE.Quaternion; // its length along the throw
  angle: number;
  trail: number; // seconds to the next puff of its burning trail
}

const UP = new THREE.Vector3(0, 1, 0);
const HIDE_SECONDS = 0.5;

// Cars in flight. Each flies the shared grenade step with the server's car numbers, on the fixed sim step, the same
// arc the server flies it, so only the throw and the landing are sent (as grenades are, grenades.ts). It burns as it
// goes: a puff of fire and smoke behind it every few hundredths of a second, fewer on low effects. Pooled.
export class ThrownCars {
  readonly group = new THREE.Group();
  private pool: Flying[] = [];

  constructor(private toon: Toon, private look: TitanLook["throw"], private stats: CarStats, private fuseSeconds: number, private sprites: FxSprites) {
    for (let i = 0; i < look.maxCars; i++) {
      const car = buildCar(toon, look, null);
      car.group.visible = false;
      this.group.add(car.group);
      this.pool.push({ car, state: createGrenade(), active: false, settled: false, hideIn: 0, axis: new THREE.Vector3(), heading: new THREE.Quaternion(), angle: 0, trail: 0 });
    }
  }

  // The car model arrived: every car is drawn from it from now on, mid-flight ones too.
  useModel(model: CarModel): void {
    for (const f of this.pool) {
      const car = buildCar(this.toon, this.look, model);
      car.group.visible = f.car.group.visible;
      car.group.position.copy(f.car.group.position);
      car.group.quaternion.copy(f.car.group.quaternion);
      this.group.remove(f.car.group);
      this.group.add(car.group);
      f.car = car;
    }
    castShadows(this.group);
  }

  get flying(): number {
    let n = 0;
    for (const f of this.pool) if (f.active) n++;
    return n;
  }

  // `color` picks the paint from the look's car colours, so it can match the car the Titan was seen holding.
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number): void {
    const f = this.pool.find((c) => !c.active) ?? this.pool[0]!;
    Object.assign(f.state, { x, y, z, vx, vy, vz, timeLeft: this.fuseSeconds });
    f.active = true;
    f.settled = false;
    f.angle = 0;
    f.trail = 0;
    // End over end along its flight, nose first.
    f.axis.set(vx, 0, vz);
    if (f.axis.lengthSq() < 1e-6) f.axis.set(1, 0, 0);
    f.axis.normalize().cross(UP).normalize();
    f.heading.setFromAxisAngle(UP, Math.atan2(-vz, vx));
    paintCar(this.toon, f.car, this.look.carColors[color % this.look.carColors.length]!);
    f.car.group.visible = true;
    f.car.group.position.set(x, y, z);
  }

  // One sim step of flight, on the fixed step the server aimed it for.
  step(dt: number, world: World): void {
    for (const f of this.pool) {
      if (!f.active || f.settled) continue;
      if (stepGrenade(f.state, this.stats, dt, world)) { f.settled = true; f.hideIn = HIDE_SECONDS; }
      f.car.group.position.set(f.state.x, f.state.y, f.state.z);
    }
  }

  // Once a frame: the tumble and the burning trail.
  update(dt: number): void {
    const every = this.look.trailEverySeconds;
    const share = vfxShare("fire");
    for (const f of this.pool) {
      if (!f.active) continue;
      if (f.settled) {
        // Held where it came down until the server's landing takes it; if that never comes (out of range), it goes.
        if ((f.hideIn -= dt) <= 0) { f.active = false; f.car.group.visible = false; }
        continue;
      }
      f.angle += this.look.spinPerSecond * dt;
      // Heading along the throw, then turned end over end about the axis across it.
      f.car.group.quaternion.setFromAxisAngle(f.axis, -f.angle).multiply(f.heading);
      if (every > 0 && share > 0 && (f.trail -= dt) <= 0) {
        f.trail = every / share;
        this.burn(f.state.x, f.state.y, f.state.z);
      }
    }
  }

  // The server says a car came down here: the nearest one goes, and the blast takes its place.
  removeNear(x: number, y: number, z: number): void {
    let best: Flying | null = null;
    let bestDistance = this.look.carMeters[0]! * 3;
    for (const f of this.pool) {
      if (!f.active) continue;
      const d = Math.hypot(f.state.x - x, f.state.y - y, f.state.z - z);
      if (d < bestDistance) { best = f; bestDistance = d; }
    }
    if (best) { best.active = false; best.car.group.visible = false; }
  }

  clear(): void {
    for (const f of this.pool) { f.active = false; f.car.group.visible = false; }
  }

  private burn(x: number, y: number, z: number): void {
    const size = this.look.trailMeters;
    const fire = this.sprites.fire.spawn();
    if (fire) {
      fire.x = x; fire.y = y; fire.z = z;
      fire.vy = 1; fire.drag = 2;
      fire.life = 0.35;
      fire.size0 = size; fire.size1 = size * 0.5;
      fire.frame0 = FRAMES.fireball.first; fire.frames = FRAMES.fireball.count;
      fire.spin = Math.random() * Math.PI * 2;
      fire.fadeShare = 0.5;
    }
    const smoke = this.sprites.smoke.spawn();
    if (smoke) {
      smoke.x = x; smoke.y = y + size * 0.3; smoke.z = z;
      smoke.vy = 1.5; smoke.drag = 1;
      smoke.age = -0.1;
      smoke.life = 1.2;
      smoke.size0 = size * 0.8; smoke.size1 = size * 2.2;
      smoke.frame0 = FRAMES.smoke.first + Math.floor(Math.random() * FRAMES.smoke.count);
      smoke.shade1 = 1;
      smoke.spin = Math.random() * Math.PI * 2; smoke.spinRate = (Math.random() - 0.5) * 0.8;
      smoke.fadeShare = 0.5;
    }
  }
}
