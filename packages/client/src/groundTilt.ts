import type { Terrain } from "@rustbucket/shared";

// Marks that lie on the ground (scorches, shockwave rings, contact shadows, mortar warnings) are flat shapes. On the
// hills they must lean with the slope, or half of a big one sinks into the hillside and the other half floats.

// A mark this close above the hills is lying on them; anything higher is on a roof or a box top, which is level.
const ON_HILLS_METERS = 0.25;

// Whether something at height `y` over (x, z) is lying on the hills rather than on a box.
export function onHills(terrain: Terrain | null, x: number, z: number, y: number): boolean {
  return terrain !== null && Math.abs(y - terrain.heightAt(x, z)) < ON_HILLS_METERS;
}

// The slope under a mark at height `y` over (x, z), as metres of rise per metre along x and along z. Level (0, 0)
// off the hills. `out` is reused, so this allocates nothing.
export function groundTilt(terrain: Terrain | null, x: number, z: number, y: number, out: { x: number; z: number }, normal: number[]): void {
  out.x = 0; out.z = 0;
  if (!terrain || !onHills(terrain, x, z, y)) return;
  terrain.normalAt(x, z, normal);
  out.x = -normal[0]! / normal[1]!;
  out.z = -normal[2]! / normal[1]!;
}
