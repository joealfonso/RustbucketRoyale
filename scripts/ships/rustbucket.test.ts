// The written Rustbucket model and data/shipKit.json must agree: the client finds parts and mount points by name in
// the model and reads their directions from the kit, so a rebuild that renames or moves one breaks both at once.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countTriangles, readGltfJson } from "../assets/glbCheck";
import { parseKits } from "../../packages/client/src/mechKit";

const root = new URL("../..", import.meta.url).pathname;
const kit = JSON.parse(readFileSync(`${root}data/shipKit.json`, "utf8"));
const gltf = readGltfJson(readFileSync(`${root}assets/models/ship/Ship_Rustbucket.glb`));
const nodes = gltf.nodes as { name?: string; translation?: number[] }[];
const node = (name: string) => nodes.find((n) => n.name === name);

describe("Ship_Rustbucket", () => {
  it("is a kit the client's kit loader accepts", () => {
    expect(() => parseKits(kit)).not.toThrow();
  });

  it("has every part the kit paints, within the near budget", () => {
    for (const part of Object.keys(kit.kits.rustbucket.parts)) expect(node(part), part).toBeDefined();
    expect(countTriangles(gltf)).toBeLessThanOrEqual(20000);
  });

  it("has the mount points the kit lists, at the same places", () => {
    const m = kit.mounts;
    expect(node("Mount_Cannon_Muzzle")?.translation).toEqual(m.cannonMuzzle.at);
    expect(node("Mount_Cannon_Breech")?.translation).toEqual(m.cannonBreech.at);
    expect(node("Mount_Bay")?.translation).toEqual(m.bay.at);
    expect(node("Mount_Camera")?.translation).toEqual(m.camera.at);
    m.engines.forEach((e: { at: number[] }, i: number) => expect(node(`Mount_Engine_${i + 1}`)?.translation).toEqual(e.at));
    m.slots.forEach((s: number[], i: number) => expect(node(`Mount_Slot_${i + 1}`)?.translation).toEqual(s));
  });

  it("points the cannon down and back, along the line from breech to muzzle", () => {
    const { at, direction } = kit.mounts.cannonMuzzle;
    const from = kit.mounts.cannonBreech.at;
    const line = at.map((v: number, i: number) => v - from[i]);
    const length = Math.hypot(...line);
    line.forEach((v: number, i: number) => expect(v / length).toBeCloseTo(direction[i], 2));
    expect(direction[1]).toBeLessThan(0); // down
    expect(direction[2]).toBeGreaterThan(0); // back (the bow is -Z)
  });
});
