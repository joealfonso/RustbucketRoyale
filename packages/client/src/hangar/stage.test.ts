import { describe, expect, it } from "vitest";
import hangarJson from "../../../../data/hangar.json";
import lifeJson from "../../../../data/hangarLife.json";
import { parseFraming } from "./framing";
import { parseHangar } from "./layout";
import { parseHangarLife } from "./life";
import { parseStageLight } from "./lighting";

// The gate V12 data files load as committed, and a broken number is caught on load rather than on screen.
describe("hangar stage, framing and life data", () => {
  const hall = parseHangar(hangarJson).hall;

  it("loads as committed", () => {
    expect(() => parseStageLight(hangarJson.light)).not.toThrow();
    expect(() => parseFraming(hangarJson.framing)).not.toThrow();
    expect(() => parseHangarLife(lifeJson, hall)).not.toThrow();
  });

  it("refuses a light with no strength or a pool you cannot see", () => {
    expect(() => parseStageLight({ ...hangarJson.light, hover: { ...hangarJson.light.hover, intensity: 0 } })).toThrow();
    expect(() => parseStageLight({ ...hangarJson.light, pools: { ...hangarJson.light.pools, opacity: 0 } })).toThrow();
  });
});
