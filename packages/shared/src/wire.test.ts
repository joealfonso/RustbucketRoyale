import { describe, expect, it } from "vitest";
import { createMechInput } from "./MechInput";
import { SnapshotMemory, decodeInput, decodeServerBinary, decodeShot, decodeSnapshot, encodeInput, encodeServerBinary, encodeShot, encodeSnapshot, snapshotSize } from "./wire";
import type { InputMessage, OtherState, ServerMessage, ShotMessage } from "./protocol";

type Snapshot = Extract<ServerMessage, { t: "snapshot" }>;

const other = (id: number, x: number): OtherState => ({ id, x, y: 1.25, z: -77.3, yaw: 5.5, running: true, jetting: false, dead: false, looted: false, repairing: false, bot: true, hp: [60, 33, 100], weapon: 2, armor: [0, 30, 12], upgrades: [3, -1], mech: id % 4, ability: id % 2 === 1 });
const snapshot = (others: OtherState[]): Snapshot => ({
  t: "snapshot", tick: 123456, ack: 99, ackAgeMs: 12.4,
  you: {
    x: -321.123456, y: 4.5, z: 888.25, vx: 3.5, vz: -2.25, vy: 0.5, bodyYaw: 2.75, grounded: true, running: false, jetting: true, crawling: true,
    dashTime: 0.1, dashCooldown: 0.5, dashX: 0.6, dashZ: -0.8, abilityTime: 0.35, abilityCooldown: 5.5, abilityX: -0.8, abilityZ: 0.6, fuel: 71.5, fuelLocked: false, fuelTimer: 0.25, stamina: 30, staminaLocked: true, staminaTimer: 0, fuelScale: 1.6, mech: 3,
  },
  health: { hp: [60, 12, 88], dead: false, respawnIn: 0 },
  match: { state: "active", seconds: 91.5, alive: 7, total: 24 },
  others,
  noises: [],
  loadout: { slots: [0, -1], active: 0, grenades: 2, armor: [30, 0, 40], upgrades: [-1, 1] },
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
    for (const key of ["x", "y", "z", "vx", "vz", "vy", "bodyYaw", "fuel", "stamina", "dashX", "dashZ", "abilityTime", "abilityCooldown", "abilityX", "abilityZ"] as const) {
      expect(back.you[key]).toBeCloseTo(original.you[key], 3);
    }
    expect([back.you.grounded, back.you.running, back.you.jetting, back.you.fuelLocked, back.you.staminaLocked, back.you.crawling]).toEqual([true, false, true, false, true, true]);
    expect(back.others).toHaveLength(2);
    expect(back.others[0]!.id).toBe(7);
    expect(Math.abs(back.others[0]!.x - 412.34)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(back.others[1]!.x - -999.9)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(back.others[0]).toMatchObject({ running: true, jetting: false, dead: false, bot: true, hp: [60, 33, 100], weapon: 2, armor: [0, 30, 12], upgrades: [3, -1] });
    expect(back.you.fuelScale).toBeCloseTo(1.6, 5);
    // The mech number rides in spare flag bits, next to flags that must not be disturbed.
    expect(back.you.mech).toBe(3);
    expect([back.others[0]!.mech, back.others[1]!.mech]).toEqual([7 % 4, 300 % 4]);
    expect(back.others[0]!.yaw).toBeCloseTo(5.5, 3);
  });

  it("carries who is using an ability right now, in a byte of its own", () => {
    const back = decodeSnapshot(encodeSnapshot(snapshot([other(3, 0), other(4, 0), { ...other(6, 0), dead: true, looted: true, repairing: true, ability: true }])))!;
    expect(back.others.map((o) => o.ability)).toEqual([true, false, true]);
    expect(back.others[2]).toMatchObject({ dead: true, looted: true, repairing: true, bot: true, mech: 2 });
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

  // Your own ability timers added 16 bytes (four float32s) and the ability byte one per other mech.
  it("is small: under 130 bytes with nobody else near, 21 bytes per extra mech, 9 per pickup", () => {
    expect(encodeSnapshot(snapshot([])).length).toBe(snapshotSize(0, 0, 0, 19)); // staminaTimer is 0
    expect(snapshotSize(0)).toBeLessThan(130);
    expect(snapshotSize(10) - snapshotSize(0)).toBe(210);
    expect(snapshotSize(0, 0, 10) - snapshotSize(0)).toBe(90);
  });

  it("leaves out your own numbers that are 0, a bit each instead of 4 bytes, and gives back the rest exactly", () => {
    const s = snapshot([]);
    Object.assign(s.you, { vy: 0, dashTime: 0, dashCooldown: 0, dashX: 0, dashZ: 0, abilityTime: 0, abilityCooldown: 0, abilityX: 0, abilityZ: 0, fuelTimer: 0 });
    s.you.vx = -0; // not +0, so it is sent: replaying from -0 must match the server
    const bytes = encodeSnapshot(s);
    expect(bytes.length).toBe(snapshotSize(0, 0, 0, 9));
    const back = decodeSnapshot(bytes)!;
    expect(Object.is(back.you.vx, -0)).toBe(true);
    for (const key of ["x", "y", "z", "vz", "vy", "bodyYaw", "dashTime", "dashCooldown", "dashX", "dashZ", "abilityTime", "abilityCooldown", "abilityX", "abilityZ", "fuel", "fuelTimer", "stamina", "staminaTimer", "fuelScale"] as const) {
      expect(back.you[key]).toBe(Math.fround(s.you[key]));
    }
    expect(back.you.mech).toBe(3);
  });

  it("carries your loadout and the pickups near you", () => {
    const s = snapshot([]);
    s.pickups = [{ id: 40000, item: 5, x: -12.34, y: 0.5, z: 88.8 }, { id: 3, item: 0, x: 0, y: 0, z: 0 }];
    const back = decodeSnapshot(encodeSnapshot(s))!;
    expect(back.loadout).toEqual({ slots: [0, -1], active: 0, grenades: 2, armor: [30, 0, 40], upgrades: [-1, 1] });
    expect(back.pickups).toHaveLength(2);
    expect(back.pickups![0]).toMatchObject({ id: 40000, item: 5 });
    expect(Math.abs(back.pickups![0]!.x - -12.34)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("can say the pickups are unchanged in one byte, which is not the same as none", () => {
    const s = snapshot([]);
    s.pickups = null;
    expect(decodeSnapshot(encodeSnapshot(s))!.pickups).toBeNull();
    expect(encodeSnapshot(s).length).toBe(snapshotSize(0, 0, 0, 19));
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

describe("snapshots against a connection's memory", () => {
  // A server and a client side of one connection.
  const link = () => {
    const sent = new SnapshotMemory(), read = new SnapshotMemory();
    return (s: Snapshot) => { const bytes = encodeSnapshot(s, sent); return { bytes, back: decodeSnapshot(bytes, read) }; };
  };
  const walk = (o: OtherState, metres: number): OtherState => ({ ...o, x: o.x + metres, z: o.z - metres / 2, y: o.y + 0.3 });

  it("sends a mech in full the first time, then 9 bytes a snapshot while only its position and yaw change", () => {
    const send = link();
    const first = send(snapshot([other(1, 10), other(2, 20)]));
    const full = encodeSnapshot(snapshot([other(1, 10), other(2, 20)])).length;
    expect(first.bytes.length).toBe(full);
    const second = send(snapshot([walk(other(1, 10), 1.3), { ...walk(other(2, 20), -2), yaw: 1 }]));
    expect(second.bytes.length).toBe(snapshotSize(0, 0, 0, 0) + 2 * 9); // your own numbers did not change either
  });

  it("reads back exactly what a full snapshot would, over many snapshots of moving, hurt and changing mechs", () => {
    const send = link();
    let a = other(5, -300), b = other(9, 640);
    for (let i = 0; i < 200; i++) {
      a = walk(a, 0.9 + (i % 7) * 0.31);
      b = { ...walk(b, -1.7), hp: i % 25 === 0 ? [b.hp[0]! - 1, b.hp[1]!, b.hp[2]!] : b.hp, weapon: i > 120 ? 1 : 2, upgrades: i > 150 ? [3, 0] : b.upgrades };
      const s = snapshot(i % 40 < 30 ? [a, b] : [b]); // a leaves view for a while and comes back
      expect(send(s).back).toEqual(decodeSnapshot(encodeSnapshot(s)));
    }
  });

  it("sends the details again only when one changes", () => {
    const send = link();
    const o = other(3, 0);
    send(snapshot([o]));
    const same = send(snapshot([walk(o, 1)])).bytes.length;
    const hurt = send(snapshot([{ ...walk(o, 2), hp: [59, 33, 100] }]));
    expect(hurt.bytes.length - same).toBe(9);
    expect(hurt.back!.others[0]!.hp).toEqual([59, 33, 100]);
  });

  it("sends a long jump, such as a respawn, as a full position", () => {
    const send = link();
    send(snapshot([other(4, 0)]));
    const jumped = send(snapshot([other(4, 500)]));
    expect(jumped.back!.others[0]!.x).toBeCloseTo(500, 5);
    expect(jumped.bytes.length).toBe(snapshotSize(0, 0, 0, 0) + 12);
  });

  it("leaves out your own numbers that did not change, and gives them back exactly", () => {
    const send = link();
    const s = snapshot([]);
    send(s);
    const moved = { ...s, you: { ...s.you, x: s.you.x + 0.1234567, vx: 0, fuel: 70.25 } };
    const { bytes, back } = send(moved);
    expect(bytes.length).toBe(snapshotSize(0, 0, 0, 3));
    expect(back!.you).toEqual(decodeSnapshot(encodeSnapshot(moved))!.you);
    expect(send(moved).bytes.length).toBe(snapshotSize(0, 0, 0, 0));
  });

  it("refuses a change for a mech this side was never sent, and keeps its memory as it was", () => {
    const sent = new SnapshotMemory(), read = new SnapshotMemory();
    decodeSnapshot(encodeSnapshot(snapshot([other(1, 0)]), sent), read);
    const change = encodeSnapshot(snapshot([walk(other(1, 0), 1)]), sent);
    expect(decodeSnapshot(change, new SnapshotMemory())).toBeNull();
    const before = new Map(read.others);
    expect(decodeSnapshot(change.slice(0, change.length - 1), read)).toBeNull();
    expect(read.others).toEqual(before);
    expect(decodeSnapshot(change, read)!.others[0]!.x).toBeCloseTo(1, 5);
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

  it("carries the ability key, and the aim point with it so a pounce lands where the client predicted", () => {
    const original = base({ ability: true, slot: 1, repair: true, targetX: Math.fround(4.25), targetY: Math.fround(1), targetZ: Math.fround(-30.5) });
    const back = decodeInput(encodeInput(original, false))!;
    expect(back).toMatchObject({ ability: true, slot: 1, repair: true, interact: false, targetX: 4.25, targetZ: -30.5 });
    expect(decodeInput(encodeInput(base(), false))!.ability).toBe(false);
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

  it("sends an ability moment as text, which survives a JSON round trip", () => {
    const m: ServerMessage = { t: "ability", id: 5, kind: "pounce", event: "land", x: 1.5, y: 0, z: -20 };
    expect(encodeServerBinary(m)).toBeNull();
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it("sends a decoy start with its decoys' ids as text too", () => {
    const m: ServerMessage = { t: "ability", id: 7, kind: "decoy", event: "start", x: 3, y: 0.5, z: -8, ids: [101, 102] };
    expect(encodeServerBinary(m)).toBeNull();
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
