import * as THREE from "three";
import {
  FireGate, Predictor, STEP, applyLook, computeShot, isOutsideRing, createGrenade, createMechInput, createMechState, createShot,
  parseCameraStats, parseGrenadeStats, parseMechStats, parseNetStats, parseWeaponStats, parseZones, throwGrenade,
  type HealthState, type MatchProgress, type RingNow, type Shot,
} from "@rustbucket/shared";
import mechJson from "../../../data/mech.json";
import weaponJson from "../../../data/weapon.json";
import cameraJson from "../../../data/camera.json";
import netJson from "../../../data/net.json";
import grenadeJson from "../../../data/grenade.json";
import zonesJson from "../../../data/zones.json";
import { setAimTarget } from "./aimTarget";
import { DebugPanel } from "./debugPanel";
import { TimedEffects } from "./effects";
import { Input } from "./input";
import { ClientGrenades } from "./grenades";
import { buildPlayMap } from "./loadMap";
import { Hud } from "./hud";
import { addMapMeshes, removeMapMeshes } from "./mapRenderer";
import { createMechModel, setMechDamage } from "./mechModel";
import { NetClient } from "./net";
import { Projectiles } from "./projectiles";
import { RemoteMechs } from "./remoteMechs";
import { RingView } from "./ringView";
import { ShotFx } from "./shotFx";
import { ThirdPersonCamera } from "./thirdPersonCamera";

const KILL_HEIGHT = -50;

const mechStats = parseMechStats(mechJson);
const weaponStats = parseWeaponStats(weaponJson);
const cameraStats = parseCameraStats(cameraJson);
const netStats = parseNetStats(netJson);
const grenadeStats = parseGrenadeStats(grenadeJson);
const zoneSet = parseZones(zonesJson);
const zoneMaxHp = zoneSet.zones.map((z) => z.hp);

// How to play is chosen in the address:
//   (nothing)                    the start menu
//   ?create&tier=medium&bots=5   make a new room on the local server with 5 bots, then share the link it shows
//   ?room=ABCD                   join that room
//   ?offline&tier=small&seed=5   practice alone, any tier or "range", any seed. Add &overview to look down on the map.
//   ?server=ws://host:port       use another server than the local one
const params = new URLSearchParams(location.search);
const offline = params.has("offline");
const online = params.has("room") || params.has("create") || params.has("online") || params.has("server");

const hint = document.getElementById("hint")!;
const hintHtml = hint.innerHTML;

if (!offline && !online) {
  hint.classList.add("hidden");
  const menu = document.getElementById("menu")!;
  menu.style.display = "flex";
  const tierSelect = document.getElementById("tierSelect") as HTMLSelectElement;
  const codeInput = document.getElementById("roomCode") as HTMLInputElement;
  const botSelect = document.getElementById("botSelect") as HTMLSelectElement;
  document.getElementById("createRoom")!.addEventListener("click", () => { location.search = `?create&tier=${tierSelect.value}&bots=${botSelect.value}`; });
  document.getElementById("joinRoom")!.addEventListener("click", () => { if (codeInput.value.trim()) location.search = `?room=${codeInput.value.trim().toUpperCase()}`; });
  document.getElementById("playOffline")!.addEventListener("click", () => { location.search = `?offline&tier=${tierSelect.value}`; });
  await new Promise(() => {}); // nothing more to do until a button reloads the page
}

function serverAddress(): string {
  const base = params.get("server") ?? `ws://${location.hostname}:8080`;
  const query = new URLSearchParams();
  if (params.get("room")) query.set("room", params.get("room")!);
  if (params.get("tier")) query.set("tier", params.get("tier")!);
  if (params.get("bots")) query.set("bots", params.get("bots")!);
  return `${base}/?${query}`;
}

const net = online ? new NetClient(serverAddress()) : null;
let tier = params.get("tier") ?? "medium";
let seed = params.has("seed") ? Number(params.get("seed")) : Math.floor(Math.random() * 0x100000000);
let roomCode = "";

