import { World, type Box } from "../world";
import { Terrain } from "../terrain";
import { cornersFor, floodBed, noiseHeights, padHeights, shapeTerrain, valueNoise, waterLevelFor, type Rect } from "./terrainGen";
import { islandCoast, onLand, reachOf, shapeShore } from "./islandGen";
import { addProp, type PropConfig, type PropInstance } from "../props";
import { orient, type ChunkSet } from "./chunks";
import { buildNavGrid, floodFill, navCell, raised, type NavGrid, type NavParams } from "./navGrid";
import { SeededRng, deriveSeed } from "./SeededRng";
import type { TierSet } from "./tiers";

export interface GeneratedMap {
  seed: number; // the seed asked for
  usedSeed: number; // the seed that passed validation, after any retries
  attempts: number;
  tier: string;
  meters: number;
  boxes: Box[];
  colors: number[]; // palette index of each box
  palette: string[];
  kinds: Int8Array; // what each box is dressed as, an index into kindNames, or -1 (ground, edge walls, props)
  kindNames: string[];
  spawns: [number, number, number][];
  props: PropInstance[];
  propOfBox: Int32Array; // for each box, the prop it belongs to, or -1
  world: World;
  nav: NavGrid;
  terrain: Terrain; // the hills; flat when tiers.json has no terrain section
}

export interface MechSize {
  halfWidth: number;
  height: number;
  stepHeight: number;
}

export interface ValidationReport {
  ok: boolean;
  problems: string[];
  connectedFraction: number;
}

