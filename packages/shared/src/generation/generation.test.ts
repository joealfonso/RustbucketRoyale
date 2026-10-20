import { describe, expect, it } from "vitest";
import chunksJson from "../../../../data/chunks.json";
import mechJson from "../../../../data/mech.json";
import tiersJson from "../../../../data/tiers.json";
import propsJson from "../../../../data/props.json";
import { parsePropConfig } from "../props";
import { World } from "../world";
import { parseMechStats } from "../stats";
import { orient, parseChunkSet } from "./chunks";
import { generateMap, validateMap, type GeneratedMap } from "./generateMap";
import { buildNavGrid } from "./navGrid";
import { SeededRng, deriveSeed } from "./SeededRng";
import { parseTiers } from "./tiers";

const chunks = parseChunkSet(chunksJson);
const tiers = parseTiers(tiersJson);
const mech = parseMechStats(mechJson);
const propConfig = parsePropConfig(propsJson);
const generate = (seed: number, tier: string) => generateMap(seed, tier, chunks, tiers, mech, propConfig);

// Everything that makes one map different from another, as one string.
const fingerprint = (m: GeneratedMap) => JSON.stringify([m.usedSeed, m.attempts, m.boxes, m.colors, m.palette, m.spawns, m.props]);

describe("SeededRng", () => {
  it("gives the same numbers for the same seed and different numbers for another", () => {
    const a = new SeededRng(42), b = new SeededRng(42), c = new SeededRng(43);
    const first = Array.from({ length: 20 }, () => a.next32());
    expect(Array.from({ length: 20 }, () => b.next32())).toEqual(first);
    expect(Array.from({ length: 20 }, () => c.next32())).not.toEqual(first);
  });

  it("keeps nextInt inside its bound and roughly even", () => {
    const rng = new SeededRng(1);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) counts[rng.nextInt(6)]++;
    for (const c of counts) expect(c).toBeGreaterThan(850);
  });

  it("shuffles into a permutation of the same items", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    new SeededRng(9).shuffle(items);
    expect([...items].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(items).not.toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("derives different retry seeds, the same way each time", () => {
    expect(deriveSeed(5, 1)).toBe(deriveSeed(5, 1));
    expect(deriveSeed(5, 1)).not.toBe(deriveSeed(5, 2));
  });

  it("matches a known value, so a change in the generator is noticed", () => {
    expect(new SeededRng(1).next32()).toBe(2_693_262_067); // pinned from the first run
  });
});

describe("chunk data", () => {
  it("parses, and every box sits inside its chunk", () => {
    expect(chunks.templates.length).toBeGreaterThan(5);
    for (const t of chunks.templates) {
      for (const b of t.boxes) {
        expect(b.center[0] - b.size[0] / 2).toBeGreaterThanOrEqual(0);
        expect(b.center[0] + b.size[0] / 2).toBeLessThanOrEqual(chunks.size);
      }
    }
  });

  it("spawnable chunks keep their middle clear", () => {
    const half = 4;
    for (const t of chunks.templates.filter((x) => x.spawnable)) {
      for (const b of t.boxes) {
        const cx = chunks.size / 2, cz = chunks.size / 2;
        const overlaps = b.center[0] - b.size[0] / 2 < cx + half && b.center[0] + b.size[0] / 2 > cx - half &&
          b.center[2] - b.size[2] / 2 < cz + half && b.center[2] + b.size[2] / 2 > cz - half;
        expect(overlaps, `${t.id} blocks its middle`).toBe(false);
      }
    }
  });

  it("four quarter turns bring a box home, and a double mirror too", () => {
    const box = { center: [12, 3, 7] as [number, number, number], size: [4, 2, 9] as [number, number, number], colorIndex: 0, kindIndex: 0 };
    const out = { center: [0, 0, 0] as [number, number, number], size: [0, 0, 0] as [number, number, number] };
    orient(box, 50, 4, false, out);
    expect(out).toEqual({ center: box.center, size: box.size });
    orient(box, 50, 1, false, out);
    expect(out.size).toEqual([9, 2, 4]);
    for (let turns = 0; turns < 4; turns++) {
      orient(box, 50, turns, true, out);
      expect(out.center[0] - out.size[0] / 2).toBeGreaterThanOrEqual(0);
      expect(out.center[0] + out.size[0] / 2).toBeLessThanOrEqual(50);
    }
  });
});

describe("generateMap", () => {
  it("builds the same map twice from the same seed, for 1000 seeds", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      expect(fingerprint(generate(seed, "small"))).toBe(fingerprint(generate(seed, "small")));
    }
  }, 120_000);

  it("builds different maps from different seeds", () => {
    const prints = new Set(Array.from({ length: 50 }, (_, i) => fingerprint(generate(1000 + i, "small"))));
    expect(prints.size).toBe(50);
  });

  it("passes its own checks for 1000 small seeds, rarely needing a retry", () => {
    let retries = 0;
    for (let seed = 5000; seed < 6000; seed++) {
      const map = generate(seed, "small");
      retries += map.attempts - 1;
      expect(map.spawns.length).toBe(tiers.tiers.small!.spawns);
      expect(validateMap(map, tiers, mech).ok).toBe(true);
    }
    expect(retries).toBeLessThan(100); // under one retry per ten maps
  }, 120_000);

  it("builds a valid map of every tier from a few seeds, within the time budget", () => {
    for (const [tier, budgetMs] of [["small", 3000], ["medium", 3000], ["large", 10_000]] as const) {
      for (const seed of [1, 777, 123456]) {
        const started = Date.now();
        const map = generate(seed, tier);
        const took = Date.now() - started;
        expect(map.meters).toBe(tiers.tiers[tier]!.meters);
        expect(map.spawns.length).toBe(tiers.tiers[tier]!.spawns);
        expect(took, `${tier} seed ${seed} took ${took.toFixed(0)} ms`).toBeLessThan(budgetMs);
      }
    }
  }, 120_000);

  it("never puts anything over the edge wall", () => {
    const map = generate(3, "small");
    const half = map.meters / 2 + tiers.edgeWallThickness;
    for (const b of map.boxes) {
      expect(b.minX).toBeGreaterThanOrEqual(-half - 1e-9);
      expect(b.maxX).toBeLessThanOrEqual(half + 1e-9);
    }
  });
});

