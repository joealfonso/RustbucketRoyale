import * as THREE from "three";
import type { UpgradeDef } from "@rustbucket/shared";
import type { Toon } from "./toonMaterial";
import type { LoadedKit } from "./mechKit";
import { createGait, type GaitState } from "./gait";
import { SEGMENTS_PER_LEG, segmentOf } from "./legRig";

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
  repairing: boolean; // shown with welding sparks
  upgradeParts: THREE.Mesh[]; // one per upgrade, made the first time it is fitted, shown while fitted
  fxTimers: number[]; // per zone: seconds until the next spark, then the next puff of smoke. Last: welding sparks
  // A mech built from a kit: each part's intact, damaged and broken versions (each with its levels of detail), and
  // the point in each hit zone that sparks and smoke come from. Empty for the grey-box mech.
  kitParts: { zone: number; states: (THREE.Object3D[] | null)[] }[]; // intact, damaged, broken; a missing one falls back
  fxAnchors: (THREE.Object3D | null)[];
  gunParts: THREE.Object3D[]; // hidden with the arms when they are broken
  // A kit's painted materials beyond the one per zone: white body paint and the pilot's accent, each zone its own,
  // so any part can carry either and still rust with its zone.
  paints: { zone: number; material: THREE.MeshToonMaterial; base: THREE.Color }[];
  glows: { material: THREE.MeshBasicMaterial; base: THREE.Color }[]; // sensors and energy accents, dark once the torso breaks
  // Walking (gait.ts, mechWalk.ts): one hip, knee and ankle joint per leg under the body, with the leg pieces hung
  // on them, and where each joint sits at rest. Empty for a mech whose kit marks no leg joints.
  legs: { side: string; hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group; restHip: THREE.Vector3; restKnee: THREE.Vector3; restAnkle: THREE.Vector3 }[];
  legSides: string[]; // each leg's side name, in the same order (L, R, or FL, FR, BL, BR)
  gait: GaitState | null;
  gaitId: string; // which mech's numbers in data/gait.json it walks with
  crawlDrop: number; crawlTilt: number; // the crawl pose, which walking adds its bob and lean to
}

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
// (damage tint, plates, gun, upgrades, effects) works the same.
export function createMechModel(
  accent: string, zoneMaxHp: readonly number[], toon: Toon | null = null, bodyColor = "#738087", kit: LoadedKit | null = null, trimColor = "deepRust",
): MechModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const grey = toon ? toon.color(bodyColor) : bodyColor;
  const baseColors = [new THREE.Color(grey), new THREE.Color(toon ? toon.color(accent) : accent), new THREE.Color(grey)];
  // In the toon look each zone's paint rusts away with damage; the plain look darkens instead.
  const zoneMaterials = baseColors.map((c) => (toon ? toon.ownMaterial(`#${c.getHexString()}`, true) : new THREE.MeshStandardMaterial({ color: c, roughness: 1 })));
  const armMeshes: THREE.Mesh[] = [];
  // Every box gets an outline in the toon look, tinted from the colour it starts with.
  const outline = (mesh: THREE.Mesh, color: string) => { if (toon) toon.outlineChild(mesh, color); };

  const part = (zone: number, center: number[], size: number[]): THREE.Mesh => {
    const mesh = new THREE.Mesh(unitBox, zoneMaterials[zone]!);
    mesh.position.set(center[0]!, center[1]!, center[2]!);
    mesh.scale.set(size[0]!, size[1]!, size[2]!);
    body.add(mesh);
    outline(mesh, `#${baseColors[zone]!.getHexString()}`);
    return mesh;
  };
  const legMeshes: THREE.Mesh[] = [];
  // The weapon in hand's colour: on a kit's own gun parts, or on the plain barrel added below.
  const gunMaterial = toon ? toon.ownMaterial("#d9731a") : new THREE.MeshStandardMaterial({ color: "#d9731a", roughness: 0.6 });
  let hasModelledGun = false;
  const paints: MechModel["paints"] = [];
  const glows: MechModel["glows"] = [];
  // One rusting material per zone and paint colour, made on first use.
  const paintFor = (zone: number, color: string): THREE.MeshToonMaterial => {
    const base = new THREE.Color(color);
    const found = paints.find((p) => p.zone === zone && p.base.equals(base));
    if (found) return found.material;
    const material = toon!.ownMaterial(color, true);
    paints.push({ zone, material, base });
    return material;
  };
  const kitParts: MechModel["kitParts"] = [];
  const fxAnchors: MechModel["fxAnchors"] = [null, null, null];
  let gunMount: THREE.Vector3 | null = null;
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
      legs.push({ side: j.side, hip, knee, ankle, restHip: j.hip.clone(), restKnee: j.knee.clone(), restAnkle: j.ankle.clone() });
    }
    // Each part's states are levels-of-detail objects; damage shows one state at a time.
    for (const p of kit.parts) {
      if (p.paint === "weapon") hasModelledGun = true;
      const paintColor = p.color ? toon.color(p.color) : p.paint === "accent" ? toon.color(accent) : p.paint === "trim" ? toon.color(trimColor) : grey;
      let mat: THREE.Material;
      if (p.paint === "weapon") mat = gunMaterial;
      else if (p.glow) {
        const glow = new THREE.MeshBasicMaterial({ color: paintColor });
        glows.push({ material: glow, base: new THREE.Color(paintColor) });
        mat = glow;
      } else if (p.rusts) mat = paintFor(p.zone, paintColor);
      else mat = toon.material(paintColor);
      const outlineColor = p.paint === "weapon" ? trimColor : paintColor;
      const makeLod = (lods: THREE.BufferGeometry[], visible: boolean): THREE.LOD => {
        const lod = new THREE.LOD();
        lods.forEach((geometry, level) => {
          const holder = new THREE.Group();
          holder.add(new THREE.Mesh(geometry, mat), new THREE.Mesh(geometry, toon.shellOutline(outlineColor)));
          lod.addLevel(holder, level === 0 ? 0 : kit.lodDistances[level - 1]!);
        });
        lod.visible = visible;
        return lod;
      };
      const states = p.states.map((state, i) => {
        if (!state) return null;
        // A leg part is hung piece by piece on its joints, placed so it sits where it was modelled while at rest.
        if (state.pieces && legs.length > 0) {
          return state.pieces.map(({ piece, lods }) => {
            const lod = makeLod(lods, i === 0);
            lod.position.copy(segmentRest(piece)).negate();
            segmentGroup(piece).add(lod);
            return lod;
          });
        }
        const lod = makeLod(state.lods, i === 0);
        body.add(lod);
        return [lod];
      });
      kitParts.push({ zone: p.zone, states });
      const intact = p.states[0]!; // the loader guarantees every part has its intact version
      if (intact.fx && !fxAnchors[p.zone]) {
        const anchor = new THREE.Object3D();
        anchor.position.copy(intact.fx);
        body.add(anchor);
        fxAnchors[p.zone] = anchor;
      }
      if (intact.mount) gunMount = intact.mount;
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
  return {
    group, body, legMeshes, zoneMaterials, toon, armMeshes, baseColors, zoneMaxHp: [...zoneMaxHp], plates, gunMaterial,
    hp: [...zoneMaxHp], dead: false, repairing: false, upgradeParts: [], fxTimers: [0, 0, 0, 0, 0, 0, 0],
    kitParts, fxAnchors, gunParts, paints, glows,
    legs, legSides: legs.map((l) => l.side), gait: legs.length > 0 ? createGait(legs.length) : null, gaitId: kit?.id ?? "", crawlDrop: 0, crawlTilt: 0,
  };
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
  // Sensors and energy accents go dark when the torso is gone, so a dead mech reads at a glance.
  const lightsOut = dead || hp[2]! <= 0;
  for (const glow of model.glows) glow.material.color.copy(glow.base).multiplyScalar(lightsOut ? 0.12 : 1);
  const armsBroken = hp[1]! <= 0;
  for (const arm of model.armMeshes) arm.visible = !armsBroken;
  for (const gun of model.gunParts) gun.visible = !armsBroken;
  // A kit mech shows each part in its zone's state: intact, damaged, or broken.
  for (const part of model.kitParts) {
    const fraction = hp[part.zone]! / model.zoneMaxHp[part.zone]!;
    let state = hp[part.zone]! <= 0 ? 2 : fraction < damagedBelow ? 1 : 0;
    // No damaged version: the intact one stays, darkening, sparking and smoking. No broken version: the part is
    // gone (an arm shot off; legs gone and the mech crawls on its belly).
    if (state === 1 && !part.states[1]) state = 0;
    part.states.forEach((objects, i) => { if (objects) for (const o of objects) o.visible = i === state; });
  }
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
    model.toon?.refit(leg);
  }
  model.group.scale.y = dead ? 0.35 : 1;
}

