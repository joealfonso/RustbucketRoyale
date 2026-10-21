import * as THREE from "three";
import { freeze } from "../freeze";
import type { Toon } from "../toonMaterial";
import { bayCentres, type HangarConfig } from "./layout";

// The hangar's stage lighting (gate V12): the picked mech in the loading bay gets a cool rim from behind against the
// warm work light, so it is the best-lit thing in the room; each bay sits in a warm pool under a lamp on its gantry
// beam, with darker floor between bays; and the bay whose card you point at brightens under a spotlight that fades
// across to it. Pools and lamp faces are flat unlit colour (two draw calls), not lights: every real light costs on
// every lit pixel, so there are only two more of those (rim and hover).

interface Spot { color: string; intensity: number; height: number; angleDegrees: number; penumbra: number; distance: number }
export interface StageLight {
  rim: Spot & { behind: number }; // behind the loading bay by `behind` metres, aimed at the mech's chest
  hover: Spot & { fadeSeconds: number };
  pools: { color: string; radius: number; opacity: number; lampColor: string; lamp: [number, number, number]; lampBelowBeam: number };
}

export function parseStageLight(raw: unknown): StageLight {
  const l = raw as Partial<StageLight>;
  const spot = (s: Partial<Spot> | undefined, what: string) => {
    for (const k of ["intensity", "height", "angleDegrees", "distance"] as const) if (!(typeof s?.[k] === "number" && s[k]! > 0)) throw new Error(`hangar.json: light.${what}.${k} must be above 0`);
    if (!(typeof s?.penumbra === "number" && s.penumbra >= 0 && s.penumbra <= 1)) throw new Error(`hangar.json: light.${what}.penumbra must be 0 to 1`);
    if (typeof s?.color !== "string") throw new Error(`hangar.json: light.${what}.color is missing`);
  };
  spot(l.rim, "rim");
  spot(l.hover, "hover");
  if (!(typeof l.rim?.behind === "number")) throw new Error("hangar.json: light.rim.behind must be a number");
  if (!(typeof l.hover?.fadeSeconds === "number" && l.hover.fadeSeconds > 0)) throw new Error("hangar.json: light.hover.fadeSeconds must be above 0");
  const p = l.pools;
  if (!(p && p.radius > 0 && p.opacity > 0 && p.opacity <= 1 && Array.isArray(p.lamp) && p.lamp.length === 3 && typeof p.lampBelowBeam === "number")) {
    throw new Error("hangar.json: light.pools needs radius, opacity 0 to 1, lamp [w, h, d] and lampBelowBeam");
  }
  return l as StageLight;
}

const POOL_SIDES = 40;

export class HangarLighting {
  readonly group = new THREE.Group();
  private hover: THREE.SpotLight;
  private bays: { x: number; z: number }[];
  private hovered = -1;
  private level = 0; // how far the hover light is up, 0 to 1
  private max: number;
  private fade: number;

  constructor(c: HangarConfig, toon: Toon, stage: StageLight) {
    const color = (name: string) => toon.color(name);
    const bay = c.loadingBay;
    const chest = c.gantry.armHeight;

    const r = stage.rim;
    const rim = new THREE.SpotLight(color(r.color), r.intensity, r.distance, THREE.MathUtils.degToRad(r.angleDegrees), r.penumbra);
    rim.position.set(bay.x, r.height, bay.z - r.behind);
    rim.target.position.set(bay.x, chest, bay.z);
    this.group.add(rim, rim.target);

    const h = stage.hover;
    this.max = h.intensity;
    this.fade = h.fadeSeconds;
    this.hover = new THREE.SpotLight(color(h.color), 0, h.distance, THREE.MathUtils.degToRad(h.angleDegrees), h.penumbra);
    this.hover.position.set(0, h.height, c.bays.z);
    this.hover.target.position.set(0, 0, c.bays.z);
    this.group.add(this.hover, this.hover.target);
    this.bays = bayCentres(c);

    // A warm pool on the floor under each bay and the loading bay, drawn over the deck, and the lamp face on each
    // gantry beam above a bay that it seems to come from.
    const p = stage.pools;
    const spots = [...this.bays, { x: bay.x, z: bay.z }];
    const disc = new THREE.CircleGeometry(p.radius, POOL_SIDES).rotateX(-Math.PI / 2);
    const pools = mergedCopies(disc, spots.map((s) => new THREE.Vector3(s.x, 0.035, s.z)));
    const poolMaterial = new THREE.MeshBasicMaterial({ color: color(p.color), transparent: true, opacity: p.opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.group.add(freeze(new THREE.Mesh(pools, poolMaterial)));
    const lampBox = new THREE.BoxGeometry(...p.lamp);
    const lamps = mergedCopies(lampBox, this.bays.map((s) => new THREE.Vector3(s.x, c.gantry.height - p.lampBelowBeam, s.z)));
    this.group.add(freeze(new THREE.Mesh(lamps, new THREE.MeshBasicMaterial({ color: color(p.lampColor), fog: false }))));
  }

  // The bay whose card the pointer is on, or -1 for none.
  hoverBay(bay: number): void {
    this.hovered = bay;
  }

  // The hover light fades out, jumps to the new bay while dark, and fades back up, so it never sweeps across the room.
  // Under reduced motion it changes at once.
  update(dt: number, still: boolean): void {
    const target = this.bays[this.hovered];
    const atTarget = target !== undefined && this.hover.position.x === target.x;
    const want = atTarget ? 1 : 0;
    const step = still ? 1 : dt / this.fade;
    this.level = want > this.level ? Math.min(want, this.level + step) : Math.max(want, this.level - step);
    if (this.level === 0 && target !== undefined && !atTarget) {
      this.hover.position.x = target.x;
      this.hover.target.position.x = target.x;
    }
    this.hover.intensity = this.level * this.max;
  }
}

function mergedCopies(geometry: THREE.BufferGeometry, at: THREE.Vector3[]): THREE.BufferGeometry {
  const source = geometry.toNonIndexed();
  const from = source.getAttribute("position") as THREE.BufferAttribute;
  const positions = new Float32Array(from.count * 3 * at.length);
  at.forEach((p, i) => {
    for (let v = 0; v < from.count; v++) {
      const o = (i * from.count + v) * 3;
      positions[o] = from.getX(v) + p.x;
      positions[o + 1] = from.getY(v) + p.y;
      positions[o + 2] = from.getZ(v) + p.z;
    }
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return merged;
}
