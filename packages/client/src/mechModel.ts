import * as THREE from "three";
import type { Toon } from "./toonMaterial";
import { castShadows } from "./sunShadows";
import type { LoadedKit } from "./mechKit";
import { createGait, type GaitState } from "./gait";
import { SEGMENTS_PER_LEG, segmentOf } from "./legRig";
import { mergedPieces, type FillLook, type MergedPiece } from "./mechMerge";
import { serialTexture } from "./mechSerials";
import { LEFT, MIDDLE, RIGHT, sideOf, splitBySide } from "./wreckSplit";
import { createSpring, kickSpring, parseRecoil, stepSpring, type Kick, type Spring } from "./recoil";
import { GLOW_BROKEN, GLOW_DAMAGED, GLOW_DARK, GLOW_INTACT, createFlicker, glowLevel, parseFlicker, type Flicker } from "./sensorFlicker";
import recoilJson from "../../../data/recoil.json";
import { rigMechMotion } from "./mechMotion";

export const recoilConfig = parseRecoil(recoilJson.recoil);
const flickerConfig = parseFlicker(recoilJson.flicker);

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<string, THREE.MeshStandardMaterial>();

export function material(color: string): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    materials.set(color, m);
  }
  return m;
}

export function addBox(parent: THREE.Object3D, center: readonly number[], size: readonly number[], color: string): void {
  const mesh = new THREE.Mesh(unitBox, material(color));
  mesh.position.set(center[0]!, center[1]!, center[2]!);
  mesh.scale.set(size[0]!, size[1]!, size[2]!);
  parent.add(mesh);
}

export interface MechModel {
  group: THREE.Group;
  body: THREE.Group; // everything above the feet, lowered and tipped forward when the mech crawls
  legMeshes: THREE.Mesh[];
  // One material per hit zone (legs, arms, torso), owned by this mech so damage tints only it.
  zoneMaterials: (THREE.MeshStandardMaterial | THREE.MeshToonMaterial)[];
  toon: Toon | null; // the toon look, when this mech is drawn with it
  armMeshes: THREE.Mesh[];
  baseColors: THREE.Color[];
  zoneMaxHp: number[];
  plates: THREE.Mesh[][]; // armor plate meshes per zone, shown while that zone has plate points
  gunMaterial: THREE.MeshStandardMaterial | THREE.MeshToonMaterial;
  // The last damage shown, kept so the spark and smoke effects can read it each frame.
  hp: number[];
  dead: boolean;
  // Knocked out and drawn blown apart by deathFx.ts, which moves the body and the parts that flew off: the slump
  // below leaves it alone.
  blownApart: boolean;
  repairing: boolean; // shown with welding sparks
  fxTimers: number[]; // per zone: seconds until the next spark, then the next puff of smoke. Last: welding sparks
  // A mech built from a kit: its parts merged into few pieces (mechMerge.ts), each with its levels of detail and the
  // zone states it shows in (bit 1 intact, 2 damaged, 4 broken), and the point in each hit zone that sparks and smoke
  // come from. Empty for the grey-box mech.
  kitPieces: { zone: number; shownIn: number; object: THREE.LOD }[];
  fxAnchors: (THREE.Object3D | null)[];
  gunParts: THREE.Object3D[]; // hidden with the arms when they are broken
  serials: { zone: number; object: THREE.Object3D }[]; // painted serial numbers, gone with their zone's part
  // A kit's painted materials beyond the one per zone: each zone's paint (its colours on the corners, so the base is
  // white) and the pilot's accent, so every painted part rusts with its zone.
  paints: { zone: number; material: THREE.MeshToonMaterial; base: THREE.Color }[];
  // Sensors and energy accents, one material per hit zone and kind: lit while their zone is intact, flickering while
  // it is damaged, an ember once it breaks, dark once the torso goes (sensorFlicker.ts). `state` is a GLOW_ constant.
  glows: { material: THREE.MeshBasicMaterial; base: THREE.Color; zone: number; state: number; flicker: Flicker }[];
  // Recoil (recoil.ts): each gun, by the side of the mech it is on, kicks back and up when it fires; the torso takes a
  // shove for heavy weapons. `kick` is the last weapon fired, whose spring settles them all.
  guns: Gun[];
  torsoKick: Spring;
  kick: Kick | null;
  recoiling: boolean;
  // Walking (gait.ts, mechWalk.ts): one hip, knee and ankle joint per leg under the body, with the leg pieces hung
  // on them, and where each joint sits at rest. Empty for a mech whose kit marks no leg joints.
  legs: { side: string; hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group; restHip: THREE.Vector3; restKnee: THREE.Vector3; restAnkle: THREE.Vector3; reach: number }[];
  legSides: string[]; // each leg's side name, in the same order (L, R, or FL, FR, BL, BR)
  gait: GaitState | null;
  gaitId: string; // which mech's numbers in data/gait.json it walks with
  crawlDrop: number; crawlTilt: number; // the crawl pose, which walking adds its bob and lean to
}

