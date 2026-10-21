import * as THREE from "three";
import { World, createShot, mechStatsFor, parseChunkSet, parseMechStats, parsePropConfig, parseRoster, parseWeapons, parseZones } from "@rustbucket/shared";
import mechJson from "../../../data/mech.json";
import rosterJson from "../../../data/roster.json";
import gaitJson from "../../../data/gait.json";
import { parseGait } from "./gait";
import { walkMech } from "./mechWalk";
import { moveMechParts, rigMechMotion } from "./mechMotion";
import chunksJson from "../../../data/chunks.json";
import propsJson from "../../../data/props.json";
import zonesJson from "../../../data/zones.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import damageFxJson from "../../../data/damageFx.json";
import { parseDamageFx } from "./damageFx";
import { createMechModel, kickMech, moveGunsAndSensors, recoilConfig, setCrawlLook, setMechDamage, type MechModel } from "./mechModel";
import { kickFor } from "./recoil";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import { SunShadows, castShadows } from "./sunShadows";
import mechKitsJson from "../../../data/mechKits.json";
import { loadKit, parseKits, type LoadedKit } from "./mechKit";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PROP_MODELS } from "./props";
import { toGeometry } from "./dressing/dressing";
import weaponsJson from "../../../data/weapons.json";
import weaponFxJson from "../../../data/weaponFx.json";
import { ShotFx } from "./shotFx";
import { parseWeaponFx, weaponFxFor } from "./weaponFxData";
import { RivetView } from "./rivetView";
import { ANCHOR_MECH, ANCHOR_WORLD, HarpoonView } from "./harpoonView";
import { mostOf, onVfxQuality, setVfxQuality, vfxConfig, vfxLevel, vfxQuality } from "./fx/quality";
import explosionFxJson from "../../../data/explosionFx.json";
import thrusterFxJson from "../../../data/thrusterFx.json";
import grenadeJson from "../../../data/grenade.json";
import abilitiesJson from "../../../data/abilities.json";
import { Debris } from "./fx/debris";
import { Explosions, parseExplosionFx } from "./fx/explosion";
import { FxSprites } from "./fx/fxSprites";
import { Thrusters, parseThrusterFx } from "./fx/thrusters";
import { DamageFx } from "./damageFx";
import deathFxJson from "../../../data/deathFx.json";
import { DeathFx, parseDeathFx } from "./deathFx";
import { PaintPreview } from "./paint/paintPreview";

// The V1 style test (style.html): one chunk, its props and three mechs in the game's look, seen from 10, 50 and
// 150 m, so the palette, bands, outline and light can be judged before any real art is made. Keys 1, 2, 3 move the
// camera; Q and E turn round the mechs; L steps through the light presets (data/look.json).
const palette = parsePalette(paletteJson);
const lookConfig = parseLook(lookJson);
const toon = new Toon(lookConfig, palette);
const chunks = parseChunkSet(chunksJson);
const props = parsePropConfig(propsJson);
const zones = parseZones(zonesJson);
const zoneMaxHp = zones.zones.map((z) => z.hp);
setCrawlLook(parseDamageFx(damageFxJson).crawl, zones.damagedBelowFraction);
const kitsData = parseKits(mechKitsJson);
const kit = await loadKit("standin", kitsData);
// The roster, each mech in its own spot on a second line further out, for judging them side by side (key 4).
const roster = (await Promise.all((kitsData.roster ?? []).map(async (id) => ({ id, kit: await loadKit(id, kitsData) }))))
  .filter((r): r is { id: string; kit: LoadedKit } => r.kit !== null);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
let preset = 0;
toon.light(scene, toon.presets[preset]!);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000);
const sunShadows = new SunShadows(renderer, toon.sun, toon.toSun, lookConfig.shadows, vfxQuality());
onVfxQuality(() => sunShadows.setQuality(vfxQuality()));

// Ground, then the chunk with its middle on the origin.
const ground = new THREE.Mesh(new THREE.BoxGeometry(600, 1, 600), toon.ground(palette.world.ground));
ground.position.y = -0.5;
scene.add(ground);
const template = chunks.templates.find((t) => t.id === "containers") ?? chunks.templates[0]!;
const half = chunks.size / 2;
for (const b of template.boxes) toon.box(scene, [b.center[0] - half, b.center[1], b.center[2] - half], b.size, chunks.palette[b.colorIndex]!);

// One of each prop just past the chunk's edge, standing, with its debris beside it (V3b).
props.types.forEach((t, i) => {
  const builder = PROP_MODELS[t.id];
  if (!builder) { toon.box(scene, [-4 + i * 7, t.size[1] / 2, half + 4], t.size, t.color); return; }
  const model = builder(t.size, i);
  ([[model.intact, -4 + i * 7], [model.destroyed, -1 + i * 7]] as const).forEach(([pieces, x]) => {
    for (const p of pieces) {
      const geometry = toGeometry([p.mesh]);
      const intact = new THREE.Mesh(geometry, toon.world(p.paint)), hull = new THREE.Mesh(geometry, toon.shellOutline(p.paint));
      intact.position.set(x, 0, half + 4);
      hull.position.copy(intact.position);
      scene.add(intact, hull);
    }
  });
});