try {
  if (net) {
    hint.textContent = "Connecting...";
    const welcome = await net.welcome;
    ({ tier, seed } = welcome);
    roomCode = welcome.code;
    // Reloading the page now rejoins this room.
    history.replaceState(null, "", `?room=${roomCode}`);
  }
  hint.textContent = `Building ${tier} map...`;
  // Let the message paint before the map build holds the thread.
  await new Promise((resolve) => setTimeout(resolve, 30));
} catch (error) {
  hint.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}
let map = buildPlayMap(tier, seed, mechStats);
const overview = params.has("overview");
hint.innerHTML = hintHtml;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color("#9fb4c4");
scene.fog = new THREE.Fog("#9fb4c4", 300, 1500);
if (params.has("overview")) scene.fog = null;
scene.add(new THREE.HemisphereLight("#ffffff", "#5b5a52", 1.4));
const sun = new THREE.DirectionalLight("#fff4e0", 2);
sun.position.set(80, 150, 40);
scene.add(sun);

let mapGroup = addMapMeshes(scene, map);
const ringView = new RingView(scene);

const ownModel = createMechModel("#d9731a", zoneMaxHp);
const mechGroup = ownModel.group;
scene.add(mechGroup);

const glow = new THREE.MeshBasicMaterial({ color: "#ffb833" });
const impacts = new TimedEffects(scene, 24, 0.25, glow);
const flashes = new TimedEffects(scene, 6, 0.3, glow);
const shotFx = new ShotFx(weaponStats, new Projectiles(scene, 64, glow, impacts), flashes, impacts);
const blastMaterial = new THREE.MeshBasicMaterial({ color: "#ff7a1a", transparent: true, opacity: 0.75 });
const blasts = new TimedEffects(scene, 6, 4, blastMaterial);
const grenades = new ClientGrenades(scene, 8, grenadeStats);
const grenadeGate = new FireGate();
const thrown = createGrenade();
const remotes = new RemoteMechs(scene, netStats.interpolationDelayMs, zoneMaxHp);

const rig = new ThirdPersonCamera(cameraStats, window.innerWidth / window.innerHeight);
const input = new Input(canvas, hint, () => mechStats.sprintDoubleTapSeconds);
const panel = new DebugPanel(mechStats, weaponStats, cameraStats);
// The rig re-applies the field of view from the tuning value every frame, so the slider needs no callback.

const [spawnX, spawnY, spawnZ] = map.spawn;
// Yaw PI faces +Z.
const predictor = new Predictor(mechStats, map.world, spawnX, spawnY, spawnZ, Math.PI);
const mech = predictor.state;
const aim = { yaw: Math.PI, pitch: 0 };
const mechInput = createMechInput();
const look = { dx: 0, dy: 0 };
const shot: Shot = createShot();
const gate = new FireGate();
let health: HealthState = { hp: [...zoneMaxHp], dead: false, respawnIn: 0 };

// Match state. Offline there is no match, so this just stays quiet.
let progress: MatchProgress = { state: "lobby", seconds: 0, alive: 1, total: 1 };
let progressAt = performance.now();
let hostId = 0;
let myPlace: number | null = null;
let spectateId = 0;
const spectatePos = { x: 0, y: 0, z: 0 };
const hud = new Hud(() => net?.sendStart(), copyInviteLink);

function copyInviteLink(): void {
  void navigator.clipboard.writeText(`${location.origin}/?room=${roomCode}`);
  hud.feed("Invite link copied");
}

// Every match brings a new map. Swap it in and point the sim at it.
function swapMap(newSeed: number, newTier: string): void {
  removeMapMeshes(scene, mapGroup);
  map = buildPlayMap(newTier, newSeed, mechStats);
  mapGroup = addMapMeshes(scene, map);
  predictor.setWorld(map.world);
}

const name = (id: number | null) => (id === null ? "the zone" : id === net?.id ? "You" : remotes.isBot(id) ? `Bot ${id}` : `Player ${id}`);