// A gun that kicks: the objects that move with it, where each sits at rest, the way back along its barrel (a turret's
// raised barrels kick down their own slope) and the point it tips up about, the back of the gun on its barrel's line.
// `side` is LEFT, MIDDLE or RIGHT (wreckSplit.ts).
export interface Gun { side: number; objects: THREE.Object3D[]; rest: THREE.Vector3[]; back: THREE.Vector3; pivot: THREE.Vector3; spring: Spring }

// How a crawling mech sits. Read from data/damageFx.json once at startup.
export interface CrawlLook {
  dropMeters: number;
  tiltDegrees: number;
  legStubScale: number;
}
let crawlLook: CrawlLook = { dropMeters: 1.3, tiltDegrees: 12, legStubScale: 0.3 };
let damagedBelow = 0.5; // a zone under this share of its hit points shows its damaged parts, from zones.json
export function setCrawlLook(look: CrawlLook, damagedBelowFraction = damagedBelow): void {
  crawlLook = look;
  damagedBelow = damagedBelowFraction;
}

// Legs hurt but still there: the mech limps (gait.ts).
export function legsLimping(model: MechModel): boolean {
  const legs = model.hp[0]!;
  return legs > 0 && legs / model.zoneMaxHp[0]! < damagedBelow;
}

const WRECK = new THREE.Color("#262626");
const scratch = new THREE.Color();

