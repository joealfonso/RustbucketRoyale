import { SeededRng } from "./generation/SeededRng";
import { navCell, raised, type NavGrid } from "./generation/navGrid";
import { createRayHit, type World } from "./world";

// How open a map is (gate 15a): of random pairs of open-ground spots `minMeters` to `maxMeters` apart, the share that
// can see each other at a mech's eye height. A long clear line is where a sniper wins and everyone else just crosses
// it; hills, rocks and buildings in the way are what make a yard to walk round. Used by the tests and
// scripts/measure-sightlines.ts, never by the game.

export interface SightlineOptions {
  pairs: number;
  minMeters: number;
  maxMeters: number;
  eyeMeters: number;
}

export const SIGHTLINES: SightlineOptions = { pairs: 1500, minMeters: 100, maxMeters: 250, eyeMeters: 3 };

export function longSightShare(map: { world: World; nav: NavGrid; meters: number }, seed: number, options: SightlineOptions = SIGHTLINES): number {
  const rng = new SeededRng(seed);
  const hit = createRayHit();
  const half = map.meters / 2 - 5;
  const spot = (): [number, number] | null => {
    for (let tries = 0; tries < 50; tries++) {
      const x = -half + rng.nextInt(Math.floor(half * 2)), z = -half + rng.nextInt(Math.floor(half * 2));
      const cell = navCell(map.nav, x, z);
      if (cell >= 0 && raised(map.nav, cell) < 0.05) return [x, z];
    }
    return null;
  };
  const groundAt = (x: number, z: number) => (map.world.terrain ? map.world.terrain.heightAt(x, z) : 0);
  let seen = 0, counted = 0;
  for (let i = 0; i < options.pairs * 20 && counted < options.pairs; i++) {
    const a = spot(), b = spot();
    if (!a || !b) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const flat = Math.hypot(dx, dz);
    if (flat < options.minMeters || flat > options.maxMeters) continue;
    const ay = groundAt(a[0], a[1]) + options.eyeMeters, by = groundAt(b[0], b[1]) + options.eyeMeters;
    const dy = by - ay;
    const length = Math.hypot(dx, dy, dz);
    counted++;
    if (!map.world.raycast(a[0], ay, a[1], dx / length, dy / length, dz / length, length, hit)) seen++;
  }
  return counted ? seen / counted : 0;
}
