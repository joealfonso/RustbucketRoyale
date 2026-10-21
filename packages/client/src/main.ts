import * as THREE from "three";
import {
  FireGate, Predictor, STEP, propsInReach, computeShot, isOutsideRing, createGrenade, createMechInput, createMechState, createShot,
  parseCameraStats, parseGrenadeStats, parseHudStats, parseMechStats, parseNetStats, parseWeapons, parseZones, parseUpgrades, applyTune, assignDeep, type TunableFile, type TuningRaws, upgradeScale, itemUpgrade, throwGrenade, partToRepair, createZoneHit, makeZonesFor, makeMuzzlesFor, mechStatsFor, parseRoster, ZONE_ARMS, parseLootConfig, parsePropConfig, itemWeapon, parseAbilities, abilityFor,
  FIRE_NONE, FIRE_SECONDARY, chargeShare, createAltFireState, createAltShot, stepAltFire, flightSteps, reelPoint, SURFACE_NUDGE, type HarpoonMessage, type RivetMessage,
  createRayHit, parseDropsConfig, parseTitanConfig, DROP_BALL, DROP_BURNING, DROP_HANGING, DROP_NONE, dropping, hangAtSpot, parseDropSpotStats, planDropSpots, releaseDrop, type AbilityMessage, type TitanMessage, type BarrageStats, type HealthState, type Loadout, type MatchProgress, type PickupState, type RingNow, type Shot, type WeaponStats,
} from "@rustbucket/shared";
import mechJson from "../../../data/mech.json";
import audioJson from "../../../data/audio.json";
import { Sound, type AudioConfig } from "./audio";
import { uiSounds } from "./uiSounds";
import { BlastSizes } from "./fx/blastSize";
import { Debris } from "./fx/debris";
import { Explosions, parseExplosionFx } from "./fx/explosion";
import explosionFxJson from "../../../data/explosionFx.json";
import { FxSprites } from "./fx/fxSprites";
import { Thrusters, parseThrusterFx } from "./fx/thrusters";
import thrusterFxJson from "../../../data/thrusterFx.json";
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
import { savedMech } from "./mechPicker";
import { rejoinQuery, serverQuery } from "./roomLinks";
import gaitJson from "../../../data/gait.json";
import { parseGait, type GaitInput } from "./gait";
import { footInWorld, walkMech } from "./mechWalk";
import { loadKit, loadRoster, parseKits } from "./mechKit";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import { SunShadows, castShadows } from "./sunShadows";
import botsJson from "../../../data/bots.json";
import noiseJson from "../../../data/noise.json";
import combatJson from "../../../data/combat.json";
import { DamageFx, parseDamageFx } from "./damageFx";
import { setAimTarget } from "./aimTarget";
import type { DebugPanel } from "./debugPanel";
import { FrameTimes } from "./frameTimes";
import { FeatureCost } from "./featureCost";
import { CreasePass } from "./creasePass";
import { GpuTimer } from "./gpuTimer";
import { Crt, parseCrt } from "./crt";
import crtJson from "../../../data/crt.json";
import { Input } from "./input";
import { ClientGrenades } from "./grenades";
import { buildPlayMap, propConfig } from "./loadMap";
import { PropView } from "./propView";
import { TreeView } from "./forest/treeView";
import { FallHints } from "./forest/fallHints";
import { parseForest } from "./forest/config";
import forestJson from "../../../data/forest.json";
import { PickupView } from "./pickupView";
import { setMechGear } from "./mechModel";
import { Hud } from "./hud";
import { DamageDiagram, parseDiagram } from "./damageDiagram";
import damageDiagramJson from "../../../data/damageDiagram.json";
import { Warnings, createWarningInput, parseWarnings } from "./warnings";
import warningsJson from "../../../data/warnings.json";
import { MapMeshes } from "./mapRenderer";
import { TerrainMeshes, parseTerrainMeshLook } from "./terrainMesh";
import { setGroundWater } from "./groundMaterial";
import { WaterMesh } from "./waterMesh";
import { waterLook } from "./waterLook";
import { Splashes, wadingAt } from "./splashes";
import { ContactShadows, parseShadowLook } from "./contactShadows";
import groundJson from "../../../data/ground.json";
import { BUILDERS, Dressing, scatter } from "./dressing";
import { PROP_MODELS } from "./props";
import { BreakFx, parsePropFx } from "./props/breakFx";
import propFxJson from "../../../data/propFx.json";
import abilityFxJson from "../../../data/abilityFx.json";
import { AbilityFx, abilityMoment, parseAbilityFx } from "./abilityFx";
import { MortarWarnings, warningSeconds } from "./mortarWarning";
import dressingJson from "../../../data/dressing.json";
import backdropJson from "../../../data/backdrop.json";
import tiersJson from "../../../data/tiers.json";
import { EdgeBarrier } from "./dressing/edgeBarrier";
import { parseBarrier } from "./dressing/edgeLayout";
import { Backdrop } from "./backdrop/backdrop";
import { parseBackdrop } from "./backdrop/layout";
import { Ranges, parseRanges } from "./backdrop/ranges";
import chunksJsonForDressing from "../../../data/chunks.json";
import { createMechModel, kickMech, legsLimping, moveGunsAndSensors, recoilConfig, setCrawlLook, setMechDamage, setMechUpgrades, type MechModel } from "./mechModel";
import { kickFor, kickIdFor } from "./recoil";
import { AltFireFx, pinLookOf } from "./altFireFx";
import { RivetView } from "./rivetView";
import { ANCHOR_MECH, ANCHOR_PICKUP, ANCHOR_WORLD, HarpoonView } from "./harpoonView";
import { NetClient, type Session } from "./net";
import { Radar } from "./radar";
import { parseRadar } from "./radarData";
import radarJson from "../../../data/radar.json";
import { RemoteMechs } from "./remoteMechs";
import { RingView } from "./ringView";
import { DropView } from "./dropView";
import { RailFx, type RailPose } from "./railFx";
import { moveMechParts } from "./mechMotion";
import { knockoutWords, statLines, type Names } from "./knockoutCard";
import { RenderScale, parseRenderScale } from "./renderScale";
import renderJson from "../../../data/render.json";
import { Tips, browserTipStore, parseTips } from "./tips";
import tipsJson from "../../../data/tips.json";
import dropsJson from "../../../data/drops.json";
import { ShotFx } from "./shotFx";
import { parseWeaponFx, usesAltLook, weaponFxFor } from "./weaponFxData";
import weaponFxJson from "../../../data/weaponFx.json";
import { addVfxQualityControl, mostOf, onVfxQuality, vfxConfig, vfxLevel, vfxQuality } from "./fx/quality";
import { ThirdPersonCamera } from "./thirdPersonCamera";
import { KillReplay, parseReplay } from "./killReplay";
import replayJson from "../../../data/replay.json";
import deathFxJson from "../../../data/deathFx.json";
import { DeathFx, parseDeathFx } from "./deathFx";
import titanJson from "../../../data/titan.json";
import titanLookJson from "../../../data/titanLook.json";
import { parseTitanLook } from "./titanLook";
import { TitanView } from "./titanView";
import { carFuseSeconds, carLanding, loadCarModel } from "./thrownCars";
import { bossBarShown } from "./hud";
import diveJson from "../../../data/dive.json";
import dropJson from "../../../data/drop.json";
import matchJson from "../../../data/match.json";
import { parseDive, share, startAltitude } from "./dive";
import { DiveCamera, simPitch } from "./diveCamera";
import { DiveHud } from "./diveHud";
import { DivePose } from "./divePose";
import { DiveTrails } from "./diveTrails";
import { LandingImpact } from "./landingImpact";
import { LandingMarker } from "./landingMarker";
import { SpeedLines } from "./speedLines";
import { DropSprites } from "./fx/dropSprites";
import { ScrapBalls } from "./scrapBall";
import { AimRing } from "./aimRing";

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
//   ?create&tier=medium&bots=5   make a new room on the local server with 5 bots, then share the link it shows.
//                                &difficulty=easy|normal|hard|mixed sets how hard its bots are (mixed if left out).
//   ?room=ABCD                   join that room
//   ?offline&tier=small&seed=5   practice alone, any tier or "range", any seed. Add &overview to look down on the map.
//   ?server=ws://host:port       use another server than the local one
const params = new URLSearchParams(location.search);
const offline = params.has("offline");
const online = params.has("room") || params.has("create") || params.has("online") || params.has("server");

// The CRT look on the HUD, as this browser last set it or else data/crt.json. Set before the start menu, which wears it too.
const crt = new Crt(document.documentElement, parseCrt(crtJson), () => localStorage);
const hint = document.getElementById("hint")!;
const hintHtml = hint.innerHTML;
// The mech you asked for. null until you pick one: online the server deals you one by player number instead.
let picked = savedMech(roster, params);

if (!offline && !online) {
  hint.classList.add("hidden");
  // Loaded only here, so a match never downloads or builds the hangar behind the title screen.
  const { showTitleScreen } = await import("./titleScreen");
  showTitleScreen(roster, picked ?? 0);
  await new Promise(() => {}); // nothing more to do until a button reloads the page
}

// A built game is served by the game server itself, so it connects back to the address it came from (wss on https).
// In development the page comes from Vite and the server is on 8080, or wherever `?server=` says; a built game
// ignores `?server=`, so an invite link can never send players to some other server.
function serverAddress(): string {
  const base = import.meta.env.DEV
    ? params.get("server") ?? `ws://${location.hostname}:8080`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  return `${base}/?${serverQuery(params)}`;
}

// Who this tab was in a room, so a reload mid match gets the same mech back. sessionStorage is per tab: two tabs of
// the same room are two players. Kept only while the address still names that room.
const SESSION_KEY = "rustbucket.session";
function savedSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return s && s.code === params.get("room")?.toUpperCase() ? s : null;
  } catch { return null; }
}
const keepSession = (s: Session | null) => { try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* private window: no reload rejoin */ } };
const net = online ? new NetClient(serverAddress(), netStats.rejoinGraceSeconds, savedSession()) : null;
if (net) net.onSession = keepSession;
let tier = params.get("tier") ?? "medium";
let seed = params.has("seed") ? Number(params.get("seed")) : Math.floor(Math.random() * 0x100000000);
let roomCode = "";

// A blinking cursor after the message while connecting and building (motion.css), so a long build never looks stuck.
hint.classList.add("busy");
try {
  if (net) {
    hint.textContent = "Connecting...";
    const welcome = await net.welcome;
    ({ tier, seed } = welcome);
    roomCode = welcome.code;
    if (picked !== null) net.sendMech(picked);
    // Reloading the page now rejoins this room.
    // Keep the room settings in the address too. If the server restarts, reloading brings the room back the same way.
    history.replaceState(null, "", `?${rejoinQuery(params, roomCode, tier)}`);
  }
  hint.textContent = `Building ${tier} map...`;
  // Let the message paint before the map build holds the thread.
  await new Promise((resolve) => setTimeout(resolve, 30));
} catch (error) {
  hint.classList.remove("busy");
  hint.textContent = error instanceof Error ? error.message : String(error);
  throw error;
}
let map = buildPlayMap(tier, seed, mechStats);
const overview = params.has("overview");
hint.classList.remove("busy");
hint.innerHTML = hintHtml;
crt.attachSwitch(document.getElementById("crtSwitch") as HTMLButtonElement);
// The mech is picked on the title screen only (gate 14a); the Menu button in the room bar goes back there.
document.getElementById("menuButton")!.addEventListener("click", () => { location.href = location.pathname; });
// Play from the title screen: the match starts the first time you click into the game, so it never counts down while
// you are still reading the screen. Only on the page Play opened: a reload or an invite link waits for Enter as before.
let autoStart = params.has("play");
// Players never see the tuning panel: a production build opens it only with &tuning in the address (for measuring
// on a laptop through the tunnel). Development always has it.
const tuningAllowed = import.meta.env.DEV || params.has("tuning");
const tips = new Tips(parseTips(tipsJson), browserTipStore(() => localStorage));
let clickedIn = false;
hint.addEventListener("click", () => { clickedIn = true; });

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
// Dynamic resolution (renderScale.ts): starts below a Retina screen's full ratio and follows how the frames go.
const renderScale = new RenderScale(parseRenderScale(renderJson), window.devicePixelRatio);
renderer.setPixelRatio(renderScale.ratio);
const frameSummary = { median: 0, worst: 0 }, gpuSummaryForScale = { median: 0, worst: 0 };

