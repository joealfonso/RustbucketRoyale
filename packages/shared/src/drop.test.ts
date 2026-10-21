import { describe, expect, it } from "vitest";
import mechJson from "../../../data/mech.json";
import { DROP_BURNING, DROP_DIVING, DROP_NONE, DROP_RIDING, DROP_SHELL, launchVelocity, shellArc, shipAt, shipEndsAt } from "./drop";
import { boardShip, planShipPath } from "./shipPath";
import { createMechInput } from "./MechInput";
import { createMechState, stepMech } from "./mechStep";
import { parseMechStats } from "./stats";
import { World, boxFromData } from "./world";

const stats = parseMechStats(mechJson);
const ground = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [8000, 1, 8000], color: "" })]);
const DT = 1 / 60;
const DEG = Math.PI / 180;

// Dives from 400 m looking `pitch` degrees, holding W, until landed. Returns how long, how far and the worst speed
// it hit the ground with.
function dive(pitch: number) {
  const s = createMechState(stats, 0, 400, 0, 0);
  s.dropPhase = DROP_DIVING;
  const input = createMechInput();
  input.aimPitch = pitch * DEG;
  input.moveY = 1;
  let seconds = 0, braked = false, landingSpeed = 0;
  while (s.dropPhase !== DROP_NONE && seconds < 60) {
    landingSpeed = -s.vy;
    stepMech(s, input, stats, DT, ground);
    if (s.dropPhase === DROP_BURNING) braked = true;
    seconds += DT;
  }
  return { s, seconds, distance: Math.hypot(s.x, s.z), braked, landingSpeed };
}

describe("drop-in dive", () => {
  it("looking down drops fast and short, looking ahead slow and far", () => {
    const steep = dive(-60), level = dive(-10);
    expect(steep.s.dropPhase).toBe(DROP_NONE);
    expect(level.s.dropPhase).toBe(DROP_NONE);
    expect(steep.seconds).toBeLessThan(level.seconds);
    expect(level.distance).toBeGreaterThan(steep.distance * 2);
  });

  it("brakes on its retro-jets near the ground and lands at the landing speed, then is stunned a moment", () => {
    const d = dive(-60);
    expect(d.braked).toBe(true);
    expect(d.landingSpeed).toBeLessThanOrEqual(stats.landingFall + 0.01);
    expect(d.s.y).toBeCloseTo(0, 3);
    expect(d.s.dropTime).toBeCloseTo(stats.landingStunSeconds, 5);
    // Stunned: holding W does not move it until the stun is over.
    const input = createMechInput();
    input.moveY = 1;
    stepMech(d.s, input, stats, DT, ground);
    expect(Math.hypot(d.s.vx, d.s.vz)).toBe(0);
  });

  it("rides with the ship exactly, through walls, whatever else is pressed", () => {
    const wall = new World([...ground.boxes, boxFromData({ name: "w", center: [20, 500, 0], size: [2, 40, 40], color: "" })]);
    const s = createMechState(stats, 5, 500, 5, 0);
    s.dropPhase = DROP_RIDING;
    s.vx = 12; s.vz = -3;
    const input = createMechInput();
    input.moveY = 1; input.moveX = 1; input.dash = true; input.aimPitch = -1;
    for (let i = 0; i < 120; i++) stepMech(s, input, stats, DT, wall);
    expect(s.dropPhase).toBe(DROP_RIDING);
    expect(s.x).toBeCloseTo(5 + 12 * 120 * DT, 9);
    expect(s.z).toBeCloseTo(5 - 3 * 120 * DT, 9);
    expect(s.y).toBe(500);
  });

  it("fires out with the jet down and forward where it looks, flies the shell unsteered, then dives", () => {
    const s = createMechState(stats, 0, 400, 0, 0);
    s.dropPhase = DROP_RIDING;
    s.vx = 30;
    const input = createMechInput();
    input.jet = true;
    input.aimYaw = Math.PI / 2; // facing -X
    input.aimPitch = 0.5; // looking up: the shot is still held to the level launch pitch, downwards
    const arc = { dx: 0, dz: 0, drop: 0, vx: 0, vy: 0, vz: 0 };
    shellArc(input.aimYaw, input.aimPitch, stats, DT, arc);
    stepMech(s, input, stats, DT, ground);
    expect(s.dropPhase).toBe(DROP_SHELL);
    expect(s.vx).toBeLessThan(0); // the ship's own speed is not added: the shot goes where the pilot looks
    // Steering does nothing in the shell.
    input.jet = false; input.moveX = 1; input.moveY = -1; input.aimYaw = 0; input.aimPitch = -1.5;
    let steps = 1;
    while (s.dropPhase === DROP_SHELL) { stepMech(s, input, stats, DT, ground); steps++; }
    expect(steps).toBe(Math.round(stats.shellSeconds / DT));
    expect(s.dropPhase).toBe(DROP_DIVING);
    expect(s.dropTime).toBe(0);
    expect(s.x).toBeCloseTo(arc.dx, 6);
    expect(s.z).toBeCloseTo(arc.dz, 6);
    expect(400 - s.y).toBeCloseTo(arc.drop, 6);
    expect(arc.dx).toBeLessThan(-30); // forward, a good way
    expect(arc.drop).toBeGreaterThan(0);
    // Gravity only, from the clamped launch: the vertical speed is the launch's, less gravity over the shell.
    expect(s.vy).toBeCloseTo(Math.sin(stats.launchLevelPitch * DEG) * stats.launchSpeed - stats.gravity * steps * DT, 6);
    // Then a normal dive that lands.
    let seconds = 0;
    while (s.dropPhase !== DROP_NONE && seconds < 60) { stepMech(s, input, stats, DT, ground); seconds += DT; }
    expect(s.dropPhase).toBe(DROP_NONE);
  });

  it("holds a shot looking straight down to the steep launch pitch, so it still goes forward", () => {
    const steep = { vx: 0, vy: 0, vz: 0 }, level = { vx: 0, vy: 0, vz: 0 };
    launchVelocity(Math.PI, -Math.PI / 2, stats, steep);
    launchVelocity(Math.PI, 0, stats, level);
    expect(steep.vz).toBeGreaterThan(0); // yaw PI faces +Z
    expect(steep.vz).toBeCloseTo(Math.cos(stats.launchSteepPitch * DEG) * stats.launchSpeed, 9);
    expect(level.vy).toBeCloseTo(Math.sin(stats.launchLevelPitch * DEG) * stats.launchSpeed, 9);
    expect(Math.hypot(steep.vx, steep.vy, steep.vz)).toBeCloseTo(stats.launchSpeed, 9);
  });
});