// Builds one map from one seed, with no checks. Deterministic: same inputs, same output, on any machine.
// Placement decisions are integer only; the box numbers that come out are sums of exact values.
function build(seed: number, tier: string, chunks: ChunkSet, tiers: TierSet, propConfig: PropConfig): Omit<GeneratedMap, "seed" | "usedSeed" | "attempts" | "world" | "nav"> {
  const settings = tiers.terrain;
  const def = tiers.tiers[tier];
  if (!def) throw new Error(`Unknown tier "${tier}"`);
  if (def.meters % chunks.size !== 0) throw new Error(`Tier ${tier}: ${def.meters} m is not a whole number of ${chunks.size} m chunks`);

  const rng = new SeededRng(seed);
  const n = def.meters / chunks.size;
  const half = def.meters / 2;
  const templates = chunks.templates;
  const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0);

  // An island's coastline comes first: chunks, props and spawns are kept off the sea and the beach.
  const island = settings?.tiers[tier]?.island ?? null;
  const cellMeters = settings?.cellMeters ?? chunks.size;
  const coast = island ? islandCoast(seed, def.meters, cellMeters, island) : null;
  const inland = island ? Math.round(island.buildInlandMeters * 100) : 0;
  const ashore = (minX: number, minZ: number, maxX: number, maxZ: number) => !coast || onLand(coast, def.meters, cellMeters, minX, minZ, maxX, maxZ, inland);

  const pick = (): number => {
    let r = rng.nextInt(totalWeight);
    for (let i = 0; i < templates.length; i++) {
      r -= templates[i]!.weight;
      if (r < 0) return i;
    }
    return 0;
  };

  // Choose a chunk for each cell. Two big solid chunks never touch edge to edge, so there is always a way round.
  const grid = new Int32Array(n * n);
  const turnsOf = new Uint8Array(n * n);
  const mirrorOf = new Uint8Array(n * n);
  const open = templates.findIndex((t) => t.boxes.length === 0);
  if (coast && open < 0) throw new Error("chunks.json: an island needs an open chunk with no boxes for its shore");
  const padMargin = settings?.padMarginMeters ?? 0;
  const oriented = { center: [0, 0, 0] as [number, number, number], size: [0, 0, 0] as [number, number, number] };
  // Whether every box of a chunk, with the level ground round it, stands far enough inland.
  const chunkAshore = (cell: number) => {
    const x = cell % n, z = (cell - x) / n;
    return templates[grid[cell]!]!.boxes.every((b) => {
      orient(b, chunks.size, turnsOf[cell]!, mirrorOf[cell] === 1, oriented);
      const cx = x * chunks.size - half + oriented.center[0], cz = z * chunks.size - half + oriented.center[2];
      return ashore(cx - oriented.size[0] / 2 - padMargin, cz - oriented.size[2] / 2 - padMargin, cx + oriented.size[0] / 2 + padMargin, cz + oriented.size[2] / 2 + padMargin);
    });
  };
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      let choice = pick();
      for (let tries = 0; tries < 4 && templates[choice]!.dense; tries++) {
        const left = x > 0 && templates[grid[z * n + x - 1]!]!.dense;
        const up = z > 0 && templates[grid[(z - 1) * n + x]!]!.dense;
        if (!left && !up) break;
        choice = pick();
      }
      if (templates[choice]!.dense) {
        const left = x > 0 && templates[grid[z * n + x - 1]!]!.dense;
        const up = z > 0 && templates[grid[(z - 1) * n + x]!]!.dense;
        if (left || up) choice = templates.findIndex((t) => !t.dense);
      }
      grid[z * n + x] = choice;
      turnsOf[z * n + x] = rng.nextInt(4);
      mirrorOf[z * n + x] = rng.nextInt(2);
      // On an island a chunk whose buildings would reach the beach or the sea is swapped for one that fits, and failing
      // that for open ground, never a dense one, so the rule above still holds.
      if (coast && !chunkAshore(z * n + x)) {
        grid[z * n + x] = open;
        for (let tries = 0; tries < ISLAND_REPICKS; tries++) {
          const other = pick();
          if (templates[other]!.dense) continue;
          grid[z * n + x] = other;
          if (chunkAshore(z * n + x)) break;
          grid[z * n + x] = open;
        }
      }
    }
  }

  const palette = [tiers.groundColor, ...chunks.palette];
  const boxKind: number[] = []; // visual only: never read by any placement decision
  const boxes: Box[] = [];
  const colors: number[] = [];
  const add = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number) => {
    boxes.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 });
    colors.push(color);
  };

  // The ground and a tall wall round the edge, so nobody walks off the map. The ground slab is a floor under the
  // lowest valley, so nothing can ever fall out of the world; it is moved down once the hills are known.
  const margin = tiers.edgeWallThickness;
  add(0, -0.5, 0, def.meters + margin * 2, 1, def.meters + margin * 2, 0);
  const wallColor = palette.length; // one extra colour for the edge wall
  palette.push("#3d4348");
  const propColor = palette.length; // then one colour per prop type
  for (const t of propConfig.types) palette.push(t.color);
  const props: PropInstance[] = [];
  const propWeight = propConfig.types.reduce((sum, t) => sum + t.weight, 0);
  // An island has no wall: the sea is its limit (Terrain.mayMove).
  if (!island) {
    const wallY = tiers.edgeWallHeight / 2;
    add(0, wallY, -half - margin / 2, def.meters + margin * 2, tiers.edgeWallHeight, margin, wallColor);
    add(0, wallY, half + margin / 2, def.meters + margin * 2, tiers.edgeWallHeight, margin, wallColor);
    add(-half - margin / 2, wallY, 0, margin, tiers.edgeWallHeight, def.meters, wallColor);
    add(half + margin / 2, wallY, 0, margin, tiers.edgeWallHeight, def.meters, wallColor);
  }

  // Breakable props scattered in a chunk, on a 1 m grid, clear of the chunk's own boxes, of each other, and of the
  // middle of a chunk where mechs may start. The same number of random draws happens whatever is decided, so the
  // rest of the map does not depend on how crowded one chunk was.
  let propBase = (_x: number, _z: number, _sx: number, _sz: number) => 0;
  // Where a chunk's spawn would stand: its middle, or on an island the nearest spot toward the map's middle that is far
  // enough inland, stepping a whole metre at a time and staying in the chunk. Null when there is none.
  const spawnSpot = (cell: number): [number, number] | null => {
    const x = cell % n, z = (cell - x) / n;
    const mx = x * chunks.size - half + chunks.size / 2, mz = z * chunks.size - half + chunks.size / 2;
    if (!coast) return [mx, mz];
    const most = Math.max(Math.abs(mx), Math.abs(mz), 1);
    for (let s = 0; s <= chunks.size / 2; s++) {
      const px = mx - Math.round((s * mx) / most), pz = mz - Math.round((s * mz) / most);
      if (ashore(px, pz, px, pz)) return [px, pz];
    }
    return null;
  };

  const placeProps = (firstBox: number, lastBox: number, originX: number, originZ: number, keepClear: [number, number] | null) => {
    const { min, max } = propConfig.perChunk;
    const count = min + rng.nextInt(max - min + 1);
    const edge = 3;
    const chunkProps: PropInstance[] = [];
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < (coast ? ISLAND_PROP_TRIES : 8); attempt++) {
        let roll = rng.nextInt(propWeight);
        let type = 0;
        while (roll >= propConfig.types[type]!.weight) { roll -= propConfig.types[type]!.weight; type++; }
        const x = originX + edge + rng.nextInt(chunks.size - edge * 2);
        const z = originZ + edge + rng.nextInt(chunks.size - edge * 2);
        const [sx, , sz] = propConfig.types[type]!.size;
        const m = propConfig.margin;
        const hits = (b: Box) => x - sx / 2 - m < b.maxX && x + sx / 2 + m > b.minX && z - sz / 2 - m < b.maxZ && z + sz / 2 + m > b.minZ;
        let blocked = false;
        for (let k = firstBox; k < lastBox && !blocked; k++) blocked = hits(boxes[k]!);
        for (const p of chunkProps) if (!blocked) blocked = hits(boxes[p.boxIndex]!);
        if (keepClear && Math.abs(x - keepClear[0]) < propConfig.keepClearOfSpawn + sx / 2 && Math.abs(z - keepClear[1]) < propConfig.keepClearOfSpawn + sz / 2) blocked = true;
        if (!ashore(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2)) blocked = true;
        if (blocked) continue;
        chunkProps.push(addProp(boxes, props, propConfig, type, x, z, propBase(x, z, sx, sz)));
        colors.push(propColor + type);
        break;
      }
    }
  };

  // The hills: noise first, then each built chunk's pad height (terrainGen.ts).
  const flatCorners = cornersFor(def.meters, chunks.size);
  const noise = settings ? noiseHeights(seed, tier, def.meters, settings) : new Int32Array(flatCorners * flatCorners);
  // On an island the shore cuts the hills down into the sea. Pads still come from the hills before the cut: a chunk's
  // middle can be out at sea while its buildings stand well inland, and the seabed is no height for them.
  const shored = coast && island ? Int32Array.from(noise) : noise;
  if (coast && island) shapeShore(shored, coast, island);
  // Where each chunk's level ground will be: its boxes' footprints, widened by the pad margin.
  const held: Rect[][] = [];
  // Held ground under something no taller than this is a floor or a terrace, which an outcrop may rise out of.
  const tallHeld: Rect[] = [];
  for (let cell = 0; cell < n * n; cell++) {
    const x = cell % n, z = (cell - x) / n;
    held.push(templates[grid[cell]!]!.boxes.map((b) => {
      orient(b, chunks.size, turnsOf[cell]!, mirrorOf[cell] === 1, oriented);
      if (oriented.size[1] > LOW_HELD_METERS) {
        const tx = x * chunks.size - half + oriented.center[0], tz = z * chunks.size - half + oriented.center[2];
        tallHeld.push({ minX: tx - oriented.size[0] / 2 - WALL_GAP_METERS, maxX: tx + oriented.size[0] / 2 + WALL_GAP_METERS, minZ: tz - oriented.size[2] / 2 - WALL_GAP_METERS, maxZ: tz + oriented.size[2] / 2 + WALL_GAP_METERS });
      }
      const cx = x * chunks.size - half + oriented.center[0], cz = z * chunks.size - half + oriented.center[2];
      return { minX: cx - oriented.size[0] / 2 - padMargin, maxX: cx + oriented.size[0] / 2 + padMargin, minZ: cz - oriented.size[2] / 2 - padMargin, maxZ: cz + oriented.size[2] / 2 + padMargin };
    }));
  }
  const padOf = settings ? padHeights(noise, def.meters, chunks.size, held, settings) : new Int32Array(n * n);
  const padsAt = () => held.flatMap((rects, cell) => rects.map((r) => ({ ...r, height: padOf[cell]! })));
  let heights = settings ? shapeTerrain(shored, def.meters, padsAt(), settings, !island) : noise;
  // Water fills the lowest ground. Its bed is raised so it is never deeper than a wade; a building pad lower than
  // the bed is raised with it (still level, now standing in shallow water), and the ground is shaped again round it.
  // An island's water is the sea: raised the same way wherever a mech can reach, deep past the wading limit.
  const water = island ? Math.round(island.seaLevelMeters * 100) : settings ? waterLevelFor(heights, settings.tiers[tier]?.waterShare ?? 0) : null;
  const reach = coast && island ? reachOf(coast, island) : null;
  if (settings && water !== null) {
    const depth = Math.round(settings.water.maxDepthMeters * 100);
    for (let cell = 0; cell < n * n; cell++) padOf[cell] = Math.max(padOf[cell]!, water - depth);
    heights = shapeTerrain(shored, def.meters, padsAt(), settings, !island);
    if (coast && island) shapeShore(heights, coast, island, true);
    floodBed(heights, water, depth, reach);
  }

  // Each chunk's boxes stand on its pad, and the ground round each box is held level.
  const spawnCandidates: number[] = [];
  const firstBoxOf = new Int32Array(n * n);
  const lastBoxOf = new Int32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const cell = z * n + x;
      const template = templates[grid[cell]!]!;
      const originX = x * chunks.size - half;
      const originZ = z * chunks.size - half;
      const padY = padOf[cell]! / 100;
      firstBoxOf[cell] = boxes.length;
      for (const b of template.boxes) {
        orient(b, chunks.size, turnsOf[cell]!, mirrorOf[cell] === 1, oriented);
        add(originX + oriented.center[0], padY + oriented.center[1], originZ + oriented.center[2], oriented.size[0], oriented.size[1], oriented.size[2], b.colorIndex + 1);
        boxKind[boxes.length - 1] = b.kindIndex;
      }
      lastBoxOf[cell] = boxes.length;
      if (template.spawnable) spawnCandidates.push(cell);
    }
  }
  const terrain = new Terrain(def.meters, cellMeters, heights, settings?.snapMeters ?? 0.5, water, settings?.water.wadeMeters, coast, island ? Math.round(island.wadeOutMeters * 100) : 0);
  const ground = boxes[0]!;
  ground.maxY = Math.min(0, terrain.minHeight) - 1;
  ground.minY = ground.maxY - 1;

  // Props, chunk by chunk in the same order as before, so the random draws are unchanged; each stands on the ground.
  propBase = (x, z, sx, sz) => Math.min(terrain.heightAt(x, z), terrain.heightAt(x - sx / 2, z - sz / 2), terrain.heightAt(x + sx / 2, z - sz / 2), terrain.heightAt(x - sx / 2, z + sz / 2), terrain.heightAt(x + sx / 2, z + sz / 2));
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const cell = z * n + x;
      placeProps(firstBoxOf[cell]!, lastBoxOf[cell]!, x * chunks.size - half, z * chunks.size - half, templates[grid[cell]!]!.spawnable ? spawnSpot(cell) : null);
    }
  }

  // Spawns: shuffled candidate chunks, kept only if far enough from the ones already chosen.
  rng.shuffle(spawnCandidates);
  const spawns: [number, number, number][] = [];
  const chosen: number[] = [];
  const sep = def.spawnSeparationChunks;
  for (const cell of spawnCandidates) {
    if (chosen.length >= def.spawns) break;
    const x = cell % n, z = (cell - x) / n;
    if (chosen.some((c) => Math.max(Math.abs((c % n) - x), Math.abs(Math.floor(c / n) - z)) < sep)) continue;
    const spot = spawnSpot(cell);
    if (!spot) continue;
    const [sx, sz] = spot;
    chosen.push(cell);
    spawns.push([sx, terrain.heightAt(sx, sz) + 0.05, sz]);
  }

  // Boulders, then woods, on open ground the seed picks. They keep off buildings and their level ground, props,
  // water, spawns and the map's edge. Taken ground is tracked on a coarse grid so each spot is checked at once.
  const kindNames = [...chunks.kinds, "boulder"];
  if (settings && (settings.rocks || settings.forest || settings.outcrops)) {
    const takenCols = Math.ceil(def.meters / TAKEN_CELL);
    // Two grids of taken ground: `taken` for boulders and woods, which keep off every building's level ground, and
    // `takenTall` for outcrops, which may rise out of floors and terraces but not walls, props or spawns.
    const taken = new Uint8Array(takenCols * takenCols), takenTall = new Uint8Array(takenCols * takenCols);
    const span = (lo: number, hi: number) => [Math.max(0, Math.floor((lo + half) / TAKEN_CELL)), Math.min(takenCols - 1, Math.floor((hi + half) / TAKEN_CELL))] as const;
    const markIn = (grid: Uint8Array, minX: number, minZ: number, maxX: number, maxZ: number) => {
      const [x0, x1] = span(minX, maxX), [z0, z1] = span(minZ, maxZ);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid[z * takenCols + x] = 1;
    };
    const freeIn = (grid: Uint8Array, minX: number, minZ: number, maxX: number, maxZ: number) => {
      const [x0, x1] = span(minX, maxX), [z0, z1] = span(minZ, maxZ);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (grid[z * takenCols + x]) return false;
      return true;
    };
    const mark = (minX: number, minZ: number, maxX: number, maxZ: number) => { markIn(taken, minX, minZ, maxX, maxZ); markIn(takenTall, minX, minZ, maxX, maxZ); };
    const free = (minX: number, minZ: number, maxX: number, maxZ: number) => freeIn(taken, minX, minZ, maxX, maxZ);
    for (const rects of held) for (const r of rects) markIn(taken, r.minX, r.minZ, r.maxX, r.maxZ);
    for (const r of tallHeld) markIn(takenTall, r.minX, r.minZ, r.maxX, r.maxZ);
    // A crate may stand right against an outcrop, so the outcrops' grid takes only the prop itself, not its margin.
    for (const p of props) {
      const b = boxes[p.boxIndex]!;
      markIn(taken, b.minX - propConfig.margin, b.minZ - propConfig.margin, b.maxX + propConfig.margin, b.maxZ + propConfig.margin);
      markIn(takenTall, b.minX, b.minZ, b.maxX, b.maxZ);
    }
    const clearOfSpawn = Math.max(settings.rocks?.clearOfSpawnMeters ?? 0, settings.forest?.clearOfSpawnMeters ?? 0, settings.outcrops?.clearOfSpawnMeters ?? 0);
    for (const [sx, , sz] of spawns) mark(sx - clearOfSpawn, sz - clearOfSpawn, sx + clearOfSpawn, sz + clearOfSpawn);

    const cell = settings.cellMeters;
    const corner = (x: number, z: number) => heights[Math.round((z + half) / cell) * terrain.corners + Math.round((x + half) / cell)]!;
    // Dry: every corner round the footprint stands clear of the water by `dryCm`. Whole centimetres.
    const dry = (minX: number, minZ: number, maxX: number, maxZ: number, dryCm: number) => {
      if (water === null) return true;
      for (const [x, z] of [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]] as const) if (corner(x, z) < water + dryCm) return false;
      return true;
    };
    // Candidate spots on a grid, each nudged by a jitter that is always drawn, so a skipped spot never shifts the rest.
    const scatter = (s: { maskSpacingMeters: number; maskAbove: number; spacingMeters: number; jitterMeters: number; clearOfEdgeMeters: number }, salt: number, place: (x: number, z: number, rng: SeededRng) => void) => {
      const r = new SeededRng(deriveSeed(seed, salt));
      const mask = valueNoise(r, terrain.corners, s.maskSpacingMeters / cell, MASK_RANGE);
      const lo = -half + s.clearOfEdgeMeters, hi = half - s.clearOfEdgeMeters;
      for (let z = lo; z <= hi; z += s.spacingMeters) {
        for (let x = lo; x <= hi; x += s.spacingMeters) {
          const px = Math.max(lo, Math.min(hi, x + r.nextInt(2 * s.jitterMeters + 1) - s.jitterMeters));
          const pz = Math.max(lo, Math.min(hi, z + r.nextInt(2 * s.jitterMeters + 1) - s.jitterMeters));
          const roll = new SeededRng(r.next32());
          if (mask[Math.round((pz + half) / cell) * terrain.corners + Math.round((px + half) / cell)]! <= s.maskAbove) continue;
          place(px, pz, roll);
        }
      }
    };

    // Outcrops first: they are the biggest, and boulders and woods fill in round them. A piece that would land on taken
    // or wet ground is left out; the rest of its cluster still stands. Sizes in tenths of a metre, whole numbers.
    const outcrops = settings.outcrops;
    if (outcrops) {
      const outcropColor = palette.length;
      palette.push(outcrops.color);
      const boulder = kindNames.length - 1;
      const tenths = (lo: number, hi: number, roll: SeededRng) => lo + roll.nextInt(Math.round((hi - lo) * 10) + 1) / 10;
      scatter({ ...outcrops, spacingMeters: settings.tiers[tier]?.outcropSpacingMeters ?? outcrops.spacingMeters }, OUTCROP_SALT, (x, z, roll) => {
        const count = outcrops.minPieces + roll.nextInt(outcrops.maxPieces - outcrops.minPieces + 1);
        const pieces: [number, number, number, number, number][] = [];
        for (let i = 0; i < count; i++) {
          const px = x + roll.nextInt(2 * outcrops.spreadMeters + 1) - outcrops.spreadMeters;
          const pz = z + roll.nextInt(2 * outcrops.spreadMeters + 1) - outcrops.spreadMeters;
          const sx = tenths(outcrops.minWidthMeters, outcrops.maxWidthMeters, roll), sz = tenths(outcrops.minWidthMeters, outcrops.maxWidthMeters, roll);
          const sy = tenths(outcrops.minHeightMeters, outcrops.maxHeightMeters, roll);
          const hx = sx / 2, hz = sz / 2;
          if (Math.abs(px) + hx > half - outcrops.clearOfEdgeMeters || Math.abs(pz) + hz > half - outcrops.clearOfEdgeMeters) continue;
          if (!freeIn(takenTall, px - hx, pz - hz, px + hx, pz + hz) || !dry(px - hx, pz - hz, px + hx, pz + hz, Math.round(outcrops.dryAboveWaterMeters * 100))) continue;
          pieces.push([px, pz, sx, sy, sz]);
        }
        // Marked only once the whole cluster is chosen, so its own pieces may lean into each other.
        for (const [px, pz, sx, sy, sz] of pieces) {
          const base = propBase(px, pz, sx, sz) - outcrops.buriedMeters;
          add(px, base + sy / 2, pz, sx, sy, sz, outcropColor);
          boxKind[boxes.length - 1] = boulder;
        }
        for (const [px, pz, sx, , sz] of pieces) mark(px - sx / 2 - 2, pz - sz / 2 - 2, px + sx / 2 + 2, pz + sz / 2 + 2);
      });
    }
    const rocks = settings.rocks;
    if (rocks) {
      const rockColor = palette.length;
      palette.push(rocks.color);
      const boulder = kindNames.length - 1;
      const steps = Math.round((rocks.maxSizeMeters - rocks.minSizeMeters) * 10);
      scatter(rocks, ROCKS_SALT, (x, z, roll) => {
        const size = rocks.minSizeMeters + roll.nextInt(steps + 1) / 10;
        const h = size / 2;
        if (!free(x - h, z - h, x + h, z + h) || !dry(x - h, z - h, x + h, z + h, Math.round(rocks.dryAboveWaterMeters * 100))) return;
        const base = propBase(x, z, size, size) - size * rocks.buriedShare;
        add(x, base + size / 2, z, size, size, size, rockColor);
        boxKind[boxes.length - 1] = boulder;
        mark(x - h - 1, z - h - 1, x + h + 1, z + h + 1);
      });
    }
    const forest = settings.forest;
    const pine = propConfig.types.findIndex((t) => t.id === "pine");
    if (forest && pine >= 0) {
      const [sx, , sz] = propConfig.types[pine]!.size;
      scatter(forest, FOREST_SALT, (x, z) => {
        if (!free(x - sx, z - sz, x + sx, z + sz) || !dry(x - sx, z - sz, x + sx, z + sz, Math.round(forest.dryAboveWaterMeters * 100))) return;
        addProp(boxes, props, propConfig, pine, x, z, propBase(x, z, sx, sz));
        colors.push(propColor + pine);
        mark(x - sx, z - sz, x + sx, z + sz);
      });
    }
  }

  const propOfBox = new Int32Array(boxes.length).fill(-1);
  for (const p of props) propOfBox[p.boxIndex] = p.id;
  const kinds = new Int8Array(boxes.length).fill(-1);
  boxKind.forEach((kind, i) => { kinds[i] = kind; });
  return { tier, meters: def.meters, boxes, colors, palette, kinds, kindNames, spawns, props, propOfBox, terrain };
}

