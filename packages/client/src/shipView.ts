import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { shipAt, shipEndsAt, type ShipPath } from "@rustbucket/shared";
import type { DiveConfig } from "./dive";
import { puff } from "./diveTrails";
import type { DropSprites } from "./fx/dropSprites";
import { addOutlineNormals } from "./outlineNormals";
import type { Toon } from "./toonMaterial";

// The Rustbucket (gate 16b): the huge rusty mothership that crosses the map on the server's line at the drop
// height, with every mech riding in its cannon bay until fired out. It is placed from the match clock and the line
// alone (shared drop.ts), so it needs no messages of its own; it keeps going past the end of its line and flies off.
// Engine exhaust is chunky inked smoke from every Mount_Engine_N. The model is the kit in data/shipKit.json; until
// it loads (or if it is missing) a grey-box stand-in of standIn's size is drawn, with the same mounts. The model is
// built nose to -z; dive.json turnDegrees turns it into this view's frame.
//
// The ship's frame: +z is its nose (glTF's forward), Mount_Bay is the middle of the rider slots, which is the path's
// point, and Mount_Cannon_Muzzle points out of the barrel along its own +z. The bay must be open below and ahead,
// as the camera sits in it while you ride.

const FLY_OFF_SECONDS = 40;

// The ship's entry in data/shipKit.json, as this view needs it: the file, each part's colour, and from how far each
// level of detail shows (0, then the kit's lodDistances).
export interface ShipLook { file: string; paint: Record<string, string>; lodMeters: number[] }

export function shipLook(kits: { lodDistances: number[]; kits: Record<string, { file: string; scheme: Record<string, string>; parts: Record<string, { paint: string }> }> }, id: string): ShipLook {
  const kit = kits.kits[id];
  if (!kit) throw new Error(`shipKit.json: no kit ${id}`);
  const paint: Record<string, string> = {};
  for (const [part, p] of Object.entries(kit.parts)) paint[part] = kit.scheme[p.paint] ?? p.paint;
  return { file: kit.file, paint, lodMeters: [0, ...kits.lodDistances] };
} // how long it stays drawn after throwing the last riders out, flying away

export class ShipView {
  readonly group = new THREE.Group(); // at the bay, turned along the line
  private body = new THREE.Group(); // the model, moved so its Mount_Bay is at the group's origin
  private muzzle: THREE.Object3D | null = null;
  private breech: THREE.Object3D | null = null; // with the muzzle, gives the barrel's direction
  private cameraMount: THREE.Object3D | null = null;
  private engines: THREE.Object3D[] = [];
  private path: ShipPath | null = null;
  private heading = 0;
  private at = { x: 0, z: 0 };
  private exhaustIn = 0;
  private point = new THREE.Vector3();
  private back = new THREE.Vector3();
  private turn = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(private toon: Toon, private sprites: DropSprites, private config: DiveConfig["ship"], private look: ShipLook) {
    this.group.add(this.body);
    this.group.visible = false;
    this.use(this.standIn());
  }

  // Loads the real model in the background; the stand-in stays if it cannot be read.
  async load(base = "/"): Promise<void> {
    try {
      const scene = (await new GLTFLoader().loadAsync(`${base}${this.look.file}`)).scene;
      this.use(this.toonify(scene), this.config.turnDegrees);
    } catch (error) {
      console.warn("The Rustbucket model could not be loaded, using the grey-box stand-in:", error);
    }
  }

  // This match's line, or null for none (the lobby, the range).
  setPath(path: ShipPath | null): void {
    this.path = path;
    if (path) this.heading = Math.atan2(path.x1 - path.x0, path.z1 - path.z0);
  }

  get line(): ShipPath | null {
    return this.path;
  }

  // Each frame, at match-clock `seconds` (negative through the countdown; not finite outside a match: hidden).
  update(seconds: number, dt: number): void {
    const p = this.path;
    this.group.visible = p !== null && Number.isFinite(seconds) && seconds < shipEndsAt(p) + FLY_OFF_SECONDS;
    if (!p || !this.group.visible) return;
    shipAt(p, seconds, this.at);
    this.group.position.set(this.at.x, p.y, this.at.z);
    this.group.rotation.set(0, this.heading, 0);
    this.group.updateMatrixWorld(true);
    this.exhaust(dt);
  }