// From clean to rustbucket, left to right: you (fresh paint), then someone else at 75%, 40%, 15% of every zone,
// and finally with arms and legs broken.
const mechs = [
  { accent: palette.mech.youAccent, x: -5, health: [1, 1, 1] },
  { accent: palette.mech.othersAccent, x: 0, health: [0.75, 0.75, 0.75] },
  { accent: palette.mech.othersAccent, x: 5, health: [0.4, 0.4, 0.4] },
  { accent: palette.mech.othersAccent, x: 10, health: [0.15, 0.15, 0.15] },
  { accent: palette.mech.othersAccent, x: 15, health: [0, 0, 0.3] },
];
const damageRow: MechModel[] = [];
for (const m of mechs) {
  const model = createMechModel(m.accent, zoneMaxHp, toon, palette.mech.body, null, palette.mech.trim);
  damageRow.push(model);
  model.group.position.set(m.x, 0, half + 12);
  model.group.rotation.y = Math.PI;
  setMechDamage(model, m.health.map((f, z) => f * zoneMaxHp[z]!), false);
  scene.add(model.group);
}

// The stand-in kit mech (V2a), a step in front of the others. D steps it through damage: whole, damaged, arms broken, legs broken.
const KIT_DAMAGE = [[1, 1, 1], [0.4, 0.4, 0.4], [0.4, 0, 0.4], [0, 0, 0.4]];
let kitDamage = 0;
const kitModel = kit ? createMechModel(palette.mech.othersAccent, zoneMaxHp, toon, palette.mech.body, kit, palette.mech.trim) : null;
if (kitModel) {
  kitModel.group.position.set(5, 0, half + 17);
  kitModel.group.rotation.y = Math.PI;
  scene.add(kitModel.group);
}
const ROSTER_Z = half + 32;
const rosterModels: MechModel[] = [];
roster.forEach((r, i) => {
  const model = createMechModel(i === 0 ? palette.mech.youAccent : palette.mech.othersAccent, zoneMaxHp, toon, palette.mech.body, r.kit, palette.mech.trim);
  model.group.position.set(i * 6 - ((roster.length - 1) * 6) / 2 + 5, 0, ROSTER_Z);
  model.group.rotation.y = Math.PI;
  scene.add(model.group);
  rigMechMotion(model.body, model.legs, model.kitPieces); // gate V9b; does nothing once createMechModel rigs it
  rosterModels.push(model);
});

// Key U: the Junk Titan (gate 13c) at the end of the roster line, for scale, seen from 10, 50, 150 and 300 m in turn
// from about where a player's camera would be, then from 14 m at chest height, to judge the head, the furnace and the
// hands.
const TITAN_X = 25;
const TITAN_DISTANCES = [10, 50, 150, 300, 14];
let titanView = -1; // which of TITAN_DISTANCES, -1 when not looking at it
const titanKit = await loadKit("titan", kitsData);
if (titanKit) {
  // Its levels switch four times farther out than a mech's, as it is about four times a mech's size. A guess until
  // the client sets the Titan's own distances.
  const titan = createMechModel(palette.mech.othersAccent, zoneMaxHp, toon, palette.mech.body, { ...titanKit, lodDistances: titanKit.lodDistances.map((d) => d * 4) }, palette.mech.trim);
  for (const gun of titan.gunParts) gun.visible = false; // it has no gun: the plain barrel a gunless kit gets would hang in its legs
  titan.group.position.set(TITAN_X, 0, ROSTER_Z);
  titan.group.rotation.y = Math.PI;
  scene.add(titan.group);
  // A car in the grapple, as the game holds one before a throw: the thrown car's model, unturned at Mount_Hand.
  const { scheme, car } = mechKitsJson.kits.titan;
  const carData = parseKits({ lodDistances: kitsData.lodDistances, kits: { car: { file: car.file, scheme, parts: Object.fromEntries(Object.entries(car.parts).map(([name, p]) => [name, { ...p, zone: "torso" }])) } } });
  const carKit = await loadKit("car", carData);
  const hand = (await new GLTFLoader().loadAsync(`/${kitsData.kits.titan!.file}`)).scene.getObjectByName("Mount_Hand");
  if (carKit && hand) {
    const held = createMechModel(palette.mech.othersAccent, zoneMaxHp, toon, palette.mech.body, carKit, palette.mech.trim);
    for (const gun of held.gunParts) gun.visible = false;
    held.group.position.copy(hand.position);
    titan.group.add(held.group);
  }
}

// Key 9: the painted atlas (V7b) on a row of boxes, dressing, a crate and a roster mech, left of the chunk.
// 9 steps close / 10 m / 50 m, 0 the next thing, P paint on and off.
const paintMech = roster[0] ? createMechModel(palette.mech.othersAccent, zoneMaxHp, toon, palette.mech.body, roster[0].kit, palette.mech.trim).group : null;
const paintPreview = new PaintPreview(scene, toon, toon.paint, paintMech);
let lookingAtPaint = false;