const nearby: number[] = [];
const TAKEN_CELL = 2; // metres: the grid that tracks where boulders and trees may still go
const MASK_RANGE = 1000; // forest and boulder masks run from -MASK_RANGE to MASK_RANGE (maskAbove is on this scale)
const ROCKS_SALT = 3000, FOREST_SALT = 3001, OUTCROP_SALT = 3002;
const LOW_HELD_METERS = 1.6; // a floor slab or one of the old grey-box hill terraces, not a wall
const WALL_GAP_METERS = 3; // an outcrop keeps this clear of any wall, so a gap beside it still fits a mech // each scatter draws from its own stream, apart from the hills and props
const ISLAND_REPICKS = 4; // tries at a chunk that fits on the island before the shore gets open ground
const ISLAND_PROP_TRIES = 32; // a shore chunk has little land, so its props get more tries at finding some

// The ground mechs can stand on, in square metres: the whole map, or on an island the land and the shallows. Counted
// from the coastline's whole-centimetre corners, a cell's worth for each, so it is the same on every machine.
function landArea(terrain: Terrain | null, meters: number): number {
  if (!terrain?.coast) return meters * meters;
  let corners = 0;
  for (const c of terrain.coast) if (c + terrain.wadeOutCm >= 0) corners++;
  return corners * terrain.cell * terrain.cell;
}

