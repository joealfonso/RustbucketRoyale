import * as THREE from "three";
import { STEP, TITAN_ACTIONS, raycastMech, type TitanConfig, type TitanMessage, type TitanState, type World, type ZoneHit } from "@rustbucket/shared";
import type { SoundName } from "./audio";
import { DeathFx, type DeathFxConfig } from "./deathFx";
import type { Explosions } from "./fx/explosion";
import type { FxSprites } from "./fx/fxSprites";
import { vfxShare } from "./fx/quality";
import { createGait, stepGait, type GaitConfig, type GaitInput, type GaitState } from "./gait";
import type { LoadedKit } from "./mechKit";
import { createMechModel, setMechDamage, type MechModel } from "./mechModel";
import { moveMechParts } from "./mechMotion";
import { bendLegs, footInWorld } from "./mechWalk";
import { StompCracks } from "./stompCracks";
import { castShadows } from "./sunShadows";
import { LEFT, MIDDLE, RIGHT, splitBySide } from "./wreckSplit";
import { ThrownCars, buildCar, carFuseSeconds, paintCar, type Car, type CarModel } from "./thrownCars";
import type { Toon } from "./toonMaterial";
import { titanDeathFx, type TitanLook } from "./titanLook";
import { DOWN, ROAR, createTitanMotion, titanMotion } from "./titanPose";
import { TitanTrack, createTitanPose, type TitanPose } from "./titanTrack";

export interface TitanViewDeps {
  scene: THREE.Scene;
  toon: Toon;
  look: TitanLook;
  config: TitanConfig; // the server's numbers: how long each move takes, its hit boxes, how a car flies
  zoneMaxHp: readonly number[];
  gait: GaitConfig; // the shared smoothing and foot spacing; the Titan's own stride is in its look
  sprites: FxSprites;
  explosions: Explosions;
  deathFx: DeathFxConfig; // the mech blow-apart, grown to the Titan's size here
  ground: (x: number, y: number, z: number) => number;
  sound: (name: SoundName, at: { x: number; y: number; z: number }, loudness?: number, pitch?: number) => void;
  shake: (x: number, y: number, z: number, radius: number, force: number) => void;
}

const ARMS = 1;
const WRECK_SEED = 13; // which way pieces fly is picked from this, the same on every screen
const STAND_IN_SIDES = ["L", "R"] as const;

// The right arm of a kit model, cut out of its merged arm pieces (wreckSplit.ts, the cut the blow-apart makes too)
// into pieces of its own that show in the same damage states. What is left stays on the body.
function rightArm(model: MechModel, middleMeters: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const piece of model.kitPieces.slice()) {
    if (piece.zone !== ARMS) continue;
    const lod = piece.object;
    const right = new THREE.LOD();
    let any = false;
    for (const level of lod.levels) {
      const holder = new THREE.Group();
      for (const child of level.object.children.slice()) {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) continue;
        const sides = splitBySide(mesh.geometry, middleMeters);
        if (!sides[RIGHT]) continue;
        holder.add(new THREE.Mesh(sides[RIGHT], mesh.material));
        mesh.removeFromParent();
        for (const side of [LEFT, MIDDLE]) if (sides[side]) level.object.add(new THREE.Mesh(sides[side]!, mesh.material));
        any = true;
      }
      right.addLevel(holder, level.distance);
    }
    if (!any) continue;
    right.visible = lod.visible;
    lod.parent!.add(right);
    model.kitPieces.push({ zone: ARMS, shownIn: piece.shownIn, object: right });
    out.push(right);
  }
  return out;
}

