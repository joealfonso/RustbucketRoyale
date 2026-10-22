import { describe, expect, it } from "vitest";
import chunksJson from "../../../../data/chunks.json";
import mechJson from "../../../../data/mech.json";
import tiersJson from "../../../../data/tiers.json";
import propsJson from "../../../../data/props.json";
import ringJson from "../../../../data/ring.json";
import { createMechInput } from "../MechInput";
import { createMechState, stepMech } from "../mechStep";
import { parsePropConfig } from "../props";
import { makeRingSchedule, parseRingConfig, ringOnLand } from "../ring";
import { parseMechStats } from "../stats";
import { parseTerrainSettings, Terrain } from "../terrain";
import { World } from "../world";
import { parseChunkSet } from "./chunks";
import { generateMap, type GeneratedMap } from "./generateMap";
import { perimeterAt } from "./islandGen";
import { raised } from "./navGrid";
import { SeededRng } from "./SeededRng";
import { parseTiers } from "./tiers";

const chunks = parseChunkSet(chunksJson);
const tiers = parseTiers(tiersJson);
const stats = parseMechStats(mechJson);
const propConfig = parsePropConfig(propsJson);
const island = tiers.terrain!.tiers.arena!.island!;
const generate = (seed: number) => generateMap(seed, "arena", chunks, tiers, stats, propConfig);
const STEP = 1 / 60;

// The shore's whole shape, the hills and everything placed, as one string.
const fingerprint = (m: GeneratedMap) => JSON.stringify([m.usedSeed, m.attempts, [...m.terrain.coast!], [...m.terrain.heights], m.boxes, m.spawns, m.props]);

describe("island coastline", () => {
  it("builds the same island twice from the same seed, for 1000 seeds", () => {
    for (let seed = 1; seed <= 1000; seed++) expect(fingerprint(generate(seed))).toBe(fingerprint(generate(seed)));
  }, 120_000);

  it("gives different seeds different shores", () => {
    const shores = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify([...generate(100 + i).terrain.coast!])));
    expect(shores.size).toBe(20);
  });

  it("goes round the square in one sweep, the same way along every line out from the middle", () => {
    expect(perimeterAt(100, 0)).toBe(4096);
    expect(perimeterAt(100, 100)).toBe(8192); // the corner between the +x and +z sides
    expect(perimeterAt(0, 100)).toBe(3 * 4096);
    expect(perimeterAt(-100, 0)).toBe(5 * 4096);
    expect(perimeterAt(0, -100)).toBe(7 * 4096);
    expect(perimeterAt(300, 120)).toBe(perimeterAt(500, 200));
  });

  it("is one piece of land with sea all round, about half the map, out to a level seabed at the edge", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const t = generate(seed).terrain;
      const n = t.corners, coast = t.coast!;
      let land = 0;
      for (const c of coast) if (c >= 0) land++;
      expect(land / coast.length).toBeGreaterThan(0.4);
      expect(land / coast.length).toBeLessThan(0.75);
      // Flood the land from the middle: it reaches every land corner, so there are no islets or lakes.
      const middle = ((n - 1) / 2) * n + (n - 1) / 2;
      const seen = new Uint8Array(coast.length), queue = [middle];
      seen[middle] = 1;
      let reached = 0;
      while (queue.length > 0) {
        const k = queue.pop()!;
        reached++;
        const i = k % n, j = (k - i) / n;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di, nj = j + dj, nk = nj * n + ni;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n || seen[nk] || coast[nk]! < 0) continue;
          seen[nk] = 1;
          queue.push(nk);
        }
      }
      expect(reached).toBe(land);
      const seabed = island.seaLevelMeters - island.seabedMeters;
      for (let i = 0; i < n; i++) {
        for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
          expect(t.heights[k]! / 100).toBeCloseTo(seabed, 5);
          expect(t.mayStand(((k % n) * t.cell) - t.meters / 2, (Math.floor(k / n) * t.cell) - t.meters / 2)).toBe(false);
        }
      }
    }
  });

  it("can be waded in up to the limit, never deeper than a wade there, and is deep past it", () => {
    const maxDepth = tiers.terrain!.water.maxDepthMeters;
    for (const seed of [1, 2, 3]) {
      const t = generate(seed).terrain;
      for (let k = 0; k < t.heights.length; k++) {
        const depth = t.waterLevel - t.heights[k]! / 100;
        if (t.coast![k]! + t.wadeOutCm >= 0) expect(depth).toBeLessThanOrEqual(maxDepth + 1e-9);
        if (t.coast![k]! + t.wadeOutCm < -100) expect(depth).toBeGreaterThan(maxDepth);
      }
    }
  });
});