// Grey-box mech. Art hook: replace this with a loaded model, keep the zone mapping so damage still shows.
// With `toon`, it is drawn in the game's look: palette colours, the master toon material and outlines.
// With `kit` (and `toon`, which a kit needs), the body is the kit's parts instead of grey boxes; everything else
// (damage tint, plates, gun, effects) works the same.
export function createMechModel(
  accent: string, zoneMaxHp: readonly number[], toon: Toon | null = null, bodyColor = "#738087", kit: LoadedKit | null = null, trimColor = "deepRust",
): MechModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const grey = toon ? toon.color(bodyColor) : bodyColor;
  const baseColors = [new THREE.Color(grey), new THREE.Color(toon ? toon.color(accent) : accent), new THREE.Color(grey)];
  // In the toon look each zone's paint rusts away with damage; the plain look darkens instead.
  const zoneMaterials = baseColors.map((c) => (toon ? toon.ownMaterial(`#${c.getHexString()}`, true, "mech") : new THREE.MeshStandardMaterial({ color: c, roughness: 1 })));
  const armMeshes: THREE.Mesh[] = [];
  // Every box gets an outline in the toon look, tinted from the colour it starts with, inked as a mech.
  const outline = (mesh: THREE.Mesh, color: string) => { if (toon) toon.outlineChild(mesh, color, true); };

  const part = (zone: number, center: number[], size: number[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(unitBox, zoneMaterials[zone]!);
    mesh.position.set(center[0]!, center[1]!, center[2]!);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    body.add(mesh);
    outline(mesh, `#${baseColors[zone]!.getHexString()}`);
    return mesh;
  };
  const legMeshes: THREE.Mesh[] = [];
  // The weapon in hand's colour: on a kit's own gun parts, or on the plain barrel added below. Only a kit's own gun
  // reads the parts' finishes (a plain barrel has none to read).
  const hasModelledGun = !!(kit && toon && kit.parts.some((p) => p.paint === "weapon"));
  const gunMaterial = toon ? toon.ownMaterial("#d9731a", false, "mech", hasModelledGun) : new THREE.MeshStandardMaterial({ color: "#d9731a", roughness: 0.6 });
  const paints: MechModel["paints"] = [];
  const glows: MechModel["glows"] = [];
  // One rusting material per zone for the merged paint, whose colours are on its corners, and one for the accent.
  const paintFor = (zone: number, color: string, cornerColors: boolean): THREE.MeshToonMaterial => {
    const found = paints.find((p) => p.zone === zone && p.material.vertexColors === cornerColors);
    if (found) return found.material;
    const material = toon!.ownMaterial(color, true, "mech", true);
    material.vertexColors = cornerColors;
    paints.push({ zone, material, base: new THREE.Color(color) });
    return material;
  };
  // Per zone, so a damaged arm's glows flicker while the torso's stay lit.
  const glowFor = (zone: number, color: string, cornerColors: boolean): THREE.MeshBasicMaterial => {
    const found = glows.find((g) => g.zone === zone && g.material.vertexColors === cornerColors);
    if (found) return found.material;
    const material = new THREE.MeshBasicMaterial({ color, vertexColors: cornerColors });
    glows.push({ material, base: new THREE.Color(color), zone, state: GLOW_INTACT, flicker: createFlicker() });
    return material;
  };
  const kitPieces: MechModel["kitPieces"] = [];
  const serials: MechModel["serials"] = [];
  const fxAnchors: MechModel["fxAnchors"] = [null, null, null];
  let gunMount: THREE.Vector3 | null = null;
  const guns: Gun[] = [];
  const gunOn = (side: number): Gun => {
    let gun = guns.find((g) => g.side === side);
    if (!gun) guns.push((gun = { side, objects: [], rest: [], back: new THREE.Vector3(0, 0, 1), pivot: new THREE.Vector3(), spring: createSpring() }));
    return gun;
  };
  const legs: MechModel["legs"] = [];
  // A segment's joint group: thigh pieces hang from the hip, shin from the knee, foot from the ankle.
  const segmentGroup = (piece: number) => {
    const leg = legs[Math.floor(piece / SEGMENTS_PER_LEG)]!;
    return [leg.hip, leg.knee, leg.ankle][piece % SEGMENTS_PER_LEG]!;
  };
  const segmentRest = (piece: number) => {
    const leg = legs[Math.floor(piece / SEGMENTS_PER_LEG)]!;
    return [leg.restHip, leg.restKnee, leg.restAnkle][piece % SEGMENTS_PER_LEG]!;
  };
  if (kit && toon) {
    for (const j of kit.legs) {
      const hip = new THREE.Group(), knee = new THREE.Group(), ankle = new THREE.Group();
      hip.rotation.order = "ZYX"; // the leg swings sideways after it bends, so the bend stays in the leg's plane
      hip.position.copy(j.hip);
      knee.position.subVectors(j.knee, j.hip);
      ankle.position.subVectors(j.ankle, j.knee);
      hip.add(knee);
      knee.add(ankle);
      body.add(hip);
      // How far forward or back of the hip this foot can reach on the ground, in the leg's side view: past it the
      // foot slides on the ground instead of the straightened leg lifting it into the air.
      const length = Math.hypot(j.knee.y - j.hip.y, j.knee.z - j.hip.z) + Math.hypot(j.ankle.y - j.knee.y, j.ankle.z - j.knee.z);
      const drop = j.hip.y - j.ankle.y;
      const reach = Math.sqrt(Math.max(0, length * length - drop * drop)) * 0.97;
      legs.push({ side: j.side, hip, knee, ankle, restHip: j.hip.clone(), restKnee: j.knee.clone(), restAnkle: j.ankle.clone(), reach });
    }
    for (const p of kit.parts) {
      const intact = p.states[0]!; // the loader guarantees every part has its intact version
      if (intact.fx && !fxAnchors[p.zone]) {
        const anchor = new THREE.Object3D();
        anchor.position.copy(intact.fx);
        body.add(anchor);
        fxAnchors[p.zone] = anchor;
      }
      if (intact.mount) gunMount = intact.mount;
    }
    // The parts merged into pieces, each a levels-of-detail object; damage shows the pieces of one state at a time.
    const accentColor = toon.color(accent);
    const shared = cornerColored(toon);
    const fillMaterial = (zone: number, look: FillLook, isAccent: boolean): THREE.Material => {
      if (look === "weapon") return gunMaterial;
      if (look === "glow") return glowFor(zone, isAccent ? accentColor : "#ffffff", !isAccent);
      if (look === "rust") return paintFor(zone, isAccent ? accentColor : "#ffffff", !isAccent);
      return isAccent ? toon.material(accentColor) : shared.plain;
    };
    // A piece as a levels-of-detail object, each geometry passed through `cut` (null leaves it out). Null if nothing is left.
    const lodOf = (piece: MergedPiece, cut: (g: THREE.BufferGeometry) => THREE.BufferGeometry | null): THREE.LOD | null => {
      const lod = new THREE.LOD();
      let any = false;
      piece.fills[0]!.lods.forEach((_, level) => {
        const holder = new THREE.Group();
        for (const f of piece.fills) {
          const g = f.lods[level] ? cut(f.lods[level]!) : null;
          if (g) { holder.add(new THREE.Mesh(g, fillMaterial(piece.zone, f.look, f.accent))); any = true; }
        }
        for (const o of piece.outlines) {
          const g = o.lods[level] ? cut(o.lods[level]!) : null;
          if (g) holder.add(new THREE.Mesh(g, o.accent ? toon.shellOutline(accentColor, true) : shared.shell));
        }
        lod.addLevel(holder, level === 0 ? 0 : kit.lodDistances[level - 1]!);
      });
      if (!any) return null;
      lod.visible = (piece.shownIn & 1) !== 0;
      kitPieces.push({ zone: piece.zone, shownIn: piece.shownIn, object: lod });
      return lod;
    };
    const whole = (g: THREE.BufferGeometry) => g;
    const split = gunSplit(kit);
    for (const piece of mergedPieces(split.rest, toon, bodyColor, trimColor)) {
      const lod = lodOf(piece, whole)!;
      // A leg piece hangs on its joint, placed so it sits where it was modelled while at rest.
      if (piece.segment >= 0 && legs.length > 0) {
        lod.position.copy(segmentRest(piece.segment)).negate();
        segmentGroup(piece.segment).add(lod);
      } else body.add(lod);
    }
    // The guns are merged on their own, then cut by side, so each gun can kick by itself: the Arbiter's two take
    // turns, a turret's barrels in the middle kick with every shot. They still count as arm pieces for damage and
    // for blowing apart (deathFx.ts cuts the arms by side the same way).
    if (split.guns) {
      for (const piece of mergedPieces(split.guns, toon, bodyColor, trimColor)) {
        for (let side = LEFT; side <= RIGHT; side++) {
          const lod = lodOf(piece, (g) => splitBySide(g, recoilConfig.sideMeters)[side] ?? null);
          if (!lod) continue;
          body.add(lod);
          gunOn(side).objects.push(lod);
        }
      }
    }
    // Serial numbers: paint like the hull's, so they rust and darken with their zone. Past the first level of detail
    // they would be a pixel or two, so they are not drawn there.
    for (const placed of kit.serials) {
      const paint = toon.ownMaterial(placed.color, true);
      paint.map = serialTexture(placed.text);
      paint.alphaTest = 0.5;
      paints.push({ zone: placed.zone, material: paint, base: new THREE.Color(toon.color(placed.color)) });
      const lod = new THREE.LOD();
      lod.addLevel(new THREE.Mesh(placed.geometry, paint), 0);
      lod.addLevel(new THREE.Object3D(), kit.lodDistances[0]!);
      lod.position.copy(placed.point);
      lod.quaternion.copy(placed.turn);
      if (placed.zone === 0 && legs.length > 0) {
        const piece = segmentOf(placed.point, kit.legs);
        lod.position.sub(segmentRest(piece));
        segmentGroup(piece).add(lod);
      } else body.add(lod);
      serials.push({ zone: placed.zone, object: lod });
    }
  } else {
    part(2, [0, 2.4, 0], [1.8, 1.6, 1.2]);
    // Legs hang from the hips (pivot at the top) so a broken one can shrink to a stub under the body.
    for (const x of [-0.6, 0.6]) legMeshes.push(part(0, [x, 0.8, 0], [0.6, 1.6, 0.7]));
    armMeshes.push(part(1, [-1.2, 2.4, 0], [0.5, 1.2, 0.5]));
    armMeshes.push(part(1, [1.2, 2.4, -0.6], [0.5, 0.6, 1.6]));
  }

  // A mech without its own modelled gun gets a plain barrel on the gun arm, in the colour of the weapon in hand.
  const gunParts: THREE.Object3D[] = [];
  if (!hasModelledGun) {
    const barrel = new THREE.Mesh(unitBox, gunMaterial);
    if (gunMount) barrel.position.copy(gunMount);
    else barrel.position.set(1.2, 2.4, -1.65);
    barrel.scale.set(0.3, 0.3, 0.6);
    body.add(barrel);
    outline(barrel, "soot");
    gunParts.push(barrel);
    // The barrel kicks, and on a grey-box mech the arm holding it.
    const gun = gunOn(sideOf(barrel.position.x, recoilConfig.sideMeters));
    gun.objects.push(barrel);
    if (!kit && armMeshes[1]) gun.objects.push(armMeshes[1]);
  }
  for (const gun of guns) {
    for (const o of gun.objects) gun.rest.push(o.position.clone());
    aimGun(gun);
  }

  // Armor plates bolted on over each zone. Art hook: real plate models with bolts and scratches at V2.
  const plateMaterial = toon ? toon.material("#a9b8c4") : new THREE.MeshStandardMaterial({ color: "#a9b8c4", roughness: 0.5, metalness: 0.3 });
  const plate = (center: number[], size: number[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(unitBox, plateMaterial);
    mesh.position.set(center[0]!, center[1]!, center[2]!);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    mesh.visible = false;
    body.add(mesh);
    outline(mesh, "#a9b8c4");
    return mesh;
  };
  const legPlates = [plate([-0.6, 0.9, -0.4], [0.65, 1.0, 0.12]), plate([0.6, 0.9, -0.4], [0.65, 1.0, 0.12])];
  // On a walking mech the leg plates ride on the leg piece they sit nearest.
  if (kit && legs.length > 0) {
    for (const p of legPlates) {
      const piece = segmentOf(p.position, kit.legs);
      p.position.sub(segmentRest(piece));
      segmentGroup(piece).add(p);
    }
  }
  const plates = [
    legPlates,
    [plate([-1.48, 2.4, 0], [0.1, 0.9, 0.45]), plate([1.48, 2.4, -0.4], [0.1, 0.5, 0.9])],
    [plate([0, 2.5, -0.66], [1.5, 1.1, 0.12]), plate([0, 2.5, 0.66], [1.5, 1.1, 0.12])],
  ];
  // Pistons that telescope with the knee and parts that sway (V9b, mechMotion.ts), lifted out of the kit's pieces.
  if (kit) rigMechMotion(body, legs, kitPieces);
  return {
    group, body, legMeshes, zoneMaterials, toon, armMeshes, baseColors, zoneMaxHp: [...zoneMaxHp], plates, gunMaterial,
    hp: [...zoneMaxHp], dead: false, blownApart: false, repairing: false, fxTimers: [0, 0, 0, 0, 0, 0, 0],
    kitPieces, fxAnchors, gunParts, serials, paints, glows, guns, torsoKick: createSpring(), kick: null, recoiling: false,
    legs, legSides: legs.map((l) => l.side), gait: legs.length > 0 ? createGait(legs.length) : null, gaitId: kit?.id ?? "", crawlDrop: 0, crawlTilt: 0,
  };
}

// Where a gun points, from its shape while the model is still at the origin, unturned: the height of its front end
// and of its back end (the corners within a tenth of its length of each) give the barrel's slope; it kicks back down
// that slope and tips up about the middle of its back end.
const gunBox = new THREE.Box3(), corner = new THREE.Vector3();
function aimGun(gun: Gun): void {
  gunBox.makeEmpty();
  for (const o of gun.objects) gunBox.expandByObject(o);
  if (gunBox.isEmpty()) return;
  const front = gunBox.min.z, rear = gunBox.max.z, band = (rear - front) * 0.1;
  let frontY = 0, frontN = 0, rearY = 0, rearN = 0;
  for (const o of gun.objects) {
    o.updateWorldMatrix(true, true);
    o.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const position = mesh.isMesh ? mesh.geometry.attributes.position : undefined;
      if (!position) return;
      for (let i = 0; i < position.count; i++) {
        corner.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        if (corner.z <= front + band) { frontY += corner.y; frontN++; }
        if (corner.z >= rear - band) { rearY += corner.y; rearN++; }
      }
    });
  }
  const middleY = (gunBox.min.y + gunBox.max.y) / 2;
  frontY = frontN > 0 ? frontY / frontN : middleY;
  rearY = rearN > 0 ? rearY / rearN : middleY;
  gun.back.set(0, rearY - frontY, rear - front).normalize();
  gun.pivot.set((gunBox.min.x + gunBox.max.x) / 2, rearY, rear);
}

