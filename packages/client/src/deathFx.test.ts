import { describe, expect, it } from "vitest";
import deathFxJson from "../../../data/deathFx.json";
import { parseDeathFx } from "./deathFx";
import { vfxConfig } from "./fx/quality";

const copy = () => JSON.parse(JSON.stringify(deathFxJson)) as Record<string, Record<string, unknown>>;

describe("parseDeathFx", () => {
  it("accepts the data file", () => {
    expect(parseDeathFx(deathFxJson).torso.seconds).toBeGreaterThan(0);
  });

  it("rejects a missing, negative or wrong-kind number", () => {
    const missing = copy(); delete missing.pieces!.speed;
    expect(() => parseDeathFx(missing)).toThrow(/pieces.speed/);
    const negative = copy(); negative.torso!.meters = -1;
    expect(() => parseDeathFx(negative)).toThrow(/torso.meters/);
    const fraction = copy(); (fraction as Record<string, unknown>).maxWrecks = 2.5;
    expect(() => parseDeathFx(fraction)).toThrow(/maxWrecks/);
    const legs = copy(); legs.pieces!.legs = 2;
    expect(() => parseDeathFx(legs)).toThrow(/legs/);
    const hook = copy(); hook.smoke!.model = 3;
    expect(() => parseDeathFx(hook)).toThrow(/smoke.model/);
  });

  it("is settled within about 3 s, as the brief asks", () => {
    expect(deathFxJson.torso.seconds).toBeLessThanOrEqual(3);
  });

  it("has a cap on flying pieces and pouring smoke in every effects level, lower on low", () => {
    for (const level of Object.values(vfxConfig.levels)) {
      expect(level.deathPieces).toBeDefined();
      expect(level.deathSmoke).toBeDefined();
    }
    expect(vfxConfig.levels.low!.deathPieces!).toBeLessThan(vfxConfig.levels.normal!.deathPieces!);
    expect(vfxConfig.levels.low!.deathSmoke!).toBeLessThan(vfxConfig.levels.normal!.deathSmoke!);
  });
});
