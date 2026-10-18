import * as THREE from "three";
import { parseChunkSet, parsePropConfig, parseZones } from "@rustbucket/shared";
import chunksJson from "../../../data/chunks.json";
import propsJson from "../../../data/props.json";
import zonesJson from "../../../data/zones.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import damageFxJson from "../../../data/damageFx.json";
import { parseDamageFx } from "./damageFx";
import { createMechModel, setCrawlLook, setMechDamage } from "./mechModel";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import mechKitsJson from "../../../data/mechKits.json";
import { loadKit, parseKits } from "./mechKit";

// The V1 style test (style.html): one chunk, its props and three mechs in the game's look, seen from 10, 50 and
// 150 m, so the palette, bands, outline and light can be judged before any real art is made. Keys 1, 2, 3 move the
// camera; Q and E turn round the mechs.
const palette = parsePalette(paletteJson);
const toon = new Toon(parseLook(lookJson), palette);
const chunks = parseChunkSet(chunksJson);
const props = parsePropConfig(propsJson);
const zones = parseZones(zonesJson);
const zoneMaxHp = zones.zones.map((z) => z.hp);
setCrawlLook(parseDamageFx(damageFxJson).crawl, zones.damagedBelowFraction);
const kit = await loadKit("standin", parseKits(mechKitsJson));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
toon.light(scene);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000);

// Ground, then the chunk with its middle on the origin.
const ground = new THREE.Mesh(new THREE.BoxGeometry(600, 1, 600), toon.ground(palette.world.ground));
ground.position.y = -0.5;
scene.add(ground);
const template = chunks.templates.find((t) => t.id === "containers") ?? chunks.templates[0]!;
const half = chunks.size / 2;
for (const b of template.boxes) toon.box(scene, [b.center[0] - half, b.center[1], b.center[2] - half], b.size, chunks.palette[b.colorIndex]!);

// One of each prop, just past the chunk's edge.
props.types.forEach((t, i) => toon.box(scene, [-4 + i * 5, t.size[1] / 2, half + 4], t.size, t.color));

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
const showKitDamage = () => kitModel && setMechDamage(kitModel, KIT_DAMAGE[kitDamage]!.map((f, z) => f * zoneMaxHp[z]!), false);

const DISTANCES = [10, 50, 150];
let distance = DISTANCES[0]!;
let turn = 0.6;
const label = document.getElementById("label")!;
function place(): void {
  const target = new THREE.Vector3(5, 2, half + 12); // the middle of the line-up
  camera.position.set(target.x + Math.sin(turn) * distance, target.y + 1.5 + distance * 0.18, target.z + Math.cos(turn) * distance);
  camera.lookAt(target);
  label.textContent = `Style test, ${distance} m · 1 / 2 / 3: 10, 50, 150 m · Q / E: turn · front: stand-in kit mech${kit ? "" : " (failed to load)"} (D: damage ${["whole", "damaged", "arms broken", "legs broken"][kitDamage]}) · behind, left to right: you (clean), then 75%, 40%, 15%, arms and legs broken`;
}
window.addEventListener("keydown", (e) => {
  const index = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
  if (index >= 0) distance = DISTANCES[index]!;
  if (e.code === "KeyQ") turn -= 0.3;
  if (e.code === "KeyE") turn += 0.3;
  if (e.code === "KeyD") { kitDamage = (kitDamage + 1) % KIT_DAMAGE.length; showKitDamage(); }
  place();
});
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
place();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