describe("on the island", () => {
  const maps = [1, 2, 3, 4, 5, 6].map(generate);

  it("has no edge wall: nothing stands outside the map", () => {
    for (const m of maps) for (const b of m.boxes.slice(1)) {
      expect(Math.max(-b.minX, b.maxX, -b.minZ, b.maxZ)).toBeLessThanOrEqual(m.meters / 2);
    }
  });

  it("keeps every building, prop, rock, tree and spawn on land", () => {
    for (const m of maps) {
      const t = m.terrain;
      m.boxes.slice(1).forEach((b, i) => {
        for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]] as const) {
          expect(t.coastAt(x, z), `seed ${m.usedSeed} box ${i + 1}`).toBeGreaterThan(0);
        }
      });
      // Buildings stand level on their pads, not sunk toward the seabed.
      m.boxes.forEach((b, k) => {
        if (k === 0 || m.propOfBox[k]! >= 0 || m.kinds[k]! < 0 || m.kindNames[m.kinds[k]!] === "boulder") return;
        const ground = [[b.minX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ], [b.maxX, b.minZ]].map(([x, z]) => t.heightAt(x!, z!));
        expect(Math.max(...ground) - Math.min(...ground), `seed ${m.usedSeed} box ${k}`).toBeLessThan(0.01);
        expect(b.minY).toBeGreaterThanOrEqual(Math.min(...ground) - 0.01);
      });
      for (const [x, , z] of m.spawns) expect(t.coastAt(x, z)).toBeGreaterThanOrEqual(island.buildInlandMeters - 1e-9);
      expect(m.spawns.length).toBe(tiers.tiers.arena!.spawns);
    }
  });

  it("marks the sea past the wading limit as a wall for bot routes and the map's checks", () => {
    for (const m of maps) {
      const { nav } = m, t = m.terrain;
      for (let z = 0; z < nav.rows; z++) for (let x = 0; x < nav.cols; x++) {
        const at = t.mayStand(nav.originX + (x + 0.5) * nav.cell, nav.originZ + (z + 0.5) * nav.cell);
        if (!at) expect(raised(nav, z * nav.cols + x)).toBeGreaterThan(nav.stepHeight);
      }
    }
  });

  it("closes the ring on land: every circle's middle is its radius inland, or as far inland as the island's middle", () => {
    const ring = parseRingConfig(ringJson);
    for (const m of maps) {
      const fits = ringOnLand(m.terrain)!;
      for (let k = 0; k < 20; k++) {
        const r = new SeededRng(m.usedSeed + k);
        const schedule = makeRingSchedule(ring, "arena", m.meters, () => r.next32() / 4294967296, fits);
        for (const stage of schedule.stages) expect(fits(stage)).toBe(true);
        const last = schedule.stages.at(-1)!;
        expect(m.terrain.coastAt(last.cx, last.cz)).toBeGreaterThanOrEqual(last.radius);
      }
    }
  });
});

