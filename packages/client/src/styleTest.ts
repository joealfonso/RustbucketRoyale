import * as THREE from "three";
import { mechStatsFor, parseChunkSet, parseMechStats, parsePropConfig, parseRoster, parseZones } from "@rustbucket/shared";
import mechJson from "../../../data/mech.json";
import rosterJson from "../../../data/roster.json";
import gaitJson from "../../../data/gait.json";
import { parseGait } from "./gait";
import { walkMech } from "./mechWalk";
import chunksJson from "../../../data/chunks.json";
import propsJson from "../../../data/props.json";
import zonesJson from "../../../data/zones.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import damageFxJson from "../../../data/damageFx.json";
import { parseDamageFx } from "./damageFx";
import { createMechModel, setCrawlLook, setMechDamage, type MechModel } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import mechKitsJson from "../../../data/mechKits.json";
import { loadKit, parseKits, type LoadedKit } from "./mechKit";
import { PROP_MODELS } from "./props";
import { toGeometry } from "./dressing/dressing";

// The V1 style test (style.html): one chunk, its props and three mechs in the game's look, seen from 10, 50 and
// 150 m, so the palette, bands, outline and light can be judged before any real art is made. Keys 1, 2, 3 move the
// camera; Q and E turn round the mechs; L steps through the light presets (data/look.json).
const palette = parsePalette(paletteJson);
const toon = new Toon(parseLook(lookJson), palette);
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
for (const m of mechs) {
  const model = createMechModel(m.accent, zoneMaxHp, toon, palette.mech.body, null, palette.mech.trim);
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
  rosterModels.push(model);
});

// Key W: the roster walks on the spot, as on a treadmill, so each gait (data/gait.json) can be judged side by side.
const gait = parseGait(gaitJson);
const rosterStats = parseRoster(rosterJson);
const statsFor = mechStatsFor(parseMechStats(mechJson), rosterStats);
const WALKS = ["standing", "walking", "running", "dashing", "in the air", "limping", "braced"] as const;
let walk = 0;
const clock = new THREE.Clock();
function walkRoster(dt: number): void {
  const mode = WALKS[walk]!;
  rosterModels.forEach((model, i) => {
    const stats = statsFor(rosterStats.mechs.findIndex((m) => m.id === roster[i]!.id));
    const speed = mode === "standing" || mode === "in the air" || mode === "braced" ? 0 : mode === "walking" || mode === "limping" ? stats.walkSpeed : mode === "dashing" ? stats.dashSpeed : stats.runSpeed;
    const yaw = model.group.rotation.y;
    setMechDamage(model, mode === "limping" ? [zoneMaxHp[0]! * 0.3, zoneMaxHp[1]!, zoneMaxHp[2]!] : zoneMaxHp, false);
    walkMech(model, gait, {
      vx: -Math.sin(yaw) * speed, vz: -Math.cos(yaw) * speed, yaw, grounded: mode !== "in the air", dashing: mode === "dashing",
      limping: mode === "limping", braced: mode === "braced", walkSpeed: stats.walkSpeed, runSpeed: stats.runSpeed,
    }, dt);
  });
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
  const target = close ? close.group.position.clone().setY(1.6) : lookingAtProps ? new THREE.Vector3(3, 0.5, half + 4) : new THREE.Vector3(5, 2, lookingAtRoster ? ROSTER_Z : half + 12);
  const lift = lookingAtProps ? 0.9 : 0.18; // looking down onto the props, over the mechs
  camera.position.set(target.x + Math.sin(turn) * distance, close ? 1.4 : target.y + 1.5 + distance * lift, target.z + Math.cos(turn) * distance);
  camera.lookAt(target);
  label.textContent = `Light: ${toon.presets[preset]!.name} (L) · ` + (lookingAtProps
    ? "Props, standing and broken: crate, junk pile, barrel · 1 / 2 / 3: back to the damage row · Q / E: turn"
    : close
    ? `${roster[closeUp]!.id} up close · W: ${WALKS[walk]} · 6: next mech · Q / E: turn · 4: the whole roster`
    : lookingAtRoster
    ? `Roster: ${roster.map((r) => r.id).join(", ") || "none loaded"} · W: ${WALKS[walk]} · 1 / 2 / 3: back to the damage row · Q / E: turn`
    : `Style test, ${distance} m · 1 / 2 / 3: 10, 50, 150 m · 4: the roster · 5: the props · Q / E: turn · front: stand-in kit mech${kit ? "" : " (failed to load)"} (D: damage ${["whole", "damaged", "arms broken", "legs broken"][kitDamage]}) · behind, left to right: you (clean), then 75%, 40%, 15%, arms and legs broken`);
}
window.addEventListener("keydown", (e) => {
  const index = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
  if (index >= 0) { distance = DISTANCES[index]!; lookingAtRoster = false; lookingAtProps = false; closeUp = -1; }
  if (e.code === "Digit4") { distance = 14; lookingAtRoster = true; lookingAtProps = false; closeUp = -1; }
  if (e.code === "Digit6" && rosterModels.length > 0) { closeUp = (closeUp + 1) % rosterModels.length; distance = 7; turn = Math.PI / 2; lookingAtRoster = true; }
  if (e.code === "Digit5") { distance = 9; lookingAtProps = true; lookingAtRoster = false; closeUp = -1; }
  if (e.code === "KeyQ") turn -= 0.3;
  if (e.code === "KeyE") turn += 0.3;
  if (e.code === "KeyW") walk = (walk + 1) % WALKS.length;
  if (e.code === "KeyL") { preset = (preset + 1) % toon.presets.length; toon.useLight(toon.presets[preset]!); }
  if (e.code === "KeyD") { kitDamage = (kitDamage + 1) % KIT_DAMAGE.length; showKitDamage(); }
  place();
});
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
place();
renderer.setAnimationLoop(() => {
  walkRoster(Math.min(0.05, clock.getDelta()));
  renderer.render(scene, camera);
});
