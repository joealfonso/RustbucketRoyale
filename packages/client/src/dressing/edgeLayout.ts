import type { Box } from "@rustbucket/shared";
import type { V3 } from "./shapes";

// Where the junkyard perimeter goes: the map's four edge walls cut into runs, bays and chunks. Pure numbers, no
// three.js, so the counts and the seeds can be tested.

export interface BarrierConfig {
  bayMeters: number; // one bay is one stretch of wall built from one seed; runs are cut into whole bays
  baysPerChunk: number; // bays built and swapped between near and far detail together
  nearMeters: number; // chunks closer than this to the camera get the full model, the rest the cheap far one
  recheckMeters: number; // the camera must move this far before near and far are decided again
  buildAtOnce: number; // more unbuilt near chunks than this (a spectator cut) are built one per frame
  panelMeters: number; // between posts; each gap holds two columns of sheets so a seam shows between them
  sheetMeters: [number, number]; // each sheet's height is picked in this range, so seams never line up into rows
  girderEveryMeters: number;
  seam: number;
  coreDepth: number; // the solid back of the wall, from its outer face, so nothing is ever see-through
  sheetDepth: number;
  ribDepth: number;
  ribWidth: number;
  ribSpacing: number;
  ribBandMeters: number; // sheets this far above the containers get corrugation: that is where eyes are
  patchChance: number;
  columnRepaintChance: number; // a sheet that is not its column's usual paint, a later replacement
  patchDepth: number;
  postWidth: number;
  postDepth: number;
  girderHeight: number;
  girderDepth: number;
  corePaint: string;
  steelPaint: string;
  panelPaints: string[];
  patchPaints: string[];
  container: {
    length: number; height: number; depth: number; stackChance: number; maxStack: number; offsetChance: number;
    ribSpacing: number; ribDepth: number; frame: number; paints: string[];
  };
  fence: { height: number; postSpacing: number; postSize: number; strands: number; strandSize: number; armLength: number; paint: string };
}

export function parseBarrier(raw: unknown): BarrierConfig {
  const c = raw as BarrierConfig;
  const numbers = (o: object, label: string, keys: string[]) => {
    for (const k of keys) if (typeof (o as Record<string, unknown>)[k] !== "number") throw new Error(`backdrop.json: ${label}.${k} must be a number`);
  };
  numbers(c ?? {}, "barrier", ["bayMeters", "baysPerChunk", "nearMeters", "recheckMeters", "buildAtOnce", "panelMeters", "girderEveryMeters", "seam", "coreDepth", "sheetDepth",
    "ribDepth", "ribWidth", "ribSpacing", "ribBandMeters", "patchChance", "columnRepaintChance", "patchDepth", "postWidth", "postDepth", "girderHeight", "girderDepth"]);
  numbers(c.container ?? {}, "barrier.container", ["length", "height", "depth", "stackChance", "maxStack", "offsetChance", "ribSpacing", "ribDepth", "frame"]);
  numbers(c.fence ?? {}, "barrier.fence", ["height", "postSpacing", "postSize", "strands", "strandSize", "armLength"]);
  if (!Array.isArray(c.sheetMeters) || !(c.sheetMeters[0] > 0) || !(c.sheetMeters[1] >= c.sheetMeters[0])) throw new Error("backdrop.json: barrier.sheetMeters must be [low, high]");
  for (const list of [c.panelPaints, c.patchPaints, c.container.paints]) {
    if (!Array.isArray(list) || list.length === 0) throw new Error("backdrop.json: barrier paint lists must not be empty");
  }
  return c;
}

// One edge wall seen from inside the map: u runs along it, w goes from its outer face (0) to the face you see (its
// thickness), y is up from its foot. `yaw` turns that frame into the world and `origin` is where u = w = y = 0 lands.
export interface EdgeRun {
  box: number;
  length: number;
  height: number;
  thickness: number;
  yaw: number;
  origin: V3;
  bays: number;
  bayLength: number;
}

export interface EdgeChunk {
  run: number;
  firstBay: number;
  bayCount: number;
  // The chunk's footprint in the world, for deciding how near the camera is.
  minX: number; maxX: number; minZ: number; maxZ: number; height: number;
}

// The edge walls are the boxes lying wholly outside the playable square.
export function edgeBoxIndices(boxes: readonly Box[], meters: number): number[] {
  const half = meters / 2 - 0.01;
  const out: number[] = [];
  boxes.forEach((b, i) => {
    if (b.minX >= half || b.maxX <= -half || b.minZ >= half || b.maxZ <= -half) out.push(i);
  });
  return out;
}

export function edgeRuns(boxes: readonly Box[], indices: readonly number[], bayMeters: number): EdgeRun[] {
  return indices.map((i) => {
    const b = boxes[i]!;
    const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const length = alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
    const thickness = alongX ? b.maxZ - b.minZ : b.maxX - b.minX;
    // The four ways round, chosen so u along the wall and w into the map stay a right-handed frame with y.
    let yaw: number, origin: V3;
    if (alongX) {
      if (cz < 0) { yaw = 0; origin = [b.minX, b.minY, b.minZ]; } // faces +z
      else { yaw = Math.PI; origin = [b.maxX, b.minY, b.maxZ]; } // faces -z
    } else if (cx < 0) { yaw = Math.PI / 2; origin = [b.minX, b.minY, b.maxZ]; } // faces +x
    else { yaw = -Math.PI / 2; origin = [b.maxX, b.minY, b.minZ]; } // faces -x
    const bays = Math.max(1, Math.round(length / bayMeters));
    return { box: i, length, height: b.maxY - b.minY, thickness, yaw, origin, bays, bayLength: length / bays };
  });
}

// A point in a run's frame, in the world.
export function runToWorld(run: EdgeRun, u: number, y: number, w: number): V3 {
  const c = Math.cos(run.yaw), s = Math.sin(run.yaw);
  return [run.origin[0] + u * c + w * s, run.origin[1] + y, run.origin[2] - u * s + w * c];
}

export function edgeChunks(runs: readonly EdgeRun[], baysPerChunk: number): EdgeChunk[] {
  const chunks: EdgeChunk[] = [];
  runs.forEach((run, r) => {
    for (let first = 0; first < run.bays; first += baysPerChunk) {
      const bayCount = Math.min(baysPerChunk, run.bays - first);
      const a = runToWorld(run, first * run.bayLength, 0, 0);
      const b = runToWorld(run, (first + bayCount) * run.bayLength, 0, run.thickness);
      chunks.push({
        run: r, firstBay: first, bayCount, height: run.height,
        minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]),
      });
    }
  });
  return chunks;
}

// How far a point is from a chunk's footprint (zero inside it), counting height above the wall too.
export function distanceToChunk(chunk: EdgeChunk, x: number, y: number, z: number): number {
  const dx = Math.max(chunk.minX - x, 0, x - chunk.maxX);
  const dz = Math.max(chunk.minZ - z, 0, z - chunk.maxZ);
  const dy = Math.max(0, y - chunk.height);
  return Math.hypot(dx, dy, dz);
}
