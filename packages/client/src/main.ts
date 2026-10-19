import * as THREE from "three";
import {
  FireGate, Predictor, STEP, applyLook, computeShot, isOutsideRing, createGrenade, createMechInput, createMechState, createShot,
  parseCameraStats, parseGrenadeStats, parseHudStats, parseMechStats, parseNetStats, parseWeapons, parseZones, parseUpgrades, applyTune, assignDeep, type TunableFile, type TuningRaws, upgradeScale, itemUpgrade, throwGrenade, partToRepair, createZoneHit, makeZonesFor, makeMuzzlesFor, mechStatsFor, parseRoster, ZONE_ARMS, parseLootConfig, parsePropConfig, itemWeapon, parseAbilities, abilityFor,
  type AbilityMessage, type BarrageStats, type HealthState, type Loadout, type MatchProgress, type PickupState, type RingNow, type Shot,
} from "@rustbucket/shared";
import mechJson from "../../../data/mech.json";
import audioJson from "../../../data/audio.json";
import { Sound, type AudioConfig } from "./audio";
import { Fireballs } from "./fireballs";
import weaponsJson from "../../../data/weapons.json";
import lootJson from "../../../data/loot.json";
import propsJsonForLoot from "../../../data/props.json";
import cameraJson from "../../../data/camera.json";
import netJson from "../../../data/net.json";
import hudJson from "../../../data/hud.json";
import grenadeJson from "../../../data/grenade.json";
import zonesJson from "../../../data/zones.json";
import damageFxJson from "../../../data/damageFx.json";
import upgradesJson from "../../../data/upgrades.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import mechKitsJson from "../../../data/mechKits.json";
import rosterJson from "../../../data/roster.json";
import abilitiesJson from "../../../data/abilities.json";
import { mechCards, savedMech } from "./mechPicker";
import gaitJson from "../../../data/gait.json";
import { parseGait, type GaitInput } from "./gait";
import { footInWorld, walkMech } from "./mechWalk";
import { loadKit, loadRoster, parseKits } from "./mechKit";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import botsJson from "../../../data/bots.json";
import noiseJson from "../../../data/noise.json";
import combatJson from "../../../data/combat.json";
import { DamageFx, parseDamageFx } from "./damageFx";
import { setAimTarget } from "./aimTarget";
import { DebugPanel, FrameTimes } from "./debugPanel";
import { TimedEffects } from "./effects";
import { Input } from "./input";
import { ClientGrenades } from "./grenades";
import { buildPlayMap, propConfig } from "./loadMap";
import { PropView } from "./propView";
import { PickupView } from "./pickupView";
import { setMechGear } from "./mechModel";
import { Hud } from "./hud";
import { DamageDiagram, parseDiagram } from "./damageDiagram";
import damageDiagramJson from "../../../data/damageDiagram.json";
import { Warnings, createWarningInput, parseWarnings } from "./warnings";
import warningsJson from "../../../data/warnings.json";
import { MapMeshes } from "./mapRenderer";
import { ContactShadows, parseShadowLook } from "./contactShadows";
import groundJson from "../../../data/ground.json";
import { BUILDERS, Dressing, scatter } from "./dressing";
import { PROP_MODELS } from "./props";
import { BreakFx } from "./props/breakFx";
import propFxJson from "../../../data/propFx.json";
import abilityFxJson from "../../../data/abilityFx.json";
import { AbilityFx, abilityMoment, parseAbilityFx } from "./abilityFx";
import { MortarWarnings } from "./mortarWarning";
import dressingJson from "../../../data/dressing.json";
import backdropJson from "../../../data/backdrop.json";
import tiersJson from "../../../data/tiers.json";
import { EdgeBarrier } from "./dressing/edgeBarrier";
import { parseBarrier } from "./dressing/edgeLayout";
import { Backdrop } from "./backdrop/backdrop";
import { parseBackdrop } from "./backdrop/layout";
import chunksJsonForDressing from "../../../data/chunks.json";
import { createMechModel, legsLimping, setCrawlLook, setMechDamage, setMechUpgrades, type MechModel } from "./mechModel";
import { NetClient } from "./net";
import { Projectiles } from "./projectiles";
import { Radar } from "./radar";
import { RemoteMechs } from "./remoteMechs";
import { RingView } from "./ringView";
import { ShotFx } from "./shotFx";
import { ThirdPersonCamera } from "./thirdPersonCamera";

const KILL_HEIGHT = -50;

const mechStats = parseMechStats(mechJson);
const weaponSet = parseWeapons(weaponsJson);
const lootConfig = parseLootConfig(lootJson, weaponSet, parsePropConfig(propsJsonForLoot));
const weaponColors = weaponSet.weapons.map((w) => w.color);
const upgradeSet = parseUpgrades(upgradesJson);
// The start weapon is what offline practice uses, and what the tuning panel edits.
const weaponStats = weaponSet.weapons[weaponSet.start]!;
const cameraStats = parseCameraStats(cameraJson);
const netStats = parseNetStats(netJson);
const grenadeStats = parseGrenadeStats(grenadeJson);
const hudStats = parseHudStats(hudJson);
const zoneSet = parseZones(zonesJson);
const zoneMaxHp = zoneSet.zones.map((z) => z.hp);
// The four mechs and how each one moves and takes damage, the same numbers the server uses.
const roster = parseRoster(rosterJson);
const statsFor = mechStatsFor(mechStats, roster);
// Each mech's Q ability (or null), the same rules the server steps with, so a ram or leap shows the instant Q goes down.
const abilitySet = parseAbilities(abilitiesJson);
const abilityOf = abilityFor(abilitySet, roster);
const damageFxConfig = parseDamageFx(damageFxJson);
setCrawlLook(damageFxConfig.crawl, zoneSet.damagedBelowFraction);

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
// The mech you asked for. null until you pick one: online the server deals you one by player number instead.
let picked = savedMech(roster, params);

