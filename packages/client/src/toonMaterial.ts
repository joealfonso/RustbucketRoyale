import * as THREE from "three";

// The look of the game, from data/look.json and data/palette.json: one master toon material for everything (three
// flat bands of light plus a hard rim), a dark outline round every box, and one warm key light with cool fill and fog.
// Colours are named from the palette in DESIGN.md. Art hook: real models get the same material from `material()`.

export interface Palette {
  colors: Record<string, string>;
  mech: { body: string; trim: string; youAccent: string; othersAccent: string };
  world: { ground: string; sky: string; remap: Record<string, string> };
}

export interface LookConfig {
  bands: number[]; // brightness of each band, darkest first
  bandEdges: number[]; // where one band turns into the next, 0 (facing away from the light) to 1 (facing it)
  rim: { strength: number; width: number; color: string };
  outline: { widthMeters: number; darken: number };
  light: {
    key: { color: string; intensity: number; direction: [number, number, number] };
    fillSky: string;
    fillGround: string;
    fillIntensity: number;
    fog: { color: string; near: number; far: number };
  };
}

export function parsePalette(raw: unknown): Palette {
  const p = raw as Palette;
  if (!p?.colors || !p.mech || !p.world?.remap) throw new Error("palette.json: needs colors, mech and world");
  for (const [name, hex] of Object.entries(p.colors)) if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`palette.json: ${name} is not a colour`);
  return p;
}

export function parseLook(raw: unknown): LookConfig {
  const l = raw as LookConfig;
  if (!Array.isArray(l?.bands) || l.bands.length < 2 || l.bandEdges?.length !== l.bands.length - 1) throw new Error("look.json: needs bands and one fewer bandEdges");
  if (typeof l.outline?.widthMeters !== "number" || typeof l.rim?.strength !== "number") throw new Error("look.json: needs outline and rim");
  return l;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const RAMP_SIZE = 64;

export class Toon {
  private ramp: THREE.DataTexture;
  private materials = new Map<string, THREE.MeshToonMaterial>();
  private groundMaterials = new Map<string, THREE.MeshToonMaterial>();
  private outlines = new Map<string, THREE.MeshBasicMaterial>();
  private shellOutlines = new Map<string, THREE.MeshBasicMaterial>();
  private rimColor: THREE.Color;

  constructor(private look: LookConfig, private palette: Palette) {
    // The bands as a tiny texture read with no blending, so light falls in flat steps.
    const data = new Uint8Array(RAMP_SIZE * 4);
    for (let i = 0; i < RAMP_SIZE; i++) {
      const t = i / (RAMP_SIZE - 1);
      let band = 0;
      while (band < look.bandEdges.length && t >= look.bandEdges[band]!) band++;
      const v = Math.round(look.bands[band]! * 255);
      data.set([v, v, v, 255], i * 4);
    }
    this.ramp = new THREE.DataTexture(data, RAMP_SIZE, 1, THREE.RGBAFormat);
    this.ramp.minFilter = THREE.NearestFilter;
    this.ramp.magFilter = THREE.NearestFilter;
    this.ramp.needsUpdate = true;
    this.rimColor = new THREE.Color(this.color(look.rim.color));
  }

  // A palette name, an old map colour remapped onto the palette, or a plain hex colour.
  color(name: string): string {
    const { colors, world } = this.palette;
    const mapped = world.remap[name.toLowerCase()];
    return colors[mapped ?? name] ?? colors[name] ?? name;
  }

  // The master material in one colour. Shared between everything that colour, so it costs one material, not one each.
  material(name: string): THREE.MeshToonMaterial {
    const hex = this.color(name);
    let m = this.materials.get(hex);
    if (!m) {
      m = this.make(hex);
      this.materials.set(hex, m);
    }
    return m;
  }

  // The same bands with no rim, for the ground: a rim on a big flat floor draws a hard line where it turns away.
  ground(name: string): THREE.MeshToonMaterial {
    const hex = this.color(name);
    let m = this.groundMaterials.get(hex);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color: hex, gradientMap: this.ramp });
      this.groundMaterials.set(hex, m);
    }
    return m;
  }

  // A material of its own, for something whose colour changes on its own (a mech zone darkening with damage).
  ownMaterial(name: string): THREE.MeshToonMaterial {
    return this.make(this.color(name));
  }

  private make(hex: string): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: this.ramp });
    const { strength, width } = this.look.rim;
    const rim = this.rimColor;
    // A hard rim of warm light where a surface turns away from the camera, so shapes separate from what is behind.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.rimColor = { value: rim };
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", `uniform vec3 rimColor;\nvoid main() {`)
        .replace("#include <opaque_fragment>", `
          float facing = max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
          outgoingLight += rimColor * ${strength.toFixed(3)} * step(1.0 - ${width.toFixed(3)}, 1.0 - facing) * diffuseColor.rgb;
          #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => `toon-rim-${strength}-${width}`;
    return m;
  }

  // The outline colour: the base colour darkened, never black, so it reads as part of the thing it surrounds.
  outlineMaterial(name: string): THREE.MeshBasicMaterial {
    const hex = this.color(name);
    let m = this.outlines.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(this.look.outline.darken), side: THREE.BackSide });
      this.outlines.set(hex, m);
    }
    return m;
  }

  // The outline for a real model: the same mesh drawn from the inside with every vertex pushed out along its normal.
  // Works for any shape; on hard-edged boxes the faces part slightly at the corners, which smooth-shaded art does not.
  shellOutline(name: string): THREE.MeshBasicMaterial {
    const hex = this.color(name);
    let m = this.shellOutlines.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(this.look.outline.darken), side: THREE.BackSide });
      const width = this.look.outline.widthMeters;
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n  transformed += normalize(normal) * ${width.toFixed(4)};`);
      };
      m.customProgramCacheKey = () => `shell-${width}`;
      this.shellOutlines.set(hex, m);
    }
    return m;
  }

  // A box with its outline: a slightly bigger copy drawn from the inside, so only its rim shows round the edges.
  // The outline is a fixed width in metres, so it thins on screen with distance, as far LODs should.
  box(parent: THREE.Object3D, center: readonly number[], size: readonly number[], name: string, material?: THREE.Material): ToonBox {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(unitBox, material ?? this.material(name));
    const hull = new THREE.Mesh(unitBox, this.outlineMaterial(name));
    group.add(mesh, hull);
    group.position.set(center[0]!, center[1]!, center[2]!);
    parent.add(group);
    const box = { group, mesh, hull };
    this.resize(box, size);
    return box;
  }

  resize(box: ToonBox, size: readonly number[]): void {
    const w = this.look.outline.widthMeters * 2;
    box.mesh.scale.set(size[0]!, size[1]!, size[2]!);
    box.hull.scale.set(size[0]! + w, size[1]! + w, size[2]! + w);
  }

  // An outline for a box mesh that is already scaled: a hull child, sized so the edge is the same width in metres
  // whatever the box's size. Call `refit` again after changing the box's scale.
  outlineChild(mesh: THREE.Mesh, name: string, outlineColor?: string): void {
    const hull = new THREE.Mesh(unitBox, this.outlineMaterial(outlineColor ?? name));
    mesh.add(hull);
    mesh.userData.hull = hull;
    this.refit(mesh);
  }

  refit(mesh: THREE.Mesh): void {
    const hull = mesh.userData.hull as THREE.Mesh | undefined;
    if (!hull) return;
    const w = this.look.outline.widthMeters * 2;
    hull.scale.set(1 + w / mesh.scale.x, 1 + w / mesh.scale.y, 1 + w / mesh.scale.z);
  }

  instances(name: string, count: number, ground = false): ToonInstances {
    return new ToonInstances(this, name, count, this.look.outline.widthMeters, ground);
  }

  // Lights, fog and sky for a scene.
  light(scene: THREE.Scene): void {
    const { light } = this.look;
    scene.background = new THREE.Color(this.palette.world.sky);
    scene.fog = new THREE.Fog(light.fog.color, light.fog.near, light.fog.far);
    scene.add(new THREE.HemisphereLight(this.color(light.fillSky), this.color(light.fillGround), light.fillIntensity));
    const key = new THREE.DirectionalLight(this.color(light.key.color), light.key.intensity);
    key.position.set(...light.key.direction).multiplyScalar(100);
    scene.add(key);
  }
}