// Checks a built map is playable: enough clear spawns, all reachable from each other, and no large sealed-off areas.
export function validateMap(
  map: Pick<GeneratedMap, "boxes" | "spawns" | "meters" | "tier" | "props"> & { world: World; nav: NavGrid },
  tiers: TierSet, mech: MechSize, propConfig?: PropConfig,
): ValidationReport {
  const problems: string[] = [];
  const def = tiers.tiers[map.tier]!;

  // Enough to break and loot, but not a solid field of crates.
  if (propConfig) {
    const squareKm = landArea(map.world.terrain, map.meters) / 1_000_000;
    const scattered = map.props.filter((p) => !propConfig.types[p.type]!.scenery);
    const perKm = scattered.length / squareKm;
    if (perKm < propConfig.density.minPerSquareKm || perKm > propConfig.density.maxPerSquareKm) problems.push(`prop density ${perKm.toFixed(0)} per square km is out of bounds`);

    const { lootDensity } = propConfig;
    const lootProps = map.props.filter((p) => propConfig.types[p.type]!.dropsLoot);
    const lootPerKm = lootProps.length / squareKm;
    if (lootPerKm < lootDensity.minPerSquareKm || lootPerKm > lootDensity.maxPerSquareKm) problems.push(`loot density ${lootPerKm.toFixed(0)} per square km is out of bounds`);
    // Squared whole-metre distances, so the count is exact on every machine.
    const reach = lootDensity.nearSpawnMeters * lootDensity.nearSpawnMeters;
    for (const [x, , z] of map.spawns) {
      const near = lootProps.filter((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) <= reach).length;
      if (near < lootDensity.minNearSpawn) problems.push(`spawn at ${x},${z} has only ${near} loot props near it`);
    }
  }

  if (map.spawns.length < def.spawns) problems.push(`only ${map.spawns.length} of ${def.spawns} spawns placed`);

  for (const [x, y, z] of map.spawns) {
    const count = map.world.query(x - mech.halfWidth, z - mech.halfWidth, x + mech.halfWidth, z + mech.halfWidth, nearby);
    for (let i = 0; i < count; i++) {
      const b = map.boxes[nearby[i]!]!;
      if (b.maxX > x - mech.halfWidth && b.minX < x + mech.halfWidth && b.maxZ > z - mech.halfWidth && b.minZ < z + mech.halfWidth && b.maxY > y && b.minY < y + mech.height) {
        problems.push(`spawn at ${x},${z} is blocked`);
        break;
      }
    }
  }

  const grid = map.nav;
  let connectedFraction = 0;
  const first = map.spawns[0];
  if (first) {
    const reached = new Uint8Array(grid.cols * grid.rows);
    floodFill(grid, navCell(grid, first[0], first[2]), reached);
    for (const [x, , z] of map.spawns) {
      if (!reached[navCell(grid, x, z)]) problems.push(`spawn at ${x},${z} cannot be reached from the first spawn`);
    }
    // Of the cells a mech could stand on at ground level, how many can the first spawn reach?
    let ground = 0, groundReached = 0;
    for (let i = 0; i < grid.top.length; i++) {
      if (raised(grid, i) <= mech.stepHeight) {
        ground++;
        if (reached[i]) groundReached++;
      }
    }
    connectedFraction = ground > 0 ? groundReached / ground : 0;
    if (connectedFraction < tiers.minConnectedFraction) problems.push(`only ${(connectedFraction * 100).toFixed(1)}% of open ground is connected`);
  }
  return { ok: problems.length === 0, problems, connectedFraction };
}