if (!offline && !online) {
  hint.classList.add("hidden");
  const menu = document.getElementById("menu")!;
  menu.style.display = "flex";
  const tierSelect = document.getElementById("tierSelect") as HTMLSelectElement;
  const codeInput = document.getElementById("roomCode") as HTMLInputElement;
  const botSelect = document.getElementById("botSelect") as HTMLSelectElement;
  document.getElementById("createRoom")!.addEventListener("click", () => { location.search = `?create&tier=${tierSelect.value}${botSelect.value === "" ? "" : `&bots=${botSelect.value}`}`; });
  document.getElementById("joinRoom")!.addEventListener("click", () => { if (codeInput.value.trim()) location.search = `?room=${codeInput.value.trim().toUpperCase()}`; });
  document.getElementById("playOffline")!.addEventListener("click", () => { location.search = `?offline&tier=${tierSelect.value}`; });
  // Picking is remembered in this browser, so the game it opens next starts you in that mech.
  mechCards(document.getElementById("menuMechs")!, roster, picked ?? 0, () => {});
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
    if (picked !== null) net.sendMech(picked);
    // Reloading the page now rejoins this room.
    // Keep the room settings in the address too. If the server restarts, reloading brings the room back the same way.
    const again = new URLSearchParams({ room: roomCode, tier });
    if (params.has("bots")) again.set("bots", params.get("bots")!);
    if (params.has("kit")) again.set("kit", params.get("kit")!);
    history.replaceState(null, "", `?${again}`);
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
// Esc frees the mouse and shows the pause screen, where you can pick another mech. Online it swaps in the lobby
// and waits for the next match once one is running; offline it swaps at once.
const highlightMech = mechCards(document.getElementById("hintMechs")!, roster, picked ?? 0, (m) => {
  picked = m;
  if (net) net.sendMech(m);
  else mech.mech = m;
});

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// The game's look (V1): palette, toon bands and outlines, warm key light, sky and haze. See DESIGN.md and toonMaterial.ts.
// The map seed picks the light preset, so everyone in a room sees the same sky; offline ?look=<name> forces one.
const palette = parsePalette(paletteJson);
const toon = new Toon(parseLook(lookJson), palette);
const forcedLook = offline ? params.get("look") : null;
const scene = new THREE.Scene();
toon.light(scene, toon.presetFor(map.seed, forcedLook));
if (params.has("overview")) scene.fog = null;

let mapMeshes = new MapMeshes(scene, map, toon);
// Near you, map boxes are drawn as junkyard models of their kind and open ground gets scattered junk (data/dressing.json).
const dressingConfig = { ...dressingJson, chunkMeters: chunksJsonForDressing.size };
const makeDressing = () => new Dressing(scene, toon, map, mapMeshes, BUILDERS, scatter, dressingConfig);
let dressing = makeDressing();
// The edge walls drawn as a junkyard perimeter, and the world beyond them (data/backdrop.json). The backdrop is the
// same for every map of one size, so it is only rebuilt when the size changes.
const barrierConfig = parseBarrier(backdropJson.barrier);
const backdropConfig = parseBackdrop(backdropJson.backdrop);
let edgeBarrier = new EdgeBarrier(scene, toon, map, mapMeshes, barrierConfig);
const makeBackdrop = () => (map.tier === "range" ? null : new Backdrop(scene, toon, map.meters, tiersJson.edgeWallThickness, backdropConfig));
let backdrop = makeBackdrop();
let propView = new PropView(map, propConfig, toon, PROP_MODELS);
const breakFx = new BreakFx(scene, toon, propFxJson);
scene.add(propView.group);
const ringView = new RingView(scene, toon.color("zoneMagenta"));
// Soft dark patches under map boxes and mechs, so nothing floats over the ground (data/ground.json shadows).
const shadowLook = parseShadowLook(groundJson.shadows);
const contactShadows = new ContactShadows(scene, shadowLook, toon.color(shadowLook.color));
contactShadows.setMap(map.boxes, map.world);
const radar = net ? new Radar(hudStats.radarRangeMeters, hudStats.detectRangeMeters) : null;

// Each mech is drawn as its roster mech's kit, by the mech number the server sends. ?kit=grey draws everyone as the
// grey-box mech, ?kit=<name> everyone as one kit.
const kitId = params.get("kit") ?? "roster";
const kitsData = parseKits(mechKitsJson);
const oneKit = kitId !== "roster" && kitId !== "grey" ? await loadKit(kitId, kitsData) : null;
const kitFor = kitId === "roster" ? await loadRoster(kitsData) : () => oneKit;
const makeOwnModel = (m: number) => createMechModel(palette.mech.youAccent, zoneMaxHp, toon, palette.mech.body, kitFor(m), palette.mech.trim);
let shownMech = picked ?? 0;
let shownNext = -2; // the "next match" mech on the HUD line, -1 for none, -2 before the line is first written
let ownModel = makeOwnModel(shownMech);
let mechGroup = ownModel.group;
scene.add(mechGroup);

const glow = new THREE.MeshBasicMaterial({ color: "#ffb833" });
const impacts = new TimedEffects(scene, 24, 0.25, glow);
const flashes = new TimedEffects(scene, 6, 0.3, glow);
const projectiles = new Projectiles(scene, 64, glow, impacts);
const shotFx = new ShotFx(weaponStats, projectiles, flashes, impacts);
const sound = new Sound(audioJson as AudioConfig);
projectiles.onImpact = (x, y, z) => sound.play("impact", { x, y, z });
// Browsers only allow sound after a click, and the click that locks the mouse is the first one.
for (const el of [canvas, hint]) el.addEventListener("click", () => sound.start());
const blasts = new Fireballs(scene, 8);
const abilityFxConfig = parseAbilityFx(abilityFxJson);
const abilityFx = new AbilityFx(scene, abilityFxConfig, (c) => toon.color(c));
const whistleAt = { x: 0, y: 0, z: 0 };
const mortarWarnings = new MortarWarnings(scene, abilityFxConfig.warning, (c) => toon.color(c), (x, y, z) => {
  whistleAt.x = x; whistleAt.y = y; whistleAt.z = z;
  sound.play("shellIncoming", whistleAt);
});
// Walking (gait.ts): each mech's legs follow how fast it is really going. Footfalls kick up dust (art hook for V5).
const gaitConfig = parseGait(gaitJson);
const dust = new TimedEffects(scene, 32, gaitConfig.dustMeters, new THREE.MeshBasicMaterial({ color: "#a39a86", transparent: true, opacity: 0.45 }));
const gaitInput: GaitInput = { vx: 0, vz: 0, yaw: 0, grounded: true, dashing: false, limping: false, braced: false, walkSpeed: 0, runSpeed: 0 };
const footAt = new THREE.Vector3();
// Dust under each foot that came down, and one thud for them, pitched for the mech's weight. `audible` is false for
// someone else walking beyond gait.json hearWalkMeters: up close you hear a mech walk, further off only its run, and
// the radar still never shows walking (NOISE_KINDS), so sneaking past at a distance still works.
function footfalls(model: MechModel, feet: number, audible: boolean): void {
  let thud = audible;
  for (let leg = 0; leg < model.legs.length; leg++) {
    if (!(feet & (1 << leg))) continue;
    footInWorld(model, leg, footAt);
    dust.spawn(footAt.x, footAt.y, footAt.z, gaitConfig.dustSeconds);
    if (thud) {
      const loud = gaitConfig.stepLoudness + (gaitConfig.runStepLoudness - gaitConfig.stepLoudness) * model.gait!.loud;
      sound.play("step", footAt, loud, gaitConfig.mechs[model.gaitId]?.stepPitch ?? 1);
      thud = false;
    }
  }
}
const walkRemote = (model: MechModel, m: number, vx: number, vy: number, vz: number, jetting: boolean, running: boolean, ability: boolean) => {
  const stats = statsFor(m);
  gaitInput.vx = vx; gaitInput.vz = vz; gaitInput.yaw = model.group.rotation.y;
  // Others carry no grounded flag: jets on, or rising or falling fast, means in the air.
  gaitInput.grounded = !jetting && Math.abs(vy) < 2;
  // A ram leans like a dash. A pounce is in the air, so the feet tuck instead. A mortar strike plants the feet.
  const kind = abilityOf(m)?.kind;
  gaitInput.dashing = (ability && kind === "ram" && gaitInput.grounded) || Math.hypot(vx, vz) > stats.runSpeed * 1.15;
  gaitInput.braced = ability && kind === "barrage";
  gaitInput.limping = legsLimping(model);
  gaitInput.walkSpeed = stats.walkSpeed; gaitInput.runSpeed = stats.runSpeed;
  const feet = walkMech(model, gaitConfig, gaitInput, fxDt);
  if (feet) {
    const p = model.group.position, me = mechGroup.position;
    footfalls(model, feet, running || Math.abs(p.x - me.x) + Math.abs(p.z - me.z) < gaitConfig.hearWalkMeters);
  }
};

// Art hook: a puff where a prop broke. Replace with real debris at V5.
const debris = new TimedEffects(scene, 12, 1.6, new THREE.MeshBasicMaterial({ color: "#8c8577", transparent: true, opacity: 0.6 }));
const grenades = new ClientGrenades(scene, 8, grenadeStats);
const grenadeGate = new FireGate();
const thrown = createGrenade();
const damageFx = new DamageFx(scene, damageFxConfig, zoneSet);
let fxDt = 0;
const emitDamage = (model: MechModel) => damageFx.emitFrom(model, fxDt); // made once, so the frame loop allocates nothing
const shadowUnder = (model: MechModel) => contactShadows.addObject(model.group);
// Everyone else wears the same accent: telling friend from foe is by name and behaviour, not colour.
const pilotAccents = palette.mech.pilotAccents ?? [];
const accentFor = (id: number) => (pilotAccents.length > 0 ? pilotAccents[id % pilotAccents.length]! : palette.mech.othersAccent);
const remoteLook = { toon, accentFor, body: palette.mech.body, kitFor, trim: palette.mech.trim };
const remotes = new RemoteMechs(scene, netStats.interpolationBufferMs, netStats.maxViewDelayMs, netStats.snapshotEvery * STEP * 1000, zoneMaxHp);
remotes.weaponColors = weaponColors;
remotes.upgrades = upgradeSet.upgrades;
remotes.look = remoteLook;
remotes.ghostLook = abilityFxConfig.ghost;
const aimHit = createZoneHit();
// The crosshair checks each mech against its own hit boxes, the ones the server uses (only with the roster drawn).
const zonesFor = kitId === "roster" ? makeZonesFor(zoneSet, roster, mechKitsJson) : () => zoneSet;
// Your shots leave your mech's own gun, the same muzzles the server fires from, taking turns where it has two.
const muzzlesFor = makeMuzzlesFor(roster, mechKitsJson);
let shotsFired = 0;
const aimAtMechs = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => remotes.raycast(ox, oy, oz, dx, dy, dz, max, zonesFor, aimHit);
const pickupView = new PickupView(scene, lootConfig.colors, weaponColors, upgradeSet.upgrades.map((u) => u.color), toon);
if (net) net.viewDelayMs = () => remotes.viewDelayMs;

const rig = new ThirdPersonCamera(cameraStats, window.innerWidth / window.innerHeight);
const input = new Input(canvas, hint, () => mechStats.sprintDoubleTapSeconds);
// Live tuning works on copies of the raw data files. A change is checked and parsed like loading the file, then
// copied into the live values in place, so everything already holding them sees it.
const tuningRaws = JSON.parse(JSON.stringify({
  mech: mechJson, weapons: weaponsJson, grenade: grenadeJson, zones: zonesJson, loot: lootJson, upgrades: upgradesJson,
  bots: botsJson, noise: noiseJson, combat: combatJson, roster: rosterJson, abilities: abilitiesJson, props: propsJsonForLoot,
})) as TuningRaws;
const liveData: Partial<Record<TunableFile, unknown>> = { mech: mechStats, weapons: weaponSet, grenade: grenadeStats, zones: zoneSet, loot: lootConfig, upgrades: upgradeSet, roster, abilities: abilitySet };
const applyLocally = (file: string, path: string, value: number) => {
  const parsed = applyTune(tuningRaws, file, path, value);
  if (parsed !== null) assignDeep(liveData[file as TunableFile], parsed);
};
// Offline a change applies at once. Online it goes to the server, which sends it back to everyone, this client too.
const frameMs = new FrameTimes(240);
const workMs = new FrameTimes(240); // time spent on the frame before the GPU takes over: the headroom a locked 60 fps hides
const panel = new DebugPanel(mechStats, tuningRaws, cameraStats, (file, path, value) => (net ? net.sendTune(file, path, value) : applyLocally(file, path, value)));
panel.addGait(gaitConfig);
if (net) {
  net.onTuned = (file, path, value) => { applyLocally(file, path, value); panel.refresh(); };
  void net.welcome.then((w) => panel.setServerTuning(w.tuning), () => {});
}
// The rig re-applies the field of view from the tuning value every frame, so the slider needs no callback.

const [spawnX, spawnY, spawnZ] = map.spawn;
// Yaw PI faces +Z.
const predictor = new Predictor(statsFor, map.world, spawnX, spawnY, spawnZ, Math.PI, abilityOf);
const mech = predictor.state;
mech.mech = shownMech; // offline this is the mech you drive; online the first snapshot says
const aim = { yaw: Math.PI, pitch: 0 };
const mechInput = createMechInput();
const look = { dx: 0, dy: 0 };
const shot: Shot = createShot();
const gate = new FireGate();
let health: HealthState = { hp: [...zoneMaxHp], dead: false, respawnIn: 0 };
// What you carry. Online the server's word is final and arrives with every snapshot. Offline it never changes.
let loadout: Loadout = { slots: [weaponSet.start, -1], active: 0, grenades: lootConfig.grenadesStart, armor: [0, 0, 0], upgrades: [-1, -1] };
let serverActive = 0;
let firingSlot = 0; // the slot this client is firing from, so the switch pause is predicted too
let pickupsNow: PickupState[] = [];
let looting = 0; // how far through looting a wreck, 0 to 1, from the server
let repairing = 0; // how far through repairing a part, 0 to 1, from the server
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

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
  mapMeshes.dispose();
  scene.remove(propView.group);
  propView.dispose();
  map = buildPlayMap(newTier, newSeed, mechStats);
  toon.useLight(toon.presetFor(newSeed, forcedLook));
  mapMeshes = new MapMeshes(scene, map, toon);
  dressing.dispose();
  dressing = makeDressing();
  edgeBarrier.dispose();
  edgeBarrier = new EdgeBarrier(scene, toon, map, mapMeshes, barrierConfig);
  if (map.tier === "range" || backdrop?.meters !== map.meters) {
    backdrop?.dispose();
    backdrop = makeBackdrop();
  }
  propView = new PropView(map, propConfig, toon, PROP_MODELS);
  contactShadows.setMap(map.boxes, map.world);
  scene.add(propView.group);
  pickupView.clear();
  predictor.setWorld(map.world);
}