describe("props", () => {
  it("never sit on a chunk's own boxes or on each other, and keep the spawns clear", () => {
    const nearby: number[] = [];
    for (const seed of [1, 2, 3]) {
      const map = generate(seed, "medium");
      expect(map.props.length).toBeGreaterThan(0);
      const clashes: string[] = [];
      for (const p of map.props) {
        const a = map.boxes[p.boxIndex]!;
        const count = map.world.query(a.minX, a.minZ, a.maxX, a.maxZ, nearby);
        for (let k = 0; k < count; k++) {
          const i = nearby[k]!;
          if (i === p.boxIndex || i === 0) continue; // the ground slab is under everything
          const b = map.boxes[i]!;
          if (a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ && a.minY < b.maxY && a.maxY > b.minY) clashes.push(`prop ${p.id} and box ${i}`);
        }
      }
      expect(clashes).toEqual([]);
      expect(validateMap(map, tiers, mech).ok).toBe(true); // spawns still clear
    }
  });

  it("are listed both ways round: each prop knows its box, each box knows its prop", () => {
    const map = generate(9, "small");
    for (const p of map.props) expect(map.propOfBox[p.boxIndex]).toBe(p.id);
    expect([...map.propOfBox].filter((id) => id >= 0)).toHaveLength(map.props.length);
  });

  it("keep within the density bounds on every tier", () => {
    for (const tier of Object.keys(tiers.tiers)) {
      const map = generate(77, tier);
      const scattered = map.props.filter((p) => !propConfig.types[p.type]!.scenery); // trees are counted apart
      const perKm = scattered.length / ((map.meters * map.meters) / 1_000_000);
      expect(perKm).toBeGreaterThanOrEqual(propConfig.density.minPerSquareKm);
      expect(perKm).toBeLessThanOrEqual(propConfig.density.maxPerSquareKm);
    }
  });
});

describe("validateMap", () => {
  const base = generate(11, "small");
  const rebuild = (extra: GeneratedMap["boxes"]): GeneratedMap => {
    const boxes = [...base.boxes, ...extra];
    return { ...base, boxes, colors: [...base.colors, ...extra.map(() => 1)], world: new World(boxes), nav: buildNavGrid(boxes, base.meters, 0, 0, { cellMeters: tiers.navCellMeters, stepHeight: mech.stepHeight, mechHeight: mech.height }) };
  };

  it("passes a good map", () => {
    expect(validateMap(base, tiers, mech).ok).toBe(true);
  });

  it("fails when something sits on a spawn", () => {
    const [x, , z] = base.spawns[0]!;
    const blocked = rebuild([{ minX: x - 1, maxX: x + 1, minZ: z - 1, maxZ: z + 1, minY: 0, maxY: 3 }]);
    expect(validateMap(blocked, tiers, mech).problems.join()).toMatch(/blocked/);
  });

  it("fails when a wall cuts the map in two", () => {
    const wall = rebuild([{ minX: -2, maxX: 2, minZ: -base.meters / 2, maxZ: base.meters / 2, minY: 0, maxY: 30 }]);
    const report = validateMap(wall, tiers, mech);
    expect(report.ok).toBe(false);
    expect(report.problems.join()).toMatch(/cannot be reached|connected/);
  });

  it("fails when a spawn has hardly any loot near it, or the whole map has too little", () => {
    const [x, , z] = base.spawns[0]!;
    const reach = propConfig.lootDensity.nearSpawnMeters;
    const bare = base.props.filter((p) => !propConfig.types[p.type]!.dropsLoot || Math.hypot(p.x - x, p.z - z) > reach);
    expect(validateMap(base, tiers, mech, propConfig).ok).toBe(true);
    expect(validateMap({ ...base, props: bare }, tiers, mech, propConfig).problems.join()).toMatch(/loot props near it/);
    const noLoot = base.props.filter((p) => !propConfig.types[p.type]!.dropsLoot);
    expect(validateMap({ ...base, props: noLoot }, tiers, mech, propConfig).problems.join()).toMatch(/loot density/);
  });

  it("fails when there are not enough spawns", () => {
    expect(validateMap({ ...base, spawns: base.spawns.slice(0, 3) }, tiers, mech).ok).toBe(false);
  });
});