// Shows the weapon in hand and the armor still on. A plate disappears the moment its points run out.
export function setMechGear(model: MechModel, gunColor: string, armor: readonly number[]): void {
  model.gunMaterial.color.set(gunColor);
  model.plates.forEach((meshes, zone) => {
    const on = (armor[zone] ?? 0) > 0;
    for (const m of meshes) m.visible = on;
  });
}

// Where each upgrade bolts on, in the body frame: centre and size. Grey-box parts. Art hook: `model` in
// data/upgrades.json for a real part.
const UPGRADE_MOUNTS: Record<string, { center: number[]; size: number[] }> = {
  bigTanks: { center: [0, 2.6, 0.9], size: [1.3, 1.0, 0.6] }, // fat tanks on the back
  quickHands: { center: [-1.15, 1.5, 0.1], size: [0.5, 0.45, 0.8] }, // toolbox on the hip
  bigEars: { center: [0.45, 3.75, 0.2], size: [0.12, 1.1, 0.12] }, // antenna on the shoulder
  overclock: { center: [1.2, 2.95, -0.6], size: [0.6, 0.35, 0.9] }, // coil on top of the gun arm
};
const OTHER_MOUNT = { center: [0, 3.4, 0.4], size: [0.6, 0.4, 0.6] };

// Shows the parts for the upgrades fitted, so anyone can see what a mech is carrying.
export function setMechUpgrades(model: MechModel, upgrades: readonly number[], defs: readonly UpgradeDef[]): void {
  for (let u = 0; u < defs.length; u++) {
    const fitted = upgrades.includes(u);
    let part = model.upgradeParts[u];
    if (!part && fitted) {
      const def = defs[u]!;
      const mount = UPGRADE_MOUNTS[def.id] ?? OTHER_MOUNT;
      part = new THREE.Mesh(unitBox, model.toon ? model.toon.material(def.color) : material(def.color));
      part.position.set(mount.center[0]!, mount.center[1]!, mount.center[2]!);
      part.scale.set(mount.size[0]!, mount.size[1]!, mount.size[2]!);
      model.body.add(part);
      model.toon?.outlineChild(part, def.color);
      model.upgradeParts[u] = part;
    }
    if (part) part.visible = fitted;
  }
}
