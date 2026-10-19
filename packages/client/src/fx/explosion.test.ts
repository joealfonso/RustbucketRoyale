import { describe, expect, it } from "vitest";
import damageFxJson from "../../../../data/damageFx.json";
import explosionFxJson from "../../../../data/explosionFx.json";
import propFxJson from "../../../../data/propFx.json";
import { parseDamageFx } from "../damageFx";
import { parsePropFx } from "../props/breakFx";
import { parseExplosionFx } from "./explosion";

describe("effect data files", () => {
  it("read cleanly", () => {
    expect(parseExplosionFx(explosionFxJson).fireball.seconds).toBeGreaterThan(0);
    expect(parseDamageFx(damageFxJson).smoke.thinShare).toBeGreaterThan(0);
    expect(parsePropFx(propFxJson).dust.puffs).toBeGreaterThan(0);
  });

  it("fail loudly on a missing number or colour list", () => {
    expect(() => parseExplosionFx({ ...explosionFxJson, ring: { ...explosionFxJson.ring, seconds: "long" } })).toThrow(/ring.seconds/);
    expect(() => parseExplosionFx({ ...explosionFxJson, debris: { ...explosionFxJson.debris, colors: [] } })).toThrow(/debris.colors/);
    expect(() => parseDamageFx({ ...damageFxJson, sparks: { ...damageFxJson.sparks, streakSeconds: null } })).toThrow(/sparks.streakSeconds/);
    expect(() => parsePropFx({ ...propFxJson, dust: { ...propFxJson.dust, puffs: -1 } })).toThrow(/dust.puffs/);
  });
});