// Key W: the roster walks on the spot, as on a treadmill, so each gait (data/gait.json) can be judged side by side.
const gait = parseGait(gaitJson);
const rosterStats = parseRoster(rosterJson);
const statsFor = mechStatsFor(parseMechStats(mechJson), rosterStats);
const WALKS = ["standing", "walking", "running", "dashing", "in the air", "limping", "braced", "side-stepping"] as const;
let walk = 0;
const clock = new THREE.Clock();
function walkRoster(dt: number): void {
  const mode = WALKS[walk]!;
  rosterModels.forEach((model, i) => {
    if (model.dead) return; // blown apart (key X): left lying until X again
    const stats = statsFor(rosterStats.mechs.findIndex((m) => m.id === roster[i]!.id));
    const speed = mode === "standing" || mode === "in the air" || mode === "braced" ? 0 : mode === "walking" || mode === "limping" || mode === "side-stepping" ? stats.walkSpeed : mode === "dashing" ? stats.dashSpeed : stats.runSpeed;
    const yaw = model.group.rotation.y;
    setMechDamage(model, mode === "limping" ? [zoneMaxHp[0]! * 0.3, zoneMaxHp[1]!, zoneMaxHp[2]!] : SENSOR_DAMAGE[sensorDamage]![1].map((f, z) => f * zoneMaxHp[z]!), false);
    walkMech(model, gait, {
      // Side-stepping moves along the mech's right (+x in its own frame) instead of its front.
      vx: (mode === "side-stepping" ? Math.cos(yaw) : -Math.sin(yaw)) * speed, vz: (mode === "side-stepping" ? -Math.sin(yaw) : -Math.cos(yaw)) * speed, yaw, grounded: mode !== "in the air", dashing: mode === "dashing",
      limping: mode === "limping", braced: mode === "braced", walkSpeed: stats.walkSpeed, runSpeed: stats.runSpeed,
    }, dt);
    moveMechParts(model, dt);
  });
}
// Gate V9b, in the roster views (4, 6, 8): hold R and the roster fires the range's weapon (G changes it) at its rate,
// each from its own muzzles in turn, to judge each gun's kick; Y kicks a Rail Shot; H steps every zone through
// damage, to judge the sensors' flicker.
const SENSOR_DAMAGE = [["whole", [1, 1, 1]], ["all damaged", [0.4, 0.4, 0.4]], ["arms broken", [1, 0, 1]]] as const;
let sensorDamage = 0;
let rosterFiring = false;
let rosterShotIn = 0;
let rosterShots = 0;
const kitMuzzles = (mechKitsJson as { kits: Record<string, { muzzles?: number[][] }> }).kits;
function kickRoster(kick: string): void {
  roster.forEach((r, i) => {
    const muzzles = kitMuzzles[r.id]?.muzzles ?? [[1.2]];
    kickMech(rosterModels[i]!, kickFor(recoilConfig, kick), muzzles[rosterShots % muzzles.length]![0]!);
  });
  rosterShots++;
}
function fireRoster(dt: number): void {
  rosterShotIn -= dt;
  if (rosterFiring && rosterShotIn <= 0) {
    kickRoster(weapons[rangeWeapon]!.id);
    rosterShotIn = 1 / weapons[rangeWeapon]!.shotsPerSecond;
  }
  for (const model of rosterModels) moveGunsAndSensors(model, dt);
  for (const model of damageRow) moveGunsAndSensors(model, dt);
  if (kitModel) moveGunsAndSensors(kitModel, dt);
}
// Key 7: a firing range behind the chunk, to judge each weapon's flash, tracer and impacts (data/weaponFx.json).
// F fires the weapon in hand, alternately at a rust wall and at a mech; G changes weapon.
const RANGE_Z = -half - 20;
const weapons = parseWeapons(weaponsJson).weapons;
const rangeWall = { minX: -6, minY: 0, minZ: RANGE_Z - 0.5, maxX: 6, maxY: 5, maxZ: RANGE_Z + 0.5 };
const rangeGround = { minX: -300, minY: -1, minZ: -300, maxX: 300, maxY: 0, maxZ: 300 };
toon.box(scene, [0, 2.5, RANGE_Z], [12, 5, 1], "rustOrange");
const rangeWorld = new World([rangeWall, rangeGround]);
const target = createMechModel(palette.mech.othersAccent, zoneMaxHp, toon, palette.mech.body, kit, palette.mech.trim);
target.group.position.set(3.5, 0, RANGE_Z + 2.5);
scene.add(target.group);
const weaponFxConfig = parseWeaponFx(weaponFxJson);
const shotFx = new ShotFx(scene, weaponFxConfig, weapons, (c) => toon.color(c), vfxConfig.sprites.growSteps, vfxQuality);
shotFx.impacts.setSurfaces([toon.color("rustOrange"), toon.color(palette.world.ground)], [0, 1]);
const rangeShot = createShot();
let rangeWeapon = 0;
let rangeShots = 0;
let lookingAtRange = false;
let rangeSlow = false; // quarter speed, to see each flipbook frame
// `alt` fires the weapon's right-click look instead (C): a slug, a windup round or a full charge (gate 18a); the rivet
// gun's detonator, or a harpoon reel that drags the range's stand-in shooter up to the wall (gate 18b).
function fireAtRange(alt = false): void {
  const w = weapons[rangeWeapon]!;
  const sec = w.secondary;
  if (alt && sec.kind === "detonate") { rangeRivets?.detonate(0); return; }
  const pellets = alt && sec.kind === "slug" ? 1 : w.pellets;
  const spreadDegrees = alt && (sec.kind === "slug" || sec.kind === "windup") ? sec.spreadDegrees : alt && sec.kind === "reel" ? 0 : w.spreadDegrees;
  // A reel always goes for the wall.
  const atMech = alt && sec.kind === "reel" ? (rangeShots++, false) : rangeShots++ % 2 === 1;
  rangeShooter.x = -4.5; rangeShooter.y = 2.4; rangeShooter.z = RANGE_Z + 9; rangeReel = 0;
  const ox = rangeShooter.x, oy = rangeShooter.y, oz = rangeShooter.z;
  const tx = atMech ? 3.5 : -1.5, ty = atMech ? 2.4 : 2, tz = atMech ? RANGE_Z + 3 : RANGE_Z + 0.5;
  for (let p = 0; p < pellets; p++) {
    const spread = (spreadDegrees * Math.PI) / 180;
    let dx = tx - ox + (Math.random() - 0.5) * spread * 20, dy = ty - oy + (Math.random() - 0.5) * spread * 20, dz = tz - oz;
    const length = Math.hypot(dx, dy, dz);
    dx /= length; dy /= length; dz /= length;
    Object.assign(rangeShot, { ox, oy, oz, dx, dy, dz, length: atMech ? length - 1 : length + 5 }); // a mech hit ends on its armour
    if (w.projectile.kind !== "harpoon" || !rangeHarpoon) { shotFx.show(rangeShot, rangeWeapon, atMech, alt ? 1 : -1); continue; }
    // The harpoon: its head and cable, latching on the mech (a yank) or the wall (a reel, or a plain bite).
    shotFx.flash(rangeShot, rangeWeapon, alt ? 1 : -1);
    const hit = atMech ? length - 1 : length - 0.5;
    rangeHarpoon.fire(0, ox, oy, oz, dx, dy, dz, hit, alt);
    const hold = alt && sec.kind === "reel" ? sec.maxSeconds : w.projectile.yankSeconds;
    rangeHarpoon.latch(0, atMech ? ANCHOR_MECH : ANCHOR_WORLD, 1, ox + dx * hit, oy + dy * hit, oz + dz * hit, alt, hold);
    if (alt && sec.kind === "reel") rangeReel = hit / w.projectileSpeed + hold;
  }
}
// Key 8: effects (V5a), the roster seen from in front. B sets off a blast behind it, in turn as big as a grenade's,
// a mortar shell's and a barrel's; J switches the roster's jets on and off (off drops them, for the landing puff);
// K dashes them; V switches the effects quality. The damage row sparks and smokes as in play.
const explosionFx = parseExplosionFx(explosionFxJson);
const fxSprites = new FxSprites(scene, (c) => toon.color(c), explosionFx.scorch);
const fxChunks = new Debris(scene, toon, mostOf(vfxConfig, "debris"), () => vfxLevel().debris ?? 0, explosionFx.chunks);
const explosions = new Explosions(scene, fxSprites, fxChunks, explosionFx, (c) => toon.color(c));
const thrusters = new Thrusters(fxSprites, parseThrusterFx(thrusterFxJson));
const damageFx = new DamageFx(fxSprites, parseDamageFx(damageFxJson), zones);
// The rivets and the harpoon on the range: the stand-in shooter is a point where the shots leave, dragged up to the
// wall by a reel; mech 1 is the target mech.
const rangeShooter = { x: 0, y: 0, z: 0 };
let rangeReel = 0; // seconds of reel left, counting the flight
const rangeLooks = weaponFxFor(weaponFxConfig, weapons);
const rangeRivetGun = weapons.findIndex((w) => w.projectile.kind === "rivet");
const rangeRivetStats = weapons[rangeRivetGun]?.projectile;
const rangeRivetLook = rangeLooks[rangeRivetGun]?.rivet;
const rangeRivets = rangeRivetLook && rangeRivetStats?.kind === "rivet"
  ? new RivetView(scene, rangeRivetLook, toon.ownMaterial(rangeRivetLook.head), (c) => toon.color(c), (m) => (m === 1 ? target : null), () => rangeRivetStats.blastRadius)
  : null;
