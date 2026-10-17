import { describe, expect, it } from "vitest";
import { createMechInput } from "./MechInput";
import { decodeInput, decodeServerBinary, decodeShot, decodeSnapshot, encodeInput, encodeServerBinary, encodeShot, encodeSnapshot, snapshotSize } from "./wire";
import type { InputMessage, OtherState, ServerMessage, ShotMessage } from "./protocol";

type Snapshot = Extract<ServerMessage, { t: "snapshot" }>;

const other = (id: number, x: number): OtherState => ({ id, x, y: 1.25, z: -77.3, yaw: 5.5, running: true, jetting: false, dead: false, looted: false, repairing: false, bot: true, hp: [60, 33, 100], weapon: 2, armor: [0, 30, 12] });
const snapshot = (others: OtherState[]): Snapshot => ({
  t: "snapshot", tick: 123456, ack: 99, ackAgeMs: 12.4,
  you: {
    x: -321.123456, y: 4.5, z: 888.25, vx: 3.5, vz: -2.25, vy: 0.5, bodyYaw: 2.75, grounded: true, running: false, jetting: true, crawling: true,
    dashTime: 0.1, dashCooldown: 0.5, dashX: 0.6, dashZ: -0.8, fuel: 71.5, fuelLocked: false, fuelTimer: 0.25, stamina: 30, staminaLocked: true, staminaTimer: 0,
  },
  health: { hp: [60, 12, 88], dead: false, respawnIn: 0 },
  match: { state: "active", seconds: 91.5, alive: 7, total: 24 },
  others,
  noises: [],
  loadout: { slots: [0, -1], active: 0, grenades: 2, armor: [30, 0, 40] },
  looting: 0,
  repairing: 0,
  pickups: [],
});