// A kit split into the parts that kick when it fires (data/recoil.json recoil.guns, or its weapon-painted parts)
// and the rest, each merged on its own. Kept per kit, so mechs of one kit share the merged geometry as before.
const gunSplits = new WeakMap<LoadedKit, { rest: LoadedKit; guns: LoadedKit | null }>();
function gunSplit(kit: LoadedKit): { rest: LoadedKit; guns: LoadedKit | null } {
  let found = gunSplits.get(kit);
  if (!found) {
    const names = recoilConfig.guns[kit.id];
    const kicks = (p: LoadedKit["parts"][number]) => (names ? names.includes(p.name) : p.paint === "weapon");
    const guns = kit.parts.filter(kicks);
    found = guns.length === 0
      ? { rest: kit, guns: null }
      : { rest: { ...kit, parts: kit.parts.filter((p) => !kicks(p)) }, guns: { ...kit, parts: guns, serials: [] } };
    gunSplits.set(kit, found);
  }
  return found;
}

// The materials that take their colour from a merged piece's corners and are the same on every kit mech: plain paint
// that never rusts (with the parts' finishes, which only kit geometry carries), and the outline. Copies of the toon ones, so things drawn in white or outlined in it are untouched.
const cornerColoredByToon = new WeakMap<Toon, { plain: THREE.MeshToonMaterial; shell: THREE.MeshBasicMaterial }>();
function cornerColored(toon: Toon): { plain: THREE.MeshToonMaterial; shell: THREE.MeshBasicMaterial } {
  let found = cornerColoredByToon.get(toon);
  if (!found) {
    const plain = toon.ownMaterial("#ffffff", false, "mech", true);
    plain.vertexColors = true;
    const source = toon.shellOutline("#ffffff", true);
    const shell = source.clone();
    shell.onBeforeCompile = source.onBeforeCompile; // clone() leaves behind the shader change that pushes the shell out
    shell.customProgramCacheKey = source.customProgramCacheKey;
    shell.color.setRGB(1, 1, 1);
    shell.vertexColors = true;
    found = { plain, shell };
    cornerColoredByToon.set(toon, found);
  }
  return found;
}

