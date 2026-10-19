import * as THREE from "three";
import { describe, expect, it } from "vitest";
import zonesJson from "../../../data/zones.json";
import { STEP, ZONE_ARMS, createZoneHit, parseZones, type OtherState } from "@rustbucket/shared";
import { RemoteMechs } from "./remoteMechs";

const INTERVAL = 3 * STEP * 1000; // snapshots every 3 ticks
const other = (id: number, x: number): OtherState => ({ id, x, y: 0, z: 0, yaw: 0, running: false, jetting: false, dead: false, looted: false, repairing: false, bot: false, hp: [60, 60, 100], weapon: 0, armor: [0, 0, 0], upgrades: [-1, -1], mech: 0, ability: false });
const tickMs = (tick: number) => tick * STEP * 1000;

function make() {
  const scene = new THREE.Scene();
  const remotes = new RemoteMechs(scene, 15, 200, INTERVAL, [60, 60, 100]);
  return { scene, remotes };
}

// A mech moving along x at 10 m/s, snapshots arriving after `latency` ms plus whatever `jitter` returns.
function feed(remotes: RemoteMechs, ticks: number, latency: number, jitter: (i: number) => number): number {
  let now = 0;
  for (let i = 1; i * 3 <= ticks; i++) {
    const tick = i * 3;
    now = tickMs(tick) + latency + jitter(i);
    remotes.push([other(1, (tickMs(tick) / 1000) * 10)], tick, now);
  }
  return now;
}

describe("RemoteMechs", () => {
  it("on a clean connection shows others about one snapshot plus the buffer behind, much less than a fixed 100 ms", () => {
    const { remotes } = make();
    feed(remotes, 300, 20, () => 0);
    expect(remotes.viewDelayMs).toBeGreaterThan(INTERVAL);
    expect(remotes.viewDelayMs).toBeLessThan(75);
  });

  it("puts the mech where it was at the moment it draws, not the latest snapshot", () => {
    const { remotes, scene } = make();
    const last = feed(remotes, 300, 20, () => 0);
    remotes.update(last + 4); // draw a little after the newest snapshot arrived
    const mesh = scene.children[0]!;
    const drawnAt = mesh.position.x / 10; // seconds of server time that x corresponds to
    const serverNow = (last + 4 - 20) / 1000; // what the server clock said, as far as the client can tell
    expect(serverNow - drawnAt).toBeCloseTo(remotes.viewDelayMs / 1000, 1);
  });

  it("tells the walk how fast a mech is moving where it is drawn, and that it stands still once updates stop", () => {
    const { remotes } = make();
    const last = feed(remotes, 300, 20, () => 0);
    remotes.update(last + 4);
    let speed = -1;
    remotes.forEachNear(0, 0, 1e6, (_model, _mech, vx, vy, vz) => { speed = Math.hypot(vx, vy, vz); });
    expect(speed).toBeCloseTo(10, 3);
    remotes.update(last + 1000); // long past the newest snapshot: it holds still, so its legs must too
    remotes.forEachNear(0, 0, 1e6, (_model, _mech, vx) => { speed = vx; });
    expect(speed).toBe(0);
  });

  it("says which mech someone is and whether they are using their ability, for the walk and the slam ring", () => {
    const { remotes } = make();
    expect(remotes.mechOf(1)).toBe(-1);
    remotes.push([{ ...other(1, 0), mech: 1, ability: true }], 0, 0);
    expect(remotes.mechOf(1)).toBe(1);
    let using = false;
    remotes.forEachNear(0, 0, 1e6, (_model, _mech, _vx, _vy, _vz, _jetting, _running, ability) => { using = ability; });
    expect(using).toBe(true);
  });

  it("moves smoothly through steady jitter instead of stuttering", () => {
    const { remotes, scene } = make();
    // Snapshots every 50 ms, each arriving 20 ms plus up to 24 ms late in a repeating pattern, and a frame every 16.7 ms.
    const arrivals = Array.from({ length: 200 }, (_, i) => ({ tick: (i + 1) * 3, at: tickMs((i + 1) * 3) + 20 + (i % 4) * 8 }));
    const xs: number[] = [];
    let next = 0;
    for (let now = 0; now < 8000; now += 16.7) {
      while (next < arrivals.length && arrivals[next]!.at <= now) {
        const a = arrivals[next++]!;
        remotes.push([other(1, (tickMs(a.tick) / 1000) * 10)], a.tick, a.at);
      }
      remotes.update(now);
      if (now > 3000 && scene.children[0]) xs.push(scene.children[0].position.x);
    }
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    // About 10 m/s * 16.7 ms each frame, with no frame standing still or leaping.
    expect(steps.length).toBeGreaterThan(200);
    for (const step of steps) {
      expect(step).toBeGreaterThan(0.1);
      expect(step).toBeLessThan(0.25);
    }
  });

  it("grows its delay when the connection is jittery, and stays under the cap", () => {
    const calm = make();
    feed(calm.remotes, 600, 20, () => 0);
    const rough = make();
    feed(rough.remotes, 600, 20, (i) => (i % 3 === 0 ? 70 : 0));
    expect(rough.remotes.viewDelayMs).toBeGreaterThan(calm.remotes.viewDelayMs + 15);
    expect(rough.remotes.viewDelayMs).toBeLessThanOrEqual(200);
  });

  it("drops a mech that is no longer in the snapshots", () => {
    const { remotes, scene } = make();
    feed(remotes, 30, 20, () => 0);
    expect(scene.children.length).toBe(1);
    remotes.push([], 33, 1000);
    expect(scene.children.length).toBe(0);
  });

  it("finds the mech under a ray, by its hit zones where it is drawn, so the crosshair can aim at an arm", () => {
    const { remotes } = make();
    const zones = parseZones(zonesJson);
    feed(remotes, 30, 0, () => 0);
    remotes.update(1e9);
    const hit = createZoneHit();
    const p = new THREE.Vector3();
    remotes.positionOf(1, p);
    // From 20 m in front (yaw 0 faces -Z), straight at the left arm, 1.2 m to the mech's left.
    const distance = remotes.raycast(p.x - 1.2, 2.4, p.z - 20, 0, 0, 1, 300, () => zones, hit);
    expect(distance).toBeGreaterThan(18);
    expect(hit.zone).toBe(ZONE_ARMS);
    expect(remotes.raycast(p.x + 5, 2.4, p.z - 20, 0, 0, 1, 300, () => zones, hit)).toBe(-1);
  });
});