describe("snapshot wire format", () => {
  it("round trips, with your own state to float precision and others rounded to centimetres", () => {
    const original = snapshot([other(7, 412.34), other(300, -999.9)]);
    const back = decodeSnapshot(encodeSnapshot(original))!;
    expect(back.tick).toBe(123456);
    expect(back.ack).toBe(99);
    expect(back.match).toEqual({ state: "active", seconds: 91.5, alive: 7, total: 24 });
    expect(back.health).toEqual({ hp: [60, 12, 88], dead: false, respawnIn: 0 });
    for (const key of ["x", "y", "z", "vx", "vz", "vy", "bodyYaw", "fuel", "stamina", "dashX", "dashZ"] as const) {
      expect(back.you[key]).toBeCloseTo(original.you[key], 3);
    }
    expect([back.you.grounded, back.you.running, back.you.jetting, back.you.fuelLocked, back.you.staminaLocked, back.you.crawling]).toEqual([true, false, true, false, true, true]);
    expect(back.others).toHaveLength(2);
    expect(back.others[0]!.id).toBe(7);
    expect(Math.abs(back.others[0]!.x - 412.34)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(back.others[1]!.x - -999.9)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(back.others[0]).toMatchObject({ running: true, jetting: false, dead: false, bot: true, hp: [60, 33, 100], weapon: 2, armor: [0, 30, 12] });
    expect(back.others[0]!.yaw).toBeCloseTo(5.5, 3);
  });

  it("carries an emptied wreck and how far through looting you are", () => {
    const s = snapshot([{ ...other(4, 1), dead: true, looted: true }]);
    s.looting = 0.6;
    s.repairing = 0.25;
    s.others[0]!.repairing = true;
    const back = decodeSnapshot(encodeSnapshot(s))!;
    expect(back.others[0]).toMatchObject({ dead: true, looted: true, repairing: true });
    expect(back.looting).toBeCloseTo(0.6, 2);
    expect(back.repairing).toBeCloseTo(0.25, 2);
  });

  it("carries the sounds heard this snapshot, to half a metre, 5 bytes each", () => {
    const s = snapshot([other(1, 2)]);
    s.noises = [{ x: 120.3, z: -455.6, kind: 3 }, { x: -1, z: 2, kind: 0 }];
    const back = decodeSnapshot(encodeSnapshot(s))!;
    expect(back.noises).toHaveLength(2);
    expect(Math.abs(back.noises[0]!.x - 120.3)).toBeLessThanOrEqual(0.25);
    expect(back.noises[0]!.kind).toBe(3);
    expect(back.others).toHaveLength(1);
    expect(encodeSnapshot(s).length - encodeSnapshot(snapshot([other(1, 2)])).length).toBe(10);
  });

  it("is small: under 110 bytes with nobody else near, 18 bytes per extra mech, 9 per pickup", () => {
    expect(encodeSnapshot(snapshot([])).length).toBe(snapshotSize(0));
    expect(snapshotSize(0)).toBeLessThan(110);
    expect(snapshotSize(10) - snapshotSize(0)).toBe(180);
    expect(snapshotSize(0, 0, 10) - snapshotSize(0)).toBe(90);
  });

  it("carries your loadout and the pickups near you", () => {
    const s = snapshot([]);
    s.pickups = [{ id: 40000, item: 5, x: -12.34, y: 0.5, z: 88.8 }, { id: 3, item: 0, x: 0, y: 0, z: 0 }];
    const back = decodeSnapshot(encodeSnapshot(s))!;
    expect(back.loadout).toEqual({ slots: [0, -1], active: 0, grenades: 2, armor: [30, 0, 40] });
    expect(back.pickups).toHaveLength(2);
    expect(back.pickups![0]).toMatchObject({ id: 40000, item: 5 });
    expect(Math.abs(back.pickups![0]!.x - -12.34)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("can say the pickups are unchanged in one byte, which is not the same as none", () => {
    const s = snapshot([]);
    s.pickups = null;
    expect(decodeSnapshot(encodeSnapshot(s))!.pickups).toBeNull();
    expect(encodeSnapshot(s).length).toBe(snapshotSize(0));
    s.pickups = [];
    expect(decodeSnapshot(encodeSnapshot(s))!.pickups).toEqual([]);
  });

  it("works with nobody else, and with the biggest crowd it can hold", () => {
    expect(decodeSnapshot(encodeSnapshot(snapshot([])))!.others).toEqual([]);
    const crowd = Array.from({ length: 255 }, (_, i) => other(i, i));
    expect(decodeSnapshot(encodeSnapshot(snapshot(crowd)))!.others).toHaveLength(255);
  });

  it("keeps the match state and a dead flag", () => {
    for (const state of ["lobby", "countdown", "active", "results"] as const) {
      const s = snapshot([]); s.match.state = state; s.health.dead = true; s.health.respawnIn = 2.2;
      const back = decodeSnapshot(encodeSnapshot(s))!;
      expect(back.match.state).toBe(state);
      expect(back.health).toMatchObject({ dead: true, respawnIn: 3 });
    }
  });

  it("refuses a truncated or padded packet", () => {
    const bytes = encodeSnapshot(snapshot([other(1, 1)]));
    expect(decodeSnapshot(bytes.slice(0, bytes.length - 1))).toBeNull();
    const padded = new Uint8Array(bytes.length + 3); padded.set(bytes);
    expect(decodeSnapshot(padded)).toBeNull();
  });
});

describe("shot wire format", () => {
  const shot: ShotMessage = { t: "shot", id: 12, ox: -14.5, oy: 2.4, oz: 300.25, dx: 0.6, dy: -0.8, dz: 0, length: 87.654, hitMech: true };

  it("round trips closely, with a unit direction", () => {
    const back = decodeShot(encodeShot(shot))!;
    expect(back).toMatchObject({ t: "shot", id: 12, hitMech: true });
    expect(back.ox).toBeCloseTo(-14.5, 4);
    expect(back.dx).toBeCloseTo(0.6, 3);
    expect(back.dy).toBeCloseTo(-0.8, 3);
    expect(back.length).toBeCloseTo(87.65, 2);
    expect(Math.hypot(back.dx, back.dy, back.dz)).toBeCloseTo(1, 6);
  });

  it("is 24 bytes", () => {
    expect(encodeShot(shot).length).toBe(24);
  });
});

describe("input wire format", () => {
  const base = (extra: Partial<InputMessage> = {}): InputMessage => ({
    t: "input", seq: 77, ...createMechInput(), moveX: 1, moveY: -1, aimYaw: Math.fround(-12.34567), aimPitch: Math.fround(0.4321),
    run: true, jet: false, dash: true, fire: false, grenade: false, slot: 0, interact: false, targetX: 0, targetY: 0, targetZ: 0, ...extra,
  });

  it("round trips exactly for the values a client really sends", () => {
    const original = base({ fire: true, targetX: Math.fround(10.5), targetY: Math.fround(-2), targetZ: Math.fround(300.125), lagMs: 85 });
    const back = decodeInput(encodeInput(original, true))!;
    expect(back).toEqual({ ...original, watchId: undefined });
  });

  it("carries the weapon slot wanted, E and F", () => {
    const back = decodeInput(encodeInput(base({ slot: 1, interact: true, repair: true }), false))!;
    expect(back.slot).toBe(1);
    expect(back.interact).toBe(true);
    expect(back.repair).toBe(true);
    expect(decodeInput(encodeInput(base(), false))).toMatchObject({ slot: 0, interact: false, repair: false });
  });

  it("carries who a knocked out player is watching", () => {
    const back = decodeInput(encodeInput(base({ watchId: 42, lagMs: 30 }), false))!;
    expect(back.watchId).toBe(42);
    expect(back.lagMs).toBe(30);
    expect(decodeInput(encodeInput(base(), false))!.watchId).toBeUndefined();
  });

  it("leaves the target out when not shooting, which makes it smaller", () => {
    const small = encodeInput(base(), false);
    const big = encodeInput(base({ fire: true }), true);
    expect(small.length).toBeLessThan(big.length);
    expect(small.length).toBeLessThanOrEqual(20);
    expect(decodeInput(small)).toMatchObject({ seq: 77, moveX: 1, moveY: -1, run: true, dash: true, fire: false });
  });

  it("rejects wrong lengths, an unknown type and junk numbers", () => {
    const good = encodeInput(base(), false);
    expect(decodeInput(good.slice(0, 10))).toBeNull();
    const padded = new Uint8Array(good.length + 1); padded.set(good);
    expect(decodeInput(padded)).toBeNull();
    const wrongType = good.slice(); wrongType[0] = 9;
    expect(decodeInput(wrongType)).toBeNull();
    const nan = encodeInput(base({ aimYaw: NaN }), false);
    expect(decodeInput(nan)).toBeNull();
    const zeroSeq = encodeInput(base({ seq: 0 }), false);
    expect(decodeInput(zeroSeq)).toBeNull();
  });

  it("clamps an absurd lag claim and an out of range pitch like the text path does", () => {
    const back = decodeInput(encodeInput(base({ lagMs: 60000, aimPitch: 9 }), false))!;
    expect(back.lagMs).toBe(1000);
    expect(back.aimPitch).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe("server binary dispatch", () => {
  it("packs snapshots and shots and leaves everything else to text", () => {
    expect(encodeServerBinary(snapshot([]))).not.toBeNull();
    expect(encodeServerBinary({ t: "result", winnerId: 1 })).toBeNull();
    expect(decodeServerBinary(encodeServerBinary(snapshot([]))!)!.t).toBe("snapshot");
    expect(decodeServerBinary(new Uint8Array([9, 9, 9]))).toBeNull();
  });
});