if (net) net.watchId = () => (health.dead ? spectateId : 0);

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
    // Hurt when hit points or armor went down. Picked something up when grenades or armor went up.
    const before = sum(health.hp) + sum(loadout.armor);
    const old = loadout;
    progress = snap.match;
    progressAt = performance.now();
    health = snap.health;
    loadout = snap.loadout;
    if (sum(health.hp) + sum(loadout.armor) < before) flashHurt();
    if (loadout.grenades > old.grenades || loadout.armor.some((a, zone) => a > old.armor[zone]!)) sound.play("pickup");
    if (loadout.slots[0] !== old.slots[0] || loadout.slots[1] !== old.slots[1]) sound.play("swap");
    // When the server changes the weapon in hand itself (taking a weapon into an empty slot), follow it.
    if (loadout.active !== serverActive) { serverActive = loadout.active; input.setSlot(loadout.active); }
    if (snap.pickups) {
      pickupsNow = snap.pickups;
      pickupView.sync(snap.pickups);
    }
    // A rattle every quarter of the way through looting, so holding E sounds like work being done.
    if (Math.floor(snap.looting * 4) > Math.floor(looting * 4)) sound.play("loot");
    looting = snap.looting;
    // A clank for every fifth of a repair, like work being done.
    if (Math.floor(snap.repairing * 5) > Math.floor(repairing * 5)) sound.play("repair");
    repairing = snap.repairing;
    ownModel.repairing = repairing > 0;
    setMechDamage(ownModel, health.hp, health.dead);
    net.noteSnapshot(snap.ack, snap.ackAgeMs, performance.now());
    remotes.push(snap.others, snap.tick, performance.now());
    for (const n of snap.noises) radar?.hear(n.x, n.z, n.kind, performance.now());
  };
  net.onShot = (s) => {
    if (s.id === net.id) return; // our own shot already played the moment we fired
    shotFx.show(s, s.hitMech);
    sound.play("shot", { x: s.ox, y: s.oy, z: s.oz });
  };
  net.onHit = (h) => {
    flashHitMarker(h.killed);
    showHit(h.zone, h.damage, h.killed);
    sound.play("hitMarker");
    impacts.spawn(h.x, h.y, h.z, 0.15);
  };
  net.onGrenade = (g) => {
    if (g.id === net.id) return; // our own grenade is already in the air
    grenades.spawn(g.x, g.y, g.z, g.vx, g.vy, g.vz);
    sound.play("grenadeThrow", { x: g.x, y: g.y, z: g.z });
  };
  net.onExplode = (e) => showBlast(e.x, e.y, e.z);
  // Your own start and landing already showed from prediction; anyone's ram or slam connecting shows here. The
  // warning ring for a strike is always the server's, yours too, so everyone sees the same spot.
  net.onAbility = (a) => {
    const own = a.id === net.id;
    if (a.event === "hit") showAbilityHit(a.x, a.y, a.z);
    else if (a.event === "pop") showPop(a.id, a.x, a.y, a.z);
    else if (a.event === "land") { if (!own) showSlam(a.x, a.y, a.z, slamRadiusOf(remotes.mechOf(a.id))); }
    else if (a.kind === "barrage") showStrike(a.id, own, a.x, a.y, a.z);
    // Others get nothing for decoys going out: they are meant to be fooled.
    else if (a.kind === "decoy") { if (own) showOwnDecoys(a.ids ?? []); }
    else if (!own) showAbilityStart(a.kind, a.x, a.y, a.z);
  };
  // A destroyed prop leaves the world here too, so walking where it stood matches the server.
  net.onPropDestroyed = (id) => {
    const prop = map.props[id];
    if (!prop || map.world.isDisabled(prop.boxIndex)) return;
    map.world.disable(prop.boxIndex);
    contactShadows.hideBox(prop.boxIndex);
    propView.destroy(id);
    debris.spawn(prop.x, prop.y, prop.z, 0.3);
    breakFx.burst(propConfig.types[prop.type]!.id, prop.x, prop.y, prop.z);
    sound.play("smash", { x: prop.x, y: prop.y, z: prop.z });
  };
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
const armsBroken = () => health.hp[ZONE_ARMS]! <= 0;
const damageDiagram = new DamageDiagram(document.getElementById("damageDiagram")!, parseDiagram(damageDiagramJson));
const warnings = new Warnings(document.getElementById("warnings")!, parseWarnings(warningsJson));
const warningInput = createWarningInput();
let hitTimer = 0;
let hurtTimer = 0;