// Builds a map from a seed and checks it. If it fails the checks, derives a new seed and tries again,
// the same way on every machine, so server and clients still end up with the same map.
export function generateMap(seed: number, tier: string, chunks: ChunkSet, tiers: TierSet, mech: MechSize, propConfig: PropConfig): GeneratedMap {
  const nav: NavParams = { cellMeters: tiers.navCellMeters, stepHeight: mech.stepHeight, mechHeight: mech.height };
  let lastProblems: string[] = [];

  for (let attempt = 0; attempt < tiers.maxAttempts; attempt++) {
    const usedSeed = attempt === 0 ? seed >>> 0 : deriveSeed(seed, attempt);
    const built = build(usedSeed, tier, chunks, tiers, propConfig);
    const world = new World(built.boxes, 16, built.terrain);
    // Trees are too thin to be walls for bot routes: bots steer round trunks up close instead.
    const thin = new Uint8Array(built.boxes.length);
    for (const p of built.props) if (propConfig.types[p.type]!.scenery) thin[p.boxIndex] = 1;
    const navGrid = buildNavGrid(built.boxes, built.meters, 0, 0, nav, built.terrain, thin);
    const map: GeneratedMap = { ...built, seed: seed >>> 0, usedSeed, attempts: attempt + 1, world, nav: navGrid };
    const report = validateMap(map, tiers, mech, propConfig);
    if (report.ok) return map;
    lastProblems = report.problems;
  }
  throw new Error(`No valid ${tier} map for seed ${seed} after ${tiers.maxAttempts} attempts: ${lastProblems.slice(0, 3).join("; ")}`);
}