// Online: wait for the first snapshot before stepping, so we start from where the server put us.
let ready = net === null;
let lastCorrection = 0;
// The visual offset left by a correction, faded out so the mech glides instead of snapping.
let offX = 0, offY = 0, offZ = 0;
// The latest step's positions, kept so rendering can blend between fixed steps.
let prevX = mech.x, prevY = mech.y, prevZ = mech.z;

if (net) {
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
    const before = health.hp.reduce((a, b) => a + b, 0);
    progress = snap.match;
    progressAt = performance.now();
    health = snap.health;
    if (health.hp.reduce((a, b) => a + b, 0) < before) flashHurt();
    setMechDamage(ownModel, health.hp, health.dead);
    remotes.push(snap.others, performance.now());
  };
  net.onShot = (s) => {
    if (s.id === net.id) return; // our own shot already played the moment we fired
    shotFx.show(s, s.hitMech);
  };
  net.onHit = (h) => {
    flashHitMarker(h.killed);
    impacts.spawn(h.x, h.y, h.z, 0.15);
  };
  net.onGrenade = (g) => {
    if (g.id === net.id) return; // our own grenade is already in the air
    grenades.spawn(g.x, g.y, g.z, g.vx, g.vy, g.vz);
  };
  net.onExplode = (e) => showBlast(e.x, e.y, e.z);
  net.onRoom = (r) => {
    const wasCountdown = progress.state === "countdown";
    hostId = r.hostId;
    if (r.seed !== map.seed || r.tier !== map.tier) swapMap(r.seed, r.tier);
    ringView.setSchedule(r.ring);
    hud.setRoom(r, net.id);
    if (r.state === "countdown") { hud.hideResult(); myPlace = null; }
    if (r.state === "active" && wasCountdown) hud.flash("GO", 900);
    progress = { ...progress, state: r.state };
  };
  net.onEliminated = (e) => {
    hud.feed(e.killerId === null && e.id !== net.id ? `${name(e.id)} fell to the zone` : `${name(e.killerId)} knocked out ${name(e.id)}`);
    if (e.id === net.id) myPlace = e.place;
  };
  net.onResult = (r) => {
    const won = r.winnerId === net.id;
    hud.showResult(won ? "Victory!" : r.winnerId === null ? "Nobody wins" : `${name(r.winnerId)} wins`, myPlace && !won ? `You placed ${myPlace}. Next match starting...` : "Next match starting...");
  };
  net.onClose = (reason) => {
    ready = false;
    hint.classList.remove("hidden");
    hint.textContent = reason;
  };
}

const crosshair = document.getElementById("crosshair")!;
const hurtOverlay = document.getElementById("hurt")!;
const statusText = document.getElementById("status")!;
const zoneFills = Array.from(document.querySelectorAll<HTMLElement>("#zones .track > div"));
let hitTimer = 0;
let hurtTimer = 0;

function flashHitMarker(killed: boolean): void {
  crosshair.classList.remove("hit", "kill");
  crosshair.classList.add(killed ? "kill" : "hit");
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => crosshair.classList.remove("hit", "kill"), killed ? 400 : 120);
}

function flashHurt(): void {
  hurtOverlay.classList.add("on");
  clearTimeout(hurtTimer);
  hurtTimer = window.setTimeout(() => hurtOverlay.classList.remove("on"), 80);
}