// Damage you can read on the mech: parts darken as they take hits, a broken arm falls off, broken legs leave the
// body down on the ground on two stubs, and a destroyed mech slumps. Sparks and smoke come from damageFx.ts.
// Art hook: real bent and missing parts at V2.
export function setMechDamage(model: MechModel, hp: readonly number[], dead: boolean): void {
  for (let zone = 0; zone < model.hp.length; zone++) model.hp[zone] = hp[zone]!;
  model.dead = dead;
  for (let zone = 0; zone < model.zoneMaterials.length; zone++) {
    const fraction = Math.max(0, Math.min(1, hp[zone]! / model.zoneMaxHp[zone]!));
    const material = model.zoneMaterials[zone]!;
    if (model.toon) {
      // Paint gives way to rust as the zone is hurt (DESIGN.md: clean mechs leave as rustbuckets). A wreck goes dark.
      model.toon.setRust(material, 1 - fraction);
      scratch.copy(model.baseColors[zone]!).multiplyScalar(dead ? 0.5 : 1);
    } else {
      scratch.copy(WRECK).lerp(model.baseColors[zone]!, fraction);
    }
    material.color.copy(scratch);
  }
  for (const paint of model.paints) {
    const fraction = Math.max(0, Math.min(1, hp[paint.zone]! / model.zoneMaxHp[paint.zone]!));
    model.toon?.setRust(paint.material, 1 - fraction);
    paint.material.color.copy(paint.base).multiplyScalar(dead ? 0.5 : 1);
  }
  // Sensors and energy accents go dark when the torso is gone, so a dead mech reads at a glance. Otherwise each shows
  // its own zone: lit, flickering (moveGunsAndSensors steps it each frame), or an ember.
  const lightsOut = dead || hp[2]! <= 0;
  for (const glow of model.glows) {
    const zoneHp = hp[glow.zone]!;
    glow.state = lightsOut ? GLOW_DARK : zoneHp <= 0 ? GLOW_BROKEN : zoneHp / model.zoneMaxHp[glow.zone]! < damagedBelow ? GLOW_DAMAGED : GLOW_INTACT;
    glow.material.color.copy(glow.base).multiplyScalar(glowLevel(glow.state, glow.flicker, 0, flickerConfig, Math.random));
  }
  // A wreck's guns and torso go back to rest, so it falls or blows apart from its built pose.
  if (dead && model.recoiling) settleRecoil(model);
  const armsBroken = hp[1]! <= 0;
  for (const arm of model.armMeshes) arm.visible = !armsBroken;
  for (const gun of model.gunParts) gun.visible = !armsBroken;
  // A kit mech shows each part in its zone's state: intact, damaged, or broken. A part with no damaged version keeps
  // its intact one, darkening, sparking and smoking; with no broken version it is gone (an arm shot off; legs gone
  // and the mech crawls on its belly). Which pieces carry which states is worked out in mechMerge.ts.
  for (const piece of model.kitPieces) {
    const fraction = hp[piece.zone]! / model.zoneMaxHp[piece.zone]!;
    const state = hp[piece.zone]! <= 0 ? 2 : fraction < damagedBelow ? 1 : 0;
    piece.object.visible = (piece.shownIn & (1 << state)) !== 0;
  }
  for (const serial of model.serials) serial.object.visible = hp[serial.zone]! > 0;
  // Crawling: the body drops onto stubs and tips forward, so a legless mech reads at a distance.
  const crawling = hp[0]! <= 0 && !dead;
  model.crawlDrop = crawling ? -crawlLook.dropMeters : 0;
  model.crawlTilt = crawling ? -(crawlLook.tiltDegrees * Math.PI) / 180 : 0;
  model.body.position.y = model.crawlDrop;
  model.body.rotation.set(model.crawlTilt, 0, 0);
  for (const leg of model.legMeshes) {
    // A stub hangs from the bottom of the torso (1.6 m up in the body's frame).
    const length = crawling ? 1.6 * crawlLook.legStubScale : 1.6;
    leg.scale.y = length;
    leg.position.y = 1.6 - length / 2;
  }
  model.group.scale.y = dead && !model.blownApart ? 0.35 : 1;
}

