import * as THREE from "three";
import { toGeometry } from "../dressing/dressing";
import { box, type MeshData } from "../dressing/shapes";
import { freeze } from "../freeze";
import { OUTLINE_UNIT_GLSL, outlineWidthGlsl, pushOutGlsl } from "../outlineWidth";
import type { Toon } from "../toonMaterial";
import type { Terrain } from "@rustbucket/shared";
import { backdropRimGlsl, inkFactor, type BackdropLook } from "./backdropLook";
import { backdropLayout, seaLayout, type BackdropConfig } from "./layout";
import { backdropPieces } from "./shapes";

// The world beyond the edge wall: junk mountains, scrap heaps, cranes and chimneys in a ring round the map, standing
// on a plain apron of ground. Built once for a map size and merged into one mesh per paint, two draw calls a paint, a
// couple of dozen in all. It uses the master toon material without the weathering patterns, whose small patches
// would shimmer at this range, plus a rim that does not fade with distance (look.json backdrop), and a shell of ink
// round each mesh that stays a pixel or two wide however far it is, so silhouettes read like the near world's
// (gate V16a). The haze's steps are what push it back.
// Round an island (a terrain with a coast) there is no wall and no junkyard: a few islets and old rigs stand in the
// open sea instead, which the water and seabed meshes draw out to the haze.
export class Backdrop {
  readonly group = new THREE.Group();
  readonly island: boolean;

  constructor(private scene: THREE.Scene, toon: Toon, readonly meters: number, wallThickness: number, config: BackdropConfig, look: BackdropLook, terrain: Terrain | null = null) {
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
    for (const [hex, meshes] of byPaint) {
      const geometry = toGeometry(meshes);
      this.group.add(new THREE.Mesh(geometry, backdropMaterial(toon, hex, look)), new THREE.Mesh(geometry, inkShell(hex, look)));
    }

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

// Made once per colour and kept, like the toon's own, so a new map of another size compiles nothing new.
const materials = new Map<string, THREE.MeshToonMaterial>();
const shells = new Map<string, THREE.MeshBasicMaterial>();

// The master material in one colour, with the backdrop's rim added after its own (which has faded out by this range).
// It reuses the master's rim colour uniform.
function backdropMaterial(toon: Toon, hex: string, look: BackdropLook): THREE.MeshToonMaterial {
  let m = materials.get(hex);
  if (m) return m;
  const base = toon.material(hex);
  m = base.clone();
  m.userData = base.userData;
  m.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `${backdropRimGlsl(look.rim, "rimColor")}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${base.customProgramCacheKey()}-backdrop`;
  materials.set(hex, m);
  return m;
}

// The ink: the mesh drawn again from the inside, pushed out along its outline normals (one per corner position, so the
// shell stays closed at hard edges; toGeometry adds them) by the backdrop outline width, in the paint darkened. It
// takes the haze like the mesh it surrounds, so it fades back with it.
function inkShell(hex: string, look: BackdropLook): THREE.MeshBasicMaterial {
  let m = shells.get(hex);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(inkFactor(look.ink.darken)), side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec3 outlineNormal;${outlineWidthGlsl(look.outline)}${OUTLINE_UNIT_GLSL}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${pushOutGlsl("outlineUnit(mat3(modelViewMatrix) * outlineNormal)")}`);
  };
  m.customProgramCacheKey = () => "backdrop-ink";
  shells.set(hex, m);
  return m;
}