describe("the Rustbucket's line", () => {
  const ship = { speedMeters: { small: 14 }, edgeMeters: 15, passShare: 0.5, tries: 10, slotMeters: 3, slotsPerRow: 4 };
  const circle = { cx: 40, cz: -30, radius: 60 };
  const plan = (seed: number) => planShipPath(seed, ground, 300, circle, 250, 14, ship, 5);

  it("is the same for the same seed, passes through the first circle, and goes live at the map's edge as the countdown ends", () => {
    expect(plan(77)).toEqual(plan(77));
    expect(plan(77)).not.toEqual(plan(78));
    for (let seed = 0; seed < 200; seed++) {
      const path = plan(seed);
      // Nearest the line comes to the circle's centre.
      const lx = path.x1 - path.x0, lz = path.z1 - path.z0, length = Math.hypot(lx, lz);
      const across = Math.abs(((circle.cx - path.x0) * lz - (circle.cz - path.z0) * lx) / length);
      expect(across).toBeLessThanOrEqual(circle.radius * ship.passShare + 1e-6);
      const live = { x: 0, z: 0 };
      shipAt(path, 0, live);
      const inner = 150 - ship.edgeMeters;
      expect(Math.max(Math.abs(live.x), Math.abs(live.z))).toBeCloseTo(inner, 6);
      expect(Math.max(Math.abs(path.x1), Math.abs(path.z1))).toBeCloseTo(inner, 6);
      expect(Math.max(Math.abs(path.x0), Math.abs(path.z0))).toBeGreaterThan(inner); // flies in from outside
      expect(path.y).toBe(250);
      expect(shipEndsAt(path)).toBeGreaterThan(0);
      expect(Math.hypot(path.x1 - live.x, path.z1 - live.z)).toBeGreaterThan(100); // a real ride, not a corner clip
    }
  });

  it("boards riders round the cannon, apart, moving at the ship's speed", () => {
    const path = plan(5);
    const at = { x: 0, z: 0 };
    shipAt(path, path.startAt, at);
    const riders = Array.from({ length: 12 }, (_, slot) => {
      const s = createMechState(stats, 0, 0, 0, 0);
      boardShip(s, path, path.startAt, slot, ship);
      return s;
    });
    for (const r of riders) {
      expect(r.dropPhase).toBe(DROP_RIDING);
      expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(path.speed, 4);
      expect(Math.hypot(r.x - at.x, r.z - at.z)).toBeLessThan(12);
      for (const o of riders) if (o !== r) expect(Math.hypot(r.x - o.x, r.z - o.z)).toBeGreaterThan(ship.slotMeters - 1e-6);
    }
  });
});
