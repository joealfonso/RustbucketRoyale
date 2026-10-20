import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { generatedMaps, tierNames } from "./config";
import { MapPool } from "./MapPool";
import { packMap, transferList, unpackMap } from "./mapPack";
import type { MapForRoom } from "./Room";

const mainThread = generatedMaps();
const pool = new MapPool(2);
afterAll(() => pool.close());

// Everything the room uses from a map, as plain data, so two maps compare field by field.
const plain = (m: MapForRoom) => {
  const t = m.world.terrain;
  return {
    boxes: m.world.boxes, nav: { ...m.nav, top: Array.from(m.nav.top), ground: Array.from(m.nav.ground) }, spawns: m.spawns, meters: m.meters, props: m.props, propOfBox: Array.from(m.propOfBox),
    terrain: t && { heights: Array.from(t.heights), meters: t.meters, cell: t.cell, snapMeters: t.snapMeters, waterLevelCm: t.waterLevelCm, wadeMeters: t.wadeMeters },
  };
};

describe("MapPool", () => {
  it("builds exactly the map the main thread builds, for a few seeds on every tier", async () => {
    for (const tier of tierNames()) {
      for (const seed of [1, 0x9e3779b9, 424242]) {
        const fromWorker = await pool.generate(tier, seed);
        expect(plain(fromWorker), `${tier} seed ${seed}`).toEqual(plain(mainThread(tier, seed)));
      }
    }
  }, 60_000);

  it("keeps the hills exactly through packing and moving to another thread", () => {
    const original = mainThread("medium", 9);
    const packed = packMap(mainThread("medium", 9));
    // Moved the way postMessage moves it: the arrays listed for transfer leave the sender.
    const map = unpackMap(structuredClone(packed, { transfer: transferList(packed) }));
    const hills = map.world.terrain!, made = original.world.terrain!;
    expect(made.maxHeight - made.minHeight).toBeGreaterThan(1); // a map with real hills, or this proves nothing
    expect(Array.from(hills.heights)).toEqual(Array.from(made.heights));
    expect([hills.meters, hills.cell, hills.snapMeters]).toEqual([made.meters, made.cell, made.snapMeters]);
    expect(made.waterLevelCm).not.toBeNull(); // a map with water, or the water checks below prove nothing
    expect([hills.waterLevelCm, hills.wadeMeters, hills.waterLevel]).toEqual([made.waterLevelCm, made.wadeMeters, made.waterLevel]);
    expect(Array.from(map.nav.ground)).toEqual(Array.from(original.nav.ground));
    // The rebuilt World stands on them: the same ground, and the same ray hits on the hillside.
    const a = { distance: 0, normalX: 0, normalY: 0, normalZ: 0, index: 0 }, b = { ...a };
    for (let i = 0; i < 50; i++) {
      const x = -480 + i * 19.3, z = 470 - i * 17.9;
      expect(map.world.groundAt(x, z)).toBe(original.world.groundAt(x, z));
      expect(map.world.raycast(x, 40, z, 0.6, -0.8, 0, 200, a)).toBe(original.world.raycast(x, 40, z, 0.6, -0.8, 0, 200, b));
      expect(a).toEqual(b);
      expect(hills.waterDepthAt(x, z)).toBe(made.waterDepthAt(x, z));
    }
  });

  it("keeps the water through the worker, so the server wades where clients wade", async () => {
    for (const tier of ["small", "medium"]) {
      const made = mainThread(tier, 77).world.terrain!;
      const moved = (await pool.generate(tier, 77)).world.terrain!;
      expect(made.waterLevelCm, tier).not.toBeNull();
      expect([moved.waterLevelCm, moved.wadeMeters]).toEqual([made.waterLevelCm, made.wadeMeters]);
      // Somewhere really under water: the lowest corner of the map.
      let low = 0;
      for (let k = 1; k < made.heights.length; k++) if (made.heights[k]! < made.heights[low]!) low = k;
      const x = (low % made.corners) * made.cell - made.meters / 2, z = Math.floor(low / made.corners) * made.cell - made.meters / 2;
      const feet = made.heightAt(x, z);
      expect(made.wading(x, feet, z), tier).toBe(true);
      expect(moved.wading(x, feet, z), tier).toBe(true);
    }
  }, 30_000);

  it("gives every caller the map for its own seed, and starts jobs in the order they were asked for", async () => {
    const one = new MapPool(1);
    const finished: number[] = [];
    const seeds = [11, 12, 13, 14];
    const maps = await Promise.all(seeds.map((seed) => one.generate("small", seed).then((m) => { finished.push(seed); return m; })));
    await one.close();
    expect(finished).toEqual(seeds);
    maps.forEach((m, i) => expect(m.props).toEqual(mainThread("small", seeds[i]!).props));
  }, 30_000);

  it("passes on why a map could not be built, and keeps working", async () => {
    await expect(pool.generate("huge", 1)).rejects.toThrow(/Unknown tier "huge"/);
    expect((await pool.generate("small", 3)).meters).toBe(mainThread("small", 3).meters);
  }, 30_000);

  it("replaces a worker that dies, failing only the job it had", async () => {
    const dir = mkdtempSync(join(tmpdir(), "map-pool-"));
    const script = join(dir, "dies.mjs");
    writeFileSync(script, `import { parentPort } from "node:worker_threads"; parentPort.on("message", () => process.exit(3));`);
    const dying = new MapPool(1, pathToFileURL(script));
    await expect(dying.generate("small", 1)).rejects.toThrow(/exit code 3/);
    await expect(dying.generate("small", 2)).rejects.toThrow(/exit code 3/); // the replacement took the next job
    await dying.close();
  }, 30_000);

  it("refuses work once closed, and fails what was still waiting", async () => {
    const closing = new MapPool(1);
    const waiting = expect(closing.generate("large", 5)).rejects.toThrow(/closed/);
    await closing.close();
    await waiting;
    await expect(closing.generate("small", 1)).rejects.toThrow(/closed/);
  }, 30_000);

  it("never keeps a finished process alive, even if nobody closes the pool", () => {
    const pool = new URL("./MapPool.ts", import.meta.url).href;
    const code = `const { MapPool } = await import(${JSON.stringify(pool)}); const p = new MapPool(2); const m = await p.generate("small", 1); console.log("built", m.meters);`;
    const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", timeout: 20_000 });
    expect(run.stdout).toContain("built");
    expect(run.status).toBe(0); // a pool holding the process open would hit the timeout and be killed instead
  }, 30_000);
});
