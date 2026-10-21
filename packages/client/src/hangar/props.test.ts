import { describe, expect, it } from "vitest";
import hangarJson from "../../../../data/hangar.json";
import mechKitsJson from "../../../../data/mechKits.json";
import propsJson from "../../../../data/hangarProps.json";
import { parseHangar } from "./layout";
import { distanceToSegment, parseHangarProps } from "./props";

const hangar = parseHangar(hangarJson);
const schemes = Object.fromEntries(Object.entries(mechKitsJson.kits).map(([id, k]) => [id, (k as { scheme?: Record<string, string> }).scheme ?? {}]));
const withWorkshop = (item: unknown) => ({ ...propsJson, workshop: [item] });

describe("hangar props", () => {
  it("reads data/hangarProps.json, every prop clear of the mechs' walks", () => {
    expect(() => parseHangarProps(propsJson, hangar, schemes)).not.toThrow();
  });

  it("refuses a prop in a mech's way, in the loading bay, or of a kind it cannot build", () => {
    // Halfway along the walk from the left-most bay to the loading bay.
    expect(() => parseHangarProps(withWorkshop({ kind: "toolCart", at: [-6.2, -4.75], turnDegrees: 0 }), hangar, schemes)).toThrow(/in a mech's way/);
    expect(() => parseHangarProps(withWorkshop({ kind: "toolCart", at: [5, 0], turnDegrees: 0 }), hangar, schemes)).toThrow(/loading bay/);
    expect(() => parseHangarProps(withWorkshop({ kind: "sofa", at: [17, -6], turnDegrees: 0 }), hangar, schemes)).toThrow(/sofa/);
  });

  it("dresses a bay only in colours from its own mech's scheme", () => {
    const bays = { ...propsJson.bays, longshot: { ...propsJson.bays.longshot, accents: { ...propsJson.bays.longshot.accents, main: "teal" } } };
    expect(() => parseHangarProps({ ...propsJson, bays }, hangar, schemes)).toThrow(/longshot.accents.main/);
  });

  it("measures distance to a walk, ends included", () => {
    expect(distanceToSegment(0, 1, -1, 0, 1, 0)).toBeCloseTo(1);
    expect(distanceToSegment(3, 0, -1, 0, 1, 0)).toBeCloseTo(2);
  });
});
