import { World, type Box } from "../world";
import { addProp, type PropConfig, type PropInstance } from "../props";
import { orient, type ChunkSet } from "./chunks";
import { buildNavGrid, floodFill, navCell, type NavGrid, type NavParams } from "./navGrid";
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
  spawns: [number, number, number][];
  props: PropInstance[];
  propOfBox: Int32Array; // for each box, the prop it belongs to, or -1
  world: World;
  nav: NavGrid;
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
  const def = tiers.tiers[tier];
  if (!def) throw new Error(`Unknown tier "${tier}"`);
  if (def.meters % chunks.size !== 0) throw new Error(`Tier ${tier}: ${def.meters} m is not a whole number of ${chunks.size} m chunks`);

  const rng = new SeededRng(seed);
  const n = def.meters / chunks.size;
  const half = def.meters / 2;
  const templates = chunks.templates;
  const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0);

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
    }
  }

  const palette = [tiers.groundColor, ...chunks.palette];
  const boxes: Box[] = [];
  const colors: number[] = [];
  const add = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number) => {
    boxes.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 });
    colors.push(color);
  };

  // The ground and a tall wall round the edge, so nobody walks off the map.
  const margin = tiers.edgeWallThickness;
  add(0, -0.5, 0, def.meters + margin * 2, 1, def.meters + margin * 2, 0);
  const wallColor = palette.length; // one extra colour for the edge wall
  palette.push("#3d4348");
  const propColor = palette.length; // then one colour per prop type
  for (const t of propConfig.types) palette.push(t.color);
  const props: PropInstance[] = [];
  const propWeight = propConfig.types.reduce((sum, t) => sum + t.weight, 0);
  const wallY = tiers.edgeWallHeight / 2;
  add(0, wallY, -half - margin / 2, def.meters + margin * 2, tiers.edgeWallHeight, margin, wallColor);
  add(0, wallY, half + margin / 2, def.meters + margin * 2, tiers.edgeWallHeight, margin, wallColor);
  add(-half - margin / 2, wallY, 0, margin, tiers.edgeWallHeight, def.meters, wallColor);
  add(half + margin / 2, wallY, 0, margin, tiers.edgeWallHeight, def.meters, wallColor);

  // Breakable props scattered in a chunk, on a 1 m grid, clear of the chunk's own boxes, of each other, and of the
  // middle of a chunk where mechs may start. The same number of random draws happens whatever is decided, so the
  // rest of the map does not depend on how crowded one chunk was.
  const placeProps = (firstBox: number, originX: number, originZ: number, keepMiddleClear: boolean) => {
    const { min, max } = propConfig.perChunk;
    const count = min + rng.nextInt(max - min + 1);
    const edge = 3;
    const chunkProps: PropInstance[] = [];
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        let roll = rng.nextInt(propWeight);
        let type = 0;
        while (roll >= propConfig.types[type]!.weight) { roll -= propConfig.types[type]!.weight; type++; }
        const x = originX + edge + rng.nextInt(chunks.size - edge * 2);
        const z = originZ + edge + rng.nextInt(chunks.size - edge * 2);
        const [sx, , sz] = propConfig.types[type]!.size;
        const m = propConfig.margin;
        const hits = (b: Box) => x - sx / 2 - m < b.maxX && x + sx / 2 + m > b.minX && z - sz / 2 - m < b.maxZ && z + sz / 2 + m > b.minZ;
        let blocked = false;
        for (let k = firstBox; k < boxes.length && !blocked; k++) blocked = hits(boxes[k]!);
        for (const p of chunkProps) if (!blocked) blocked = hits(boxes[p.boxIndex]!);
        const middleX = originX + chunks.size / 2, middleZ = originZ + chunks.size / 2;
        if (keepMiddleClear && Math.abs(x - middleX) < propConfig.keepClearOfSpawn + sx / 2 && Math.abs(z - middleZ) < propConfig.keepClearOfSpawn + sz / 2) blocked = true;
        if (blocked) continue;
        chunkProps.push(addProp(boxes, props, propConfig, type, x, z));
        colors.push(propColor + type);
        break;
      }
    }
  };

  const oriented = { center: [0, 0, 0] as [number, number, number], size: [0, 0, 0] as [number, number, number] };
  const spawnCandidates: number[] = [];
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const cell = z * n + x;
      const template = templates[grid[cell]!]!;
      const originX = x * chunks.size - half;
      const originZ = z * chunks.size - half;
      const firstBox = boxes.length;
      for (const b of template.boxes) {
        orient(b, chunks.size, turnsOf[cell]!, mirrorOf[cell] === 1, oriented);
        add(originX + oriented.center[0], oriented.center[1], originZ + oriented.center[2], oriented.size[0], oriented.size[1], oriented.size[2], b.colorIndex + 1);
      }
      placeProps(firstBox, originX, originZ, template.spawnable);
      if (template.spawnable) spawnCandidates.push(cell);
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
    chosen.push(cell);
    spawns.push([x * chunks.size - half + chunks.size / 2, 0.05, z * chunks.size - half + chunks.size / 2]);
  }

  const propOfBox = new Int32Array(boxes.length).fill(-1);
  for (const p of props) propOfBox[p.boxIndex] = p.id;
  return { tier, meters: def.meters, boxes, colors, palette, spawns, props, propOfBox };
}

const nearby: number[] = [];

// Checks a built map is playable: enough clear spawns, all reachable from each other, and no large sealed-off areas.
export function validateMap(
  map: Pick<GeneratedMap, "boxes" | "spawns" | "meters" | "tier" | "props"> & { world: World; nav: NavGrid },
  tiers: TierSet, mech: MechSize, propConfig?: PropConfig,
): ValidationReport {
  const problems: string[] = [];
  const def = tiers.tiers[map.tier]!;

  // Enough to break and loot, but not a solid field of crates.
  if (propConfig) {
    const perKm = map.props.length / ((map.meters * map.meters) / 1_000_000);
    if (perKm < propConfig.density.minPerSquareKm || perKm > propConfig.density.maxPerSquareKm) problems.push(`prop density ${perKm.toFixed(0)} per square km is out of bounds`);
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
      if (grid.top[i]! <= mech.stepHeight) {
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
    const world = new World(built.boxes);
    const navGrid = buildNavGrid(built.boxes, built.meters, 0, 0, nav);
    const map: GeneratedMap = { ...built, seed: seed >>> 0, usedSeed, attempts: attempt + 1, world, nav: navGrid };
    const report = validateMap(map, tiers, mech, propConfig);
    if (report.ok) return map;
    lastProblems = report.problems;
  }
  throw new Error(`No valid ${tier} map for seed ${seed} after ${tiers.maxAttempts} attempts: ${lastProblems.slice(0, 3).join("; ")}`);
}