// Shows the weapon in hand and the armor still on. A plate disappears the moment its points run out.
export function setMechGear(model: MechModel, gunColor: string, armor: readonly number[]): void {
  model.gunMaterial.color.set(gunColor);
  model.plates.forEach((meshes, zone) => {
    const on = (armor[zone] ?? 0) > 0;
    for (const m of meshes) m.visible = on;
  });
}

// A shot from this mech: the gun on the muzzle's side kicks back and up, and a heavy weapon shoves the torso.
// `muzzleX` is the muzzle's x in the mech's own frame; NaN, or a side with no gun of its own, kicks every gun.
export function kickMech(model: MechModel, kick: Kick, muzzleX: number): void {
  if (model.dead || model.guns.length === 0) return;
  const side = Number.isNaN(muzzleX) ? -1 : sideOf(muzzleX, recoilConfig.sideMeters);
  const any = model.guns.some((g) => g.side === side);
  for (const gun of model.guns) if (!any || gun.side === side || gun.side === MIDDLE) kickSpring(gun.spring, kick.cap);
  if (kick.torsoMeters > 0) kickSpring(model.torsoKick, kick.cap);
  model.kick = kick;
  model.recoiling = true;
}

const tip = new THREE.Quaternion();
const turned = new THREE.Vector3();
const ACROSS = new THREE.Vector3(1, 0, 0);
const DEGREES = Math.PI / 180;

