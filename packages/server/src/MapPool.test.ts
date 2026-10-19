import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { generatedMaps, tierNames } from "./config";
import { MapPool } from "./MapPool";
import type { MapForRoom } from "./Room";

const mainThread = generatedMaps();
const pool = new MapPool(2);
afterAll(() => pool.close());

// Everything the room uses from a map, as plain data, so two maps compare field by field.
const plain = (m: MapForRoom) => ({
  boxes: m.world.boxes, nav: { ...m.nav, top: Array.from(m.nav.top) }, spawns: m.spawns, meters: m.meters, props: m.props, propOfBox: Array.from(m.propOfBox),
});

describe("MapPool", () => {
  it("builds exactly the map the main thread builds, for a few seeds on every tier", async () => {
    for (const tier of tierNames()) {
      for (const seed of [1, 0x9e3779b9, 424242]) {
        const fromWorker = await pool.generate(tier, seed);
        expect(plain(fromWorker), `${tier} seed ${seed}`).toEqual(plain(mainThread(tier, seed)));
      }
    }
  }, 60_000);

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
