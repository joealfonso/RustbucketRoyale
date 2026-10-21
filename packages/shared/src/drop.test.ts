import { describe, expect, it } from "vitest";
import dropJson from "../../../data/drop.json";
import mechJson from "../../../data/mech.json";
import { DROP_BALL, DROP_BURNING, DROP_HANGING, DROP_NONE, ballFallSeconds, releaseDrop } from "./drop";
import { hangAtSpot, parseDropSpotStats, planDropSpots } from "./dropSpots";
import { createMechInput } from "./MechInput";
import { createMechState, stepMech } from "./mechStep";
import { parseMechStats } from "./stats";
import { World, boxFromData } from "./world";

const stats = parseMechStats(mechJson);
const ground = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [8000, 1, 8000], color: "" })]);
const DT = 1 / 60;

// Drops a ball from `height` metres at the origin, aiming at (tx, tz), until it lands.
function drop(height: number, tx: number, tz: number) {
  const s = createMechState(stats, 0, 0, 0, 0);
  hangAtSpot(s, 0, 0, ground, height);
  releaseDrop(s);
  const input = createMechInput();
  input.targetX = tx; input.targetZ = tz;
  input.jet = true; input.dash = true; input.fire = true; // none of these do anything in the air
  let seconds = 0, burst = false, landingSpeed = 0, topSteer = 0;
  while (s.dropPhase !== DROP_NONE && seconds < 120) {
    landingSpeed = -s.vy;
    stepMech(s, input, stats, DT, ground);
    if (s.dropPhase === DROP_BURNING) burst = true;
    topSteer = Math.max(topSteer, Math.hypot(s.vx, s.vz));
    seconds += DT;
  }
  return { s, seconds, burst, landingSpeed, topSteer };
}

describe("drop-in ball", () => {
  it("hangs still through the countdown, whatever is pressed", () => {
    const s = createMechState(stats, 0, 0, 0, 0);
    hangAtSpot(s, 20, -30, ground, 250);
    const input = createMechInput();
    input.moveY = 1; input.jet = true; input.targetX = 500; input.targetZ = 500;
    for (let i = 0; i < 300; i++) stepMech(s, input, stats, DT, ground);
    expect(s.dropPhase).toBe(DROP_HANGING);
    expect([s.x, s.y, s.z]).toEqual([20, 250, -30]);
    releaseDrop(s);
    expect(s.dropPhase).toBe(DROP_BALL);
  });

  it("steers onto a reachable target and lands on it", () => {
    const d = drop(250, 60, -80);
    expect(d.s.dropPhase).toBe(DROP_NONE);
    expect(Math.hypot(d.s.x - 60, d.s.z + 80)).toBeLessThan(1);
    expect(d.topSteer).toBeLessThanOrEqual(stats.ballSteer + 1e-5); // the drop state is kept at float32
  });

  it("heads for a target out of reach at the top steer speed and falls short of it", () => {
    const d = drop(250, 5000, 0);
    const reach = stats.ballSteer * d.seconds;
    expect(d.s.x).toBeLessThan(reach);
    expect(d.s.x).toBeGreaterThan(reach * 0.7);
    expect(Math.abs(d.s.z)).toBeLessThan(1e-6);
  });

  it("bursts near the ground, lands at the landing speed, then is stunned a moment", () => {
    const d = drop(250, 0, 0);
    expect(d.burst).toBe(true);
    expect(d.landingSpeed).toBeLessThanOrEqual(stats.landingFall + 0.01);
    expect(d.s.y).toBeCloseTo(0, 3);
    expect(d.s.dropTime).toBeCloseTo(stats.landingStunSeconds, 5);
    const input = createMechInput();
    input.moveY = 1;
    stepMech(d.s, input, stats, DT, ground);
    expect(Math.hypot(d.s.vx, d.s.vz)).toBe(0);
  });

  it("takes about the time ballFallSeconds says, whatever the steering", () => {
    for (const height of [150, 250, 450, 750]) {
      expect(Math.abs(drop(height, 0, 0).seconds - ballFallSeconds(height, stats))).toBeLessThan(0.25);
      expect(Math.abs(drop(height, 300, 200).seconds - ballFallSeconds(height, stats))).toBeLessThan(0.25);
    }
  });
});

describe("drop-in start spots", () => {
  const spotStats = parseDropSpotStats(dropJson.spots);

  it("are the same for the same seed, and spot i does not depend on how many are planned", () => {
    expect(planDropSpots(9, 12, ground, 1000, spotStats)).toEqual(planDropSpots(9, 12, ground, 1000, spotStats));
    expect(planDropSpots(9, 12, ground, 1000, spotStats)).not.toEqual(planDropSpots(10, 12, ground, 1000, spotStats));
    expect(planDropSpots(9, 20, ground, 1000, spotStats).slice(0, 12)).toEqual(planDropSpots(9, 12, ground, 1000, spotStats));
  });

  it("spread over the whole map, inside the edge, none close together", () => {
    for (const [meters, count] of [[300, 12], [1000, 28], [2000, 48]] as const) {
      for (let seed = 0; seed < 50; seed++) {
        const spots = planDropSpots(seed, count, ground, meters, spotStats);
        const inner = meters / 2 - spotStats.edgeMeters;
        let closest = Infinity;
        for (const a of spots) {
          expect(Math.max(Math.abs(a.x), Math.abs(a.z))).toBeLessThanOrEqual(inner);
          for (const b of spots) if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
        }
        // An even spread over the square would put them about side / sqrt(count) apart; at least a third of that.
        expect(closest).toBeGreaterThan((inner * 2) / Math.sqrt(count) / 3);
        // Reaching every quarter of the map, not bunched in one.
        const quarters = new Set(spots.map((s) => (s.x < 0 ? 0 : 1) + (s.z < 0 ? 0 : 2)));
        expect(quarters.size).toBe(4);
      }
    }
  });
});