function flashHitMarker(killed: boolean): void {
  crosshair.classList.remove("hit", "kill");
  crosshair.classList.add(killed ? "kill" : "hit");
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => crosshair.classList.remove("hit", "kill"), killed ? 400 : 120);
}

// Every hit that lands pops the tick marks again (restarting the animation), and says what it struck.
const hitMarker = document.getElementById("hitmarker")!;
const hitLabel = document.getElementById("hitlabel")!;
function showHit(zone: number, damage: number, killed: boolean): void {
  for (const el of [hitMarker, hitLabel]) {
    el.classList.remove("pop", "kill");
    void el.offsetWidth; // lets the same animation start again straight away
    el.classList.add("pop");
    if (killed) el.classList.add("kill");
  }
  const part = zone < 0 ? "SPLASH" : (zoneSet.zones[zone]?.name ?? "").toUpperCase();
  // A part already at zero takes nothing more, so say so rather than "-0".
  const amount = damage > 0 ? `-${Math.round(damage)}` : "BROKEN";
  hitLabel.textContent = killed ? `${part} ${amount} · DOWN` : `${part} ${amount}`;
}

function flashHurt(): void {
  sound.play("hurt");
  hurtOverlay.classList.add("on");
  clearTimeout(hurtTimer);
  hurtTimer = window.setTimeout(() => hurtOverlay.classList.remove("on"), 80);
}

