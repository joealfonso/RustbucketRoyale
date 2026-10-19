import { describe, expect, it } from "vitest";
import { NOISE_KINDS } from "@rustbucket/shared";
import radarJson from "../../../data/radar.json";
import { parseRadar, shapesByKind, warnByKind } from "./radarData";
import { placeOnRadar, sweepAngle } from "./radarMath";

const config = parseRadar(radarJson);

describe("radar marks", () => {
  it("gives every sound kind a shape, in the order the server sends kinds", () => {
    const shapes = shapesByKind(config);
    expect(shapes).toHaveLength(NOISE_KINDS.length);
    NOISE_KINDS.forEach((kind, i) => expect(shapes[i]).toBe(config.marks[kind]));
  });

  it("never tells two warning-red kinds apart by colour alone", () => {
    const shapes = shapesByKind(config);
    const red = warnByKind(config).flatMap((warn, i) => (warn ? [shapes[i]] : []));
    expect(new Set(red).size).toBe(red.length);
  });

  it("rejects a data file that leaves a sound kind without a shape", () => {
    const { run: _run, ...rest } = config.marks;
    expect(() => parseRadar({ ...config, marks: rest })).toThrow(/marks\.run/);
    expect(() => parseRadar({ ...config, marks: { ...config.marks, shot: "star" } })).toThrow(/marks\.shot/);
  });
});

describe("radar placement", () => {
  const out = { x: 0, y: 0 };

  it("puts what is ahead at the top and what is to the right on the right", () => {
    // Facing yaw 0 looks down -z.
    placeOnRadar(0, -10, 0, 2, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(-20);
    placeOnRadar(10, 0, 0, 2, out);
    expect(out.x).toBeCloseTo(20);
    expect(out.y).toBeCloseTo(0);
  });

  it("turns with you, so whatever you face is always up", () => {
    // A quarter turn right faces +x, so something there is now straight up.
    const yaw = -Math.PI / 2;
    placeOnRadar(10, 0, yaw, 1, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(-10);
  });

  it("scales distance by the range", () => {
    const range = 150, mid = 75;
    placeOnRadar(0, -range, 0, mid / range, out);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(mid);
  });
});

describe("radar sweep", () => {
  it("starts straight up, turns clockwise and comes round once per sweep", () => {
    const period = config.sweepSeconds;
    expect(sweepAngle(0, period)).toBeCloseTo(-Math.PI / 2);
    expect(sweepAngle(period * 250, period)).toBeCloseTo(0);
    expect(sweepAngle(period * 1000, period)).toBeCloseTo(-Math.PI / 2);
    expect(sweepAngle(period * 1000 * 7.5, period)).toBeCloseTo(Math.PI / 2);
  });
});