let rangeRivetId = 1;
if (rangeRivets && rangeRivetStats?.kind === "rivet") {
  rangeRivets.popOwnFuses = true;
  rangeRivets.onPop = (x, y, z, radius) => explosions.blast(x, y, z, radius, 0);
  const fuse = rangeRivetStats.fuseSeconds;
  shotFx.onImpact = (x, y, z, weapon, nx, ny, nz) => {
    if (weapon === rangeRivetGun) rangeRivets.stick({ owner: 0, id: rangeRivetId++, x, y, z, outX: nx, outY: ny, outZ: nz, mech: -1, fuseSeconds: fuse });
  };
  // On the mech the rivet faces back along the shot, out of its armour.
  shotFx.onMechImpact = (x, y, z, weapon) => {
    if (weapon === rangeRivetGun) rangeRivets.stick({ owner: 0, id: rangeRivetId++, x, y, z, outX: -rangeShot.dx, outY: 0, outZ: -rangeShot.dz, mech: 1, fuseSeconds: fuse });
  };
}
const rangeHarpoonGun = weapons.findIndex((w) => w.projectile.kind === "harpoon");
const rangeHarpoonLook = rangeLooks[rangeHarpoonGun]?.harpoon;
const rangeHarpoon = rangeHarpoonLook
  ? new HarpoonView(scene, rangeHarpoonLook, (c) => toon.color(c), toon.color(weapons[rangeHarpoonGun]!.color), fxSprites.sparks,
    (_id, out) => { out.x = rangeShooter.x; out.y = rangeShooter.y; out.z = rangeShooter.z; return true; }, (m) => (m === 1 ? target : null), () => false)
  : null;
