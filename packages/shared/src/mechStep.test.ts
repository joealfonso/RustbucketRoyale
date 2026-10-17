import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import greybox from "../../../data/greybox.json";
import { createMechInput, type MechInput } from "./MechInput";
import { createMechState, moveTowardsAngle, stepMech, type MechState } from "./mechStep";
import { parseMechStats } from "./stats";
import { World, boxFromData, type Box } from "./world";

const stats = parseMechStats(mechJson);
const ground = boxFromData({ name: "g", center: [0, -0.5, 0], size: [1000, 1, 1000], color: "#fff" });
const DT = 1 / 60;

const groundWorld = new World([ground]);

function run(state: MechState, input: MechInput, seconds: number, boxes: Box[] = [ground]): void {
  const world = boxes.length === 1 && boxes[0] === ground ? groundWorld : new World(boxes);
  for (let i = 0; i < Math.round(seconds / DT); i++) stepMech(state, input, stats, DT, world);
}

// Aim yaw 0 faces -Z, so forward input moves toward negative z.
function forward(extra: Partial<MechInput> = {}): MechInput {
  return { ...createMechInput(), moveY: 1, ...extra };
}

describe("stepMech", () => {
  it("lands on the ground and stays grounded", () => {
    const s = createMechState(stats, 0, 2, 0, 0);
    run(s, createMechInput(), 1);
    expect(s.grounded).toBe(true);
    expect(s.y).toBeCloseTo(0);
  });

  it("walks at walk speed and runs faster", () => {
    const walker = createMechState(stats, 0, 0, 0, 0);
    run(walker, createMechInput(), 0.1);
    run(walker, forward(), 2);
    expect(Math.hypot(walker.vx, walker.vz)).toBeCloseTo(stats.walkSpeed, 1);

    const runner = createMechState(stats, 0, 0, 0, 0);
    run(runner, createMechInput(), 0.1);
    run(runner, forward({ run: true }), 1);
    expect(Math.hypot(runner.vx, runner.vz)).toBeCloseTo(stats.runSpeed, 1);
    expect(runner.z).toBeLessThan(0);
  });

  it("does not accelerate instantly, that is the weight", () => {
    const s = createMechState(stats, 0, 0, 0, 0);
    run(s, createMechInput(), 0.1);
    run(s, forward({ run: true }), DT);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(stats.runSpeed / 2);
  });

  it("drops to walk speed when stamina runs out", () => {
    const s = createMechState(stats, 0, 0, 0, 0);
    run(s, createMechInput(), 0.1);
    run(s, forward({ run: true }), stats.staminaMax / stats.runDrainPerSecond + 1);
    expect(s.stamina.locked).toBe(true);
    expect(s.running).toBe(false);
  });

  it("jets lift the mech and burn fuel until empty", () => {
    const s = createMechState(stats, 0, 0, 0, 0);
    run(s, createMechInput(), 0.1);
    run(s, { ...createMechInput(), jet: true }, 0.5);
    expect(s.y).toBeGreaterThan(1);
    expect(s.fuel.value).toBeLessThan(stats.fuelMax);
    run(s, { ...createMechInput(), jet: true }, 5);
    expect(s.fuel.locked).toBe(true);
    expect(s.jetting).toBe(false);
  });

  it("is stopped by a wall", () => {
    const wall = boxFromData({ name: "w", center: [0, 4, -10], size: [20, 8, 1], color: "#fff" });
    const s = createMechState(stats, 0, 0, 0, 0);
    run(s, forward({ run: true }), 4, [ground, wall]);
    expect(s.z).toBeCloseTo(-9.5 + stats.halfWidth, 1);
  });

  it("walks up a low step without jets", () => {
    const step = boxFromData({ name: "s", center: [0, 0.25, -25], size: [10, 0.5, 40], color: "#fff" });
    const s = createMechState(stats, 0, 0, 0, 0);
    run(s, forward(), 3, [ground, step]);
    expect(s.y).toBeCloseTo(0.5, 1);
  });

  it("lets the grey-box map hold a mech spawned on it", () => {
    const boxes = greybox.boxes.map((b) => boxFromData(b as never));
    const [x, y, z] = greybox.spawn as [number, number, number];
    const s = createMechState(stats, x, y, z, 0);
    run(s, createMechInput(), 1, boxes);
    expect(s.grounded).toBe(true);
  });
});