// The camera shakes for something violent nearby, harder the closer it is.
function shakeNear(x: number, y: number, z: number, radius: number, force: number): void {
  const distance = Math.hypot(x - mech.x, y - mech.y, z - mech.z);
  if (distance < radius) rig.addShake((1 - distance / radius) * force);
}

function showBlast(x: number, y: number, z: number): void {
  grenades.removeNear(x, y, z);
  blasts.spawn(x, y + 0.6, z, 4.5);
  sound.play("explosion", { x, y, z });
  shakeNear(x, y, z, grenadeStats.shakeRadius, grenadeStats.shakeForce);
}

// The slam ring is as wide as the slam reaches, so what you see is what gets hit. 0 for a mech not seen yet.
function slamRadiusOf(m: number): number {
  const a = m >= 0 ? abilityOf(m) : null;
  return a?.kind === "pounce" ? a.slamRadius : 0;
}

// A ram, leap or mortar strike starting, at the mech. Decoys going out show nothing here (showOwnDecoys).
function showAbilityStart(kind: AbilityMessage["kind"], x: number, y: number, z: number): void {
  if (kind === "decoy") return;
  abilityFx.start(x, y, z);
  sound.play(kind === "barrage" ? "mortar" : kind, { x, y: y + 1, z });
}

// The strike's numbers for the Cataclysm that called it. Someone near the target may not have that mech in sight,
// so it falls back to whichever roster mech has a mortar strike.
function barrageOf(m: number): BarrageStats | null {
  const a = m >= 0 ? abilityOf(m) : null;
  if (a?.kind === "barrage") return a;
  for (const b of Object.values(abilitySet.mechs)) if (b.kind === "barrage") return b;
  return null;
}