// The game's look (V1): palette, toon bands and outlines, warm key light, sky and haze. See DESIGN.md and toonMaterial.ts.
// The map seed picks the light preset, so everyone in a room sees the same sky; offline ?look=<name> forces one.
const palette = parsePalette(paletteJson);
const lookConfig = parseLook(lookJson);
const toon = new Toon(lookConfig, palette);
const forcedLook = offline ? params.get("look") : null;
const scene = new THREE.Scene();
toon.light(scene, toon.presetFor(map.seed, forcedLook));
toon.setGround(map.terrain);
// Real sun shadows near the camera (V7a, sunShadows.ts), their cost following the F1 "Effects quality" switch.
const sunShadows = new SunShadows(renderer, toon.sun, toon.toSun, lookConfig.shadows, vfxQuality());
onVfxQuality(() => sunShadows.setQuality(vfxQuality()));
if (params.has("overview")) scene.fog = null;

let mapMeshes = new MapMeshes(scene, map, toon);
// The hills (data/ground.json mesh), in the ground's toon look. The range has none: its floor is a box.
const terrainLook = parseTerrainMeshLook(groundJson.mesh);
const makeTerrain = () => (map.terrain ? new TerrainMeshes(scene, map.terrain, toon.ground(palette.world.ground), terrainLook) : null);
let terrainMeshes = makeTerrain();
// The water over the flooded low ground (data/water.json), and the ground under and round it soaked to mud.
const water = new WaterMesh(scene, waterLook.surface, toon.bands, (c) => toon.color(c));
const showWater = () => {
  water.setTerrain(map.terrain);
  setGroundWater(toon.ground(palette.world.ground), map.terrain?.waterLevel ?? null);
};
showWater();
// Near you, map boxes are drawn as junkyard models of their kind and open ground gets scattered junk (data/dressing.json).
const dressingConfig = { ...dressingJson, chunkMeters: chunksJsonForDressing.size };
const makeDressing = () => new Dressing(scene, toon, map, mapMeshes, BUILDERS, scatter, dressingConfig);
let dressing = makeDressing();
// The edge walls drawn as a junkyard perimeter, and the world beyond them (data/backdrop.json). The backdrop is the
// same for every map of one size, so it is only rebuilt when the size changes.
const barrierConfig = parseBarrier(backdropJson.barrier);
const backdropConfig = parseBackdrop(backdropJson.backdrop);
let edgeBarrier = new EdgeBarrier(scene, toon, map, mapMeshes, barrierConfig);
// An island tier (the Arena) gets open sea, distant islets and rigs instead of the junkyard round it (backdrop.ts).
const makeBackdrop = () => (map.tier === "range" ? null : new Backdrop(scene, toon, map.meters, tiersJson.edgeWallThickness, backdropConfig, map.terrain));
let backdrop = makeBackdrop();
// Mountains on the horizon beyond all of it, travelling with the camera; not round the range, which has no backdrop.
const ranges = new Ranges(parseRanges(backdropJson.ranges), toon.bands, toon.hazeColor, (c) => toon.color(c));
scene.add(ranges.mesh);
ranges.mesh.visible = map.tier !== "range" && !map.terrain?.island;
let propView = new PropView(map, propConfig, toon, PROP_MODELS);
// The woods (data/forest.json): the pines are props, but drawn and felled here.
const forestConfig = parseForest(forestJson);
const makeTrees = () => {
  const view = new TreeView(map, propConfig, toon, forestConfig);
  view.onLand = (x, y, z) => {
    breakFx.burst("pineCrown", x, y, z, groundBelow(x, y, z));
    treeAt.x = x; treeAt.y = y; treeAt.z = z;
    sound.play("treeLand", treeAt);
  };
  scene.add(view.group);
  return view;
};
// What shots and blasts were seen last, so a tree falls away from what hit it.
const fallHints = new FallHints(forestConfig.fall.hintSeconds, forestConfig.fall.hintShotMeters);
const treeAt = { x: 0, y: 0, z: 0 };
// Effects (V5a): shared sprite and chunk pools, sized for the most generous quality level in data/vfx.json and
// capped by the active one; explosions, jets and prop breaks draw from them.
const explosionFx = parseExplosionFx(explosionFxJson);
const fxSprites = new FxSprites(scene, (c) => toon.color(c), explosionFx.scorch);
const chunks = new Debris(scene, toon, mostOf(vfxConfig, "debris"), () => vfxLevel().debris ?? 0, explosionFx.chunks);
const explosions = new Explosions(scene, fxSprites, chunks, explosionFx, (c) => toon.color(c));
chunks.setTerrain(map.terrain);
explosions.setTerrain(map.terrain);
const thrusters = new Thrusters(fxSprites, parseThrusterFx(thrusterFxJson));
const splashes = new Splashes(fxSprites.water, waterLook.splashes);
const breakFx = new BreakFx(chunks, fxSprites, parsePropFx(propFxJson), (c) => toon.color(c));
// The drop-in (gates 16a to 16c): the flaming scrap balls, the drop's camera, HUD, aim ring, landing marker, smoke
// trails, the burst and the landing (data/dive.json). Its effects are inked toon sprites of their own.
const dive = parseDive(diveJson);
const dropSprites = new DropSprites(scene, (c) => toon.color(c), dive.toon);
const divePose = new DivePose(dive.pose);
const diveTrails = new DiveTrails(dropSprites, dive.trail);
const landingImpact = new LandingImpact(dropSprites, chunks, dive.impact, dive.impact.debrisColors.map((c) => new THREE.Color(toon.color(c))));
const speedLines = new SpeedLines(dive.speedLines, dropSprites);
const diveHud = new DiveHud(dive.hud);
const scrapBalls = new ScrapBalls(scene, toon, dropSprites, chunks, dive);
const dropSpotStats = parseDropSpotStats(dropJson.spots);
scene.add(propView.group);
let treeView = makeTrees();
// What the map casts in the sun. The dressing and the near edge wall mark their own as they rebuild near you.
const castMapShadows = () => {
  for (const group of [mapMeshes.group, dressing.group, dressing.far?.group, edgeBarrier.group, propView.group, treeView.group]) if (group) castShadows(group);
};
castMapShadows();
const ringView = new RingView(scene, toon.color("zoneMagenta"));
const dropView = new DropView(toon, fxSprites, parseDropsConfig(dropsJson));
// Made once: a closure made in the frame loop would be garbage every frame.
const markDrop = (x: number, z: number): void => radar?.markDrop(x, z);
// The Longshot's Rail Shot: lasers while charging, a beam when it fires (railFx.ts). Its range is the longest any
// roster mech's rail reaches, so a laser is never drawn shorter than the shot.
const railRange = Math.max(0, ...Object.values(abilitySet.mechs).map((a) => (a.kind === "rail" ? a.range : 0)));
const railMuzzle = ((mechKitsJson as { kits: Record<string, { muzzles?: number[][] }> }).kits.longshot?.muzzles?.[0] ?? [0.9, 2.6, -3]);
const railFx = new RailFx(toon.color("warningRed"), toon.color("warmLight"), railRange, railMuzzle);
scene.add(railFx.group);
const railPose: RailPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
const railFrom = { x: 0, y: 0, z: 0 };
// Where a charging mech is and which way it aims: yours from your own aim, anyone else's from how they are drawn
// (their aim up and down is not sent, so their laser runs level).
const railPoseOf = (id: number, out: RailPose): boolean => {
  if (net && id === net.id) { out.x = mech.x; out.y = mech.y; out.z = mech.z; out.yaw = aim.yaw; out.pitch = aim.pitch; return true; }
  if (!remotes.positionOf(id, out)) return false;
  out.yaw = remotes.yawOf(id); // models face -z turned by their yaw, the same convention as aim
  out.pitch = 0;
  return true;
};
const railChargeOf = (m: number): number => { const a = m >= 0 ? abilityOf(m) : null; return a?.kind === "rail" ? a.chargeSeconds : 0; };
scene.add(dropView.group);
// Soft dark patches under map boxes and mechs, so nothing floats over the ground (data/ground.json shadows).
const shadowLook = parseShadowLook(groundJson.shadows);
const contactShadows = new ContactShadows(scene, shadowLook, toon.color(shadowLook.color));
contactShadows.setMap(map.boxes, map.world);
// Where the sun's shadows reach, the box patches step back to a share of their strength.
const fadeContacts = () => contactShadows.fadeNear(sunShadows.meters, sunShadows.meters + sunShadows.ahead, lookConfig.shadows.contactNear);
fadeContacts();
onVfxQuality(fadeContacts);
const radar = net ? new Radar(hudStats.radarRangeMeters, hudStats.detectRangeMeters, parseRadar(radarJson)) : null;

// Each mech is drawn as its roster mech's kit, by the mech number the server sends. ?kit=grey draws everyone as the
// grey-box mech, ?kit=<name> everyone as one kit.
const kitId = params.get("kit") ?? "roster";
const kitsData = parseKits(mechKitsJson);
const oneKit = kitId !== "roster" && kitId !== "grey" ? await loadKit(kitId, kitsData) : null;
const kitFor = kitId === "roster" ? await loadRoster(kitsData) : () => oneKit;
const makeOwnModel = (m: number) => {
  const model = createMechModel(palette.mech.youAccent, zoneMaxHp, toon, palette.mech.body, kitFor(m), palette.mech.trim);
  castShadows(model.group);
  return model;
};
let shownMech = picked ?? 0;
let shownNext = -2; // the "next match" mech on the HUD line, -1 for none, -2 before the line is first written
let ownModel = makeOwnModel(shownMech);
let mechGroup = ownModel.group;
scene.add(mechGroup);

