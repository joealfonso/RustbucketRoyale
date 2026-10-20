import * as THREE from "three";
import type { PropConfig } from "@rustbucket/shared";
import { toGeometry } from "../dressing/dressing";
import { freeze } from "../freeze";
import type { PlayMap } from "../loadMap";
import { drawnFar } from "../propView";
import type { Toon } from "../toonMaterial";
import type { ForestConfig } from "./config";
import { crownFade, fallAngle, fallOver, restAngle, sinkDepth } from "./fall";
import { farPine, pineModel, reachOf, stump, type Part } from "./pineModel";
import { treeLook } from "./variety";

// The woods: every pine on the map (a breakable prop, data/props.json) drawn as a toon pine (pineModel.ts), a few
// thousand of them on a large map in about a dozen draw calls.
//  - Near the camera a tree is its full model, past `far.beyondMeters` a two-cone spire (with the same hysteresis as
//    the props, so one at the boundary does not flicker). Like the props, only trees inside the camera's view are
//    packed into the instance buffers each frame.
//  - Each tree's colour rides in its instance, so the crowns of every shape are one draw and one outline whatever
//    their greens; the trunks are one more pair per shape.
//  - A crown that the camera is inside, or that stands between the camera and its mech, is stippled away (a screen
//    door dither, toon-style) so a wood never blinds you.
//  - Broken, a tree leaves its stump and topples from the stump over a second and a half, crashes, lies a while and
//    sinks away (fall.ts). A small fixed pool of falling trees; if more fall at once the oldest is let go early.

const DITHER = `
float treeDither(vec2 p) {
  int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}`;

// A copy of a material whose instances can be stippled away by the per-instance `treeFade` (1 solid, less is
// see-through), keeping all of the original's own shader changes.
function fading<M extends THREE.Material>(material: M): M {
  const copy = material.clone() as M;
  const base = material.onBeforeCompile.bind(material);
  copy.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("void main() {", "attribute float treeFade;\nvarying float vTreeFade;\nvoid main() {\n  vTreeFade = treeFade;");
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", `varying float vTreeFade;\n${DITHER}\nvoid main() {\n  if (vTreeFade < 0.999 && treeDither(gl_FragCoord.xy) >= vTreeFade) discard;`);
  };
  const key = material.customProgramCacheKey.bind(material);
  copy.customProgramCacheKey = () => `${key()}-treefade`;
  copy.userData = material.userData;
  return copy;
}