const strikeFrom = { x: 0, y: 0, z: 0 };
// A strike called in: the ring at the target for everyone, and the launch at the Cataclysm for anyone but its
// pilot, who heard it from prediction.
function showStrike(id: number, own: boolean, x: number, y: number, z: number): void {
  const stats = barrageOf(own ? mech.mech : remotes.mechOf(id));
  if (stats) mortarWarnings.show(x, y, z, stats);
  if (!own && remotes.positionOf(id, strikeFrom)) showAbilityStart("barrage", strikeFrom.x, strikeFrom.y, strikeFrom.z);
}

// Your decoys going out: you see them see-through and hear them leave you. Nobody else does.
function showOwnDecoys(ids: readonly number[]): void {
  remotes.addOwnDecoys(ids);
  sound.play("decoy", { x: mech.x, y: mech.y + 1, z: mech.z });
}

function showPop(id: number, x: number, y: number, z: number): void {
  remotes.forgetOwnDecoy(id);
  abilityFx.fizz(x, y, z);
  sound.play("fizz", { x, y: y + abilityFxConfig.fizz.heightMeters, z });
}

function showSlam(x: number, y: number, z: number, radius: number): void {
  abilityFx.slam(x, y, z, radius);
  sound.play("slam", { x, y, z });
  shakeNear(x, y, z, abilityFxConfig.slam.shakeRadius, abilityFxConfig.slam.shakeForce);
}

function showAbilityHit(x: number, y: number, z: number): void {
  abilityFx.hit(x, y, z);
  sound.play("slam", { x, y, z });
  shakeNear(x, y, z, abilityFxConfig.hit.shakeRadius, abilityFxConfig.hit.shakeForce);
}

const fuelBar = document.getElementById("fuel")!;
const staminaBar = document.getElementById("stamina")!;
const fuelFill = fuelBar.firstElementChild as HTMLElement;
const staminaFill = staminaBar.firstElementChild as HTMLElement;

// A new mech under you: picked another one, or the server dealt one. The old model goes, damage is shown again on the new one.
function swapOwnMech(m: number): void {
  scene.remove(mechGroup);
  ownModel = makeOwnModel(m);
  mechGroup = ownModel.group;
  scene.add(mechGroup);
  setMechDamage(ownModel, health.hp, health.dead);
  shownMech = m;
  shownNext = -2; // says the HUD line is out of date
  if (picked === null) highlightMech(m);
}

function respawnOffline(): void {
  Object.assign(mech, createMechState(statsFor(mech.mech), spawnX, spawnY, spawnZ, aim.yaw, mech.mech));
}

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.setAspect(window.innerWidth / window.innerHeight);
});
renderer.setSize(window.innerWidth, window.innerHeight);