// Muzzle flashes, tracers and impacts in each weapon's look (data/weaponFx.json), the grit in the colours of the map.
const weaponFxConfig = parseWeaponFx(weaponFxJson);
const shotFx = new ShotFx(scene, weaponFxConfig, weaponSet.weapons, (c) => toon.color(c), vfxConfig.sprites.growSteps, vfxQuality);
// Each weapon's right-click look (gate 18a), by index in weapons.json: its name for the HUD, glow, vent and pin.
const weaponLooks = weaponFxFor(weaponFxConfig, weaponSet.weapons);
const altLooks = weaponLooks.map((l) => l.alt);
const showSurfaces = () => shotFx.impacts.setSurfaces(map.palette.map((c) => toon.color(c)), map.colors);
showSurfaces();
const sound = new Sound(audioJson as AudioConfig);
shotFx.onImpact = (x, y, z, weapon, nx, ny, nz) => {
  sound.play("impact", { x, y, z });
  // Offline there is no server to say where a rivet stuck: it sticks where its tracer lands.
  if (net === null && weapon === rivetGun) stickOfflineRivet(x, y, z, nx, ny, nz);
};
// Splashes and their sounds. `splashAt` is reused so a splash allocates nothing of ours.
const splashAt = { x: 0, y: 0, z: 0 };
function splashSound(x: number, y: number, z: number, look: { loudness: number; pitch: number }): void {
  splashAt.x = x; splashAt.y = y; splashAt.z = z;
  sound.play("splash", splashAt, look.loudness, look.pitch);
}
shotFx.onWater = (x, y, z) => {
  splashes.shot(x, y, z);
  splashSound(x, y, z, waterLook.splashes.shot.sound);
};
// A mech coming down hard in the water splashes instead of raising dust.
thrusters.onLanding = (x, y, z) => {
  if (!wadingAt(map.terrain, x, y, z)) return false;
  splashes.landing(x, map.terrain!.waterLevel, z);
  splashSound(x, y, z, waterLook.splashes.landing.sound);
  return true;
};
// Browsers only allow sound after a click, and the click that locks the mouse is the first one.
for (const el of [canvas, hint]) el.addEventListener("click", () => sound.start());
// UI sounds: a click for clicking in (or back in) and for the room bar's buttons, a tick for hovering them.
// Only while the mouse is free: the screen fades out under the first shots, and those clicks are not UI.
hint.addEventListener("click", () => { if (!document.pointerLockElement) sound.play("uiClick"); });
uiSounds(document.getElementById("roomBar")!, sound);
// A broken barrel goes off a beat later (props.json barrelBlast.delaySeconds) and the server's word on it can lag, so
// a blast where one broke is taken for it this long afterwards.
const BARREL_MEMORY_SECONDS = 1;
const blastSizes = new BlastSizes(grenadeStats.blastRadius, propConfig.barrelBlast.radius);
const abilityFxConfig = parseAbilityFx(abilityFxJson);
const abilityFx = new AbilityFx(fxSprites, explosions, abilityFxConfig);
const whistleAt = { x: 0, y: 0, z: 0 };
const mortarWarnings = new MortarWarnings(scene, abilityFxConfig.warning, (c) => toon.color(c), (x, y, z) => {
  whistleAt.x = x; whistleAt.y = y; whistleAt.z = z;
  sound.play("shellIncoming", whistleAt);
}, (x, z) => map.world.groundAt(x, z));
// Walking (gait.ts): each mech's legs follow how fast it is really going. Footfalls kick up dust.
const gaitConfig = parseGait(gaitJson);
const gaitInput: GaitInput = { vx: 0, vz: 0, yaw: 0, grounded: true, dashing: false, limping: false, braced: false, walkSpeed: 0, runSpeed: 0 };
const footAt = new THREE.Vector3();
// Dust under each foot that came down, and one thud for them, pitched for the mech's weight. `audible` is false for
// someone else walking beyond gait.json hearWalkMeters: up close you hear a mech walk, further off only its run, and
// the radar still never shows walking (NOISE_KINDS), so sneaking past at a distance still works.
// In the water (the same test the server slows a mech with) each foot splashes instead, and the thud is a slosh.
function footfalls(model: MechModel, feet: number, audible: boolean): void {
  let thud = audible;
  const p = model.group.position;
  const wading = wadingAt(map.terrain, p.x, p.y, p.z);
  const wade = waterLook.splashes.wade.sound;
  for (let leg = 0; leg < model.legs.length; leg++) {
    if (!(feet & (1 << leg))) continue;
    footInWorld(model, leg, footAt);
    if (wading) splashes.wade(footAt.x, map.terrain!.waterLevel, footAt.z);
    else fxSprites.dustPuff(footAt.x, footAt.y, footAt.z, gaitConfig.dustMeters, gaitConfig.dustSeconds);
    if (thud) {
      const loud = gaitConfig.stepLoudness + (gaitConfig.runStepLoudness - gaitConfig.stepLoudness) * model.gait!.loud;
      const pitch = gaitConfig.mechs[model.gaitId]?.stepPitch ?? 1;
      if (wading) sound.play("wade", footAt, loud * wade.loudness, pitch * wade.pitch);
      else sound.play("step", footAt, loud, pitch);
      thud = false;
    }
  }
}
const walkRemote = (model: MechModel, m: number, vx: number, vy: number, vz: number, jetting: boolean, running: boolean, ability: boolean, dropPhase = DROP_NONE) => {
  const stats = statsFor(m);
  gaitInput.vx = vx; gaitInput.vz = vz; gaitInput.yaw = model.group.rotation.y;
  // Others carry no grounded flag: jets on, or rising or falling fast, means in the air. Dropping in is always in
  // the air, even hanging still up top.
  gaitInput.grounded = dropPhase === DROP_NONE && !jetting && Math.abs(vy) < 2;
  // A ram leans like a dash. A pounce is in the air, so the feet tuck instead. A mortar strike plants the feet.
  const kind = abilityOf(m)?.kind;
  // Gliding in from the drop-in is faster than any run, but it is not a dash.
  gaitInput.dashing = dropPhase === DROP_NONE && ((ability && kind === "ram" && gaitInput.grounded) || Math.hypot(vx, vz) > stats.runSpeed * 1.15);
  gaitInput.braced = ability && kind === "barrage";
  gaitInput.limping = legsLimping(model);
  gaitInput.walkSpeed = stats.walkSpeed; gaitInput.runSpeed = stats.runSpeed;
  const feet = walkMech(model, gaitConfig, gaitInput, fxDt);
  moveMechParts(model, fxDt);
  if (dropPhase === DROP_BURNING) thrusters.drive(model, jetting, gaitInput.dashing, gaitInput.grounded, vy, fxDt, dive.burn.flameScale, dropSprites.fire);
  else thrusters.drive(model, jetting, gaitInput.dashing, gaitInput.grounded, vy, fxDt);
  if (feet) {
    const p = model.group.position, me = mechGroup.position;
    footfalls(model, feet, running || Math.abs(p.x - me.x) + Math.abs(p.z - me.z) < gaitConfig.hearWalkMeters);
  }
};

const grenades = new ClientGrenades(scene, 8, grenadeStats);
const grenadeGate = new FireGate();
const thrown = createGrenade();
const damageFx = new DamageFx(fxSprites, damageFxConfig, zoneSet);
const altFireFx = new AltFireFx(scene, (c) => toon.color(c), fxSprites, altLooks);
const pinLook = pinLookOf(altLooks);

// Gate 18b: the rivet gun's stuck rivets and the magnet harpoon's head and cable (rivetView.ts, harpoonView.ts).
const rivetGun = weaponSet.weapons.findIndex((w) => w.projectile.kind === "rivet");
const harpoonGun = weaponSet.weapons.findIndex((w) => w.projectile.kind === "harpoon");
const selfId = () => net?.id ?? 0; // offline you are 0
const drawnMech = (id: number): MechModel | null => (id === selfId() ? ownModel : remotes.modelOf(id));
// Read live, so tuning the rivet gun in F1 shows at once.
const rivetStats = () => { const p = weaponSet.weapons[rivetGun]?.projectile; return p?.kind === "rivet" ? p : null; };
const rivetLook = weaponLooks[rivetGun]?.rivet;
const rivetView = rivetLook
  ? new RivetView(scene, rivetLook, toon.ownMaterial(rivetLook.head), (c) => toon.color(c), drawnMech, () => rivetStats()?.blastRadius ?? 0)
  : null;
if (rivetView) {
  rivetView.popOwnFuses = net === null;
  rivetView.onPop = (x, y, z, radius) => showRivetPop(x, y, z, radius);
}
let offlineRivetId = 1;
function stickOfflineRivet(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  const stats = rivetStats();
  if (!rivetView || !stats) return;
  if (rivetView.countOf(0) >= stats.maxStuck) rivetView.popOldest(0);
  rivetView.stick({ owner: 0, id: offlineRivetId++, x, y, z, outX: nx, outY: ny, outZ: nz, mech: -1, fuseSeconds: stats.fuseSeconds });
  sound.play("rivetStick", { x, y, z });
}
// A rivet's pop: the explosion look at its size, its own short bang, and a shake if it is near.
function showRivetPop(x: number, y: number, z: number, radius: number): void {
  fallHints.blast(performance.now() / 1000, x, z, radius);
  explosions.blast(x, y, z, radius, groundBelow(x, y, z));
  sound.play("rivetPop", { x, y, z });
  if (rivetLook) shakeNear(x, y, z, rivetLook.popShakeRadius, rivetLook.popShake);
}
// A rivet the server says stuck: on the map facing out of the face it hit, or riding a mech at its spot on the body.
function showRivet(m: RivetMessage): void {
  if (!rivetView) return;
  if (m.event === "detonate") {
    rivetView.detonate(m.owner);
    if (m.owner !== selfId()) sound.play("detonateClick", { x: m.x, y: m.y + 2, z: m.z });
    return;
  }
  const on = m.on ?? -1;
  const local = on >= 0 && m.lx !== undefined ? { x: m.lx, y: m.ly ?? 0, z: m.lz ?? 0 } : undefined;
  // Riding a mech the head faces straight out from its middle; on the map, out of the face it hit.
  const outX = on >= 0 ? (local?.x ?? 0) : m.nx ?? 0, outY = on >= 0 ? 0 : m.ny ?? 1, outZ = on >= 0 ? (local?.z ?? 0) : m.nz ?? 0;
  rivetView.stick({ owner: m.owner, id: m.id, x: m.x, y: m.y, z: m.z, outX, outY: outX === 0 && outZ === 0 ? 1 : outY, outZ, mech: on, local, fuseSeconds: m.fuse ?? rivetStats()?.fuseSeconds ?? 1 });
  sound.play("rivetStick", { x: m.x, y: m.y, z: m.z });
}

const harpoonLook = weaponLooks[harpoonGun]?.harpoon;
const muzzleAt = { x: 0, y: 0, z: 0 };
// Where someone's barrel ends as drawn: yours from your model, anyone else's from theirs (their first muzzle).
function muzzleOf(id: number, out: { x: number; y: number; z: number }): boolean {
  const own = id === selfId();
  const model = own ? ownModel : remotes.modelOf(id);
  if (!model || !model.group.visible) return false;
  const muzzles = muzzlesFor(own ? mech.mech : Math.max(0, remotes.mechOf(id)));
  const muzzle = muzzles[own ? Math.max(0, shotsFired - 1) % muzzles.length : 0]!;
  const p = model.group.position, yaw = model.group.rotation.y;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  out.x = p.x + cos * muzzle[0]! + sin * muzzle[2]!; out.y = p.y + muzzle[1]!; out.z = p.z - sin * muzzle[0]! + cos * muzzle[2]!;
  return true;
}
const harpoonView = harpoonLook
  ? new HarpoonView(scene, harpoonLook, (c) => toon.color(c), toon.color(weaponSet.weapons[harpoonGun]!.color), fxSprites.sparks, muzzleOf, drawnMech, (id, out) => pickupView.positionOf(id, out))
  : null;
