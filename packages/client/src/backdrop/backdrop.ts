import * as THREE from "three";
import { toGeometry } from "../dressing/dressing";
import { box, type MeshData } from "../dressing/shapes";
import { freeze } from "../freeze";
import type { Toon } from "../toonMaterial";
import type { Terrain } from "@rustbucket/shared";
import { backdropLayout, seaLayout, type BackdropConfig } from "./layout";
import { backdropPieces } from "./shapes";

// The world beyond the edge wall: junk mountains, scrap heaps, cranes and chimneys in a ring round the map, standing
// on a plain apron of ground. Built once for a map size and merged into one mesh per paint, a handful of draw calls in
// all. It uses the master toon material without the weathering patterns, whose small patches would shimmer at this
// range, and no outline for the same reason; distance fog and haze are what push it back.
// Round an island (a terrain with a coast) there is no wall and no junkyard: a few islets and old rigs stand in the
// open sea instead, which the water and seabed meshes draw out to the haze.
export class Backdrop {
  readonly group = new THREE.Group();
  readonly island: boolean;

  constructor(private scene: THREE.Scene, toon: Toon, readonly meters: number, wallThickness: number, config: BackdropConfig, terrain: Terrain | null = null) {
    this.island = terrain?.island ?? false;
    const edge = meters / 2 + wallThickness;
    const byPaint = new Map<string, MeshData[]>();
    const add = (paint: string, mesh: MeshData) => {
      const hex = toon.color(paint);
      const list = byPaint.get(hex);
      if (list) list.push(mesh);
      else byPaint.set(hex, [mesh]);
    };
    const items = this.island ? seaLayout(config.sea, meters) : backdropLayout(config, meters, edge);
    for (const item of items) for (const p of backdropPieces(config, item)) add(p.paint, p.mesh);
    for (const [hex, meshes] of byPaint) this.group.add(new THREE.Mesh(toGeometry(meshes), toon.material(hex)));

    if (this.island) {
      this.group.position.y = terrain!.waterLevel - config.sea.sinkMeters;
    } else {
      // The apron: four slabs from the wall's outer face outward, level with the map's floor, so the backdrop stands on
      // ground when seen from above.
      const out = config.apron.outMeters, far = edge + out, mid = edge + out / 2;
      const slabs = [box([0, -0.5, -mid], [far * 2, 1, out]), box([0, -0.5, mid], [far * 2, 1, out]), box([-mid, -0.5, 0], [out, 1, edge * 2]), box([mid, -0.5, 0], [out, 1, edge * 2])];
      this.group.add(new THREE.Mesh(toGeometry(slabs), toon.ground(config.apron.paint)));
    }
    freeze(this.group);
    scene.add(this.group);
  }

  // Whether this backdrop already suits a map: the same size, and island or not.
  suits(meters: number, terrain: Terrain | null): boolean {
    return meters === this.meters && (terrain?.island ?? false) === this.island;
  }

  dispose(): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.scene.remove(this.group);
  }
}
