import * as THREE from "three";
import { toGeometry } from "../dressing/dressing";
import { box, cylinder, merge, mirrorX, type MeshData, type V3 } from "../dressing/shapes";
import type { Toon } from "../toonMaterial";
import type { Pieces } from "./hall";
import { bayCentres, type HangarConfig } from "./layout";

// The gantry over each bay: two columns and a beam (fixed, merged into the hall), and two arms that clamp the mech
// at the chest and swing back out of its way when it walks out to the loading bay. Power runs to the gantries in
// cables hung from beam to beam, from a junction box on the side wall.

export function buildGantries(c: HangarConfig, pieces: Pieces): void {
  const g = c.gantry;
  const bays = bayCentres(c);
  const add = (paint: string, mesh: MeshData) => { const list = pieces.get(paint); if (list) list.push(mesh); else pieces.set(paint, [mesh]); };
  const columnX = (bay: { x: number }, side: number) => bay.x + side * c.bays.halfWidth;
  for (const bay of bays) {
    for (const side of [-1, 1]) {
      const x = columnX(bay, side);
      add("gantry", box([x, g.height / 2, bay.z], [g.column, g.height, g.column]));
      add("frame", box([x, 0.15, bay.z], [g.column * 1.8, 0.3, g.column * 1.8], 0.05)); // foot plate bolted to the deck
    }
    add("gantry", box([bay.x, g.height + g.beam / 2, bay.z], [c.bays.halfWidth * 2 + g.column, g.beam, g.column]));
    add("frame", box([bay.x, g.height + g.beam + 0.25, bay.z], [0.7, 0.5, 0.5], 0.04)); // junction box the cables feed
  }
  // Cables hang from junction box to junction box, and from the side walls into the outer two.
  const top = g.height + g.beam + 0.25;
  const feeds: V3[] = [[-c.hall.halfWidth, top + 1.5, bays[0]!.z], ...bays.map((b) => [b.x, top, b.z] as V3), [c.hall.halfWidth, top + 1.5, bays.at(-1)!.z]];
  for (let i = 0; i + 1 < feeds.length; i++) add("cable", hangingCable(feeds[i]!, feeds[i + 1]!, g.cableSag, g.cableRadius));
}

// A cable sagging between two points: a parabola is close enough to a catenary at this sag.
export function hangingCable(a: V3, b: V3, sag: number, radius: number, segments = 14): MeshData {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t));
  }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments * 2, radius, 6, false);
  const mesh: MeshData = { positions: [...tube.attributes.position!.array], normals: [...tube.attributes.normal!.array], indices: [...tube.index!.array] };
  tube.dispose();
  return mesh;
}

// One bay's two arms. `reach` is how far each arm comes in from its column, so its pad meets this mech's flank.
export class GantryArms {
  readonly group = new THREE.Group();
  private arms: THREE.Group[] = [];
  private angle = 0; // 0 closed on the mech, 1 swung fully open

  constructor(private c: HangarConfig, toon: Toon, bay: { x: number; z: number }, reach: number) {
    const g = c.gantry;
    const t = g.armThickness;
    const arm = merge(
      cylinder([0, 0, 0], t * 0.8, t * 1.6, "y", 8), // the hinge round the column
      box([reach / 2, 0, 0], [reach, t, t]),
      box([reach * 0.55, -t * 0.9, 0], [reach * 0.7, t * 0.5, t * 0.6]), // the ram that drives the clamp
    );
    const pad = box([reach + 0.08, 0, 0], [0.16, g.clampSize, g.clampSize * 1.2], 0.03);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(bay.x + side * (c.bays.halfWidth - g.column / 2), g.armHeight, bay.z);
      // Built reaching to +x for the left column; the right one is its mirror image.
      for (const [mesh, paint] of [[arm, c.paints.arm!], [pad, c.paints.frame!]] as const) {
        const geometry = toGeometry([side < 0 ? mesh : mirrorX(mesh)]);
        pivot.add(new THREE.Mesh(geometry, toon.material(paint)), new THREE.Mesh(geometry, toon.shellOutline(paint)));
      }
      this.group.add(pivot);
      this.arms.push(pivot);
    }
  }

  // Swings toward open (or closed) at the speed in the data file. Returns true once it is all the way there.
  swing(open: boolean, dt: number): boolean {
    const step = dt / this.c.gantry.swingSeconds;
    this.angle = open ? Math.min(1, this.angle + step) : Math.max(0, this.angle - step);
    // Eased, so the arm starts and stops like a hydraulic one rather than snapping.
    const eased = this.angle * this.angle * (3 - 2 * this.angle);
    const radians = eased * THREE.MathUtils.degToRad(this.c.gantry.openDegrees);
    // Both arms swing back toward the wall, away from the way the mech walks out.
    this.arms[0]!.rotation.y = radians;
    this.arms[1]!.rotation.y = -radians;
    return open ? this.angle >= 1 : this.angle <= 0;
  }

  // Straight to open, for the mech already standing in the loading bay when the title screen opens.
  openNow(): void {
    this.angle = 1;
    this.swing(true, 0);
  }
}
