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

// The V1 style test (style.html): one chunk, its props and three mechs in the game's look, seen from 10, 50 and
// 150 m, so the palette, bands, outline and light can be judged before any real art is made. Keys 1, 2, 3 move the
// camera; Q and E turn round the mechs.
const palette = parsePalette(paletteJson);
const toon = new Toon(parseLook(lookJson), palette);
const chunks = parseChunkSet(chunksJson);
const props = parsePropConfig(propsJson);
const zones = parseZones(zonesJson);
const zoneMaxHp = zones.zones.map((z) => z.hp);
setCrawlLook(parseDamageFx(damageFxJson).crawl);

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

// You, someone else, and someone whose legs are gone, side by side.
const mechs = [
  { accent: palette.mech.youAccent, x: 0, broken: false },
  { accent: palette.mech.othersAccent, x: 5, broken: false },
  { accent: palette.mech.othersAccent, x: 10, broken: true },
];
for (const m of mechs) {
  const model = createMechModel(m.accent, zoneMaxHp, toon, palette.mech.body);
  model.group.position.set(m.x, 0, half + 12);
  model.group.rotation.y = Math.PI;
  if (m.broken) setMechDamage(model, [0, zoneMaxHp[1]!, zoneMaxHp[2]! * 0.6], false);
  scene.add(model.group);
}

const DISTANCES = [10, 50, 150];
let distance = DISTANCES[0]!;
let turn = 0.6;
const label = document.getElementById("label")!;
function place(): void {
  const target = new THREE.Vector3(5, 2, half + 12);
  camera.position.set(target.x + Math.sin(turn) * distance, target.y + 1.5 + distance * 0.18, target.z + Math.cos(turn) * distance);
  camera.lookAt(target);
  label.textContent = `Style test, ${distance} m · 1 / 2 / 3: 10, 50, 150 m · Q / E: turn · left: you, middle: someone else, right: broken legs`;
}
window.addEventListener("keydown", (e) => {
  const index = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
  if (index >= 0) distance = DISTANCES[index]!;
  if (e.code === "KeyQ") turn -= 0.3;
  if (e.code === "KeyE") turn += 0.3;
  place();
});
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
place();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