let accumulator = 0;
let lastCountdown = -1;
const camForward = new THREE.Vector3();
let simTime = 0;
let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const workStarted = performance.now();
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
  if (input.wasPressed("KeyM")) hud.feed(sound.toggleMute() ? "Sound off (M)" : "Sound on (M)");
  if (input.takeEnter() && net && hostId === net.id && progress.state === "lobby") net.sendStart();

  // Look is applied every frame so the camera answers the mouse at once, not once per sim step.
  input.takeLook(look);
  applyLook(aim, look.dx, look.dy, mechStats);

  if (ready) accumulator += frameTime;
  else accumulator = 0;
  while (accumulator >= STEP) {
    prevX = mech.x; prevY = mech.y; prevZ = mech.z;
    input.sample(mechInput);
    // Rounded to float precision, which is what the server receives, so both sides run identical numbers.
    mechInput.aimYaw = Math.fround(aim.yaw);
    mechInput.aimPitch = Math.fround(aim.pitch);
    // The weapon to fire: the slot asked for if it holds one, otherwise the one in hand.
    const wantedSlot = loadout.slots[mechInput.slot]! >= 0 ? mechInput.slot : loadout.active;
    if (wantedSlot !== firingSlot) { firingSlot = wantedSlot; gate.holdUntil(simTime + lootConfig.switchSeconds); }
    const weapon = weaponSet.weapons[loadout.slots[firingSlot]!] ?? weaponStats;
    setAimTarget(rig.camera, map.world, weapon.maxAimDistance, mechInput, aimAtMechs);
    mechInput.targetX = Math.fround(mechInput.targetX); mechInput.targetY = Math.fround(mechInput.targetY); mechInput.targetZ = Math.fround(mechInput.targetZ);
    // A destroyed mech can only look around, and nobody moves during the countdown: the same rules the server applies,
    // so prediction does not run ahead and get pulled back.
    if (health.dead || progress.state === "countdown") {
      mechInput.moveX = 0; mechInput.moveY = 0; mechInput.run = false; mechInput.jet = false;
      mechInput.fire = false; mechInput.grenade = false; mechInput.ability = false;
    }

    const dashBefore = mech.dashTime;
    const abilityBefore = mech.abilityTime;
    const seq = predictor.step(mechInput, STEP);
    if (dashBefore <= 0 && mech.dashTime > 0) sound.play("dash", { x: mech.x, y: mech.y + 1, z: mech.z });
    // Your own ram or leap shows from prediction, the instant Q goes down; the dust is where it pushed off from.
    const ownAbility = abilityOf(mech.mech);
    const moment = ownAbility ? abilityMoment(abilityBefore, mech.abilityTime, ownAbility.kind) : null;
    if (moment === "start") showAbilityStart(ownAbility!.kind, prevX, prevY, prevZ);
    else if (moment === "land") showSlam(mech.x, mech.y, mech.z, slamRadiusOf(mech.mech));
    net?.sendInput(seq, mechInput);
    if (net === null && mech.y < KILL_HEIGHT) respawnOffline();

    simTime += STEP;
    if (mechInput.fire && gate.tryFire(simTime, weapon.shotsPerSecond * upgradeScale(loadout, upgradeSet, "fireRate"))) {
      // Each pellet is drawn at once, with this client's own spread. The server decides what they hit.
      const muzzles = muzzlesFor(mech.mech);
      const muzzle = muzzles[shotsFired++ % muzzles.length]!;
      for (let i = 0; i < weapon.pellets; i++) {
        computeShot(mech, mechInput.targetX, mechInput.targetY, mechInput.targetZ, weapon, Math.random, shot, armsBroken() ? zoneSet.brokenArmsSpreadMultiplier : 1, muzzle);
        shotFx.show(shot);
      }
      sound.play("shot", { x: shot.ox, y: shot.oy, z: shot.oz });
      rig.addShake(weapon.shakeForce);
    }
    // Online a grenade needs one in the bag. Count it down here so a held key does not throw twice before the server says.
    const hasGrenade = (net === null || loadout.grenades > 0) && !armsBroken();
    if (mechInput.grenade && hasGrenade && grenadeGate.tryFire(simTime, 1 / grenadeStats.cooldownSeconds)) {
      if (net) loadout = { ...loadout, grenades: loadout.grenades - 1 };
      throwGrenade(mech, mechInput.targetX, mechInput.targetY, mechInput.targetZ, grenadeStats, thrown);
      grenades.spawn(thrown.x, thrown.y, thrown.z, thrown.vx, thrown.vy, thrown.vz);
      sound.play("grenadeThrow", { x: thrown.x, y: thrown.y, z: thrown.z });
    }
    shotFx.update(STEP, map.world);
    blasts.update(STEP);
    debris.update(STEP);
    breakFx.update(STEP);
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
  // With an instant body turn, face exactly where the camera looks, even between sim steps.
  mechGroup.rotation.y = mechStats.turnSpeedDegrees > 0 ? mech.bodyYaw : aim.yaw;
  remotes.update(performance.now());

  // Walking: your legs from your predicted speed, everyone else's from how they move on screen. Looks only.
  fxDt = frameTime;
  const ownStats = statsFor(mech.mech);
  const ownAbilityStats = abilityOf(mech.mech);
  gaitInput.vx = mech.vx; gaitInput.vz = mech.vz; gaitInput.yaw = mechGroup.rotation.y;
  gaitInput.grounded = mech.grounded; gaitInput.limping = legsLimping(ownModel);
  gaitInput.dashing = mech.dashTime > 0 || (mech.abilityTime > 0 && ownAbilityStats?.kind === "ram");
  gaitInput.braced = mech.abilityTime > 0 && ownAbilityStats?.kind === "barrage";
  gaitInput.walkSpeed = ownStats.walkSpeed; gaitInput.runSpeed = ownStats.runSpeed;
  const ownFeet = walkMech(ownModel, gaitConfig, gaitInput, frameTime);
  if (ownFeet && !health.dead) footfalls(ownModel, ownFeet, true);
  remotes.forEachNear(mechGroup.position.x, mechGroup.position.z, gaitConfig.farMeters, walkRemote);
  dust.update(frameTime);
  abilityFx.update(frameTime);
  mortarWarnings.update(frameTime);

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
  // The camera can ride a little of your walk's bob (camera.json walkBob, off by default).
  const bob = spectating ? 0 : (ownModel.gait?.bob ?? 0) * cameraStats.walkBob;
  rig.update(viewX, viewY + cameraStats.pivotHeight + bob, viewZ, aim.yaw, aim.pitch, map.world, frameTime);
  dressing.update(viewX, viewZ);

  const matchSeconds = progress.state === "active" ? progress.seconds + (performance.now() - progressAt) / 1000 : 0;
  const ring: RingNow | null = ringView.update(matchSeconds);
  const outside = ring !== null && !health.dead && progress.state === "active" && isOutsideRing(ring, mech.x, mech.z);
  if (net) hud.setProgress(progress, ring);

  // Sound: the ears go where the camera is, jets hiss while firing, and the countdown beeps each second then says go.
  rig.camera.getWorldDirection(camForward);
  sound.setListener(rig.camera.position.x, rig.camera.position.y, rig.camera.position.z, camForward.x, camForward.y, camForward.z);
  sound.setJets(mech.jetting && !health.dead);
  const countdown = progress.state === "countdown" ? Math.ceil(progress.seconds) : -1;
  if (countdown !== lastCountdown) {
    if (countdown > 0) sound.play("countdown");
    else if (lastCountdown > 0 && progress.state === "active") sound.play("go");
    lastCountdown = countdown;
  }
  // Watching someone, the radar is centred on them.
  radar?.draw(viewX, viewZ, aim.yaw, remotes, progress.state === "lobby" ? null : ring, outside, performance.now());

  // ?overview floats the camera above the middle of the map, for looking over a seed at a glance.
  if (overview) {
    rig.camera.position.set(0, map.meters * 0.75, 1);
    rig.camera.lookAt(0, 0, 0);
  }
  edgeBarrier.update(rig.camera.position);

  fuelFill.style.width = `${mech.fuel.fraction * 100}%`;
  staminaFill.style.width = `${mech.stamina.fraction * 100}%`;
  damageDiagram.update(mech.mech, zonesFor(mech.mech), health.hp, loadout.armor, lootConfig.armorPlates);
  warningInput.dead = health.dead;
  warningInput.outside = outside;
  warningInput.hp = health.hp;
  warningInput.maxHp = zoneMaxHp;
  warningInput.fuelFraction = mech.fuel.fraction;
  warningInput.fuelLocked = mech.fuel.locked;
  warningInput.jetHeld = mechInput.jet;
  warnings.update(warningInput);
  if (mech.mech !== shownMech) swapOwnMech(mech.mech);
  const next = picked !== null && picked !== mech.mech ? picked : -1;
  if (next !== shownNext) { shownNext = next; hud.setMech(roster.mechs[mech.mech]!, next >= 0 ? roster.mechs[next]!.name : null); }
  hud.setAbility(ownAbilityStats?.name ?? null, mech.abilityCooldown, ownAbilityStats?.cooldownSeconds ?? 0);
  damageFx.emitFrom(ownModel, frameTime);
  remotes.forEachModel(emitDamage);
  contactShadows.beginMoving();
  contactShadows.addObject(mechGroup);
  remotes.forEachModel(shadowUnder);
  contactShadows.endMoving();
  damageFx.update(frameTime);
  hud.setLoadout(loadout, weaponSet.weapons, lootConfig.armorPlates, upgradeSet.upgrades);
  setMechUpgrades(ownModel, loadout.upgrades, upgradeSet.upgrades);
  radar?.setRangeScale(upgradeScale(loadout, upgradeSet, "radarRange"));
  setMechGear(ownModel, weaponColors[loadout.slots[loadout.active]!] ?? weaponStats.color, loadout.armor);
  pickupView.update(performance.now());
  // Standing by a weapon, say what E would do.
  let near: PickupState | null = null;
  let nearDistance = lootConfig.interactRange;
  // The same choice the server makes: the nearest weapon or upgrade not already fitted.
  for (const p of pickupsNow) {
    if (itemWeapon(p.item) < 0 && (itemUpgrade(p.item) < 0 || loadout.upgrades.includes(itemUpgrade(p.item)))) continue;
    const d = Math.hypot(p.x - mech.x, p.z - mech.z);
    if (d <= nearDistance) { near = p; nearDistance = d; }
  }
  if (near && !health.dead && itemUpgrade(near.item) >= 0) {
    const name = upgradeSet.upgrades[itemUpgrade(near.item)]!.name;
    const full = loadout.upgrades[0] >= 0 && loadout.upgrades[1] >= 0;
    hud.setPrompt(full ? `E: fit ${name} (drops ${upgradeSet.upgrades[loadout.upgrades[0]]!.name})` : `E: fit ${name}`);
  } else if (near && !health.dead) {
    const name = weaponSet.weapons[itemWeapon(near.item)]!.name;
    const full = loadout.slots[0] >= 0 && loadout.slots[1] >= 0;
    const dropping = full ? weaponSet.weapons[loadout.slots[loadout.active]!]?.name : undefined;
    hud.setPrompt(dropping ? `E: take ${name} (drops ${dropping})` : `E: take ${name}`);
  } else if (looting > 0 && !health.dead) {
    hud.setPrompt(`Looting... ${Math.round(looting * 100)}%`);
  } else if (repairing > 0 && !health.dead) {
    hud.setPrompt(`Repairing ${zoneSet.zones[partToRepair(health.hp, zoneSet)]?.name ?? ""}... ${Math.round(repairing * 100)}%`);
  } else if (!health.dead && remotes.fullWreckNear(mech.x, mech.z, lootConfig.interactRange)) {
    hud.setPrompt("Hold E: loot wreck");
  } else if (!health.dead && net && partToRepair(health.hp, zoneSet) >= 0) {
    hud.setPrompt(`Hold F: repair ${zoneSet.zones[partToRepair(health.hp, zoneSet)]!.name}`);
  } else {
    hud.setPrompt("");
  }
  statusText.textContent = spectating
    ? `${myPlace ? `You placed ${myPlace}. ` : ""}${spectateId ? `Watching ${name(spectateId)}. Click to switch.` : "Nobody left to watch."}`
    : health.dead && progress.state !== "active" ? `Destroyed. Back in ${Math.ceil(health.respawnIn)}...` : "";
  fuelBar.classList.toggle("locked", mech.fuel.locked);
  staminaBar.classList.toggle("locked", mech.stamina.locked);
  if (panel.visible) panel.update(Math.hypot(mech.vx, mech.vz), mech.grounded, fps, remotes.count + 1, lastCorrection, net?.rttMs ?? 0, net ? remotes.viewDelayMs : 0);

  renderer.render(scene, rig.camera);
  frameMs.record(frameTime * 1000);
  workMs.record(performance.now() - workStarted);
  if (panel.visible) panel.updateRender(frameMs, workMs, renderer.info.render.calls, renderer.info.render.triangles);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