// Each frame: a reel drags the shooter point along its cable, as the server drags a reeling mech.
function updateRange(dt: number): void {
  if (rangeReel > 0 && weapons[rangeHarpoonGun]?.secondary.kind === "reel") {
    rangeReel -= dt;
    const speed = weapons[rangeHarpoonGun]!.secondary.speed;
    const tx = -1.5, tz = RANGE_Z + 2, dx = tx - rangeShooter.x, dz = tz - rangeShooter.z, d = Math.hypot(dx, dz);
    if (d > 0.5) { rangeShooter.x += (dx / d) * speed * dt; rangeShooter.z += (dz / d) * speed * dt; }
  }
  rangeHarpoon?.update(dt);
  rangeRivets?.update(dt, camera.position);
  rangeHarpoon?.draw(camera);
}
const BLASTS = [["grenade", grenadeJson.blastRadius], ["mortar shell", abilitiesJson.mechs.cataclysm.blastRadius], ["barrel", props.barrelBlast.radius]] as const;
let nextBlast = 0;
let jetsOn = false;
let dashFrames = 0;
let dropFrames = 0;
let lookingAtFx = false;
// X blows the roster and a grey-box mech apart, as if shot from the camera; Z shows them already lying as wrecks, as
// a wreck that comes into view later is drawn; either again stands them back up.
const deathFx = new DeathFx(fxSprites, explosions, parseDeathFx(deathFxJson), () => 0);
const greyWreck = createMechModel(palette.mech.othersAccent, zoneMaxHp, toon, palette.mech.body, null, palette.mech.trim);
greyWreck.group.position.set(((roster.length + 1) * 6) / 2 + 5, 0, ROSTER_Z);
greyWreck.group.rotation.y = Math.PI;
greyWreck.group.visible = false;
scene.add(greyWreck.group);
const wreckable = [...rosterModels, greyWreck];
let wrecked = false;
function blowApart(already: boolean): void {
  wrecked = !wrecked;
  wreckable.forEach((model, i) => {
    if (!wrecked) { setMechDamage(model, zoneMaxHp, false); return; }
    setMechDamage(model, [zoneMaxHp[0]!, zoneMaxHp[1]!, 0], true);
    const p = model.group.position;
    if (already) deathFx.lieDown(model, i + 1);
    else deathFx.blowApart(model, p.x - camera.position.x, p.z - camera.position.z, i + 1);
  });
}
function showFx(dt: number): void {
  thrusters.tick(dt);
  const dashing = dashFrames > 0, dropping = dropFrames > 0;
  for (const model of rosterModels) thrusters.drive(model, jetsOn, dashing, !jetsOn && !dropping, dropping ? -9 : jetsOn ? 3 : 0, dt);
  dashFrames = Math.max(0, dashFrames - 1); dropFrames = Math.max(0, dropFrames - 1);
  for (const model of damageRow) damageFx.emitFrom(model, dt);
  if (kitModel) damageFx.emitFrom(kitModel, dt);
  deathFx.update(dt, camera.position);
  explosions.update(dt);
  fxChunks.update(dt);
  fxSprites.update(dt, camera.position);
}
let lookingAtRoster = false;
let closeUp = -1; // key 6: one roster mech up close, from the side, to judge its walk; -1 for none
let lookingAtProps = false; // key 5: the props row, from above and in front, where the mechs do not block it