if (harpoonView && harpoonLook) {
  harpoonView.onLatch = (shooter, kind, target, x, y, z, reel) => {
    muzzleAt.x = x; muzzleAt.y = y; muzzleAt.z = z;
    sound.play("harpoonLatch", muzzleAt);
    if (kind === ANCHOR_MECH) {
      shotFx.impacts.mech(weaponLooks[harpoonGun]!.impact, x, y, z);
      sound.play("harpoonYank", muzzleAt);
      // Yanked yourself: the jerk on your camera as the cable goes taut.
      if (target === selfId()) rig.addShake(harpoonLook.yankShake);
    }
    if (reel) {
      if (muzzleOf(shooter, muzzleAt)) sound.play("harpoonReel", muzzleAt);
      if (shooter === selfId()) rig.addShake(harpoonLook.reelShake);
    }
  };
}
// Speed lines rushing past while a harpoon drags you, yours or someone else's (data/weaponFx.json reelLines).
const reelLines = harpoonLook ? new SpeedLines(harpoonLook.reelLines, dropSprites) : null;
const reelHit = createRayHit();
const reelTo = { x: 0, y: 0, z: 0 };
// Your own harpoon leaving: its head and cable from your muzzle. A reel is predicted: where it will land on the map
// is found now, and the pull starts on the step it gets there, as the server will start it.
function fireOwnHarpoon(s: Shot, weapon: WeaponStats, reel: boolean, seq: number): void {
  if (!harpoonView) return;
  const hit = map.world.raycast(s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, weapon.maxAimDistance, reelHit);
  const length = hit ? reelHit.distance : Math.min(s.length, weapon.maxAimDistance);
  harpoonView.fire(selfId(), s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, length, reel);
  if (!hit) return;
  const hx = s.ox + s.dx * reelHit.distance, hy = s.oy + s.dy * reelHit.distance, hz = s.oz + s.dz * reelHit.distance;
  const sec = weapon.secondary;
  if (reel && sec.kind === "reel") {
    // The same nudge off the surface and no lift of its own as the server's reel, so the pull predicts exactly.
    const n = SURFACE_NUDGE;
    reelPoint(hx + reelHit.normalX * n, hy + reelHit.normalY * n, hz + reelHit.normalZ * n, reelHit.normalX, reelHit.normalY, reelHit.normalZ, sec, reelTo);
    predictor.pullAfter(seq + flightSteps(reelHit.distance, weapon), reelTo.x, reelTo.y, reelTo.z, sec.speed, sec.maxSeconds, sec.stopMeters, 0);
    harpoonView.latch(selfId(), ANCHOR_WORLD, -1, hx, hy, hz, true, sec.maxSeconds);
  } else if (net === null) {
    // Offline a harpoon into the map just bites and lets go: there is nothing there to drag.
    harpoonView.latch(selfId(), ANCHOR_WORLD, -1, hx, hy, hz, false);
  }
}
// The server's word on where a harpoon landed and how long it pulls.
function showHarpoon(m: HarpoonMessage): void {
  if (!harpoonView) return;
  if (m.hit === "none") { harpoonView.release(m.id); return; }
  const hold = m.seconds ?? 0;
  if (m.hit === "mech" && m.target !== undefined) harpoonView.latch(m.id, ANCHOR_MECH, m.target, m.x, m.y, m.z, m.reel, hold);
  else if (m.hit === "pickup" && m.target !== undefined) harpoonView.latch(m.id, ANCHOR_PICKUP, m.target, m.x, m.y, m.z, m.reel, hold);
  // A smashed crate: the head drags its loot back.
  else if (m.hit === "prop" && m.loot !== undefined) harpoonView.latch(m.id, ANCHOR_PICKUP, m.loot, m.x, m.y, m.z, m.reel, hold);
  else harpoonView.latch(m.id, ANCHOR_WORLD, -1, m.x, m.y, m.z, m.reel, hold);
}
let fxDt = 0;
const emitDamage = (model: MechModel) => damageFx.emitFrom(model, fxDt); // made once, so the frame loop allocates nothing
const moveGuns = (model: MechModel) => moveGunsAndSensors(model, fxDt);
// Someone's gun kicks for a shot that left from (ox, oz) in the world: which gun goes by where the shot started, in
// the mech's own frame (the inverse of computeShot's turn), so the Arbiter's two guns kick in turn.
const kickShooter = (model: MechModel | null, kick: string | undefined, ox: number, oz: number) => {
  if (kick === undefined) return;
  if (!model) return;
  const p = model.group.position, yaw = model.group.rotation.y;
  kickMech(model, kickFor(recoilConfig, kick), Math.cos(yaw) * (ox - p.x) - Math.sin(yaw) * (oz - p.z));
};
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
// A mech knocked out blows apart (deathFx.ts), pushed the way the killing blow went: from where its killer stood,
// noted when the knockout is announced, which comes just before the snapshot that shows it dead.
const deathFx = new DeathFx(fxSprites, explosions, parseDeathFx(deathFxJson), groundBelow);
const knockedFrom = new Map<number, { x: number; z: number }>();
const killerAt = { x: 0, y: 0, z: 0 };
remotes.onKnockedOut = (id, model, alreadyDown) => {
  if (alreadyDown) { deathFx.lieDown(model, id); return; }
  const from = knockedFrom.get(id);
  knockedFrom.delete(id);
  const at = model.group.position;
  deathFx.blowApart(model, from ? at.x - from.x : 0, from ? at.z - from.z : 0, id);
};
// Someone else's drop-in: the ball bursting as the retro-jets light, and coming down. Their ball, pose and smoke
// trail are drawn each frame.
remotes.onDropPhase = (_model, from, to, x, y, z) => {
  if (to === DROP_BURNING && from !== DROP_NONE) showBurn(x, y, z);
  else if (to === DROP_NONE && from !== DROP_NONE) showLanding(x, y, z, false);
};
const dropRemote = (model: MechModel, phase: number, vx: number, vy: number, vz: number, id: number) => {
  divePose.apply(model, phase, fxDt);
  diveTrails.emit(model, phase, vx, vy, vz, fxDt);
  if ((phase === DROP_HANGING || phase === DROP_BALL) && !model.dead) { const p = model.group.position; scrapBalls.ball(p.x, p.y, p.z, vx, vy, vz, id); }
};
// The Junk Titan (gate 13c): drawn from the snapshots, its moments from "titan" messages (titanView.ts). Its model is
// fetched the first time one is near, so a map without one never downloads it; until then a grey-box stand-in.
const titanConfig = parseTitanConfig(titanJson);
const titanLook = parseTitanLook(titanLookJson);
const titanView = new TitanView({
  scene, toon, look: titanLook, config: titanConfig, zoneMaxHp, gait: gaitConfig, sprites: fxSprites, explosions,
  deathFx: parseDeathFx(deathFxJson), ground: groundBelow,
  sound: (name, at, loudness, pitch) => sound.play(name, at, loudness, pitch),
  shake: (x, y, z, radius, force) => shakeNear(x, y, z, radius, force),
}, null);
let titanKitAsked = kitId === "grey";
const askTitanKit = () => {
  if (titanKitAsked) return;
  titanKitAsked = true;
  void loadKit(titanLook.kit, kitsData).then((kit) => { if (kit) titanView.setKit(kit); });
  void loadCarModel(kitsData, titanLook.kit).then((car) => { if (car) titanView.setCarModel(car); });
};
const titanFuse = carFuseSeconds(titanConfig.throw.flightSeconds, STEP);
const TITAN_ID = 0; // who the server says was hit when a shot strikes the Titan (server Titan.ts)
const carLands = { x: 0, y: 0, z: 0 };
// A Titan moment, live or in the kill replay. The blasts it leads to are the server's explode messages, which carry
// only a spot: a thrown car's landing (worked out now, from the same flight) and the body coming down are
// remembered there, so those blasts are drawn their own size.
function showTitan(m: TitanMessage): void {
  const now = performance.now() / 1000;
  if (m.event === "throw") {
    carLanding(m.x, m.y, m.z, m.vx ?? 0, m.vy ?? 0, m.vz ?? 0, titanConfig.car, titanFuse, STEP, map.world, carLands);
    blastSizes.strike(carLands.x, carLands.z, 0, now, titanFuse + BARREL_MEMORY_SECONDS, titanConfig.throw.blastRadius);
  } else if (m.event === "fall") {
    blastSizes.strike(m.x, m.z, 0, now, titanConfig.fall.seconds + BARREL_MEMORY_SECONDS, titanConfig.fall.radius);
  }
  titanView.event(m);
}
const aimHit = createZoneHit();
// The crosshair checks each mech against its own hit boxes, the ones the server uses (only with the roster drawn).
const zonesFor = kitId === "roster" ? makeZonesFor(zoneSet, roster, mechKitsJson) : () => zoneSet;
// Your shots leave your mech's own gun, the same muzzles the server fires from, taking turns where it has two.
const muzzlesFor = makeMuzzlesFor(roster, mechKitsJson);
let shotsFired = 0;
// The Titan's hit boxes count too, so shots aimed at it converge on it rather than on the wall behind.
const aimAtMechs = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => {
  const mech = remotes.raycast(ox, oy, oz, dx, dy, dz, max, zonesFor, aimHit);
  const titan = titanView.raycast(ox, oy, oz, dx, dy, dz, mech >= 0 ? mech : max, aimHit);
  return titan >= 0 ? titan : mech;
};
const pickupView = new PickupView(scene, lootConfig.colors, weaponColors, upgradeSet.upgrades.map((u) => u.color), toon);
if (net) net.viewDelayMs = () => remotes.viewDelayMs;

const rig = new ThirdPersonCamera(cameraStats, window.innerWidth / window.innerHeight);
// The kill replay (gate 13b): the last seconds again from over your killer's shoulder, then you watch them.
const killReplay = new KillReplay(parseReplay(replayJson), zoneMaxHp.length);
killReplay.listenForSkip(window);
killReplay.onExplode = (x, y, z) => showBlast(x, y, z);
killReplay.onTitan = (m) => showTitan(m);
killReplay.onGrenade = (_id, x, y, z, vx, vy, vz) => { grenades.spawn(x, y, z, vx, vy, vz); sound.play("grenadeThrow", { x, y, z }); };
// The replay puts your mech back together (it is alive at the start of the clip) and blows it apart again here.
killReplay.onVictimDown = (model, awayX, awayZ) => deathFx.blowApart(model, awayX, awayZ, net?.id ?? 0);
// Over, played out or skipped: watch the killer. The click that skipped it must not also switch who you watch.
// Your wreck lies where it is live, even if the clip ended before it went down.
killReplay.onEnd = (killerId) => {
  spectateId = killerId;
  input.takeClick();
  if (ownModel.dead && !ownModel.blownApart) deathFx.lieDown(ownModel, net?.id ?? 0);
};
const input = new Input(canvas, hint, () => mechStats.sprintDoubleTapSeconds);
// Live tuning works on copies of the raw data files. A change is checked and parsed like loading the file, then
// copied into the live values in place, so everything already holding them sees it.
const tuningRaws = JSON.parse(JSON.stringify({
  mech: mechJson, weapons: weaponsJson, grenade: grenadeJson, zones: zonesJson, loot: lootJson, upgrades: upgradesJson,
  bots: botsJson, noise: noiseJson, combat: combatJson, roster: rosterJson, abilities: abilitiesJson, props: propsJsonForLoot, titan: titanJson,
})) as TuningRaws;
// The Titan's numbers change in place too, so its moves keep the server's timing; a thrown car's flight time is read
// once at the start (titanFuse), so a tuned flight only takes on a reload.
const liveData: Partial<Record<TunableFile, unknown>> = { mech: mechStats, weapons: weaponSet, grenade: grenadeStats, zones: zoneSet, loot: lootConfig, upgrades: upgradeSet, roster, abilities: abilitySet, titan: titanConfig };
const applyLocally = (file: string, path: string, value: number) => {
  const parsed = applyTune(tuningRaws, file, path, value);
  if (parsed !== null) assignDeep(liveData[file as TunableFile], parsed);
};
// Offline a change applies at once. Online it goes to the server, which sends it back to everyone, this client too.
const frameMs = new FrameTimes(240);
const workMs = new FrameTimes(240); // time spent on the frame before the GPU takes over: the headroom a locked 60 fps hides
const gpuTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
// The V7 look features that cost the most, switchable from F1 to see what each costs on this machine (gate 12c).
let coverShown = true;
const crease = new CreasePass(lookConfig.crease);
const lookFeatures = [
  { name: "sun shadows", set: (on: boolean) => sunShadows.setEnabled(on) },
  { name: "painted marks", set: (on: boolean) => toon.paint.setShown(on) },
  { name: "ground cover", set: (on: boolean) => { coverShown = on; } },
  { name: "crease lines", on: crease.enabled, set: (on: boolean) => { crease.enabled = on; } },
];
const featureCost = new FeatureCost(lookFeatures, 2, 3);
const gpuSummary = { median: 0, worst: 0 };
// The panel and lil-gui load on the first F1, so they are not part of the start download.
let panel: DebugPanel | null = null;
let panelLoading = false;
let serverTuning: boolean | null = null;
async function loadPanel(): Promise<DebugPanel> {
  const { DebugPanel } = await import("./debugPanel");
  const p = new DebugPanel(mechStats, tuningRaws, cameraStats, (file, path, value) => (net ? net.sendTune(file, path, value) : applyLocally(file, path, value)));
  p.addGait(gaitConfig);
  p.addHud(crt.setting, (v) => crt.setIntensity(v));
  addVfxQualityControl(p.gui);
  p.addFeatures(lookFeatures, featureCost, gpuTimer);
  if (serverTuning !== null) p.setServerTuning(serverTuning);
  return p;
}
function togglePanel(p: DebugPanel): void {
  const open = p.toggle();
  input.setPanelOpen(open);
  if (open) input.unlock();
  else input.lock();
}
if (net) {
  net.onTuned = (file, path, value) => { applyLocally(file, path, value); panel?.refresh(); };
  void net.welcome.then((w) => { serverTuning = w.tuning; panel?.setServerTuning(w.tuning); }, () => {});
}
// The rig re-applies the field of view from the tuning value every frame, so the slider needs no callback.

