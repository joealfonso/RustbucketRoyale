import * as THREE from "three";
import { toGeometry } from "../dressing/dressing";
import { container } from "../dressing/container";
import type { DressPiece } from "../dressing/kinds";
import { ruin } from "../dressing/ruin";
import { sheet } from "../dressing/sheet";
import { crate } from "../props/crate";
import type { Toon } from "../toonMaterial";
import type { PaintKit } from "./paintKit";
import type { SurfaceKind } from "./paintLook";

// The style page's paint row (key 9, gate V7b): plain map boxes, dressing, a crate and a roster mech, in the game's own
// painted materials. P switches the paint off and on everywhere on the page, to compare.

const ROW_X = -60, ROW_Z = 0;
const VIEWS = [{ name: "close", distance: 3.5 }, { name: "10 m", distance: 10 }, { name: "50 m", distance: 50 }] as const;

interface Item { name: string; x: number; height: number }

export class PaintPreview {
  private items: Item[] = [];
  private painted = true;
  private focus = 0;
  private view = 1;

  constructor(scene: THREE.Scene, private toon: Toon, private kit: PaintKit, mech: THREE.Object3D | null) {
    const at = (x: number) => ROW_X + x;
    this.plainBox(scene, "container, plain map box", at(0), [6, 2.6, 2.4], "rustOrange", "metal");
    this.dressed(scene, "container, dressing", at(8), [6, 2.6, 2.4], "rustOrange", (b) => container(b), () => "metal");
    this.dressed(scene, "sheet wall, dressing", at(15), [4, 3, 0.4], "scrapSteel", (b) => sheet(b), () => "metal");
    this.dressed(scene, "ruin, dressing", at(21.5), [5, 3, 1], "warmLight", (b) => ruin(b), (_p, i) => (i === 1 ? "metal" : "concrete"));
    this.plainBox(scene, "concrete, plain map box", at(27.5), [3, 2, 2], "scrapSteel", "concrete");
    const crateSize: [number, number, number] = [2, 2, 2];
    this.pieces(scene, "crate prop", at(32), crateSize[1], crate(crateSize, 3).intact, (p) => (p.paint === "sparkYellow" ? "metal" : "wood"), new THREE.Vector3(at(32), 0, ROW_Z));
    this.plainBox(scene, "planks, plain map box", at(35.5), [1.6, 1.6, 1.6], "rustOrange", "wood");
    if (mech) {
      mech.position.set(at(40), 0, ROW_Z);
      mech.rotation.y = 0;
      scene.add(mech);
      this.items.push({ name: "roster mech", x: at(40), height: 4 });
    }
  }

  togglePaint(): void {
    this.painted = !this.painted;
    this.kit.setShown(this.painted);
  }

  nextView(): void {
    this.view = (this.view + 1) % VIEWS.length;
  }

  nextItem(): void {
    this.focus = (this.focus + 1) % this.items.length;
  }

  // Puts the camera on the focused item (or the middle of the row at 50 m) and returns the label.
  place(camera: THREE.PerspectiveCamera, turn: number): string {
    const view = VIEWS[this.view]!;
    const item = this.items[this.focus]!;
    const far = this.view === VIEWS.length - 1;
    const middle = (this.items[0]!.x + this.items[this.items.length - 1]!.x) / 2;
    const target = new THREE.Vector3(far ? middle : item.x, far ? 1 : item.height * 0.5, ROW_Z);
    const d = view.distance;
    camera.position.set(target.x + Math.sin(turn - 0.6) * d, target.y + (far ? d * 0.25 : Math.min(2, d * 0.2)), target.z + Math.cos(turn - 0.6) * d);
    camera.lookAt(target);
    const k = this.kit;
    return `Paint (V7b) · ${far ? "the whole row" : item.name}, ${view.name} · 9: close / 10 m / 50 m · 0: next thing · P: paint ${this.painted ? "on" : "off"} · Q / E: turn · atlas ${k.look.tileSize}² × ${k.texture.image.depth} layers, ${(k.bytes / 1048576).toFixed(1)} MB, built in ${k.buildMs.toFixed(0)} ms · 1 / 2 / 3: back`;
  }

  // A map box as the game draws it: the unit box scaled, the world material with paint chipped at its edges, a hull outline.
  private plainBox(scene: THREE.Scene, name: string, x: number, size: [number, number, number], color: string, kind: SurfaceKind): void {
    this.toon.box(scene, [x, size[1] / 2, ROW_Z], size, color, this.toon.world(color, kind, true));
    this.items.push({ name, x, height: size[1] });
  }

  private dressed(scene: THREE.Scene, name: string, x: number, size: [number, number, number], color: string, build: (b: { min: [number, number, number]; max: [number, number, number]; seed: number; color: string }) => DressPiece[], kindOf: (p: DressPiece, i: number) => SurfaceKind): void {
    const min: [number, number, number] = [x - size[0] / 2, 0, ROW_Z - size[2] / 2], max: [number, number, number] = [x + size[0] / 2, size[1], ROW_Z + size[2] / 2];
    this.pieces(scene, name, x, size[1], build({ min, max, seed: 11, color }), kindOf, null);
  }

  private pieces(scene: THREE.Scene, name: string, x: number, height: number, pieces: DressPiece[], kindOf: (p: DressPiece, i: number) => SurfaceKind, position: THREE.Vector3 | null): void {
    pieces.forEach((p, i) => {
      const geometry = toGeometry([p.mesh]);
      const mesh = new THREE.Mesh(geometry, this.toon.world(p.paint, kindOf(p, i))), hull = new THREE.Mesh(geometry, this.toon.shellOutline(p.paint));
      if (position) { mesh.position.copy(position); hull.position.copy(position); }
      scene.add(mesh, hull);
    });
    this.items.push({ name, x, height });
  }
}