const showKitDamage = () => kitModel && setMechDamage(kitModel, KIT_DAMAGE[kitDamage]!.map((f, z) => f * zoneMaxHp[z]!), false);

const DISTANCES = [10, 50, 150];
let distance = DISTANCES[0]!;
let turn = 0.6;
const label = document.getElementById("label")!;
function place(): void {
  // The middle of the line-up being looked at: the damage row, or the roster further out.
  const close = rosterModels[closeUp];
  rosterModels.forEach((m, i) => { m.group.visible = !close || i === closeUp; }); // the others would stand in the way
  greyWreck.group.visible = lookingAtFx;
  if (lookingAtPaint) {
    label.textContent = paintPreview.place(camera, turn);
    return;
  }
  if (titanView >= 0) {
    const d = TITAN_DISTANCES[titanView]!;
    const chest = titanView === TITAN_DISTANCES.length - 1;
    const target = chest ? new THREE.Vector3(TITAN_X, 7.5, ROSTER_Z) : new THREE.Vector3(TITAN_X - 3, 5, ROSTER_Z);
    camera.position.set(target.x + Math.sin(turn) * d, chest ? 8.5 : 2 + d * 0.04, target.z + Math.cos(turn) * d);
    camera.lookAt(target);
    label.textContent = `Junk Titan${titanKit ? "" : " (failed to load)"} ${chest ? "up close, at chest height" : `beside the roster, ${d} m`} · U: next view · Q / E: turn · L: light · 1 / 2 / 3: back`;
    return;
  }
  if (lookingAtFx) {
    camera.position.set(5 + Math.sin(turn) * 22, 5, ROSTER_Z + Math.cos(turn) * 22);
    camera.lookAt(5, 3, ROSTER_Z - 4);
    label.textContent = `Effects · B: blast (next: ${BLASTS[nextBlast]![0]}) · J: jets ${jetsOn ? "on" : "off"} · K: dash · X / Z: ${wrecked ? "stand back up" : "blow apart / lying"} · T: ${rangeSlow ? "quarter speed" : "full speed"} · V: effects ${vfxQuality()} · Q / E: turn · 1 / 2 / 3: back`;
    return;
  }
  if (lookingAtRange) {
    camera.position.set(3 + (turn - 0.6) * 4, 3, RANGE_Z + 11);
    camera.lookAt(-0.5, 2.2, RANGE_Z + 3);
    label.textContent = `Firing range · F: fire ${weapons[rangeWeapon]!.name} (wall, then mech) · C: its right-click · G: next weapon · T: ${rangeSlow ? "quarter speed" : "full speed"} · effects ${vfxQuality()} · 1 / 2 / 3: back`;
    return;
  }
  const target = close ? close.group.position.clone().setY(1.6) : lookingAtProps ? new THREE.Vector3(3, 0.5, half + 4) : new THREE.Vector3(5, 2, lookingAtRoster ? ROSTER_Z : half + 12);
  const lift = lookingAtProps ? 0.9 : 0.18; // looking down onto the props, over the mechs
  camera.position.set(target.x + Math.sin(turn) * distance, close ? 1.4 : target.y + 1.5 + distance * lift, target.z + Math.cos(turn) * distance);
  camera.lookAt(target);
  label.textContent = `Light: ${toon.presets[preset]!.name} (L) · ` + (lookingAtProps
    ? "Props, standing and broken: crate, junk pile, barrel · 1 / 2 / 3: back to the damage row · Q / E: turn"
    : close
    ? `${roster[closeUp]!.id} up close · W: ${WALKS[walk]} · R (hold): fire ${weapons[rangeWeapon]!.name} · G: next weapon · Y: rail kick · H: sensors ${SENSOR_DAMAGE[sensorDamage]![0]} · T: ${rangeSlow ? "quarter speed" : "full speed"} · X / Z: ${wrecked ? "stand back up" : "blow apart / lying"} · 6: next mech · Q / E: turn · 4: the whole roster`
    : lookingAtRoster
    ? `Roster: ${roster.map((r) => r.id).join(", ") || "none loaded"} · W: ${WALKS[walk]} · R (hold): fire ${weapons[rangeWeapon]!.name} · G: next weapon · Y: rail kick · H: sensors ${SENSOR_DAMAGE[sensorDamage]![0]} · 1 / 2 / 3: back to the damage row · Q / E: turn`
    : `Style test, ${distance} m · 1 / 2 / 3: 10, 50, 150 m · 4: the roster · 5: the props · Q / E: turn · front: stand-in kit mech${kit ? "" : " (failed to load)"} (D: damage ${["whole", "damaged", "arms broken", "legs broken"][kitDamage]}) · behind, left to right: you (clean), then 75%, 40%, 15%, arms and legs broken`);
}
window.addEventListener("keydown", (e) => {
  if (e.code.startsWith("Digit")) titanView = -1;
  if (e.code === "KeyU") { titanView = (titanView + 1) % TITAN_DISTANCES.length; lookingAtPaint = false; lookingAtRange = false; lookingAtFx = false; closeUp = -1; }
  const index = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
  if (index >= 0) { distance = DISTANCES[index]!; lookingAtRoster = false; lookingAtProps = false; closeUp = -1; lookingAtRange = false; lookingAtFx = false; }
  if (index >= 0 || ["Digit4", "Digit5", "Digit6", "Digit7", "Digit8"].includes(e.code)) lookingAtPaint = false;
  if (e.code === "Digit9") { if (lookingAtPaint) paintPreview.nextView(); lookingAtPaint = true; lookingAtRange = false; lookingAtFx = false; closeUp = -1; }
  if (e.code === "Digit0" && lookingAtPaint) paintPreview.nextItem();
  if (e.code === "KeyP") paintPreview.togglePaint();
  if (e.code === "Digit8") { lookingAtFx = true; lookingAtRange = false; closeUp = -1; turn = 0; }
  if (e.code === "KeyB") { const [, radius] = BLASTS[nextBlast]!; explosions.blast(5, 0.3, ROSTER_Z - 7, radius, 0); nextBlast = (nextBlast + 1) % BLASTS.length; }
  if (e.code === "KeyJ") { jetsOn = !jetsOn; if (!jetsOn) dropFrames = 1; }
  if (e.code === "KeyK") dashFrames = 1;
  if ((e.code === "KeyX" || e.code === "KeyZ") && (lookingAtFx || closeUp >= 0)) blowApart(e.code === "KeyZ");
  if (e.code === "KeyV") setVfxQuality(vfxQuality() === "low" ? "normal" : "low");
  if (e.code === "Digit7") lookingAtRange = true;
  if (e.code === "KeyF") fireAtRange();
  if (e.code === "KeyC" && lookingAtRange) fireAtRange(true);
  if (e.code === "KeyG") rangeWeapon = (rangeWeapon + 1) % weapons.length;
  if (e.code === "KeyT") rangeSlow = !rangeSlow;
  // Far enough back for the whole line-up: 14 m framed four mechs 6 m apart, and the roster grows.
  if (e.code === "Digit4") { distance = 14 * Math.max(1, roster.length / 4); lookingAtRoster = true; lookingAtProps = false; closeUp = -1; }
  if (e.code === "Digit6" && rosterModels.length > 0) { closeUp = (closeUp + 1) % rosterModels.length; distance = 7; turn = Math.PI / 2; lookingAtRoster = true; }
  if (e.code === "Digit5") { distance = 9; lookingAtProps = true; lookingAtRoster = false; closeUp = -1; }
  if (e.code === "KeyQ") turn -= 0.3;
  if (e.code === "KeyE") turn += 0.3;
  if (e.code === "KeyW") walk = (walk + 1) % WALKS.length;
  if (e.code === "KeyL") { preset = (preset + 1) % toon.presets.length; toon.useLight(toon.presets[preset]!); }
  if (e.code === "KeyR") rosterFiring = true;
  if (e.code === "KeyY") kickRoster("railShot");
  if (e.code === "KeyH") sensorDamage = (sensorDamage + 1) % SENSOR_DAMAGE.length;
  if (e.code === "KeyD") { kitDamage = (kitDamage + 1) % KIT_DAMAGE.length; showKitDamage(); }
  place();
});
window.addEventListener("keyup", (e) => { if (e.code === "KeyR") rosterFiring = false; });
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
place();
// Everything here is built by now: let what the master material draws cast sun shadows.
castShadows(scene);
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  walkRoster(dt);
  const fxDt = rangeSlow ? dt / 4 : dt;
  showFx(lookingAtFx || closeUp >= 0 ? fxDt : dt);
  fireRoster(closeUp >= 0 || lookingAtRoster || lookingAtFx ? fxDt : dt);
  shotFx.update(fxDt, rangeWorld);
  shotFx.draw(camera, fxDt);
  updateRange(fxDt);
  sunShadows.follow(camera);
  renderer.render(scene, camera);
});