  // Where the cannon's muzzle is in the world and which way it points, for the blast when someone is fired out.
  muzzleAt(position: THREE.Vector3, direction: THREE.Vector3): void {
    const m = this.muzzle ?? this.group;
    m.getWorldPosition(position);
    if (this.breech) {
      this.breech.getWorldPosition(this.back);
      direction.subVectors(position, this.back).normalize();
    } else {
      m.getWorldQuaternion(this.turn);
      direction.set(0, 0, 1).applyQuaternion(this.turn);
    }
  }

  // The view from the cannon bay while you ride: offset from bayCamera.mount, looking where you aim, so you look
  // down past the barrel at the map going by.
  bayView(camera: THREE.Camera, yaw: number, pitch: number): void {
    const c = this.config.bayCamera;
    // From the mount the data names (one with a clear view down past the barrel), else from the bay.
    (this.cameraMount ?? this.group).getWorldPosition(this.point);
    this.group.worldToLocal(this.point);
    this.point.x += c.side; this.point.y += c.up; this.point.z -= c.back;
    this.group.localToWorld(this.point);
    camera.position.copy(this.point);
    camera.quaternion.setFromEuler(this.euler.set(pitch, yaw, 0));
    camera.updateMatrixWorld();
  }

  private exhaust(dt: number): void {
    const e = this.config.exhaust;
    this.exhaustIn -= dt;
    if (this.exhaustIn > 0) return;
    this.exhaustIn = e.every;
    const back = -e.backSpeed;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    for (const engine of this.engines) {
      engine.getWorldPosition(this.point);
      const s = puff(this.sprites, this.point.x, this.point.y, this.point.z, e.width, e.grow, e.seconds, 0);
      if (s) { s.vx = sin * back; s.vz = cos * back; s.drag = 0.4; }
    }
  }

  // Swaps in a model, turned so its nose is +z (`turnDegrees`), and finds its mounts.
  private use(model: THREE.Object3D, turnDegrees = 0): void {
    this.body.clear();
    const turned = new THREE.Group();
    turned.rotation.y = turnDegrees * Math.PI / 180;
    turned.add(model);
    this.body.add(turned);
    this.body.position.set(0, 0, 0);
    this.group.updateMatrixWorld(true);
    const bay = model.getObjectByName("Mount_Bay");
    if (bay) {
      const p = new THREE.Vector3();
      bay.getWorldPosition(p);
      this.group.worldToLocal(p);
      this.body.position.copy(p).negate();
    }
    this.muzzle = model.getObjectByName("Mount_Cannon_Muzzle") ?? null;
    this.breech = model.getObjectByName("Mount_Cannon_Breech") ?? null;
    this.cameraMount = model.getObjectByName(this.config.bayCamera.mount) ?? null;
    this.engines = [];
    model.traverse((o) => { if (/^Mount_Engine_\d+$/.test(o.name)) this.engines.push(o); });
  }