const [spawnX, spawnY, spawnZ] = map.spawn;
// Yaw PI faces +Z.
const predictor = new Predictor(statsFor, map.world, spawnX, spawnY, spawnZ, Math.PI, abilityOf);
const mech = predictor.state;
// Online, your own ram ploughs through props in prediction on the same step the server smashes them (the shared rule,
// propsInReach), so a charge through a row of trees is not stopped by each trunk until the server's word arrives.
// Only their collision goes here: they break on screen when the server says so. Offline nothing breaks them.
const smashScratch: number[] = [], smashed: number[] = [];
if (net) {
  predictor.afterStep = (s) => {
    const ram = abilityOf(s.mech);
    if (ram?.kind !== "ram" || s.abilityTime <= 0) return;
    const count = propsInReach(map.world, map.propOfBox, s.x, s.y, s.z, ram.hitRadius, statsFor(s.mech).height, smashScratch, smashed);
    for (let i = 0; i < count; i++) map.world.disable(map.props[smashed[i]!]!.boxIndex);
  };
}
mech.mech = shownMech; // offline this is the mech you drive; online the first snapshot says
const aim = { yaw: Math.PI, pitch: 0 };
const diveCamera = new DiveCamera(dive.camera, mechStats);
const landingMarker = new LandingMarker(dive.marker, toon.color(dive.marker.color), mechStats);
const aimRing = new AimRing(dive.aim, toon.color(dive.aim.color));
scene.add(landingMarker.group, aimRing.group);
let aimOnGround = false; // the crosshair is on the map, not the sky, so the drop's aim ring can show
let ownDropPhase = DROP_NONE; // your drop phase as last drawn, to catch the burn lighting and the touchdown
const mechInput = createMechInput();
const look = { dx: 0, dy: 0 };
const shot: Shot = createShot();
const gate = new FireGate();
// Both triggers of the gun in hand (gate 18a): stepped here exactly as the server steps them, so your own spin up,
// heat, charge and shots match what it decides.
const altState = createAltFireState();
const altShot = createAltShot();
let lastOwnAlt = -1; // the right-click share of your last shot, -1 for a primary: how its hits on mechs look
// When you last fired and how long until the next: the harpoon's cooldown ring (both its triggers share the gate).
let harpoonFiredAt = -Infinity, harpoonGap = 1;
// A held slug reaches as far as the slug does, so the crosshair converges on what it can actually hit.
const aimRangeOf = (weapon: WeaponStats, altHeld: boolean) =>
  altHeld && weapon.secondary.kind === "slug" ? weapon.secondary.maxAimDistance : weapon.maxAimDistance;
// Your own right-click on your mech, in the HUD and in your ears, once a frame.
function showOwnAltFire(dt: number): void {
  const index = loadout.slots[firingSlot]!;
  const weapon = weaponSet.weapons[index];
  const live = weapon !== undefined && !health.dead && !dropping(mech) && altState.weaponId === weapon.id;
  const kind = weapon?.secondary.kind ?? "slug";
  const charge = live ? chargeShare(altState, weapon) : 0;
  const muzzles = muzzlesFor(mech.mech);
  const muzzle = muzzles[shotsFired % muzzles.length]!;
  const now = performance.now() / 1000;
  if (live && kind === "windup" && altState.windup > 0) altFireFx.glow(ownModel, muzzle, index, altState.windup, false, now);
  if (live && kind === "charge" && charge > 0) altFireFx.glow(ownModel, muzzle, index, charge, charge >= 1, now);
  if (live && altState.overheat > 0) altFireFx.vent(ownModel, muzzle, index, dt);
  if (mech.pinTime > 0 && pinLook >= 0) altFireFx.pin(ownModel, pinLook, dt);
  const whine = live && kind === "windup" && mechInput.altFire && altState.overheat <= 0 ? Math.max(0.05, altState.windup) : 0;
  sound.setHeld("windupWhine", whine);
  sound.setHeld("chargeHum", charge, charge >= 1);
  const stuck = kind === "detonate" ? rivetView?.countOf(selfId()) ?? 0 : 0;
  const maxStuck = kind === "detonate" ? rivetStats()?.maxStuck ?? 1 : 1;
  const value = kind === "windup" ? (altState.overheat > 0 ? 1 : altState.heat)
    : kind === "detonate" ? stuck / maxStuck
    : kind === "reel" ? Math.min(1, (simTime - harpoonFiredAt) / harpoonGap)
    : charge;
  const flag = kind === "windup" ? altState.overheat > 0 : kind === "charge" ? charge >= 1 : gate.ready(simTime);
  hud.setAltFire(weapon ? altLooks[index]!.name : null, kind, value, flag, stuck);
}
// Someone else pinned or venting: what the snapshots say, drawn from their gun and feet.
function showRemoteAlt(model: MechModel, mechIndex: number, weapon: number, pinned: boolean, overheated: boolean, spin: number): void {
  const muzzle = muzzlesFor(Math.max(0, mechIndex))[0]!;
  if (spin > 0) altFireFx.glow(model, muzzle, weapon, spin, weaponSet.weapons[weapon]?.secondary.kind === "charge" && spin >= 1, performance.now() / 1000);
  if (overheated) altFireFx.vent(model, muzzle, weapon, fxDt);
  if (pinned && pinLook >= 0) altFireFx.pin(model, pinLook, fxDt);
}
// Someone else's gun winding up, heard in steps from where they stand, climbing in pitch as it gets there.
remotes.onSpinStep = (model, weapon, spin) => {
  const kind = weaponSet.weapons[weapon]?.secondary.kind;
  if (kind !== "windup" && kind !== "charge") return;
  const p = model.group.position;
  sound.play(kind === "windup" ? "windupWhine" : "chargeHum", { x: p.x, y: p.y + 2, z: p.z }, 1, 0.8 + spin * 0.6);
};
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
  scene.remove(treeView.group);
  treeView.dispose();
  map = buildPlayMap(newTier, newSeed, mechStats);
  toon.useLight(toon.presetFor(newSeed, forcedLook));
  toon.setGround(map.terrain);
  mapMeshes = new MapMeshes(scene, map, toon);
  terrainMeshes?.dispose();
  terrainMeshes = makeTerrain();
  showWater();
  chunks.setTerrain(map.terrain);
  explosions.setTerrain(map.terrain);
  showSurfaces();
  dressing.dispose();
  dressing = makeDressing();
  edgeBarrier.dispose();
  edgeBarrier = new EdgeBarrier(scene, toon, map, mapMeshes, barrierConfig);
  if (map.tier === "range" || !backdrop?.suits(map.meters, map.terrain)) {
    backdrop?.dispose();
    backdrop = makeBackdrop();
  }
  ranges.mesh.visible = map.tier !== "range" && !map.terrain?.island;
  propView = new PropView(map, propConfig, toon, PROP_MODELS);
  contactShadows.setMap(map.boxes, map.world);
  scene.add(propView.group);
  treeView = makeTrees();
  castMapShadows();
  pickupView.clear();
  rivetView?.clear();
  harpoonView?.clear();
  predictor.setWorld(map.world);
}

if (net) net.watchId = () => (health.dead ? spectateId : 0);