function showBlast(x: number, y: number, z: number): void {
  grenades.removeNear(x, y, z);
  blasts.spawn(x, y + 0.2, z, 0.25);
  const distance = Math.hypot(x - mech.x, y - mech.y, z - mech.z);
  if (distance < grenadeStats.shakeRadius) rig.addShake((1 - distance / grenadeStats.shakeRadius) * grenadeStats.shakeForce);
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
  if (input.takeEnter() && net && hostId === net.id && progress.state === "lobby") net.sendStart();

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
    setAimTarget(rig.camera, map.world, weaponStats.maxAimDistance, mechInput);
    // A destroyed mech can only look around, the same rule the server applies.
    if (health.dead) {
      mechInput.moveX = 0; mechInput.moveY = 0; mechInput.run = false; mechInput.jet = false;
      mechInput.fire = false; mechInput.grenade = false;
    }

    const seq = predictor.step(mechInput, STEP);
    net?.sendInput(seq, mechInput);
    if (net === null && mech.y < KILL_HEIGHT) respawnOffline();

    simTime += STEP;
    if (mechInput.fire && gate.tryFire(simTime, weaponStats.shotsPerSecond)) {
      computeShot(mech, mechInput.targetX, mechInput.targetY, mechInput.targetZ, weaponStats, Math.random, shot);
      shotFx.show(shot);
      rig.addShake(weaponStats.shakeForce);
    }
    if (mechInput.grenade && grenadeGate.tryFire(simTime, 1 / grenadeStats.cooldownSeconds)) {
      throwGrenade(mech, mechInput.targetX, mechInput.targetY, mechInput.targetZ, grenadeStats, thrown);
      grenades.spawn(thrown.x, thrown.y, thrown.z, thrown.vx, thrown.vy, thrown.vz);
    }
    shotFx.update(STEP, map.world);
    blasts.update(STEP);
    // Offline there is no server to send the blast, so it goes off when the fuse ends.
    grenades.update(STEP, map.world, net === null ? showBlast : undefined);
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

  // A quick widening of the view sells the dash. The fraction runs from 1 at the start of a dash to 0 at its end.
  rig.setFovKick(mech.dashTime > 0 ? mech.dashTime / mechStats.dashSeconds : 0, frameTime);
  // A knocked out player (or someone who arrived mid match) watches a mech that is still standing.
  const spectating = net !== null && progress.state === "active" && health.dead;
  let viewX = x, viewY = y, viewZ = z;
  if (spectating) {
    const alive = remotes.aliveIds();
    if (input.takeClick() && alive.length > 0) spectateId = alive[(Math.max(0, alive.indexOf(spectateId)) + 1) % alive.length]!;
    else if (!alive.includes(spectateId)) spectateId = alive[0] ?? 0;
    if (spectateId && remotes.positionOf(spectateId, spectatePos)) {
      viewX = spectatePos.x; viewY = spectatePos.y; viewZ = spectatePos.z;
    }
  } else {
    input.takeClick(); // keep the click from piling up
  }
  mechGroup.visible = !(spectating && myPlace === null); // someone who never had a mech has nothing to show
  rig.update(viewX, viewY + cameraStats.pivotHeight, viewZ, aim.yaw, aim.pitch, map.world, frameTime);

  const matchSeconds = progress.state === "active" ? progress.seconds + (performance.now() - progressAt) / 1000 : 0;
  const ring: RingNow | null = ringView.update(matchSeconds);
  const outside = ring !== null && !health.dead && progress.state === "active" && isOutsideRing(ring, mech.x, mech.z);
  if (net) hud.setProgress(progress, ring, outside);

  // ?overview floats the camera above the middle of the map, for looking over a seed at a glance.
  if (overview) {
    rig.camera.position.set(0, map.meters * 0.75, 1);
    rig.camera.lookAt(0, 0, 0);
  }

  fuelFill.style.width = `${mech.fuel.fraction * 100}%`;
  staminaFill.style.width = `${mech.stamina.fraction * 100}%`;
  zoneFills.forEach((fill, zone) => { fill.style.width = `${(health.hp[zone]! / zoneMaxHp[zone]!) * 100}%`; });
  statusText.textContent = spectating
    ? `${myPlace ? `You placed ${myPlace}. ` : ""}${spectateId ? `Watching ${name(spectateId)}. Click to switch.` : "Nobody left to watch."}`
    : "";
  fuelBar.classList.toggle("locked", mech.fuel.locked);
  staminaBar.classList.toggle("locked", mech.stamina.locked);
  if (panel.visible) panel.update(Math.hypot(mech.vx, mech.vz), mech.grounded, fps, remotes.count + 1, lastCorrection);

  renderer.render(scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