describe("the sea as the map's limit", () => {
  const map = generate(5);
  const t = map.terrain;
  // A lane from the island's middle out to sea with nothing standing in it, as a heading (yaw) and a start on land.
  const lane = (() => {
    const nearby: number[] = [];
    for (let a = 0; a < 360; a += 5) {
      const dx = Math.cos((a * Math.PI) / 180), dz = Math.sin((a * Math.PI) / 180);
      let start = 0;
      while (t.coastAt(dx * start, dz * start) > 20) start += 1;
      let clear = true;
      for (let d = start; d < start + 40 && clear; d += 1) {
        const x = dx * d, z = dz * d;
        const count = map.world.query(x - 3, z - 3, x + 3, z + 3, nearby);
        for (let i = 0; i < count; i++) if (nearby[i] !== 0) clear = false;
      }
      if (clear) return { x: dx * start, z: dz * start, yaw: Math.atan2(-dx, -dz), dx, dz };
    }
    throw new Error("no clear lane to the sea on this map");
  })();

  const runOut = (input: Partial<ReturnType<typeof createMechInput>>, seconds: number, everyStep?: (i: number) => Partial<ReturnType<typeof createMechInput>>) => {
    const s = createMechState(stats, lane.x, t.heightAt(lane.x, lane.z), lane.z, lane.yaw);
    let furthest = Infinity;
    for (let i = 0; i < seconds * 60; i++) {
      stepMech(s, { ...createMechInput(), aimYaw: lane.yaw, moveY: 1, ...input, ...everyStep?.(i) }, stats, STEP, map.world);
      furthest = Math.min(furthest, t.coastAt(s.x, s.z));
    }
    return { s, furthest };
  };

  it("stops a mech walking, running, dashing or jetting out to sea at the wading limit", () => {
    const limit = -island.wadeOutMeters;
    for (const [name, input, every] of [
      ["walk", {}, undefined],
      ["run", { run: true }, undefined],
      ["dash", {}, (i: number) => ({ dash: i % 30 === 0 })],
      ["jet", { jet: true }, undefined],
    ] as const) {
      const { s, furthest } = runOut(input, 8, every);
      expect(furthest, name).toBeGreaterThanOrEqual(limit);
      // It got right up to the line, not stopped short by something else.
      expect(t.coastAt(s.x, s.z), name).toBeLessThan(limit + 1);
    }
  });

  it("lets a mech slide along the limit instead of sticking to it", () => {
    // Heading out at an angle to the shore: the sideways part of the walk carries on. Both ways are tried, since the
    // lane can end in a cove where one way runs straight back into the sea.
    const ends = [runOut({ moveX: 1 }, 8).s, runOut({ moveX: -1 }, 8).s];
    const along = Math.max(...ends.map((s) => Math.hypot(s.x - lane.x, s.z - lane.z)));
    expect(along).toBeGreaterThan(30);
    for (const s of ends) expect(t.mayStand(s.x, s.z)).toBe(true);
  });

  it("lets a mech that is somehow past the limit walk back in, but no further out", () => {
    const flat = parseTerrainSettings(tiersJson.terrain);
    expect(flat.tiers.arena!.island).toBeDefined();
    // A strip map: land west of x = 0, the limit at x = 6, and sea east of it.
    const n = 21, cell = 4, coast = new Int32Array(n * n), heights = new Int32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) coast[j * n + i] = -(i * cell - 40) * 100;
    const strip = new Terrain(80, cell, heights, 0.5, -100, 0.1, coast, 600);
    const world = new World([], 16, strip);
    const east = Math.atan2(-1, 0), west = Math.atan2(1, 0);
    const s = createMechState(stats, 12, 0, 0, east);
    for (let i = 0; i < 60; i++) stepMech(s, { ...createMechInput(), aimYaw: east, moveY: 1 }, stats, STEP, world);
    expect(s.x).toBeCloseTo(12, 6); // already out: going further is refused
    for (let i = 0; i < 120; i++) stepMech(s, { ...createMechInput(), aimYaw: west, moveY: 1 }, stats, STEP, world);
    expect(s.x).toBeLessThan(6);
  });
});
