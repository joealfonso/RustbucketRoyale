import { describe, expect, it } from "vitest";
import mechJson from "../../../../data/mech.json";
import dressingJson from "../../../../data/dressing.json";
import { parseMechStats } from "@rustbucket/shared";
import { buildPlayMap } from "../loadMap";
import { COVER_KINDS, parseCover } from "./coverConfig";
import { CoverSites, ITEM_FLOATS, MAX_HEIGHT, planCell } from "./coverPlan";
import { bladeShade, coverModel } from "./coverShapes";

const config = parseCover(dressingJson.cover);
const mech = parseMechStats(mechJson);
const map = buildPlayMap("medium", 11, mech);
const sites = new CoverSites(map, config);

// Every clump in a block of cells round a point.
function itemsAround(x: number, z: number, reach = 6): number[][] {
  const [cx, cz] = sites.cellOf(x, z);
  const out: number[][] = [];
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= sites.cellsPerSide || nz >= sites.cellsPerSide) continue;
      const items = planCell(sites, map, config, nx, nz);
      for (let i = 0; i < items.length; i += ITEM_FLOATS) out.push([...items.slice(i, i + ITEM_FLOATS)]);
    }
  }
  return out;
}

describe("ground cover", () => {
  it("is the same for the same map and cell", () => {
    for (const [cx, cz] of [[10, 10], [40, 70], [100, 3]] as const) {
      expect([...planCell(sites, map, config, cx, cz)]).toEqual([...planCell(new CoverSites(map, config), map, config, cx, cz)]);
    }
  });

  it("covers open ground densely, and differs between cells", () => {
    const items = itemsAround(map.spawn[0], map.spawn[2]);
    expect(items.length).toBeGreaterThan(1500);
    const kinds = new Set(items.map((i) => i[0]));
    expect(kinds.size).toBe(COVER_KINDS.length);
    expect([...planCell(sites, map, config, 20, 20)]).not.toEqual([...planCell(sites, map, config, 21, 20)]);
  });

  it("grows nothing in the water, inside a box, or under one standing low over the ground", () => {
    const water = map.terrain!.waterLevel;
    // Boxes filed by 10 m square, so each clump is checked against the few near it, not all of them.
    const near = new Map<string, number[]>();
    map.boxes.forEach((b, k) => {
      if (k === 0) return;
      for (let x = Math.floor(b.minX / 10); x <= Math.floor(b.maxX / 10); x++) {
        for (let z = Math.floor(b.minZ / 10); z <= Math.floor(b.maxZ / 10); z++) {
          const key = `${x},${z}`;
          near.set(key, [...(near.get(key) ?? []), k]);
        }
      }
    });
    const problems: string[] = [];
    let checked = 0;
    // Every fourth cell each way across the whole map, so wet ground and buildings are both crossed.
    for (let cz = 0; cz < sites.cellsPerSide; cz += 4) {
      for (let cx = 0; cx < sites.cellsPerSide; cx += 4) {
        const items = planCell(sites, map, config, cx, cz);
        for (let i = 0; i < items.length; i += ITEM_FLOATS) {
          const x = items[i + 1]!, z = items[i + 3]!, ground = map.terrain!.heightAt(x, z);
          checked++;
          if (ground < water + 0.05) problems.push(`in the water at ${x.toFixed(1)}, ${z.toFixed(1)}`);
          for (const k of near.get(`${Math.floor(x / 10)},${Math.floor(z / 10)}`) ?? []) {
            const b = map.boxes[k]!;
            if (b.maxY < ground + 0.05 || b.minY > ground + 1) continue;
            if (x > b.minX - 0.2 && x < b.maxX + 0.2 && z > b.minZ - 0.2 && z < b.maxZ + 0.2) problems.push(`inside box ${k} at ${x.toFixed(1)}, ${z.toFixed(1)}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
    expect(Number.isFinite(water)).toBe(true);
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("keeps plants off the hard ground round buildings: rubble and junk only there", () => {
    const buildings = map.boxes.map((b, i) => ({ b, kind: map.kinds[i]! >= 0 ? map.kindNames[map.kinds[i]!] : "" }))
      .filter(({ kind }) => kind === "sheet" || kind === "container" || kind === "ruin" || kind === "tower");
    expect(buildings.length).toBeGreaterThan(0);
    const plants = new Set(["grass", "fern"].map((k) => COVER_KINDS.indexOf(k as never)));
    let onPads = 0;
    const problems: string[] = [];
    for (const { b } of buildings.slice(0, 40)) {
      for (const item of itemsAround((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, 2)) {
        const x = item[1]!, z = item[3]!;
        const d = Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
        if (d > config.padMeters) continue;
        onPads++;
        if (plants.has(item[0]!)) problems.push(`a ${COVER_KINDS[item[0]!]} ${d.toFixed(2)} m from a building at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
    }
    expect(onPads).toBeGreaterThan(0);
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("leaves open ground to plants: junk only gathers round buildings, and bare ground stays mostly bare", () => {
    const junk = new Set(["rubble", "scrap"].map((k) => COVER_KINDS.indexOf(k as never)));
    let open = 0;
    const problems: string[] = [];
    for (const item of itemsAround(map.spawn[0], map.spawn[2])) {
      // Clumps are stored as 32-bit floats, so one on a slope right at the limit can read back as open ground.
      if (sites.groundAt(item[1]!, item[3]!) !== "open" || sites.slopeAt(item[1]!, item[3]!) > config.slopeAbove - 0.02) continue;
      open++;
      if (junk.has(item[0]!)) problems.push(`a ${COVER_KINDS[item[0]!]} on open ground at ${item[1]!.toFixed(1)}, ${item[3]!.toFixed(1)}`);
    }
    expect(open).toBeGreaterThan(500);
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("grows grass in patches with bare ground between, not an even sprinkle", () => {
    // Clumps per 3 m square over the 13 by 13 cells round the spawn: plenty of squares are bare, and of the rest
    // most are lush rather than a lone clump. Before V11 only about one square in seven was bare. The squares were
    // 2 m until V16a made the clumps fewer and bigger.
    const squares = new Map<string, number>();
    for (const item of itemsAround(map.spawn[0], map.spawn[2])) {
      const key = `${Math.floor(item[1]! / 3)},${Math.floor(item[3]! / 3)}`;
      squares.set(key, (squares.get(key) ?? 0) + 1);
    }
    const counts = [...squares.values()];
    const all = ((13 * config.cellMeters) / 3) ** 2;
    const lush = counts.filter((n) => n >= 3).length, sparse = counts.filter((n) => n === 1).length;
    expect(1 - counts.length / all).toBeGreaterThan(0.35);
    expect(lush).toBeGreaterThan(sparse * 2);
  });

  it("sits on the ground and stays low enough never to read as cover", () => {
    const problems: string[] = [];
    for (const item of itemsAround(map.spawn[0], map.spawn[2], 3)) {
      const ground = map.terrain!.heightAt(item[1]!, item[3]!);
      if (item[2]! > ground + 0.001 || item[2]! < ground - 0.5) problems.push(`at ${item[2]} over ground ${ground}`);
      if (item[6]! > MAX_HEIGHT) problems.push(`too tall: ${item[6]}`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("each kind's model is small and cheap", () => {
    for (const kind of COVER_KINDS) {
      const pieces = coverModel(kind, config.grass);
      let triangles = 0, top = 0, reach = 0;
      for (const { mesh } of pieces) {
        triangles += mesh.indices.length / 3;
        for (let i = 0; i < mesh.positions.length; i += 3) {
          top = Math.max(top, mesh.positions[i + 1]!);
          reach = Math.max(reach, Math.hypot(mesh.positions[i]!, mesh.positions[i + 2]!));
          expect(Number.isFinite(mesh.positions[i]!)).toBe(true);
        }
      }
      expect(triangles, kind).toBeLessThan(110);
      expect(top, kind).toBeLessThan(0.85);
      expect(reach, kind).toBeLessThan(0.85);
    }
  });

  it("draws grass as a few broad blades in one green, dark at the root and lighter up the blade", () => {
    const g = config.grass;
    const pieces = coverModel("grass", g);
    expect(pieces.length).toBe(g.blades);
    expect(new Set(pieces.map((p) => p.paint)).size).toBe(1);
    expect(bladeShade(0, g)).toBeCloseTo(g.rootShade, 6);
    expect(bladeShade(g.rootMeters, g)).toBeCloseTo(g.tipShade, 6);
    expect(bladeShade(g.rootMeters * 3, g)).toBeCloseTo(g.tipShade, 6);
    expect(bladeShade(g.rootMeters / 2, g)).toBeGreaterThan(g.rootShade);
    expect(bladeShade(-0.05, g)).toBeCloseTo(g.rootShade, 6);
  });

  it("rejects grass with no blades or a root brighter than the tip", () => {
    expect(() => parseCover({ ...dressingJson.cover, grass: { ...dressingJson.cover.grass, blades: 0 } })).toThrow(/grass/);
    expect(() => parseCover({ ...dressingJson.cover, grass: { ...dressingJson.cover.grass, rootShade: 1.2 } })).toThrow(/grass/);
  });

  it("rejects a mix with no weight", () => {
    const bad = structuredClone(dressingJson.cover);
    bad.mixes.open = { grass: 0, weeds: 0, fern: 0, rubble: 0, scrap: 0 };
    expect(() => parseCover(bad)).toThrow(/mixes.open/);
  });
});
