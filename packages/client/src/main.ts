import * as THREE from "three";
import {
  FireGate, Predictor, STEP, applyLook, boxFromData, computeShot, createMechInput, createMechState, createShot,
  parseCameraStats, parseMechStats, parseNetStats, parseWeaponStats,
  type Box, type BoxData, type Shot,
} from "@rustbucket/shared";
import mechJson from "../../../data/mech.json";
import weaponJson from "../../../data/weapon.json";
import cameraJson from "../../../data/camera.json";
import netJson from "../../../data/net.json";
import greyboxJson from "../../../data/greybox.json";
import { setAimTarget } from "./aimTarget";
import { DebugPanel } from "./debugPanel";
import { TimedEffects } from "./effects";
import { Input } from "./input";
import { addBox, createMechModel } from "./mechModel";
import { NetClient } from "./net";
import { Projectiles } from "./projectiles";
import { RemoteMechs } from "./remoteMechs";
import { ShotFx } from "./shotFx";
import { ThirdPersonCamera } from "./thirdPersonCamera";

const KILL_HEIGHT = -50;

const mechStats = parseMechStats(mechJson);
const weaponStats = parseWeaponStats(weaponJson);
const cameraStats = parseCameraStats(cameraJson);
const netStats = parseNetStats(netJson);
const mapData = greyboxJson as { spawn: [number, number, number]; boxes: BoxData[] };
const boxes: Box[] = mapData.boxes.map(boxFromData);

// Offline by default. Add ?online to join the local server, or ?server=ws://host:port for another one.
const params = new URLSearchParams(location.search);
const serverUrl = params.get("server") ?? (params.has("online") ? `ws://${location.hostname}:8080` : null);

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

for (const b of mapData.boxes) addBox(scene, b.center, b.size, b.color);

const mechGroup = createMechModel("#d9731a");
scene.add(mechGroup);

const glow = new THREE.MeshBasicMaterial({ color: "#ffb833" });
const impacts = new TimedEffects(scene, 24, 0.25, glow);
const flashes = new TimedEffects(scene, 6, 0.3, glow);
const shotFx = new ShotFx(weaponStats, new Projectiles(scene, 64, glow, impacts), flashes, impacts);
const remotes = new RemoteMechs(scene, netStats.interpolationDelayMs);

const rig = new ThirdPersonCamera(cameraStats, window.innerWidth / window.innerHeight);
const input = new Input(canvas, document.getElementById("hint")!);
const panel = new DebugPanel(mechStats, weaponStats, cameraStats);
panel.onFov = (fov) => { rig.camera.fov = fov; rig.camera.updateProjectionMatrix(); };

const [spawnX, spawnY, spawnZ] = mapData.spawn;
// Yaw PI faces +Z, down the long strip.
const predictor = new Predictor(mechStats, boxes, spawnX, spawnY, spawnZ, Math.PI);
const mech = predictor.state;
const aim = { yaw: Math.PI, pitch: 0 };
const mechInput = createMechInput();
const look = { dx: 0, dy: 0 };
const shot: Shot = createShot();
const gate = new FireGate();

// Online: wait for the first snapshot before stepping, so we start from where the server put us.
const net = serverUrl ? new NetClient(serverUrl) : null;
let ready = net === null;
let lastCorrection = 0;
// The visual offset left by a correction, faded out so the mech glides instead of snapping.
let offX = 0, offY = 0, offZ = 0;
// The latest step's positions, kept so rendering can blend between fixed steps.
let prevX = mech.x, prevY = mech.y, prevZ = mech.z;

if (net) {
  const hint = document.getElementById("hint")!;
  net.onSnapshot = (snap) => {
    const error = predictor.reconcile(snap.ack, snap.you, STEP);
    lastCorrection = error;
    if (!ready) {
      ready = true;
      prevX = mech.x; prevY = mech.y; prevZ = mech.z;
      offX = offY = offZ = 0;
    } else if (error > netStats.snapDistance) {
      offX = offY = offZ = 0;
      prevX = mech.x; prevY = mech.y; prevZ = mech.z;
    } else {
      offX += predictor.correctionX; offY += predictor.correctionY; offZ += predictor.correctionZ;
      prevX -= predictor.correctionX; prevY -= predictor.correctionY; prevZ -= predictor.correctionZ;
    }
    remotes.push(snap.others, performance.now());
  };
  net.onShot = (s) => {
    if (s.id === net.id) return; // our own shot already played the moment we fired
    shotFx.show(s);
  };
  net.onClose = (reason) => {
    ready = false;
    hint.classList.remove("hidden");
    hint.textContent = reason;
  };
}

const fuelBar = document.getElementById("fuel")!;
const staminaBar = document.getElementById("stamina")!;
const fuelFill = fuelBar.firstElementChild as HTMLElement;
const staminaFill = staminaBar.firstElementChild as HTMLElement;

function respawnOffline(): void {
  Object.assign(mech, createMechState(mechStats, spawnX, spawnY, spawnZ, aim.yaw));
}

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.setAspect(window.innerWidth / window.innerHeight);
});
renderer.setSize(window.innerWidth, window.innerHeight);

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
  if (net === null && input.wasPressed("KeyR")) respawnOffline();

  // Look is applied every frame so the camera answers the mouse at once, not once per sim step.
  input.takeLook(look);
  applyLook(aim, look.dx, look.dy, mechStats);

  if (ready) accumulator += frameTime;
  else accumulator = 0;
  while (accumulator >= STEP) {
    prevX = mech.x; prevY = mech.y; prevZ = mech.z;
    input.sample(mechInput);
    mechInput.aimYaw = aim.yaw;
    mechInput.aimPitch = aim.pitch;
    setAimTarget(rig.camera, boxes, weaponStats.maxAimDistance, mechInput);

    const seq = predictor.step(mechInput, STEP);
    net?.sendInput(seq, mechInput);
    if (net === null && mech.y < KILL_HEIGHT) respawnOffline();

    simTime += STEP;
    if (mechInput.fire && gate.tryFire(simTime, weaponStats.shotsPerSecond)) {
      computeShot(mech, mechInput.targetX, mechInput.targetY, mechInput.targetZ, weaponStats, Math.random, shot);
      shotFx.show(shot);
      rig.addShake(weaponStats.shakeForce);
    }
    shotFx.update(STEP, boxes);
    accumulator -= STEP;
  }

  const alpha = accumulator / STEP;
  const fade = Math.exp(-netStats.correctionSmoothing * frameTime);
  offX *= fade; offY *= fade; offZ *= fade;
  const x = prevX + (mech.x - prevX) * alpha + offX;
  const y = prevY + (mech.y - prevY) * alpha + offY;
  const z = prevZ + (mech.z - prevZ) * alpha + offZ;
  mechGroup.position.set(x, y, z);
  mechGroup.rotation.y = mech.bodyYaw;
  remotes.update(performance.now());

  rig.update(x, y + cameraStats.pivotHeight, z, aim.yaw, aim.pitch, boxes, frameTime);

  fuelFill.style.width = `${mech.fuel.fraction * 100}%`;
  staminaFill.style.width = `${mech.stamina.fraction * 100}%`;
  fuelBar.classList.toggle("locked", mech.fuel.locked);
  staminaBar.classList.toggle("locked", mech.stamina.locked);
  if (panel.visible) panel.update(Math.hypot(mech.vx, mech.vz), mech.grounded, fps, remotes.count + 1, lastCorrection);

  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