describe("dash", () => {
  const settled = () => {
    const s = createMechState(stats, 0, 0, 0, 0);
    run(s, createMechInput(), 0.2);
    return s;
  };

  it("bursts in the direction you are steering, about dashSpeed times dashSeconds far", () => {
    const s = settled();
    const startZ = s.z;
    stepMech(s, forward({ dash: true }), stats, DT, groundWorld);
    run(s, forward(), stats.dashSeconds);
    expect(startZ - s.z).toBeGreaterThan(stats.dashSpeed * stats.dashSeconds * 0.8);
    expect(s.x).toBeCloseTo(0, 3); // straight ahead, not sideways
  });

  it("goes sideways when steering sideways, and straight ahead when standing still", () => {
    const side = settled();
    stepMech(side, { ...createMechInput(), aimYaw: Math.PI, moveX: 1, dash: true }, stats, DT, groundWorld);
    expect(side.dashX).toBeCloseTo(-1); // right of a mech facing +Z is -X
    const still = settled();
    stepMech(still, { ...createMechInput(), aimYaw: Math.PI, dash: true }, stats, DT, groundWorld);
    expect(still.dashZ).toBeCloseTo(1); // ahead of a mech facing +Z
  });

  it("goes the way you tapped, even while steering another way", () => {
    const s = settled();
    // Aim yaw 0 faces -Z. Holding forward but double-tapping D dashes right (+X), not forward.
    stepMech(s, forward({ dash: true, dashMoveX: 1 }), stats, DT, groundWorld);
    expect(s.dashX).toBeCloseTo(1);
    expect(s.dashZ).toBeCloseTo(0);

    const back = settled();
    stepMech(back, forward({ dash: true, dashMoveY: -1 }), stats, DT, groundWorld);
    expect(back.dashZ).toBeCloseTo(1); // backwards from a mech facing -Z
  });

  it("costs stamina and then has to cool down", () => {
    const s = settled();
    stepMech(s, forward({ dash: true }), stats, DT, groundWorld);
    expect(s.stamina.value).toBeLessThan(stats.staminaMax);
    run(s, forward(), 0.3);
    const z = s.z;
    stepMech(s, forward({ dash: true }), stats, DT, groundWorld); // still cooling down
    expect(s.dashTime).toBeLessThanOrEqual(0);
    expect(Math.abs(s.z - z)).toBeLessThan(0.5);
    run(s, forward(), stats.dashCooldown);
    stepMech(s, forward({ dash: true }), stats, DT, groundWorld);
    expect(s.dashTime).toBeGreaterThan(0);
  });

  it("will not dash without enough stamina", () => {
    const s = settled();
    s.stamina.value = stats.dashStaminaCost - 1;
    stepMech(s, forward({ dash: true }), stats, DT, groundWorld);
    expect(s.dashTime).toBeLessThanOrEqual(0);
  });

  it("does not leave the mech faster than a run afterwards, and still stops at walls", () => {
    const s = settled();
    stepMech(s, forward({ dash: true }), stats, DT, groundWorld);
    run(s, forward(), stats.dashSeconds + 0.05);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(stats.runSpeed + 1e-6);

    const wall = boxFromData({ name: "w", center: [0, 4, -4], size: [20, 8, 1], color: "#fff" });
    const t = settled();
    stepMech(t, forward({ dash: true }), stats, DT, new World([ground, wall]));
    run(t, forward(), 0.5, [ground, wall]);
    expect(t.z).toBeGreaterThan(-3.5 + stats.halfWidth - 0.01);
  });
});

describe("moveTowardsAngle", () => {
  it("takes the short way round", () => {
    const next = moveTowardsAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.05);
    expect(next).toBeCloseTo(Math.PI - 0.05);
  });
});