const name = (id: number | null) => (id === null ? "the zone" : id === net?.id ? "You" : remotes.isBot(id) ? `Bot ${id}` : `Player ${id}`);
const cardNames: Names = { roster, weapons: weaponSet, abilities: abilitySet, player: (id) => name(id), get selfId() { return net?.id ?? null; } };

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
    const wasDead = health.dead;
    health = snap.health;
    loadout = snap.loadout;
    if (sum(health.hp) + sum(loadout.armor) < before) {
      flashHurt();
      if (loadout.grenades > 0) tips.offer("grenade"); // under fire with a grenade in hand: the moment to say G
    }
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
    if (!killReplay.playing) {
      setMechDamage(ownModel, health.hp, health.dead); // the replay shows your mech as it was
      if (health.dead && !wasDead) {
        const from = knockedFrom.get(net.id);
        knockedFrom.delete(net.id);
        deathFx.blowApart(ownModel, from ? mech.x - from.x : 0, from ? mech.z - from.z : 0, net.id);
      }
    }
    net.noteSnapshot(snap.ack, snap.ackAgeMs, performance.now());
    remotes.push(snap.others, snap.tick, performance.now());
    if (snap.titan) askTitanKit();
    titanView.push(snap.titan, snap.tick * STEP * 1000, performance.now());
    for (const n of snap.noises) radar?.hear(n.x, n.z, n.kind, performance.now());
  };
  // A scattergun's pellets each arrive as their own shot, a few milliseconds apart: one sound per pull, not one per
  // pellet, or a blast stacks into a harsh chorus.
  const lastShotSound = new Map<number, number>();
  const showShot = (id: number, s: Shot, weapon: number, hitMech: boolean, alt: number) => {
    if (weapon === harpoonGun && harpoonView) {
      shotFx.flash(s, weapon, alt);
      harpoonView.fire(id, s.ox, s.oy, s.oz, s.dx, s.dy, s.dz, s.length, alt >= 0);
    } else {
      shotFx.show(s, weapon, hitMech, alt);
    }
    fallHints.shot(performance.now() / 1000, s.ox, s.oz, s.dx, s.dz, s.length);
    const now = performance.now();
    if (now - (lastShotSound.get(id) ?? -Infinity) < 40) return;
    lastShotSound.set(id, now);
    const stats = weaponSet.weapons[weapon];
    const altLook = stats !== undefined && usesAltLook(stats.secondary.kind, alt);
    sound.play(alt >= 0 ? sound.altShotFor(stats?.id) : sound.shotFor(stats?.id), { x: s.ox, y: s.oy, z: s.oz });
    // once a pull, like the sound
    kickShooter(id === net.id ? ownModel : remotes.modelOf(id), stats ? kickIdFor(recoilConfig, stats.id, altLook) : undefined, s.ox, s.oz);
  };
  killReplay.onShot = showShot;
  net.onShot = (s) => {
    // Your own shots come back too: the replay draws them, live they already showed the moment you fired.
    const weapon = s.id === net.id ? loadout.slots[firingSlot]! : remotes.weaponOf(s.id);
    const alt = s.alt ?? -1;
    killReplay.shot(performance.now(), s.id, s, weapon, s.hitMech, alt);
    if (s.id === net.id || killReplay.playing) return;
    showShot(s.id, s, weapon, s.hitMech, alt);
  };
  net.onHit = (h) => {
    flashHitMarker(h.killed);
    showHit(h.zone, h.damage, h.killed, h.targetId === TITAN_ID);
    sound.play("hitMarker");
    shotFx.hitMech(h.x, h.y, h.z, loadout.slots[firingSlot]!, lastOwnAlt);
  };
  net.onGrenade = (g) => {
    killReplay.grenade(performance.now(), g.id, g.x, g.y, g.z, g.vx, g.vy, g.vz);
    if (g.id === net.id || killReplay.playing) return; // our own grenade is already in the air
    grenades.spawn(g.x, g.y, g.z, g.vx, g.vy, g.vz);
    sound.play("grenadeThrow", { x: g.x, y: g.y, z: g.z });
  };
  net.onTitan = (m) => {
    killReplay.titan(performance.now(), m);
    if (!killReplay.playing) showTitan(m);
  };
  net.onExplode = (e) => {
    killReplay.explode(performance.now(), e.x, e.y, e.z);
    if (killReplay.playing) return;
    // A rivet popping: drawn by its rivet, in its turn if a detonation's ripple is running, or here if it was never seen.
    if (e.rivet !== undefined) { if (!rivetView?.popById(e.rivet)) showRivetPop(e.x, e.y, e.z, rivetStats()?.blastRadius ?? 0); return; }
    showBlast(e.x, e.y, e.z);
  };
  net.onRivet = showRivet;
  net.onHarpoon = showHarpoon;
  // Your own start and landing already showed from prediction; anyone's ram or slam connecting shows here. The
  // warning ring for a strike is always the server's, yours too, so everyone sees the same spot.
  net.onAbility = (a) => {
    killReplay.ability(performance.now(), a);
    if (!killReplay.playing) showAbilityMoment(a);
  };
  killReplay.onAbility = (a) => showAbilityMoment(a);
  const showAbilityMoment = (a: AbilityMessage) => {
    const own = a.id === net.id;
    if (a.kind === "rail") {
      if (a.event === "start") {
        railFx.charge(a.id, railChargeOf(own ? mech.mech : remotes.mechOf(a.id)), performance.now());
        sound.play("railCharge", { x: a.x, y: a.y + 2, z: a.z });
      } else if (a.event === "hit") {
        if (!railPoseOf(a.id, railPose)) { railPose.x = a.x; railPose.y = a.y; railPose.z = a.z; }
        railFx.muzzleAt(railPose, railFrom);
        railFx.fire(a.id, railFrom, a.x, a.y, a.z, performance.now());
        kickShooter(own ? ownModel : remotes.modelOf(a.id), "railShot", railFrom.x, railFrom.z);
        sound.play("railShot", { x: railFrom.x, y: railFrom.y + 2, z: railFrom.z });
        showAbilityHit(a.x, a.y, a.z);
      }
      return;
    }
    if (a.event === "hit") showAbilityHit(a.x, a.y, a.z);
    else if (a.event === "pop") showPop(a.id, a.x, a.y, a.z);
    else if (a.event === "land") { if (!own) showSlam(a.x, a.y, a.z, slamRadiusOf(remotes.mechOf(a.id))); }
    else if (a.kind === "barrage") showStrike(a.id, own, a.x, a.y, a.z);
    // Others get nothing for decoys going out: they are meant to be fooled.
    else if (a.kind === "decoy") { if (own) showOwnDecoys(a.ids ?? []); }
    else if (!own) showAbilityStart(a.kind, a.x, a.y, a.z);
  };
  net.onPropDestroyed = propDestroyed;
  net.onRoom = (r) => {
    const wasCountdown = progress.state === "countdown";
    hostId = r.hostId;
    if (r.seed !== map.seed || r.tier !== map.tier) swapMap(r.seed, r.tier);
    ringView.setSchedule(r.ring);
    dropView.setDrops(r.drops);
    hud.setRoom(r, net.id);
    if (r.state === "countdown") { hud.hideResult(); myPlace = null; killReplay.clear(); knockedFrom.clear(); titanView.clear(); rivetView?.clear(); harpoonView?.clear(); }
    if (r.state === "active" && wasCountdown) hud.flash("GO", 900);
    progress = { ...progress, state: r.state };
  };
  net.onEliminated = (e) => {
    if (e.killerId === net.id) knockedFrom.set(e.id, { x: mech.x, z: mech.z });
    else if (e.killerId !== null && remotes.positionOf(e.killerId, killerAt)) knockedFrom.set(e.id, { x: killerAt.x, z: killerAt.z });
    const byTitan = e.killerId === null && (e.how?.causes.at(-1) ?? "").startsWith("titan:");
    hud.feed(e.left ? `${name(e.id)} dropped out` : byTitan && e.id !== net.id ? `The Junk Titan flattened ${name(e.id)}` : e.killerId === null && e.id !== net.id ? `${name(e.id)} fell to the zone` : `${name(e.killerId)} knocked out ${name(e.id)}`);
    if (e.id === net.id) {
      myPlace = e.place;
      // Knocked out by a mech you saw: the replay first, and the server keeps sending what is round the killer.
      if (!e.left && killReplay.knockedOut(performance.now(), net.id, e.killerId)) spectateId = e.killerId!;
      // Who got you and how (gate 14c), up as the replay or the spectate camera takes over.
      if (!e.left) {
        const words = knockoutWords(e.killerId, e.how, cardNames);
        hud.showKnockout(words.title, words.by, words.how, hudStats.knockoutCardSeconds);
      }
    }
  };
  net.onResult = (r) => {
    const won = r.winnerId === net.id;
    hud.hideKnockout();
    hud.showResult(won ? "Victory!" : r.winnerId === null ? "Nobody wins" : `${name(r.winnerId)} wins`, myPlace && !won ? myPlace : null, progress.total, statLines(r.stats, name));
    sound.play("uiWhoosh");
  };
  net.onClose = (reason) => {
    ready = false;
    hint.classList.remove("hidden");
    hint.textContent = reason;
  };
  // A dropped connection: the mech waits on the server while this tries to get back to it.
  net.onNotice = (text) => hud.feed(text);
  net.onReconnecting = (trying) => hud.feed(trying ? "Connection lost. Reconnecting..." : "Back in.");
  // Too late to get back into that match: join the room afresh. The address already names the room and its settings
  // (rejoinQuery), so after a server restart the room comes back the way it was.
  net.onRejoinFailed = () => { keepSession(null); location.reload(); };
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
function showHit(zone: number, damage: number, killed: boolean, titan = false): void {
  for (const el of [hitMarker, hitLabel]) {
    el.classList.remove("pop", "kill");
    void el.offsetWidth; // lets the same animation start again straight away
    el.classList.add("pop");
    if (killed) el.classList.add("kill");
  }
  const part = titan ? "TITAN" : zone < 0 ? "SPLASH" : (zoneSet.zones[zone]?.name ?? "").toUpperCase();
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

// A mech touching down from the drop-in: dust and scrap thrown out round it (a splash in the water, from the thrusters'
// landing), a heavy thud, and the camera shaken if it is near, or hard if it is yours.
const dropAt = { x: 0, y: 0, z: 0 };
// The ball bursting open as the retro-jets light: rust plates tumbling off, a pop of flame, a clatter and the burn's roar.
function showBurn(x: number, y: number, z: number): void {
  dropAt.x = x; dropAt.y = y; dropAt.z = z;
  scrapBalls.burst(x, y, z, groundBelow(x, y, z));
  sound.play("shellBurst", dropAt);
  sound.play("landingBurn", dropAt);
}

function showLanding(x: number, y: number, z: number, own: boolean): void {
  dropAt.x = x; dropAt.y = y; dropAt.z = z;
  if (!wadingAt(map.terrain, x, y, z)) landingImpact.land(x, y, z, groundBelow(x, y + 1, z));
  sound.play("landingImpact", dropAt);
  if (own) rig.addShake(dive.camera.landingShake);
  else shakeNear(x, y, z, dive.impact.shakeRadiusMeters, dive.impact.shakeForce);
}

const groundHit = createRayHit();
// The ground under a spot: the top of whatever box is below it, or the hillside. The ray reaches down past the lowest
// valley; on the range, with no hills, it meets the floor box.
function groundBelow(x: number, y: number, z: number): number {
  const from = y + 0.5;
  const reach = from - Math.min(0, map.terrain?.minHeight ?? 0) + 1;
  return map.world.raycast(x, from, z, 0, -1, 0, reach, groundHit) ? from - groundHit.distance : map.terrain?.heightAt(x, z) ?? 0;
}

// A destroyed prop leaves the world here too, so walking where it stood matches the server.
function propDestroyed(id: number, quiet: boolean): void {
  const prop = map.props[id];
  if (!prop || map.world.isDisabled(prop.boxIndex)) return;
  map.world.disable(prop.boxIndex);
  contactShadows.hideBox(prop.boxIndex);
  // A tree comes down with a creak, chips flying from the stump; the crash and needles come when it lands.
  if (treeView.has(id)) {
    treeView.fell(id, fallHints.directionFor(performance.now() / 1000, prop.x, prop.z), quiet);
    if (quiet) return;
    const floor = groundBelow(prop.x, prop.y, prop.z);
    breakFx.burst("pine", prop.x, floor + forestConfig.pine.stump.heightMeters, prop.z, floor);
    sound.play("treeFall", { x: prop.x, y: floor + 2, z: prop.z });
    return;
  }
  propView.destroy(id);
  const type = propConfig.types[prop.type]!;
  breakFx.burst(type.id, prop.x, prop.y, prop.z, groundBelow(prop.x, prop.y, prop.z));
  if (type.explodes) blastSizes.barrel(prop.x, prop.z, performance.now() / 1000, BARREL_MEMORY_SECONDS);
  sound.play("smash", { x: prop.x, y: prop.y, z: prop.z });
}

function showBlast(x: number, y: number, z: number): void {
  grenades.removeNear(x, y, z);
  titanView.blastAt(x, y, z);
  const radius = blastSizes.radiusAt(x, z, performance.now() / 1000);
  fallHints.blast(performance.now() / 1000, x, z, radius);
  explosions.blast(x, y, z, radius, groundBelow(x, y, z));
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
  sound.play(kind === "barrage" ? "mortar" : kind === "rail" ? "railCharge" : kind, { x, y: y + 1, z });
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
  if (stats) {
    mortarWarnings.show(x, y, z, stats);
    blastSizes.strike(x, z, stats.spreadMeters, performance.now() / 1000, warningSeconds(stats) + BARREL_MEMORY_SECONDS, stats.blastRadius);
  }
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
}

// Offline practice drops in like a match: hanging as a ball over the first of the match's drop spots (shared
// dropSpots.ts, the server's rule) through a countdown that starts once you click in, then falling. The range has
// no drop-in.
let offlineDropIn = 0;
function startDropOffline(): void {
  const altitude = startAltitude(dropJson.altitudeMeters, map.tier);
  if (altitude === null) return;
  const spot = planDropSpots(map.seed, 1, map.world, map.meters, dropSpotStats)[0]!;
  hangAtSpot(mech, spot.x, spot.z, map.world, altitude);
  prevX = mech.x; prevY = mech.y; prevZ = mech.z;
  faceDrop();
  offlineDropIn = matchJson.countdownSeconds;
}

// Hanging over your spot: the view looks down toward the middle of the map, where most of the fight will be.
// (Yaw 0 faces -z: the middle at (0, 0) is straight ahead at atan2(x, z).)
function faceDrop(): void {
  if (Math.hypot(mech.x, mech.z) > 1) aim.yaw = Math.atan2(mech.x, mech.z);
  aim.pitch = dive.camera.startPitchDegrees * Math.PI / 180;
}

function respawnOffline(): void {
  Object.assign(mech, createMechState(statsFor(mech.mech), spawnX, spawnY, spawnZ, aim.yaw, mech.mech));
  startDropOffline();
}
if (net === null) startDropOffline();

// The offline countdown, ticking only while you are in the game: "DROP IN 3", then the ball falls.
function countDownOffline(dt: number): void {
  if (offlineDropIn <= 0 || !input.locked) return;
  offlineDropIn -= dt;
  if (offlineDropIn > 0) {
    progress = { state: "countdown", seconds: offlineDropIn, alive: 1, total: 1 };
    return;
  }
  progress = { state: "lobby", seconds: 0, alive: 1, total: 1 };
  releaseDrop(mech);
  hud.flash("GO", 900);
  sound.play("go");
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

  if (input.wasPressed("F1") && tuningAllowed) {
    if (panel) togglePanel(panel);
    else if (!panelLoading) {
      panelLoading = true;
      void loadPanel().then((p) => { panel = p; togglePanel(p); }, (err: unknown) => {
        panelLoading = false;
        console.error("Tuning panel failed to load", err);
        hud.feed("Tuning panel failed to load");
      });
    }
  }
  if (net === null && input.wasPressed("KeyR")) respawnOffline();
  if (input.wasPressed("KeyM")) hud.feed(sound.toggleMute() ? "Sound off (M)" : "Sound on (M)");
  if (input.takeEnter() && net && hostId === net.id && progress.state === "lobby") net.sendStart();
  if (autoStart && clickedIn && net && hostId === net.id && progress.state === "lobby") { autoStart = false; net.sendStart(); }

  // Look is applied every frame so the camera answers the mouse at once, not once per sim step.
  input.takeLook(look);
  // Slower while scoped, so aim keeps pace on screen. Dropping in, you can look further down (diveCamera.ts).
  diveCamera.look(aim, look.dx * rig.zoomShare, look.dy * rig.zoomShare, mechStats, dropping(mech) && !health.dead, frameTime);
  if (net === null) countDownOffline(frameTime);

  if (ready) accumulator += frameTime;
  else accumulator = 0;
  while (accumulator >= STEP) {
    prevX = mech.x; prevY = mech.y; prevZ = mech.z;
    input.sample(mechInput);
    // Rounded to float precision, which is what the server receives, so both sides run identical numbers.
    mechInput.aimYaw = Math.fround(aim.yaw);
    mechInput.aimPitch = Math.fround(simPitch(aim.pitch, mechStats));
    // The weapon to fire: the slot asked for if it holds one, otherwise the one in hand.
    const wantedSlot = loadout.slots[mechInput.slot]! >= 0 ? mechInput.slot : loadout.active;
    if (wantedSlot !== firingSlot) { firingSlot = wantedSlot; gate.holdUntil(simTime + lootConfig.switchSeconds); }
    const weapon = weaponSet.weapons[loadout.slots[firingSlot]!] ?? weaponStats;
    // Dropping, the crosshair's ground point steers the ball, so it reaches the ground far below and ignores mechs.
    const droppingNow = dropping(mech);
    aimOnGround = droppingNow
      ? setAimTarget(rig.camera, map.world, dive.aim.rangeMeters, mechInput)
      : setAimTarget(rig.camera, map.world, aimRangeOf(weapon, mechInput.altFire), mechInput, aimAtMechs);
    mechInput.targetX = Math.fround(mechInput.targetX); mechInput.targetY = Math.fround(mechInput.targetY); mechInput.targetZ = Math.fround(mechInput.targetZ);
    // A destroyed mech can only look around, and nobody moves during the countdown: the same rules the server applies,
    // so prediction does not run ahead and get pulled back.
    if (health.dead || progress.state === "countdown") {
      mechInput.moveX = 0; mechInput.moveY = 0; mechInput.run = false; mechInput.jet = false;
      mechInput.fire = false; mechInput.altFire = false; mechInput.grenade = false; mechInput.ability = false;
    }
    // No guns or grenades while dropping in or stunned by the landing; the server refuses them too.
    if (dropping(mech) || mech.dropTime > 0) { mechInput.fire = false; mechInput.altFire = false; mechInput.grenade = false; }
    // GUESS: a charge held when the guns are taken away (knocked out, dropping) is lost rather than fired on the
    // release that follows. The server should agree; see the 18a report.
    if (!mechInput.altFire && (health.dead || dropping(mech) || mech.dropTime > 0 || progress.state === "countdown")) altState.charge = 0;

    const dashBefore = mech.dashTime;
    const abilityBefore = mech.abilityTime;
    const seq = predictor.step(mechInput, STEP);
    if (dashBefore <= 0 && mech.dashTime > 0) sound.play("dash", { x: mech.x, y: mech.y + 1, z: mech.z });
    // Your own ram or leap shows from prediction, the instant Q goes down; the dust is where it pushed off from.
    const ownAbility = abilityOf(mech.mech);
    const moment = ownAbility ? abilityMoment(abilityBefore, mech.abilityTime, ownAbility.kind) : null;
    if (moment === "start") showAbilityStart(ownAbility!.kind, prevX, prevY, prevZ);
    else if (moment === "land") showSlam(mech.x, mech.y, mech.z, slamRadiusOf(mech.mech));
    net?.sendInput(seq, mechInput, droppingNow);
    if (net === null && mech.y < KILL_HEIGHT) respawnOffline();

    simTime += STEP;
    const wasOverheated = altState.overheat > 0;
    const rateScale = upgradeScale(loadout, upgradeSet, "fireRate");
    if (stepAltFire(altState, gate, mechInput, weapon, simTime, STEP, rateScale, altShot) && altShot.detonate) {
      // The detonator: no shot, a click, and every rivet of yours popping one after another (the server pops them too;
      // its blasts for them are taken as these).
      sound.play("detonateClick", { x: mech.x, y: mech.y + 2, z: mech.z });
      rivetView?.detonate(selfId());
    } else if (altShot.mode !== FIRE_NONE) {
      // Each pellet is drawn at once, with this client's own spread. The server decides what they hit. `fired` is the
      // gun with the right-click's numbers laid over it (a slug's one pellet, the windup's spread, a charge's damage).
      const fired = altShot.weapon;
      const alt = altShot.mode === FIRE_SECONDARY ? altShot.share : -1;
      const altLook = usesAltLook(weapon.secondary.kind, alt);
      lastOwnAlt = alt;
      const muzzles = muzzlesFor(mech.mech);
      const muzzle = muzzles[shotsFired++ % muzzles.length]!;
      const weaponIndex = weaponSet.weapons.indexOf(weapon);
      harpoonGap = 1 / ((altShot.reel && weapon.secondary.kind === "reel" ? weapon.secondary.shotsPerSecond : weapon.shotsPerSecond) * rateScale);
      harpoonFiredAt = simTime;
      for (let i = 0; i < fired.pellets; i++) {
        computeShot(mech, mechInput.targetX, mechInput.targetY, mechInput.targetZ, fired, Math.random, shot, armsBroken() ? zoneSet.brokenArmsSpreadMultiplier : 1, muzzle);
        if (weaponIndex === harpoonGun && harpoonView) {
          shotFx.flash(shot, weaponIndex, alt);
          fireOwnHarpoon(shot, weapon, altShot.reel, seq);
        } else {
          shotFx.show(shot, weaponIndex, false, alt);
        }
        fallHints.shot(performance.now() / 1000, shot.ox, shot.oz, shot.dx, shot.dz, shot.length);
      }
      sound.play(alt >= 0 ? sound.altShotFor(weapon.id) : sound.shotFor(weapon.id), { x: shot.ox, y: shot.oy, z: shot.oz });
      rig.addShake(fired.shakeForce);
      kickMech(ownModel, kickFor(recoilConfig, kickIdFor(recoilConfig, weapon.id, altLook)), muzzle[0]!);
    }
    if (!wasOverheated && altState.overheat > 0) sound.play("overheat", { x: mech.x, y: mech.y + 2, z: mech.z });
    // Online a grenade needs one in the bag. Count it down here so a held key does not throw twice before the server says.
    const hasGrenade = (net === null || loadout.grenades > 0) && !armsBroken();
    if (mechInput.grenade && hasGrenade && grenadeGate.tryFire(simTime, 1 / grenadeStats.cooldownSeconds)) {
      if (net) loadout = { ...loadout, grenades: loadout.grenades - 1 };
      throwGrenade(mech, mechInput.targetX, mechInput.targetY, mechInput.targetZ, grenadeStats, thrown);
      grenades.spawn(thrown.x, thrown.y, thrown.z, thrown.vx, thrown.vy, thrown.vz);
      sound.play("grenadeThrow", { x: thrown.x, y: thrown.y, z: thrown.z });
    }
    shotFx.update(STEP, map.world);
    harpoonView?.update(STEP);
    // Offline there is no server to send the blast, so it goes off when the fuse ends.
    grenades.update(STEP, map.world, net === null ? showBlast : undefined);
    titanView.step(map.world);
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
  divePose.apply(ownModel, mech.dropPhase, frameTime);
  // Your own hang, fall, burst and touchdown, from prediction, the moment they happen on your screen.
  if (mech.dropPhase !== ownDropPhase) {
    if (mech.dropPhase === DROP_HANGING && ownDropPhase === DROP_NONE) faceDrop();
    else if (mech.dropPhase === DROP_BALL) hud.flash(dive.hud.aimCall, dive.hud.aimCallSeconds * 1000);
    else if (mech.dropPhase === DROP_BURNING && ownDropPhase !== DROP_NONE) showBurn(x, y, z);
    else if (mech.dropPhase === DROP_NONE && !health.dead) showLanding(mech.x, mech.y, mech.z, true);
    ownDropPhase = mech.dropPhase;
  }
  // While the kill replay plays it places everyone, your own mech too, from its recording; remotes.update then
  // leaves them be. Recorded after, so the recording holds this frame as drawn.
  if (killReplay.busy && progress.state !== "active") killReplay.cancel();
  const replaying = killReplay.update(performance.now(), frameTime, remotes, ownModel, rig.camera, map.world);
  remotes.update(performance.now());
  scrapBalls.begin(frameTime * killReplay.timeScale);
  remotes.forEachDrop(dropRemote);
  if ((mech.dropPhase === DROP_HANGING || mech.dropPhase === DROP_BALL) && !health.dead) scrapBalls.ball(x, y, z, mech.vx, mech.vy, mech.vz, 0);
  scrapBalls.end();
  killReplay.record(performance.now(), net?.id ?? 0, ownModel, mech, health, remotes);
  // Effects keep the replay's slow motion (tracers move on the sim step and stay at full speed).
  const fxTime = frameTime * killReplay.timeScale;

  // Walking: your legs from your predicted speed, everyone else's from how they move on screen. Looks only.
  fxDt = fxTime;
  const ownStats = statsFor(mech.mech);
  const ownAbilityStats = abilityOf(mech.mech);
  gaitInput.vx = mech.vx; gaitInput.vz = mech.vz; gaitInput.yaw = mechGroup.rotation.y;
  gaitInput.grounded = mech.grounded; gaitInput.limping = legsLimping(ownModel);
  gaitInput.dashing = mech.dashTime > 0 || (mech.abilityTime > 0 && ownAbilityStats?.kind === "ram");
  gaitInput.braced = mech.abilityTime > 0 && ownAbilityStats?.kind === "barrage";
  gaitInput.walkSpeed = ownStats.walkSpeed; gaitInput.runSpeed = ownStats.runSpeed;
  thrusters.tick(fxTime);
  if (replaying) {
    const o = killReplay.own; // your mech as it moved then
    walkRemote(ownModel, mech.mech, o.vx, o.vy, o.vz, o.jetting, o.running, o.ability);
  } else {
    const ownFeet = walkMech(ownModel, gaitConfig, gaitInput, frameTime);
    moveMechParts(ownModel, frameTime);
    if (mech.dropPhase === DROP_BURNING) thrusters.drive(ownModel, !health.dead, gaitInput.dashing, mech.grounded, mech.vy, frameTime, dive.burn.flameScale, dropSprites.fire);
    else thrusters.drive(ownModel, mech.jetting && !health.dead, gaitInput.dashing, mech.grounded, mech.vy, frameTime);
    if (ownFeet && !health.dead) footfalls(ownModel, ownFeet, true);
  }
  remotes.forEachNear(mechGroup.position.x, mechGroup.position.z, gaitConfig.farMeters, walkRemote);
  titanView.update(performance.now(), fxTime, remotes.viewDelayMs, rig.camera.position, killReplay.clock);
  moveGunsAndSensors(ownModel, fxTime);
  remotes.forEachModel(moveGuns);
  explosions.update(fxTime);
  chunks.update(fxTime);
  water.update(frameTime);
  mortarWarnings.update(frameTime);

  // A quick widening of the view sells the dash. The fraction runs from 1 at the start of a dash to 0 at its end.
  const ownRail = ownAbilityStats?.kind === "rail" && mech.abilityTime > 0 && !health.dead ? ownAbilityStats : null;
  rig.setZoom(ownRail ? ownRail.zoomFov : null);
  const ownDrop = health.dead ? DROP_NONE : mech.dropPhase;
  diveCamera.update(rig, ownDrop, -mech.vy, frameTime);
  rig.setFovKick(mech.dashTime > 0 ? mech.dashTime / mechStats.dashSeconds : 0, frameTime);
  // A knocked out player (or someone who arrived mid match) watches a mech that is still standing.
  const spectating = net !== null && progress.state === "active" && health.dead;
  let viewX = x, viewY = y, viewZ = z;
  if (replaying) {
    viewX = killReplay.focus.x; viewY = killReplay.focus.y; viewZ = killReplay.focus.z;
    input.takeClick();
  } else if (killReplay.waiting) {
    input.takeClick(); // your own wreck stays in view until the replay starts
  } else if (spectating) {
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
  if (!replaying) rig.update(viewX, viewY + cameraStats.pivotHeight + bob, viewZ, aim.yaw, aim.pitch, map.world, frameTime);
  dressing.update(viewX, viewZ);
  // The rush of air, where you are aiming and where you will really land, and your height and fall speed.
  const diving = ownDrop === DROP_BALL || ownDrop === DROP_BURNING;
  speedLines.update(rig.camera.position, diving ? mech.vx : 0, diving ? mech.vy : 0, diving ? mech.vz : 0, frameTime);
  // Dragged by a harpoon, yours or someone else's: the lines rush past along the pull.
  const pulled = mech.pullTime > 0 && !health.dead && !spectating;
  reelLines?.update(rig.camera.position, pulled ? mech.pullVx : 0, pulled ? mech.pullVy : 0, pulled ? mech.pullVz : 0, frameTime);
  landingMarker.update(mech, mechInput, ownStats, map.world, ownAbilityStats, rig.camera.position, frameTime);
  landingMarker.group.visible &&= ownDrop !== DROP_NONE;
  aimRing.update(aimOnGround && ownDrop !== DROP_NONE && !spectating && !replaying, mechInput.targetX, mechInput.targetY, mechInput.targetZ, rig.camera.position);
  diveHud.update(ownDrop, ownDrop === DROP_NONE ? 0 : mech.y - groundBelow(mech.x, mech.y, mech.z), -mech.vy);
  sound.setWind(diving ? share(Math.hypot(mech.vx, mech.vy, mech.vz), dive.wind.fromSpeed, dive.wind.fullSpeed) : 0);

  const matchSeconds = progress.state === "active" ? progress.seconds + (performance.now() - progressAt) / 1000 : 0;
  const ring: RingNow | null = ringView.update(matchSeconds);
  dropView.update(progress.state === "active" ? matchSeconds : null, frameTime);
  railFx.update(performance.now(), map.world, railPoseOf, railPose);
  if (dropView.news === "announced") { hud.flash("SUPPLY DROP INBOUND", 2500); hud.feed("Supply drop incoming: follow the yellow beam"); }
  else if (dropView.news === "open") hud.feed("Supply drop open");
  if (radar && progress.state === "active") dropView.forEachMarked(matchSeconds, markDrop);
  const outside = ring !== null && !health.dead && progress.state === "active" && isOutsideRing(ring, mech.x, mech.z);
  if (net || progress.state === "countdown") hud.setProgress(progress, ring, mech.dropPhase === DROP_HANGING ? dive.hud.countdownWords : "");

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
  // The Titan's bar while it stands near whoever you are watching, and its mark on the radar.
  const titanNear = bossBarShown(titanView.shown, titanView.fallen, titanView.x - viewX, titanView.z - viewZ, titanLook.hud.bossBarMeters);
  hud.setBoss(titanLook.hud.name, titanNear && progress.state === "active", titanView.hp);
  if (titanView.shown && !titanView.fallen) radar?.markTitan(titanView.x, titanView.z, titanLook.hud.radarMarkSize);
  // Watching someone, the radar is centred on them.
  radar?.draw(viewX, viewZ, aim.yaw, remotes, progress.state === "lobby" ? null : ring, outside, performance.now());

  // ?overview floats the camera above the middle of the map, for looking over a seed at a glance.
  if (overview) {
    rig.camera.position.set(0, map.meters * 0.75, 1);
    rig.camera.lookAt(0, 0, 0);
  }
  edgeBarrier.update(rig.camera.position);
  ranges.follow(rig.camera.position);
  terrainMeshes?.update(rig.camera.position);
  propView.cull(rig.camera);
  treeView.update(frameTime);
  treeView.cull(rig.camera, viewX, viewY + cameraStats.pivotHeight, viewZ);

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
  showOwnAltFire(fxTime);
  remotes.forEachAlt(showRemoteAlt);
  if (titanView.shown && !titanView.fallen) damageFx.emitFrom(titanView.model, fxTime);
  contactShadows.beginMoving();
  contactShadows.addObject(mechGroup);
  remotes.forEachModel(shadowUnder);
  contactShadows.endMoving();
  deathFx.update(fxTime, rig.camera.position);
  rivetView?.update(fxTime, rig.camera.position);
  fxSprites.update(fxTime, rig.camera.position);
  altFireFx.update(rig.camera.position);
  dropSprites.update(fxTime, rig.camera.position);
  hud.setLoadout(loadout, weaponSet.weapons, lootConfig.armorPlates, upgradeSet.upgrades);
  hud.setReplay(killReplay.playing, killReplay.progress);
  setMechUpgrades(ownModel, loadout.upgrades, upgradeSet.upgrades);
  radar?.setRangeScale(upgradeScale(loadout, upgradeSet, "radarRange"));
  setMechGear(ownModel, weaponColors[loadout.slots[loadout.active]!] ?? weaponStats.color, loadout.armor);
  pickupView.update(performance.now(), frameTime);
  // Tips, once each in this browser, at the moment they help (tips.ts). Only while you are playing, not watching.
  const playing = !health.dead && !spectating && input.locked && (net === null || progress.state === "active");
  // Hanging or falling, the one thing to know about the drop.
  if (!health.dead && input.locked && dropping(mech)) tips.offer("drop");
  else if (playing) {
    tips.walking(frameTime, mech.grounded && !mech.running && Math.hypot(mech.vx, mech.vz) > 1);
    if (ownAbilityStats && mech.abilityCooldown <= 0) tips.offer("ability", ownAbilityStats.name);
    if (loadout.slots[1]! >= 0) tips.offer("weapons");
    const inHand = loadout.slots[firingSlot]!;
    const altKind = weaponSet.weapons[inHand]?.secondary.kind;
    // The rivet gun and the harpoon each say what their right-click does, the first time each is in hand.
    if (altKind === "detonate" || altKind === "reel") tips.offer(altKind);
    else if (inHand >= 0 && altLooks[inHand]) tips.offer("secondary", altLooks[inHand]!.name);
  }
  const tipNow = tips.current(frameTime);
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
    hud.setPrompt(tipNow);
  }
  // While the kill replay is on, the knockout card and the REPLAY tag say what is going on, not "Watching X".
  statusText.textContent = spectating && !killReplay.busy
    ? `${myPlace ? `You placed ${myPlace}. ` : ""}${spectateId ? `Watching ${name(spectateId)}. Click to switch.` : "Nobody left to watch."}`
    : health.dead && progress.state !== "active" ? `Destroyed. Back in ${Math.ceil(health.respawnIn)}...` : "";
  fuelBar.classList.toggle("locked", mech.fuel.locked);
  staminaBar.classList.toggle("locked", mech.stamina.locked);
  if (panel?.visible) panel.update(Math.hypot(mech.vx, mech.vz), mech.grounded, fps, remotes.count + 1, lastCorrection, net?.rttMs ?? 0, net ? remotes.viewDelayMs : 0);

  shotFx.draw(rig.camera, fxTime);
  harpoonView?.draw(rig.camera);
  sunShadows.follow(rig.camera);
  if (dressing.cover) dressing.cover.group.visible = coverShown;
  gpuTimer.begin();
  crease.render(renderer, scene, rig.camera);
  gpuTimer.end();
  featureCost.tick(frameTime, gpuTimer.times, gpuSummary);
  frameMs.record(frameTime * 1000);
  if (renderScale.due(frameTime)) {
    frameMs.summary(frameSummary);
    gpuTimer.times.summary(gpuSummaryForScale);
    if (renderScale.decide(frameSummary.median, gpuSummaryForScale.median)) {
      renderer.setPixelRatio(renderScale.ratio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      frameMs.clear(); // the old frames were drawn at the old size
    }
  }
  workMs.record(performance.now() - workStarted);
  if (panel?.visible) panel.updateRender(frameMs, workMs, renderer.info.render.calls, renderer.info.render.triangles, gpuTimer.times, renderScale.ratio);
  requestAnimationFrame(frame);
}
// Effects sit in the scene from the start with nothing to draw, so their shaders build now rather than in the frame
// of the first explosion or jet, which showed as a hitch.
renderer.compile(scene, rig.camera);
requestAnimationFrame(frame);