// The Junk Titan (gate 13c) as this client sees it: drawn from the snapshots a little in the past like other mechs,
// walking with the leg rig on a slow heavy stride (every footfall a thud, dust and a small shake), its stomp, throw
// and roar laid over the walk from the server's action clock. Felled, it tips forward, and as it hits the ground it
// blows apart like a mech four times over and the wreck stays smoking. Its damage reads on it: rust per zone and the
// core glow dimming with its hit points. It is drawn from its kit (titanLook.json kit) once that loads, a grey-box mech
// scaled up until then. The effects of its moments (stomps, cars, the fall) come from the server's "titan" messages,
// through `event`.
export class TitanView {
  readonly cars: ThrownCars;
  readonly cracks: StompCracks;
  model: MechModel;
  private holder = new THREE.Group(); // where it stands, faces and topples; the model inside is at rest, so the wreck works
  private scale = 1;
  private shoulders = new THREE.Group();
  private held: Car;
  private heldColor = 0; // the paint of the car in its hands, which the thrown car keeps
  private track: TitanTrack;
  private replayTrack: TitanTrack;
  private pose: TitanPose = createTitanPose();
  private motion = createTitanMotion();
  private gaitInput: GaitInput;
  private standInGait: GaitState = createGait(2); // the grey box has no legs: its thuds come from a gait of its own
  private zoneHp: number[];
  private shownHp = -1;
  private present = false; // in the newest snapshot
  private seen = false; // anything to draw at all
  private down = false; // hit the ground and blew apart; the wreck stays until a new match
  private lastAction = -1;
  private lastRecord = Number.NEGATIVE_INFINITY;
  private recordState: TitanState = { x: 0, y: 0, z: 0, yaw: 0, hp: 1, action: "walk", actionSeconds: 0 };
  private wreck: DeathFx;
  private at = { x: 0, y: 0, z: 0 };
  private foot = new THREE.Vector3();
  private camera = new THREE.Vector3();

  constructor(private deps: TitanViewDeps, kit: LoadedKit | null) {
    const { look, scene, config } = deps;
    this.track = new TitanTrack(look.maxSamples);
    this.replayTrack = new TitanTrack(Math.ceil(look.replay.keepSeconds * look.replay.sampleHz) + 2);
    this.gaitInput = { vx: 0, vz: 0, yaw: 0, grounded: true, dashing: false, limping: false, braced: false, walkSpeed: look.walk.walkSpeed, runSpeed: look.walk.runSpeed };
    this.zoneHp = deps.zoneMaxHp.slice();
    this.wreck = new DeathFx(deps.sprites, deps.explosions, titanDeathFx(deps.deathFx, look.fall), deps.ground);
    this.cars = new ThrownCars(deps.toon, look.throw, config.car, carFuseSeconds(config.throw.flightSeconds, STEP), deps.sprites);
    this.cracks = new StompCracks(3, deps.toon.color("soot"), look.stomp.crackFadeSeconds, look.stomp.crackLift);
    this.held = buildCar(deps.toon, look.throw, null);
    this.holder.rotation.order = "YXZ"; // turned to face its way, then tipped over along it
    this.holder.visible = false;
    this.model = this.build(kit);
    scene.add(this.holder, this.cars.group, this.cracks.group);
  }

  // The kit arrived (or changed): the same Titan, drawn from it from now on.
  setKit(kit: LoadedKit | null): void {
    const wasDown = this.down;
    this.standUp();
    this.holder.remove(this.model.group);
    this.model = this.build(kit);
    this.shownHp = -1;
    if (wasDown) this.land(true);
  }

  // The car model arrived: the cars it throws, and the one it lifts, are drawn from it.
  setCarModel(model: CarModel): void {
    this.cars.useModel(model);
    const held = buildCar(this.deps.toon, this.deps.look.throw, model);
    held.group.visible = this.held.group.visible;
    held.group.position.copy(this.held.group.position);
    held.group.scale.copy(this.held.group.scale);
    held.group.rotation.y = -model.turn; // sits in the hand as modelled, length forward
    this.shoulders.remove(this.held.group);
    this.shoulders.add(held.group);
    this.held = held;
    paintCar(this.deps.toon, held, this.deps.look.throw.carColors[this.heldColor]!);
    castShadows(held.group);
  }

