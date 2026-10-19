// Times the junkyard dressing and edge barrier per frame outside the browser, on a real map with the real builders:
// a walk across the map (the steady cost) and spectator camera jumps between far apart mechs (the worst frame).
// npx tsx scripts/measure-dressing.ts [tier] [seed]
import * as THREE from "three";
import mechJson from "../data/mech.json";
import paletteJson from "../data/palette.json";
import lookJson from "../data/look.json";
import dressingJson from "../data/dressing.json";
import backdropJson from "../data/backdrop.json";
import chunksJson from "../data/chunks.json";
import { parseMechStats } from "@rustbucket/shared";
import { buildPlayMap } from "../packages/client/src/loadMap";
import { MapMeshes } from "../packages/client/src/mapRenderer";
import { Toon, parseLook, parsePalette } from "../packages/client/src/toonMaterial";
import { BUILDERS, Dressing, scatter } from "../packages/client/src/dressing";
import { EdgeBarrier } from "../packages/client/src/dressing/edgeBarrier";
import { parseBarrier } from "../packages/client/src/dressing/edgeLayout";

const tier = process.argv[2] ?? "large";
const seed = Number(process.argv[3] ?? 7);
const map = buildPlayMap(tier, seed, parseMechStats(mechJson));
const scene = new THREE.Scene();
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
const meshes = new MapMeshes(scene, map, toon);
const dressing = new Dressing(scene, toon, map, meshes, BUILDERS, scatter, { ...dressingJson, chunkMeters: chunksJson.size });
const barrier = new EdgeBarrier(scene, toon, map, meshes, parseBarrier(backdropJson.barrier));
const camera = new THREE.Vector3();

const barrierMs: number[] = [];

function frame(x: number, z: number): number {
  const start = performance.now();
  camera.set(x, 6, z);
  dressing.update(x, z);
  const mid = performance.now();
  barrier.update(camera);
  const end = performance.now();
  barrierMs.push(end - mid);
  return end - start;
}

function summary(label: string, times: number[]): void {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.toFixed(2);
  console.log(`${label.padEnd(44)} frames ${String(times.length).padStart(5)}  median ${at(0.5)}  p99 ${at(0.99)}  worst ${sorted.at(-1)!.toFixed(2)} ms`);
}

const half = map.meters / 2;
const spawn = frame(0, 0);
console.log(`${tier} seed ${seed}: first build at the centre ${spawn.toFixed(1)} ms`);

// A sprint (16 m/s at 60 fps) from one corner to the opposite one, near the edge wall at both ends.
const walk: number[] = [];
frame(-half * 0.95, -half * 0.95); // getting there is a jump, timed below
for (let i = 0; i < 300; i++) frame(-half * 0.95, -half * 0.95);
const steps = Math.floor((map.meters * 0.95 * Math.SQRT2) / (16 / 60));
for (let i = 0; i < steps; i++) {
  const t = i / steps;
  walk.push(frame(-half * 0.95 + t * map.meters * 0.95, -half * 0.95 + t * map.meters * 0.95));
}
summary("sprint corner to corner", walk);

// Spectating: the camera cuts to a mech somewhere else every 3 s, near the wall half the time. Positions are fixed so
// runs compare; the world is not random here.
const spots: [number, number][] = [[0.8, 0.1], [-0.7, -0.6], [0.2, -0.9], [-0.9, 0.7], [0.5, 0.5], [-0.2, 0.92], [0.93, -0.4], [-0.5, 0.1]];
const jumps: number[] = [];
const jumpFrames: number[] = [];
for (const [fx, fz] of spots) {
  for (let i = 0; i < 180; i++) {
    const ms = frame(fx * half + i * 0.05, fz * half);
    jumps.push(ms);
    if (i === 0) jumpFrames.push(ms);
  }
}
summary("spectator cuts, every frame", jumps);
summary("spectator cuts, the frame of the cut", jumpFrames);
summary("edge barrier alone, every frame above", barrierMs);