// Each frame: settles the guns and torso after a shot, and flickers the glows of hurt zones. Composes with walking
// (mechWalk.ts): that sets the body's height and lean, this only its z and the guns' own place. Allocates nothing.
export function moveGunsAndSensors(model: MechModel, dt: number): void {
  if (model.dead) return; // setMechDamage has put the lights out and the guns back
  for (const glow of model.glows) {
    if (glow.state === GLOW_DAMAGED) glow.material.color.copy(glow.base).multiplyScalar(glowLevel(GLOW_DAMAGED, glow.flicker, dt, flickerConfig, Math.random));
  }
  const kick = model.kick;
  if (!model.recoiling || !kick) return;
  let moving = false;
  for (const gun of model.guns) {
    if (stepSpring(gun.spring, kick.hz, kick.damping, dt)) moving = true;
    poseGun(gun, gun.spring.x * kick.backMeters, gun.spring.x * kick.climbDegrees * DEGREES);
  }
  if (stepSpring(model.torsoKick, kick.torsoHz, kick.damping, dt)) moving = true;
  model.body.position.z = model.torsoKick.x * kick.torsoMeters;
  model.recoiling = moving;
}

function poseGun(gun: Gun, back: number, climb: number): void {
  tip.setFromAxisAngle(ACROSS, climb); // about +x, so the muzzle (forward is -z) tips up
  for (let i = 0; i < gun.objects.length; i++) {
    const o = gun.objects[i]!;
    turned.copy(gun.rest[i]!).sub(gun.pivot).applyQuaternion(tip).add(gun.pivot).addScaledVector(gun.back, back);
    o.position.copy(turned);
    o.quaternion.copy(tip);
  }
}

function settleRecoil(model: MechModel): void {
  for (const gun of model.guns) {
    gun.spring.x = 0; gun.spring.v = 0;
    poseGun(gun, 0, 0);
  }
  model.torsoKick.x = 0; model.torsoKick.v = 0;
  model.body.position.z = 0;
  model.recoiling = false;
}