  // Imported materials never ship (DESIGN.md asset intake): every part is painted its kit colour (by mesh name,
  // without its _LODn) as a vertex colour, and all parts are merged into one mesh per level of detail, drawn
  // with the master toon material and one ink outline: two draw calls for the whole ship instead of two a part. A
  // part's _LOD1 and _LOD2 meshes are its farther levels; a part without one keeps its nearer level.
  private toonify(scene: THREE.Object3D): THREE.Object3D {
    const root = new THREE.Group();
    const parts = new Map<string, THREE.Mesh[]>();
    for (const child of [...scene.children]) {
      if (!(child as THREE.Mesh).isMesh) { root.add(child); continue; } // the mounts
      const name = child.name.replace(/_LOD\d+$/, "");
      const level = Number(/_LOD(\d+)$/.exec(child.name)?.[1] ?? 0);
      const list = parts.get(name) ?? [];
      list[level] = child as THREE.Mesh;
      parts.set(name, list);
    }
    const { paint, lodMeters } = this.look;
    const material = this.toon.ownMaterial("#ffffff");
    material.vertexColors = true;
    const outline = this.toon.shellOutline(this.config.standIn.hull);
    const lod = new THREE.LOD();
    const color = new THREE.Color();
    for (let level = 0; level < lodMeters.length; level++) {
      const pieces: THREE.BufferGeometry[] = [];
      for (const [name, levels] of parts) {
        let mesh: THREE.Mesh | undefined;
        for (let l = level; l >= 0 && !mesh; l--) mesh = levels[l];
        if (!mesh) continue;
        color.set(this.toon.color(paint[name] ?? this.config.standIn.hull));
        pieces.push(painted(mesh, color));
      }
      const merged = mergeGeometries(pieces, false);
      if (!merged) throw new Error("the ship's parts could not be merged");
      addOutlineNormals(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.add(new THREE.Mesh(merged, outline));
      lod.addLevel(mesh, lodMeters[level]!);
    }
    root.add(lod);
    return root;
  }

  // The grey-box Rustbucket: a long hull with the cannon bay slung under its belly (a deck on struts, open on every
  // side so the camera in it sees the map), the barrel angled down and forward off the deck's front, a bridge on top,
  // four engines at the back and rust patches on the plating.
  private standIn(): THREE.Group {
    const s = this.config.standIn;
    const L = s.lengthMeters, W = s.widthMeters, H = s.heightMeters;
    const g = new THREE.Group();
    const box = (center: number[], size: number[], color: string, parent: THREE.Object3D = g) => this.toon.box(parent, center, size, color);
    const belly = 8; // the hull's underside, above the riders' deck
    box([0, belly + H / 2, -L * 0.05], [W, H, L * 0.9], s.hull);
    box([0, belly + H * 0.45, L * 0.45], [W * 0.7, H * 0.75, L * 0.1], s.hull); // the blunt nose
    box([0, belly + H + 4, L * 0.15], [W * 0.35, 8, L * 0.12], s.hull); // the bridge
    box([0, -0.6, 0], [W * 0.5, 1, 14], s.trim); // the deck the riders stand on
    for (const [x, z] of [[-W * 0.22, -6], [W * 0.22, -6], [-W * 0.22, 6], [W * 0.22, 6]] as const) box([x, belly / 2, z], [1.2, belly, 1.2], s.trim);
    box([W * 0.51, belly + H * 0.5, -L * 0.25], [0.6, H * 0.4, L * 0.12], s.patch);
    box([-W * 0.51, belly + H * 0.3, L * 0.2], [0.6, H * 0.3, L * 0.1], s.patch);
    box([W * 0.2, belly + H + 0.1, -L * 0.3], [W * 0.3, 0.6, L * 0.15], s.patch);

    const barrel = new THREE.Group();
    barrel.position.set(0, -0.5, 6);
    barrel.rotation.x = 35 * Math.PI / 180; // down and forward
    const length = H;
    box([0, 0, length / 2], [3.2, 3.2, length], s.barrel, barrel);
    box([0, 0, length - 1], [4.2, 4.2, 2], s.trim, barrel); // the muzzle's collar
    const muzzle = new THREE.Object3D();
    muzzle.name = "Mount_Cannon_Muzzle";
    muzzle.position.set(0, 0, length);
    barrel.add(muzzle);
    g.add(barrel);

    let n = 0;
    for (const [x, y] of [[-W * 0.35, H * 0.25], [W * 0.35, H * 0.25], [-W * 0.15, H * 0.7], [W * 0.15, H * 0.7]] as const) {
      box([x, belly + y, -L / 2 - 4], [7, 7, 8], s.trim);
      const mount = new THREE.Object3D();
      mount.name = `Mount_Engine_${n++}`;
      mount.position.set(x, belly + y, -L / 2 - 9);
      g.add(mount);
    }
    const bay = new THREE.Object3D();
    bay.name = "Mount_Bay";
    g.add(bay);
    return g;
  }
}

// One part as plain float corners in the model's frame, with its colour on every corner. The file stores corners as
// small whole numbers scaled up by the node (mesh quantization); the outline is pushed out in the mesh's own units,
// so that scale is baked in here, or the ink would be metres thick.
function painted(mesh: THREE.Mesh, color: THREE.Color): THREE.BufferGeometry {
  mesh.updateMatrix();
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal"] as const) {
    const a = source.getAttribute(name);
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
    g.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  g.applyMatrix4(mesh.matrix);
  const colors = new Float32Array(g.attributes.position!.count * 3);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}