// One mesh for many parts, each vertex coloured by its part's paint (white for "the tree's own colour") and shade.
function partsGeometry(parts: Part[], color: (name: string) => string): THREE.BufferGeometry {
  const geometry = toGeometry(parts.map((p) => p.mesh));
  const colors = new Float32Array(geometry.attributes.position!.count * 3);
  const c = new THREE.Color();
  let v = 0;
  for (const p of parts) {
    c.set(p.paint ? color(p.paint) : "#ffffff").multiplyScalar(p.shade);
    for (let k = 0; k < p.mesh.positions.length / 3; k++, v++) colors.set([c.r, c.g, c.b], v * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Uploads the first `count` numbers of an instance buffer.
function send(attribute: THREE.InstancedBufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}

interface LayerPart {
  geometry: THREE.BufferGeometry;
  fill: THREE.Material;
  outline: THREE.Material | null;
  colored: boolean; // takes the tree's colour from its instance
}

// The instanced meshes for one way of drawing trees (near model of one shape, far model, stumps, falling), sharing
// one buffer of matrices, one of colours and, if it fades, one of fades. Slots are refilled every frame with the
// trees to draw; a slot holding the same tree as last frame copies nothing.
class TreeLayer {
  readonly meshes: THREE.InstancedMesh[] = [];
  private matrices: THREE.InstancedBufferAttribute;
  private colors: THREE.InstancedBufferAttribute;
  private fades: THREE.InstancedBufferAttribute | null;
  private shown: Int32Array;
  private used = 0;
  private changed = false;

  constructor(capacity: number, parts: LayerPart[], fades: boolean, name: string) {
    this.matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.fades = fades ? new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1) : null;
    this.shown = new Int32Array(capacity).fill(-1);
    for (const part of parts) {
      if (this.fades) part.geometry.setAttribute("treeFade", this.fades);
      for (const material of part.outline ? [part.fill, part.outline] : [part.fill]) {
        const mesh = new THREE.InstancedMesh(part.geometry, material, capacity);
        mesh.instanceMatrix = this.matrices;
        if (part.colored) mesh.instanceColor = this.colors;
        mesh.frustumCulled = false; // culled per tree in TreeView.cull
        mesh.count = 0;
        mesh.visible = false;
        mesh.name = name;
        this.meshes.push(mesh);
      }
    }
  }

  begin(): void {
    this.used = 0;
  }

  // Draws tree `tree` (its matrix and colour from `matrices` and `colors`) in the next slot. `always` copies the
  // matrix even if the slot held this tree last frame, for trees that move.
  put(tree: number, matrices: ArrayLike<number>, matrixAt: number, colors: Float32Array, fade: number, always = false): void {
    const slot = this.used++;
    if (always || this.shown[slot] !== tree) {
      this.shown[slot] = tree;
      const m = this.matrices.array as Float32Array, c = this.colors.array as Float32Array;
      for (let k = 0; k < 16; k++) m[slot * 16 + k] = matrices[matrixAt + k]!;
      for (let k = 0; k < 3; k++) c[slot * 3 + k] = colors[tree * 3 + k]!;
      this.changed = true;
    }
    if (this.fades) {
      const f = this.fades.array as Float32Array;
      if (f[slot] !== fade) { f[slot] = fade; this.changed = true; }
    }
  }

  end(): void {
    for (const mesh of this.meshes) {
      mesh.count = this.used;
      mesh.visible = this.used > 0;
    }
    if (!this.changed) return;
    this.changed = false;
    send(this.matrices, this.used * 16);
    send(this.colors, this.used * 3);
    if (this.fades) send(this.fades, this.used);
  }

  dispose(): void {
    const geometries = new Set(this.meshes.map((m) => m.geometry));
    for (const m of this.meshes) m.dispose();
    for (const g of geometries) g.dispose();
  }
}

interface Faller {
  tree: number; // -1 when the slot is free
  t: number; // seconds since it broke
  dirX: number; dirZ: number; // the way it falls, on the ground plan
  rest: number; // how far over it ends up, radians from upright
  landed: boolean;
}

const placed = new THREE.Matrix4();
const shift = new THREE.Matrix4();
const tipping = new THREE.Matrix4();
const body = new THREE.Matrix4();
const at = new THREE.Vector3();
const axis = new THREE.Vector3();
const scale = new THREE.Vector3();
const turned = new THREE.Quaternion();
const fall = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const origin = new THREE.Vector3();
const seen = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const ball = new THREE.Sphere();
const eye = new THREE.Vector3();

export class TreeView {
  readonly group = new THREE.Group();
  // A tree has hit the ground: where its crown came down, for dust, needles and a thump.
  onLand: ((x: number, y: number, z: number) => void) | null = null;

  private count: number;
  private treeOf: Int32Array; // tree index per prop id, -1 for props that are not trees
  private matrices: Float32Array; // standing placement, 16 per tree
  private colors: Float32Array; // 3 per tree
  private shapes: Uint8Array;
  private yaws: Float32Array;
  private sizes: Float32Array; // height and width scale, 2 per tree
  private crowns: Float32Array; // crown bottom and top (world y) and radius, 3 per tree
  private fallYaws: Float32Array;
  private isFar: Uint8Array;
  private isBroken: Uint8Array;
  private near: TreeLayer[] = [];
  private far: TreeLayer | null = null;
  private stumps: TreeLayer | null = null;
  private falling: TreeLayer[] = [];
  private fallers: Faller[] = [];
  private fallMatrix = new Float32Array(16);
  private tops: number[]; // model height per shape
  private reach = 0;
  private nearSq: number;
  private farSq: number;

  constructor(private map: PlayMap, config: PropConfig, toon: Toon, private forest: ForestConfig, typeId = "pine") {
    const look = forest.pine;
    const type = config.types.findIndex((t) => t.id === typeId);
    const trees = type < 0 ? [] : map.props.filter((p) => p.type === type);
    this.count = trees.length;
    this.treeOf = new Int32Array(map.props.length).fill(-1);
    this.matrices = new Float32Array(this.count * 16);
    this.colors = new Float32Array(this.count * 3);
    this.shapes = new Uint8Array(this.count);
    this.yaws = new Float32Array(this.count);
    this.sizes = new Float32Array(this.count * 2);
    this.crowns = new Float32Array(this.count * 3);
    this.fallYaws = new Float32Array(this.count);
    this.isFar = new Uint8Array(this.count);
    this.isBroken = new Uint8Array(this.count);
    this.farSq = look.far.beyondMeters ** 2;
    this.nearSq = (look.far.beyondMeters - look.far.hysteresisMeters) ** 2;

    const models = look.shapes.map((_, s) => pineModel(look, s));
    this.tops = models.map((m) => m.top);
    const paints = look.colors.map((c) => new THREE.Color(toon.color(c.paint)));
    const height = type < 0 ? 0 : config.types[type]!.size[1];
    trees.forEach((p, i) => {
      const v = treeLook(look, map.seed, p.id);
      this.treeOf[p.id] = i;
      const baseY = p.y - height / 2;
      turned.setFromAxisAngle(up, v.yaw);
      placed.compose(at.set(p.x, baseY, p.z), turned, scale.set(v.width, v.height, v.width));
      placed.toArray(this.matrices, i * 16);
      paints[v.color]!.toArray(this.colors, i * 3);
      this.shapes[i] = v.shape;
      this.yaws[i] = v.yaw;
      this.sizes[i * 2] = v.height;
      this.sizes[i * 2 + 1] = v.width;
      const tiers = look.shapes[v.shape]!.tiers;
      this.crowns[i * 3] = baseY + Math.min(...tiers.map((t) => t.bottom)) * v.height;
      this.crowns[i * 3 + 1] = baseY + models[v.shape]!.top * v.height;
      this.crowns[i * 3 + 2] = Math.max(...tiers.map((t) => t.radius)) * v.width;
      this.fallYaws[i] = v.fallYaw;
    });
    if (this.count === 0) return;

    const color = (name: string) => toon.color(name);
    const fill = toon.ownMaterial("#ffffff");
    fill.vertexColors = true;
    // Trunks and stumps take no colour from their instance, crowns do: sharing one material between them made three
    // re-decide its shader program at every switch, each frame.
    const woodFill = toon.ownMaterial("#ffffff");
    woodFill.vertexColors = true;
    const fillFading = fading(fill);
    // White outlines, darkened like every outline and then tinted by each tree's colour in its instance.
    const outline = toon.instanced(toon.shellOutline("#ffffff"));
    const outlineFading = fading(outline);
    const woodOutline = toon.instanced(toon.shellOutline(look.trunk.paint));
    const scaleMax = Math.max(look.scale.height[1], look.scale.width[1]);
    for (const m of models) this.reach = Math.max(this.reach, reachOf([...m.wood, ...m.crown]) * scaleMax + 0.5);

    models.forEach((m, s) => {
      const perShape = this.shapes.filter((x) => x === s).length;
      if (perShape === 0) { this.near.push(new TreeLayer(0, [], false, "pine")); return; }
      this.near.push(new TreeLayer(perShape, [
        { geometry: partsGeometry(m.wood, color), fill: woodFill, outline: woodOutline, colored: false },
        { geometry: partsGeometry(m.crown, color), fill: fillFading, outline: outlineFading, colored: true },
      ], true, "pine"));
    });
    // No outline far away: past 140 m the outline is a fifth of a pixel wide, and drawing it doubled the far trees'
    // cost for nothing that shows.
    this.far = new TreeLayer(this.count, [{ geometry: partsGeometry(farPine(look), color), fill, outline: null, colored: true }], false, "far pine");
    this.stumps = new TreeLayer(this.count, [{ geometry: partsGeometry(stump(look), color), fill: woodFill, outline: woodOutline, colored: false }], false, "pine stump");
    const pool = Math.min(forest.fall.maxFalling, this.count);
    models.forEach((m) => {
      this.falling.push(new TreeLayer(pool, [
        { geometry: partsGeometry(m.wood, color), fill: woodFill, outline: woodOutline, colored: false },
        { geometry: partsGeometry(m.crown, color), fill, outline, colored: true },
      ], false, "falling pine"));
    });
    for (let i = 0; i < pool; i++) this.fallers.push({ tree: -1, t: 0, dirX: 1, dirZ: 0, rest: 0, landed: false });
    for (const layer of [...this.near, this.far, this.stumps, ...this.falling]) for (const mesh of layer.meshes) this.group.add(mesh);
    // Instances move, the meshes never do (freeze.ts).
    freeze(this.group);
  }

  // Whether this prop is one of the trees drawn here.
  has(propId: number): boolean {
    return (this.treeOf[propId] ?? -1) >= 0;
  }

  // A tree broke. It falls the way `direction` says (radians, as atan2(z, x)), or its own seeded way for NaN.
  // `quiet` leaves just the stump, for trees that fell before you joined.
  fell(propId: number, direction: number, quiet = false): void {
    const i = this.treeOf[propId] ?? -1;
    if (i < 0 || this.isBroken[i]) return;
    this.isBroken[i] = 1;
    if (quiet || this.fallers.length === 0) return;
    let slot = this.fallers.find((f) => f.tree < 0);
    if (!slot) slot = this.fallers.reduce((a, b) => (b.t > a.t ? b : a));
    const yaw = Number.isNaN(direction) ? this.fallYaws[i]! : direction;
    slot.tree = i;
    slot.t = 0;
    slot.landed = false;
    slot.dirX = Math.cos(yaw);
    slot.dirZ = Math.sin(yaw);
    const m = i * 16, x = this.matrices[m + 12]!, baseY = this.matrices[m + 13]!, z = this.matrices[m + 14]!;
    const stumpH = this.forest.pine.stump.heightMeters;
    const length = this.tops[this.shapes[i]!]! * this.sizes[i * 2]! - stumpH;
    const ground = this.map.terrain ? this.map.terrain.heightAt(x + slot.dirX * length, z + slot.dirZ * length) : baseY;
    slot.rest = restAngle(this.forest.fall, length, ground - (baseY + stumpH));
  }

  // Moves the falling trees on. Call once a frame.
  update(dt: number): void {
    if (this.fallers.length === 0) return;
    for (const layer of this.falling) layer.begin();
    const look = this.forest.fall, stumpH = this.forest.pine.stump.heightMeters;
    for (const f of this.fallers) {
      if (f.tree < 0) continue;
      f.t += dt;
      if (fallOver(look, f.t)) { f.tree = -1; continue; }
      const i = f.tree, m = i * 16;
      const x = this.matrices[m + 12]!, baseY = this.matrices[m + 13]!, z = this.matrices[m + 14]!;
      const angle = fallAngle(look, f.rest, f.t);
      // Turned about a level axis across the fall, through the top of the stump: up swings toward (dirX, dirZ).
      fall.setFromAxisAngle(axis.set(f.dirZ, 0, -f.dirX), angle);
      turned.setFromAxisAngle(up, this.yaws[i]!);
      body.compose(origin, turned, scale.set(this.sizes[i * 2 + 1]!, this.sizes[i * 2]!, this.sizes[i * 2 + 1]!));
      tipping.makeRotationFromQuaternion(fall).multiply(shift.makeTranslation(0, -stumpH, 0)).multiply(body);
      const e = tipping.elements;
      e[12]! += x; e[13]! += baseY + stumpH - sinkDepth(look, f.t); e[14]! += z;
      tipping.toArray(this.fallMatrix, 0);
      this.falling[this.shapes[i]!]!.put(i, this.fallMatrix, 0, this.colors, 1, true);
      if (!f.landed && f.t >= look.seconds) {
        f.landed = true;
        // Where the middle of the crown came down.
        const reach = (this.tops[this.shapes[i]!]! * this.sizes[i * 2]! - stumpH) * 0.55;
        this.onLand?.(x + f.dirX * Math.sin(f.rest) * reach, baseY + stumpH + Math.cos(f.rest) * reach, z + f.dirZ * Math.sin(f.rest) * reach);
      }
    }
    for (const layer of this.falling) layer.end();
  }

  // Packs the trees inside the camera's view into the layers. `focus` is what the camera looks at (its mech), so
  // crowns in the way can be stippled. Call each frame before drawing, once the camera has moved.
  cull(camera: THREE.Camera, focusX: number, focusY: number, focusZ: number): void {
    if (this.count === 0) return;
    camera.updateMatrixWorld();
    seen.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    eye.setFromMatrixPosition(camera.matrixWorld);
    const fade = this.forest.pine.fade;
    for (const layer of this.near) layer.begin();
    this.far!.begin();
    this.stumps!.begin();
    for (let i = 0; i < this.count; i++) {
      const m = i * 16;
      const x = this.matrices[m + 12]!, y = this.matrices[m + 13]!, z = this.matrices[m + 14]!;
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
      const isFar = drawnFar(this.isFar[i] === 1, dx * dx + dy * dy + dz * dz, this.nearSq, this.farSq);
      this.isFar[i] = isFar ? 1 : 0;
      ball.center.set(x, y, z);
      ball.radius = this.reach;
      if (!seen.intersectsSphere(ball)) continue;
      if (this.isBroken[i]) {
        if (!isFar) this.stumps!.put(i, this.matrices, m, this.colors, 1);
      } else if (isFar) {
        this.far!.put(i, this.matrices, m, this.colors, 1);
      } else {
        const c = i * 3;
        const f = crownFade(x, z, this.crowns[c]!, this.crowns[c + 1]!, this.crowns[c + 2]!, eye.x, eye.y, eye.z, focusX, focusY, focusZ, fade.marginMeters, fade.least);
        this.near[this.shapes[i]!]!.put(i, this.matrices, m, this.colors, f);
      }
    }
    for (const layer of this.near) layer.end();
    this.far!.end();
    this.stumps!.end();
  }

  dispose(): void {
    for (const layer of [...this.near, ...this.falling]) layer.dispose();
    this.far?.dispose();
    this.stumps?.dispose();
  }
}