  private build(kit: LoadedKit | null): MechModel {
    const { look, toon, zoneMaxHp } = this.deps;
    // It is about four times a mech's size, so each simpler level takes over that much further away.
    const sized = kit ? { ...kit, lodDistances: kit.lodDistances.map((d) => d * look.lodScale) } : null;
    const model = createMechModel(look.colors.accent, zoneMaxHp, toon, look.colors.body, sized, look.colors.trim);
    for (const part of model.gunParts) part.removeFromParent(); // the plain barrel mechs without a modelled gun get
    model.gunParts.length = 0;
    this.scale = kit ? look.kitScale : look.standInScale;
    // The kit throws with its right arm alone (its grapple, holding the car at Mount_Hand): the arms' merged pieces
    // are cut by side and the right side swings about its shoulder. The stand-in swings both arms. Measured in the
    // model's own frame before it joins the holder.
    const arms: THREE.Object3D[] = kit ? rightArm(model, look.fall.middleMeters) : [...model.armMeshes];
    model.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const a of arms) box.expandByObject(a);
    this.holder.scale.setScalar(this.scale);
    this.holder.add(model.group);
    this.shoulders.removeFromParent();
    this.shoulders.rotation.set(0, 0, 0);
    if (!box.isEmpty()) this.shoulders.position.set(kit ? (box.min.x + box.max.x) / 2 : 0, box.max.y - (box.max.y - box.min.y) * 0.1, (box.min.z + box.max.z) / 2);
    else this.shoulders.position.set(0, 2.6, 0);
    model.body.add(this.shoulders);
    for (const a of arms) {
      a.position.sub(this.shoulders.position);
      this.shoulders.add(a);
    }
    // The car it lifts: in the kit's hand (Mount_Hand), or in front of the stand-in's chest, at full size whatever
    // the model's scale.
    this.held.group.visible = false;
    this.held.group.scale.setScalar(1 / this.scale);
    if (kit) this.held.group.position.fromArray(look.throw.hand).sub(this.shoulders.position);
    else this.held.group.position.set(0, -look.throw.handMeters / this.scale, -look.throw.carMeters[2]! / this.scale);
    this.shoulders.add(this.held.group);
    castShadows(model.group);
    return model;
  }

  // Whether there is a Titan near you to draw, and where it is drawn, for the HUD and the radar.
  get shown(): boolean {
    return this.seen && this.holder.visible;
  }

  // Felled: falling or already a wreck. No boss bar, no hit boxes.
  get fallen(): boolean {
    return this.down || this.pose.action === DOWN;
  }

  get hp(): number {
    return this.fallen ? 0 : this.pose.hp;
  }

  get x(): number {
    return this.holder.position.x;
  }

  get z(): number {
    return this.holder.position.z;
  }

  // A snapshot's word on the Titan, at server time `serverMs`. Null: none near you. A fallen Titan's wreck stays
  // where it fell even when the server stops sending it.
  push(state: TitanState | null | undefined, serverMs: number, nowMs: number): void {
    if (!state) {
      this.present = false;
      this.track.clear();
      return;
    }
    this.present = true;
    this.track.push(state, serverMs, nowMs);
  }

  // Its hit boxes (data/titan.json) where it is drawn, for the crosshair: the distance along the ray, or -1.
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, hit: ZoneHit): number {
    if (!this.shown || this.fallen) return -1;
    const p = this.holder.position;
    return raycastMech(ox, oy, oz, dx, dy, dz, max, p.x, p.y, p.z, this.pose.yaw, this.deps.config, hit) ? hit.distance : -1;
  }

  // One fixed sim step: the cars in flight, on the step the server aimed them for.
  step(world: World): void {
    this.cars.step(STEP, world);
  }

  // Once a frame. `delayMs` is how far in the past other mechs are drawn; `replayMs` the moment of the kill replay on
  // screen, or null when it is not playing (then this frame is recorded for one).
  update(nowMs: number, dt: number, delayMs: number, camera: THREE.Vector3, replayMs: number | null): void {
    this.camera.copy(camera);
    const replaying = replayMs !== null && !this.down;
    const has = replaying ? this.replayTrack.sample(replayMs, this.pose) : this.present && this.track.sample(this.track.renderTime(nowMs, delayMs), this.pose);
    this.seen = has || this.down;
    this.holder.visible = this.seen;
    this.cars.update(dt);
    this.cracks.update(dt);
    this.wreck.update(dt, camera);
    if (!has || this.down) return;
    if (!replaying) this.record(nowMs);

    const p = this.pose;
    this.holder.position.set(p.x, p.y, p.z);
    this.holder.rotation.y = p.yaw;
    this.showDamage(p.hp);
    if (p.action !== this.lastAction) {
      // A roar has no message of its own: it is heard as it starts.
      if (p.action === ROAR && p.seconds < 0.5) this.roar();
      this.lastAction = p.action;
    }
    titanMotion(p.action, p.seconds, this.deps.look, this.deps.config, this.motion);
    this.holder.rotation.x = -this.motion.topple;
    if (p.action === DOWN) {
      // Tipping over with everything hanging still, until it hits the ground as the server's fall ends.
      this.held.group.visible = false;
      this.shoulders.rotation.x = 0;
      if (p.seconds >= this.deps.config.fall.seconds) this.land(p.seconds > this.deps.config.fall.seconds + this.deps.look.fall.pourSeconds);
      return;
    }
    this.glow(p.action === ROAR ? Math.abs(this.motion.arms) / Math.max(1e-3, (this.deps.look.roar.armDegrees * Math.PI) / 180) : 0);
    this.held.group.visible = this.motion.car;
    this.shoulders.rotation.x = this.motion.arms;
    const w = this.deps.look.walk;
    if (Math.abs(p.x - camera.x) + Math.abs(p.z - camera.z) < w.farMeters) this.walk(dt);
    moveMechParts(this.model, dt);
  }

  private walk(dt: number): void {
    const { look, gait } = this.deps;
    const p = this.pose, m = this.motion, g = this.gaitInput;
    g.vx = p.vx; g.vz = p.vz; g.yaw = p.yaw;
    const model = this.model;
    const s = this.scale;
    if (model.gait && model.legs.length > 0) {
      const state = model.gait;
      stepGait(state, g, look.walk.gait, model.legSides, gait.smoothing, dt);
      // The stomp, throw and roar laid over the walk for this frame only: the gait smooths from its own numbers.
      const pitch = state.pitch, roll = state.roll, lift = state.feet[1]!, ahead = state.feet[2]!;
      state.pitch += m.pitch; state.roll += m.roll;
      state.feet[1] = lift + m.footLift / s;
      state.feet[2] = ahead - m.footForward / s;
      bendLegs(model, look.walk.gait, gait.footInward);
      state.pitch = pitch; state.roll = roll; state.feet[1] = lift; state.feet[2] = ahead;
      let thud = true;
      for (let leg = 0; leg < model.legs.length; leg++) {
        if (!(state.footfalls & (1 << leg))) continue;
        footInWorld(model, leg, this.foot);
        this.footfall(this.foot.x, this.foot.z, thud);
        thud = false;
      }
    } else {
      // The stand-in: its body takes the moves, and a thud lands to one side and then the other.
      const state = this.standInGait;
      stepGait(state, g, look.walk.gait, STAND_IN_SIDES, gait.smoothing, dt);
      model.body.position.y = state.bob / s;
      model.body.rotation.set(state.pitch + m.pitch, 0, state.roll + m.roll);
      let thud = true;
      for (let leg = 0; leg < 2; leg++) {
        if (!(state.footfalls & (1 << leg))) continue;
        const side = (leg === 0 ? -1 : 1) * look.walk.standInFeetMeters;
        this.footfall(p.x + Math.cos(p.yaw) * side, p.z - Math.sin(p.yaw) * side, thud);
        thud = false;
      }
    }
  }

  // Dust under every foot that came down; `thud` for the first of them, so feet landing together boom once.
  private footfall(x: number, z: number, thud: boolean): void {
    const w = this.deps.look.walk;
    const y = this.deps.ground(x, this.pose.y + 2, z);
    const puffs = Math.max(1, Math.round(w.dustPuffs * vfxShare("dust")));
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2;
      this.deps.sprites.dustPuff(x + Math.cos(a) * w.dustMeters * 0.4, y, z + Math.sin(a) * w.dustMeters * 0.4, w.dustMeters, w.dustSeconds);
    }
    if (!thud) return;
    this.at.x = x; this.at.y = y; this.at.z = z;
    this.deps.sound("titanStep", this.at, w.loudness, w.pitch);
    this.deps.shake(x, y, z, w.shakeRadius, w.shakeForce);
  }

  private roar(): void {
    const r = this.deps.look.roar, p = this.pose;
    this.at.x = p.x; this.at.y = p.y + this.deps.config.height * 0.8; this.at.z = p.z;
    this.deps.sound("titanRoar", this.at);
    this.deps.shake(p.x, p.y, p.z, r.shakeRadius, r.shakeForce);
  }

  // Each zone rusts with the hit points it has lost (faster for the limbs), and never quite to nothing while it
  // stands, so no part drops off before it falls.
  private showDamage(hp: number): void {
    const step = Math.round(hp * 100);
    if (step === this.shownHp) return;
    this.shownHp = step;
    const wear = this.deps.look.damage.zoneWear;
    for (let zone = 0; zone < this.zoneHp.length; zone++) {
      const max = this.deps.zoneMaxHp[zone]!;
      this.zoneHp[zone] = Math.max(max * 0.02, max * (1 - (1 - hp) * (wear[zone] ?? 1)));
    }
    setMechDamage(this.model, this.zoneHp, false);
  }

  // The core and sensors glow less as it is worn down, and flare with a roar.
  private glow(flare: number): void {
    const least = this.deps.look.damage.glowLeast;
    const level = (least + (1 - least) * Math.max(0, Math.min(1, this.pose.hp))) * (1 + flare * 0.6);
    for (const glow of this.model.glows) glow.material.color.copy(glow.base).multiplyScalar(level);
  }

  // It hits the ground: blows apart along the way it was falling, smoke pouring, and the wreck stays. `already` for
  // one first seen long down: it lies there without the blast.
  private land(already: boolean): void {
    if (this.down) return;
    this.down = true;
    this.held.group.visible = false;
    this.shoulders.rotation.set(0, 0, 0);
    this.model.body.position.y = 0;
    this.model.body.rotation.set(0, 0, 0);
    setMechDamage(this.model, this.zoneHp, true);
    if (already) { this.wreck.lieDown(this.model, WRECK_SEED); return; }
    const p = this.pose;
    this.wreck.blowApart(this.model, -Math.sin(p.yaw), -Math.cos(p.yaw), WRECK_SEED);
    const f = this.deps.look.fall;
    this.at.x = p.x; this.at.y = p.y + 2; this.at.z = p.z;
    this.deps.sound("titanFall", this.at);
    this.deps.shake(p.x, p.y, p.z, f.shakeRadius, f.shakeForce);
  }

  // Back on its feet, wreck given back: a new match, or a new model.
  private standUp(): void {
    if (!this.down) return;
    this.down = false;
    setMechDamage(this.model, this.deps.zoneMaxHp, false);
    this.wreck.update(0, this.camera); // a wreck whose mech is not dead is given back
    this.holder.rotation.x = 0;
  }

  // A moment the server sent: a stomp landing, a car thrown or landing, the fall beginning.
  event(m: TitanMessage): void {
    const look = this.deps.look;
    this.at.x = m.x; this.at.y = m.y; this.at.z = m.z;
    if (m.event === "stomp") {
      const k = look.stomp;
      const radius = m.radius ?? this.deps.config.stomp.radius;
      const floor = this.deps.ground(m.x, m.y + 1, m.z);
      const puffs = Math.max(4, Math.round(k.puffs * vfxShare("dust")));
      for (let i = 0; i < puffs; i++) {
        // Round the edge of what it hits, some nearer in, so the ring reads as the danger zone.
        const a = (i / puffs) * Math.PI * 2, out = radius * (0.45 + 0.55 * (((i * 7) % 5) / 4));
        this.deps.sprites.dustPuff(m.x + Math.cos(a) * out, floor, m.z + Math.sin(a) * out, k.puffMeters, k.puffSeconds, 1.5);
      }
      this.deps.explosions.ring(m.x, floor, m.z, radius, k.ringSeconds);
      this.deps.explosions.fling(m.x, floor + 0.3, m.z, floor, Math.round(k.debris * vfxShare("blastDebris")), k.debrisSpeed);
      this.cracks.show(m.x, floor, m.z, radius, k.crackSeconds);
      this.deps.sound("titanStomp", this.at);
      this.deps.shake(m.x, floor, m.z, k.shakeRadius, k.shakeForce);
    } else if (m.event === "throw") {
      this.cars.spawn(m.x, m.y, m.z, m.vx ?? 0, m.vy ?? 0, m.vz ?? 0, this.heldColor);
      this.held.group.visible = false;
      this.heldColor = (this.heldColor + 1) % look.throw.carColors.length;
      paintCar(this.deps.toon, this.held, look.throw.carColors[this.heldColor]!);
      this.deps.sound("titanThrow", this.at);
    } else if (m.event === "land") {
      // The blast itself is the server's explode message; this is the car going to pieces in it.
      this.cars.removeNear(m.x, m.y, m.z);
      const floor = this.deps.ground(m.x, m.y + 1, m.z);
      this.deps.explosions.fling(m.x, floor + 0.5, m.z, floor, Math.round(look.stomp.debris * vfxShare("blastDebris")), look.stomp.debrisSpeed);
      this.deps.sound("carCrash", this.at);
      this.deps.shake(m.x, floor, m.z, look.throw.shakeRadius, look.throw.shakeForce);
    } else if (m.event === "fall") {
      // A last roar, low and long, as it starts to go over.
      this.at.y = m.y + this.deps.config.height * 0.8;
      this.deps.sound("titanRoar", this.at, 1, 0.7);
    }
  }

  // A blast the server reported: a car in flight that close went off with it.
  blastAt(x: number, y: number, z: number): void {
    this.cars.removeNear(x, y, z);
  }

  // A new match: no Titan, no wreck, no cars, no cracks, until the server shows one.
  clear(): void {
    this.standUp();
    this.present = false;
    this.seen = false;
    this.holder.visible = false;
    this.track.clear();
    this.replayTrack.clear();
    this.cars.clear();
    this.cracks.clear();
    this.lastAction = -1;
    this.shownHp = -1;
    this.pose.action = 0;
  }

  // The drawn Titan, kept a few times a second for the kill replay to draw it again.
  private record(nowMs: number): void {
    const look = this.deps.look;
    if (nowMs - this.lastRecord < 1000 / look.replay.sampleHz - 1) return;
    this.lastRecord = nowMs;
    const s = this.recordState, p = this.pose;
    s.x = p.x; s.y = p.y; s.z = p.z; s.yaw = p.yaw; s.hp = p.hp;
    s.action = TITAN_ACTIONS[p.action] ?? "walk";
    s.actionSeconds = p.seconds;
    this.replayTrack.push(s, nowMs, nowMs);
  }
}