// ---- Gate 13c (client): the Junk Titan's moves. Key I stands a live Titan beside the roster, past the scale Titan
// (key U), and steps it through walk, stomp, throw, roar and down; each move repeats so it can be watched again. It
// is fed made-up snapshots and messages on the timings the server uses (data/titan.json), through the same TitanView
// the game draws it with. No sound and no camera shake here. Kept in its own block, loaded with its own imports.
{
  const [{ TitanView }, { parseTitanLook }, { crossed }, { carFuseSeconds, carLanding, loadCarModel }, shared, titanLookJson, titanJson] = await Promise.all([
    import("./titanView"), import("./titanLook"), import("./titanPose"), import("./thrownCars"), import("@rustbucket/shared"),
    import("../../../data/titanLook.json"), import("../../../data/titan.json"),
  ]);
  const look = parseTitanLook(titanLookJson.default);
  const config = shared.parseTitanConfig(titanJson.default);
  const titan = new TitanView({
    scene, toon, look, config, zoneMaxHp, gait, sprites: fxSprites, explosions, deathFx: parseDeathFx(deathFxJson), ground: () => 0,
    sound: () => {}, shake: () => {},
  }, await loadKit(look.kit, kitsData));
  const car = await loadCarModel(kitsData, look.kit);
  if (car) titan.setCarModel(car);
  const MOVES = ["walk", "stomp", "throw", "roar", "down"] as const;
  const HOME_X = 48, HOME_Z = ROSTER_Z;
  const fuse = carFuseSeconds(config.throw.flightSeconds, shared.STEP);
  const flying = shared.createGrenade();
  const lands = { x: 0, y: 0, z: 0 };
  const state = { x: HOME_X, y: 0, z: HOME_Z, yaw: Math.PI, hp: 1, action: "walk" as (typeof MOVES)[number], actionSeconds: 0 };
  let move = -1; // index in MOVES, -1 while not looking
  let time = 0, seconds = 0, landIn = -1, stepLeft = 0;
  const moveSeconds = () => (state.action === "stomp" ? config.stomp.windupSeconds + config.stomp.recoverSeconds
    : state.action === "throw" ? config.throw.windupSeconds + config.throw.recoverSeconds : state.action === "roar" ? config.roar.seconds : Infinity);
  const frame = () => {
    if (move < 0) return;
    camera.position.set(HOME_X + Math.sin(turn) * 42, 14, HOME_Z + Math.cos(turn) * 42);
    camera.lookAt(HOME_X, 7, HOME_Z);
    label.textContent = `Junk Titan moves · I: next (now: ${MOVES[move]}) · Q / E: turn · V: effects ${vfxQuality()} · L: light · 1 / 2 / 3: back`;
  };
  window.addEventListener("keydown", (e) => {
    if (e.code.startsWith("Digit") || e.code === "KeyU") { move = -1; return; }
    if (e.code === "KeyI") {
      move = (move + 1) % MOVES.length;
      lookingAtPaint = false; lookingAtRange = false; lookingAtFx = false; closeUp = -1;
      if (MOVES[move] === "walk") titan.clear(); // stands back up after "down"
      state.action = MOVES[move]!;
      state.actionSeconds = seconds = 0;
      state.hp = MOVES[move] === "down" ? 0 : 1 - move * 0.2; // worn down a little more each move, to see the rust
      state.x = HOME_X; state.z = HOME_Z; state.yaw = Math.PI;
      if (state.action === "down") titan.event({ t: "titan", event: "fall", x: state.x, y: 0, z: state.z });
    }
    frame(); // after the page's own handler, so Q / E turn round the Titan here
  });
  let last = performance.now();
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (move < 0) return;
    time += dt;
    const before = seconds;
    seconds += dt;
    if (state.action === "walk") {
      // Back and forth in front of the roster at its walking speed, facing the way it goes.
      const reach = 14, w = config.walkSpeed / reach;
      state.x = HOME_X + Math.sin(time * w) * reach;
      state.yaw = Math.cos(time * w) > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else if (state.action !== "down" && seconds > moveSeconds() + 0.6) {
      seconds = 0; // again
    }
    const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw);
    if (state.action === "stomp" && crossed(before, seconds, config.stomp.windupSeconds)) {
      titan.event({ t: "titan", event: "stomp", x: state.x, y: 0, z: state.z, radius: config.stomp.radius });
    }
    if (state.action === "throw" && crossed(before, seconds, config.throw.windupSeconds)) {
      const t = config.throw;
      const rx = Math.cos(state.yaw), rz = -Math.sin(state.yaw);
      shared.aimCar(state.x + fx * t.handForward + rx * t.handSide, t.handHeight, state.z + fz * t.handForward + rz * t.handSide, state.x + fx * 45, config.car.radius, state.z + fz * 45, t.flightSeconds, config.car, shared.STEP, flying);
      titan.event({ t: "titan", event: "throw", x: flying.x, y: flying.y, z: flying.z, vx: flying.vx, vy: flying.vy, vz: flying.vz });
      carLanding(flying.x, flying.y, flying.z, flying.vx, flying.vy, flying.vz, config.car, fuse, shared.STEP, rangeWorld, lands);
      landIn = fuse;
    }
    if (landIn >= 0 && (landIn -= dt) < 0) {
      titan.event({ t: "titan", event: "land", x: lands.x, y: lands.y, z: lands.z });
      explosions.blast(lands.x, lands.y, lands.z, config.throw.blastRadius, 0);
    }
    if (state.action === "down" && crossed(before, seconds, config.fall.seconds)) explosions.blast(state.x, 1, state.z, config.fall.radius, 0);
    // A hand-made snapshot every frame, drawn a tenth of a second behind as the game draws it.
    state.actionSeconds = state.action === "walk" ? time : seconds;
    titan.push(state, now, now);
    for (stepLeft += dt; stepLeft >= shared.STEP; stepLeft -= shared.STEP) titan.step(rangeWorld);
    titan.update(now, dt, 100, camera.position, null);
  };
  requestAnimationFrame(tick);
}
