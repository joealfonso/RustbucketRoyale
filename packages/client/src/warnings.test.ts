import { describe, expect, it } from "vitest";
import { createWarningInput, parseWarnings, shownWarnings, warningMask, type WarningInput } from "./warnings";
import warningsJson from "../../../data/warnings.json";

const config = parseWarnings(warningsJson);
const maxHp = [60, 60, 100];

function state(change: Partial<WarningInput> = {}): WarningInput {
  return { ...createWarningInput(), hp: [60, 60, 100], maxHp, ...change };
}
const ids = (s: WarningInput) => shownWarnings(warningMask(s, config), config).map((w) => w.id);

describe("warnings", () => {
  it("shows nothing for a healthy mech inside the zone", () => {
    expect(ids(state())).toEqual([]);
  });

  it("names each broken part and the zone", () => {
    expect(ids(state({ outside: true }))).toEqual(["outside"]);
    expect(ids(state({ hp: [0, 60, 100] }))).toEqual(["legsBroken"]);
    expect(ids(state({ hp: [60, 0, 100] }))).toEqual(["armsBroken"]);
    expect(ids(state({ hp: [60, 60, 20] }))).toEqual(["torsoCritical"]);
    expect(ids(state({ hp: [60, 60, 30] }))).toEqual([]);
  });

  it("warns about low fuel only while the jets are held, and empty fuel whenever it is locked", () => {
    expect(ids(state({ fuelFraction: 0.1 }))).toEqual([]);
    expect(ids(state({ fuelFraction: 0.1, jetHeld: true }))).toEqual(["fuelLow"]);
    expect(ids(state({ fuelFraction: 0.5, jetHeld: true }))).toEqual([]);
    expect(ids(state({ fuelFraction: 0, fuelLocked: true, jetHeld: true }))).toEqual(["fuelEmpty"]);
    expect(ids(state({ fuelFraction: 0, fuelLocked: true }))).toEqual(["fuelEmpty"]);
  });

  it("orders by priority and caps the count", () => {
    const everything = state({ outside: true, hp: [0, 0, 10], fuelLocked: true });
    const shown = ids(everything);
    expect(shown).toHaveLength(config.maxShown);
    expect(shown).toEqual(config.warnings.map((w) => w.id).filter((id) => ["outside", "torsoCritical", "legsBroken", "armsBroken", "fuelEmpty"].includes(id)).slice(0, config.maxShown));
    expect(shown[0]).toBe("outside");
  });

  it("is silent while dead", () => {
    expect(ids(state({ dead: true, outside: true, hp: [0, 0, 0] }))).toEqual([]);
  });

  it("gives danger and caution different markers and levels in the data", () => {
    expect(config.warnings.find((w) => w.id === "outside")!.level).toBe("danger");
    expect(config.warnings.find((w) => w.id === "fuelLow")!.level).toBe("caution");
  });

  it("rejects an unknown warning or a bad cap", () => {
    expect(() => parseWarnings({ ...warningsJson, maxShown: 0 })).toThrow();
    expect(() => parseWarnings({ ...warningsJson, warnings: [{ id: "nope", text: "x", level: "danger" }] })).toThrow();
  });
});
