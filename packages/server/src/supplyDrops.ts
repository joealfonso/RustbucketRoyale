import { createRingNow, navCell, raised, ringAt, type DropsConfig, type NavGrid, type RingSchedule, type SupplyDrop, type World } from "@rustbucket/shared";

// Where this match's supply drops land: inside the ring as it will be at landing time, near its middle, on open dry
// ground with nothing standing close, so the crate is reachable and the fight round it has room. A drop with no
// such spot after a few tries is left out rather than dropped into a wall.

const TRIES = 200; // outcrops leave fewer open spots, and planning runs once a match
const FLAT_STEP = 0.6; // metres of rise between neighbouring cells that still counts as open ground

export function planDrops(config: DropsConfig, tier: string, ring: RingSchedule, map: { world: World; nav: NavGrid; meters: number }, random: () => number): SupplyDrop[] {
  const times = config.landSeconds[tier];
  if (!times) return [];
  const circle = createRingNow();
  const drops: SupplyDrop[] = [];
  for (const landAt of times) {
    ringAt(ring, landAt, circle);
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * circle.radius * config.placeShareOfRing;
      const x = circle.cx + Math.cos(angle) * distance, z = circle.cz + Math.sin(angle) * distance;
      if (!openGround(map, x, z, config.clearMeters)) continue;
      drops.push({ x, y: map.world.terrain?.heightAt(x, z) ?? 0, z, landAt });
      break;
    }
  }
  return drops;
}

// Bare, dry and roughly level for `clear` metres all round: no box raised off the ground in any nav cell there.
// The Junk Titan wakes up on such a spot too.
export function openGround(map: { world: World; nav: NavGrid; meters: number }, x: number, z: number, clear: number): boolean {
  const half = map.meters / 2 - clear;
  if (Math.abs(x) > half || Math.abs(z) > half) return false;
  const terrain = map.world.terrain;
  if (terrain && terrain.waterDepthAt(x, z) > 0) return false;
  const nav = map.nav;
  const middle = navCell(nav, x, z);
  if (middle < 0) return false;
  const reach = Math.ceil(clear / nav.cell);
  const col = middle % nav.cols, row = Math.floor(middle / nav.cols);
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const c = col + dx, r = row + dz;
      if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return false;
      const i = r * nav.cols + c;
      if (raised(nav, i) > 0.05 || Math.abs(nav.ground[i]! - nav.ground[middle]!) > FLAT_STEP * Math.max(1, Math.hypot(dx, dz))) return false;
      if (terrain && terrain.waterDepthAt(nav.originX + (c + 0.5) * nav.cell, nav.originZ + (r + 0.5) * nav.cell) > 0) return false;
    }
  }
  return true;
}