export interface ToonBox {
  group: THREE.Group;
  mesh: THREE.Mesh;
  hull: THREE.Mesh;
}

const placed = new THREE.Matrix4();
const at = new THREE.Vector3();
const sized = new THREE.Vector3();
const noTurn = new THREE.Quaternion();
const gone = new THREE.Matrix4().makeScale(0, 0, 0);

// Many boxes of one colour in two draw calls: the boxes, and their outlines. For the map and the props.
export class ToonInstances {
  readonly mesh: THREE.InstancedMesh;
  readonly hull: THREE.InstancedMesh | null;

  // `ground` draws the bands with no rim and no outline, for the floor.
  constructor(toon: Toon, name: string, count: number, private outlineWidth: number, ground = false) {
    this.mesh = new THREE.InstancedMesh(unitBox, ground ? toon.ground(name) : toon.material(name), count);
    this.hull = ground ? null : new THREE.InstancedMesh(unitBox, toon.outlineMaterial(name), count);
  }

  set(i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    this.mesh.setMatrixAt(i, placed.compose(at.set(x, y, z), noTurn, sized.set(sx, sy, sz)));
    const w = this.outlineWidth * 2;
    this.hull?.setMatrixAt(i, placed.compose(at, noTurn, sized.set(sx + w, sy + w, sz + w)));
  }

  hide(i: number): void {
    this.mesh.setMatrixAt(i, gone);
    this.hull?.setMatrixAt(i, gone);
    this.commit();
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.hull) this.hull.instanceMatrix.needsUpdate = true;
  }

  addTo(parent: THREE.Object3D): void {
    parent.add(this.mesh);
    if (this.hull) parent.add(this.hull);
  }

  dispose(): void {
    this.mesh.dispose();
    this.hull?.dispose();
  }
}
