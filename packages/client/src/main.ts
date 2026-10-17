import * as THREE from "three";
import {
  applyLook, boxFromData, createMechInput, createMechState, parseCameraStats, parseMechStats,
  parseWeaponStats, stepMech, type Box, type BoxData,
} from "@rustbucket/shared";
import mechJson from "../../../data/mech.json";
import weaponJson from "../../../data/weapon.json";
import cameraJson from "../../../data/camera.json";
import greyboxJson from "../../../data/greybox.json";
import { DebugPanel } from "./debugPanel";
import { TimedEffects } from "./effects";
import { Input } from "./input";
import { Projectiles } from "./projectiles";
import { ThirdPersonCamera } from "./thirdPersonCamera";
import { Weapon } from "./weapon";

const STEP = 1 / 60;
const KILL_HEIGHT = -50;

const mechStats = parseMechStats(mechJson);
const weaponStats = parseWeaponStats(weaponJson);
const cameraStats = parseCameraStats(cameraJson);
const mapData = greyboxJson as { spawn: [number, number, number]; boxes: BoxData[] };
const boxes: Box[] = mapData.boxes.map(boxFromData);

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color("#9fb4c4");
scene.fog = new THREE.Fog("#9fb4c4", 300, 1500);
scene.add(new THREE.HemisphereLight("#ffffff", "#5b5a52", 1.4));
const sun = new THREE.DirectionalLight("#fff4e0", 2);
sun.position.set(80, 150, 40);
scene.add(sun);

// Grey-box map. Colours come from data/greybox.json.
const materials = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    materials.set(color, m);
  }
  return m;
}
const unitBox = new THREE.BoxGeometry(1, 1, 1);
for (const b of mapData.boxes) {
  const mesh = new THREE.Mesh(unitBox, material(b.color));
  mesh.position.set(...b.center);
  mesh.scale.set(...b.size);
  scene.add(mesh);
}

// Grey-box mech. Art hook: replace this group with a loaded model, keep the transform logic.
const mechGroup = new THREE.Group();
function part(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string): void {
  const mesh = new THREE.Mesh(unitBox, material(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mechGroup.add(mesh);
}
part(0, 2.4, 0, 1.8, 1.6, 1.2, "#738087");
part(-0.6, 0.8, 0, 0.6, 1.6, 0.7, "#738087");
part(0.6, 0.8, 0, 0.6, 1.6, 0.7, "#738087");
part(-1.2, 2.4, 0, 0.5, 1.2, 0.5, "#d9731a");
part(1.2, 2.4, -0.6, 0.5, 0.6, 1.6, "#d9731a");
scene.add(mechGroup);

const glow = new THREE.MeshBasicMaterial({ color: "#ffb833" });
const impacts = new TimedEffects(scene, 24, 0.25, glow);
const flashes = new TimedEffects(scene, 6, 0.3, glow);
const projectiles = new Projectiles(scene, 64, glow, impacts);

const rig = new ThirdPersonCamera(cameraStats, window.innerWidth / window.innerHeight);
const weapon = new Weapon(weaponStats, projectiles, flashes, rig);
const input = new Input(canvas, document.getElementById("hint")!);
const panel = new DebugPanel(mechStats, weaponStats, cameraStats);
panel.onFov = (fov) => { rig.camera.fov = fov; rig.camera.updateProjectionMatrix(); };

const [spawnX, spawnY, spawnZ] = mapData.spawn;
// Yaw PI faces +Z, down the long strip.
const mech = createMechState(mechStats, spawnX, spawnY, spawnZ, Math.PI);
const aim = { yaw: Math.PI, pitch: 0 };
const mechInput = createMechInput();
const look = { dx: 0, dy: 0 };

const fuelBar = document.getElementById("fuel")!;
const staminaBar = document.getElementById("stamina")!;
const fuelFill = fuelBar.firstElementChild as HTMLElement;
const staminaFill = staminaBar.firstElementChild as HTMLElement;

function respawn(): void {
  Object.assign(mech, createMechState(mechStats, spawnX, spawnY, spawnZ, aim.yaw));
}

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.setAspect(window.innerWidth / window.innerHeight);
});
renderer.setSize(window.innerWidth, window.innerHeight);

// Previous and current position, so the render can blend between fixed steps.
let prevX = mech.x, prevY = mech.y, prevZ = mech.z;
let accumulator = 0;
let simTime = 0;
let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const frameTime = Math.min((now - last) / 1000, 0.1);
  last = now;
  fps += (1 / Math.max(frameTime, 1e-4) - fps) * 0.1;

  if (input.wasPressed("F1")) {
    const open = panel.toggle();
    input.setPanelOpen(open);
    if (open) input.unlock();
    else input.lock();
  }
  if (input.wasPressed("KeyR")) respawn();

  // Look is applied every frame so the camera answers the mouse at once, not once per sim step.
  input.takeLook(look);
  applyLook(aim, look.dx, look.dy, mechStats);

  accumulator += frameTime;
  while (accumulator >= STEP) {
    prevX = mech.x; prevY = mech.y; prevZ = mech.z;
    input.sample(mechInput);
    mechInput.aimYaw = aim.yaw;
    mechInput.aimPitch = aim.pitch;
    stepMech(mech, mechInput, mechStats, STEP, boxes);
    if (mech.y < KILL_HEIGHT) respawn();

    simTime += STEP;
    weapon.update(simTime, mechInput.fire, mech, boxes);
    projectiles.update(STEP, boxes);
    impacts.update(STEP);
    flashes.update(STEP);
    accumulator -= STEP;
  }

  const alpha = accumulator / STEP;
  const x = prevX + (mech.x - prevX) * alpha;
  const y = prevY + (mech.y - prevY) * alpha;
  const z = prevZ + (mech.z - prevZ) * alpha;
  mechGroup.position.set(x, y, z);
  mechGroup.rotation.y = mech.bodyYaw;

  rig.update(x, y + cameraStats.pivotHeight, z, aim.yaw, aim.pitch, boxes, frameTime);

  fuelFill.style.width = `${mech.fuel.fraction * 100}%`;
  staminaFill.style.width = `${mech.stamina.fraction * 100}%`;
  fuelBar.classList.toggle("locked", mech.fuel.locked);
  staminaBar.classList.toggle("locked", mech.stamina.locked);
  if (panel.visible) panel.update(Math.hypot(mech.vx, mech.vz), mech.grounded, fps);

  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
