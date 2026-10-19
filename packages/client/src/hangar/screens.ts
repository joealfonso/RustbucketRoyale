import * as THREE from "three";
import type { LoadedKit } from "../mechKit";
import type { Toon } from "../toonMaterial";
import type { HangarConfig, ScreenSpot } from "./layout";

// Holographic schematic displays (MECH_ROSTER.md, The hangar; allowed in the hangar only by DESIGN.md): a see-through
// blue pane in a thin housing, a measuring grid, and a mech drawn as a wireframe of its edges turning slowly,
// flattened onto the pane. Lit lines added over the pane, no bloom pass.

const FLAT = 0.002; // how thick the flattened schematic is, in the screen's depth

// A mech's schematic: the hard edges of every part at its simplest level of detail, as one set of line segments,
// moved so its middle sits on the origin. Null for a mech whose kit did not load.
export function schematicOf(kit: LoadedKit | null): THREE.BufferGeometry | null {
  if (!kit) return null;
  const chunks: Float32Array[] = [];
  for (const part of kit.parts) {
    const lods = part.states[0]?.lods;
    const simplest = lods?.[lods.length - 1];
    if (!simplest) continue;
    const edges = new THREE.EdgesGeometry(simplest, 30);
    chunks.push(edges.attributes.position!.array as Float32Array);
    edges.dispose();
  }
  const positions = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { positions.set(c, at); at += c.length; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  const middle = geometry.boundingBox!.getCenter(new THREE.Vector3());
  geometry.translate(-middle.x, -middle.y, -middle.z);
  geometry.computeBoundingBox();
  return geometry;
}

export class Screen {
  readonly group = new THREE.Group();
  private spin = new THREE.Group();
  private lines: THREE.LineSegments | null = null;

  constructor(readonly spot: ScreenSpot, private c: HangarConfig["screen"], toon: Toon, private lineMaterial: THREE.LineBasicMaterial, dimMaterial: THREE.LineBasicMaterial) {
    const [w, h] = spot.size;
    const frame = c.frame;
    this.group.position.set(...spot.center);
    this.group.rotation.y = THREE.MathUtils.degToRad(spot.turnDegrees);
    // A thin frame round the pane, open in the middle so the pane shows what is behind it.
    for (const [x, y, sx, sy] of [[0, h / 2 + frame / 2, w + frame * 2, frame], [0, -h / 2 - frame / 2, w + frame * 2, frame], [-w / 2 - frame / 2, 0, frame, h], [w / 2 + frame / 2, 0, frame, h]] as const) {
      toon.box(this.group, [x, y, -0.05], [sx, sy, 0.1], "soot");
    }
    if (spot.stand) {
      // A console: a desk at working height under the screen, on a post bolted to the deck.
      const bottom = spot.center[1] - h / 2 - frame;
      toon.box(this.group, [0, -h / 2 - frame - (bottom - 1) / 2, -0.25], [0.25, bottom - 1, 0.25], "frameNavy");
      toon.box(this.group, [0, 1 - spot.center[1] - 0.5, -0.1], [0.3, 1, 0.3], "frameNavy");
      toon.box(this.group, [0, 1 - spot.center[1] + 0.05, 0.1], [w * 0.9, 0.1, 0.6], "soot");
      toon.box(this.group, [0, -spot.center[1] + 0.05, -0.1], [0.8, 0.1, 0.8], "soot");
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c.glass, fog: false, transparent: true, opacity: c.glassOpacity, depthWrite: false }));
    glass.position.z = 0.005;
    this.group.add(glass);
    // The measuring grid: a border and a few evenly spaced lines each way.
    const grid: number[] = [];
    const n = c.gridLines;
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + (w * i) / n, y = -h / 2 + (h * i) / n;
      grid.push(x, -h / 2, 0, x, h / 2, 0, -w / 2, y, 0, w / 2, y, 0);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
    const gridLines = new THREE.LineSegments(gridGeometry, dimMaterial);
    gridLines.position.z = 0.01;
    // The schematic turns inside a group squashed flat against the glass, so it reads as a drawing, not a model.
    const flat = new THREE.Group();
    flat.position.z = 0.02;
    flat.scale.z = FLAT;
    flat.add(this.spin);
    this.group.add(gridLines, flat);
  }

  // Shows this mech's schematic, scaled to fill the screen whichever way it is turned.
  show(schematic: THREE.BufferGeometry | null): void {
    if (this.lines) this.spin.remove(this.lines);
    this.lines = null;
    if (!schematic) return;
    const b = schematic.boundingBox!;
    const across = Math.max(Math.hypot(b.max.x, b.max.z), Math.hypot(b.min.x, b.min.z)) * 2;
    const [w, h] = this.spot.size;
    const scale = this.c.fill * Math.min(w / across, h / (b.max.y - b.min.y));
    this.lines = new THREE.LineSegments(schematic, this.lineMaterial);
    this.lines.scale.setScalar(scale);
    this.spin.add(this.lines);
  }

  update(seconds: number): void {
    this.spin.rotation.y = (seconds / this.c.spinSeconds) * Math.PI * 2;
  }
}
