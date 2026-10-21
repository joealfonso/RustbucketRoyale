import * as THREE from "three";
import { describe, expect, it } from "vitest";
import zonesJson from "../../../data/zones.json";
import abilityFxJson from "../../../data/abilityFx.json";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { parseAbilityFx } from "./abilityFx";
import { Toon, parseLook, parsePalette } from "./toonMaterial";
import { STEP, ZONE_ARMS, createZoneHit, parseZones, type OtherState } from "@rustbucket/shared";
import { RemoteMechs } from "./remoteMechs";
import { createDrawnMech } from "./replayFrames";

const INTERVAL = 3 * STEP * 1000; // snapshots every 3 ticks
const other = (id: number, x: number): OtherState => ({ id, x, y: 0, z: 0, yaw: 0, running: false, jetting: false, dead: false, looted: false, repairing: false, bot: false, hp: [60, 60, 100], weapon: 0, armor: [0, 0, 0], upgrades: [-1, -1], mech: 0, ability: false, dropPhase: 0 });
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

  it("tells the blow-apart who went down, live, in a replay, and lying there after one", () => {
    const { remotes } = make();
    const calls: string[] = [];
    remotes.onKnockedOut = (id, _model, alreadyDown) => calls.push(`${id}:${alreadyDown}`);
    remotes.push([{ ...other(2, 0), dead: true }], 0, 0); // first seen a wreck
    remotes.push([other(1, 0), { ...other(2, 0), dead: true }], 3, 50);
    remotes.push([{ ...other(1, 0), dead: true }, { ...other(2, 0), dead: true }], 6, 100);
    expect(calls).toEqual(["2:true", "1:false"]);
    calls.length = 0;
    remotes.beginReplay();
    const drawn = createDrawnMech(3);
    drawn.hp = [60, 60, 100];
    remotes.showRecorded(1, drawn); // alive in the clip
    remotes.showRecorded(1, { ...drawn, dead: true }); // and down again
    expect(calls).toEqual(["1:false"]);
    calls.length = 0;
    remotes.push([{ ...other(1, 0), dead: true }, { ...other(2, 0), dead: true }, { ...other(3, 0), dead: true }], 9, 150); // 3 seen down mid replay
    remotes.endReplay();
    // Nothing is blown apart in this test, so every wreck is handed back to lie down.
    expect(calls.sort()).toEqual(["1:true", "2:true", "3:true"]);
  });

  describe("your own decoys", () => {
    const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
    const ghost = parseAbilityFx(abilityFxJson).ghost;
    const looked = () => {
      const made = make();
      made.remotes.look = { toon, accentFor: () => "#D9453B", body: "paintWhite", kitFor: () => null, trim: "frameNavy" };
      made.remotes.ghostLook = ghost;
      return made;
    };
    // Every material a mech is drawn with, outlines left out (a ghost hides those).
    const drawn = (group: THREE.Object3D) => {
      const out: THREE.Material[] = [];
      group.traverse((o) => { if (o instanceof THREE.Mesh && o.visible && (o.material as THREE.Material).side !== THREE.BackSide) out.push(o.material as THREE.Material); });
      return out;
    };

    it("draws the decoys see-through whether their ids come before or after the snapshot, and nobody else", () => {
      const { remotes, scene } = looked();
      remotes.addOwnDecoys([2]); // before: not in a snapshot yet
      remotes.push([other(1, 0), other(2, 5), other(3, 10)], 0, 0);
      remotes.addOwnDecoys([3]); // after: already drawn
      const [real, early, late] = scene.children;
      expect(drawn(real!).every((m) => !m.transparent)).toBe(true);
      for (const decoy of [early!, late!]) {
        expect(drawn(decoy).length).toBeGreaterThan(0);
        expect(drawn(decoy).every((m) => m.transparent && m.opacity === ghost.opacity)).toBe(true);
      }
      expect(remotes.isOwnDecoy(1)).toBe(false);
      expect(remotes.isOwnDecoy(2) && remotes.isOwnDecoy(3)).toBe(true);
    });

    it("leaves materials shared with other mechs alone", () => {
      const { remotes, scene } = looked();
      remotes.push([other(1, 0), other(2, 5)], 0, 0);
      // Plates (hidden until armour is fitted) come from the shared toon material of their colour.
      const every = (group: THREE.Object3D) => {
        const out = new Set<THREE.Material>();
        group.traverse((o) => { if (o instanceof THREE.Mesh) out.add(o.material as THREE.Material); });
        return [...out];
      };
      const solid = every(scene.children[0]!);
      expect(solid.filter((m) => every(scene.children[1]!).includes(m)).length).toBeGreaterThan(0);
      remotes.addOwnDecoys([2]);
      expect(every(scene.children[0]!)).toEqual(solid);
      expect(solid.every((m) => !m.transparent)).toBe(true);
      const stillShared = every(scene.children[1]!).filter((m) => solid.includes(m));
      expect(stillShared.every((m) => m.side === THREE.BackSide)).toBe(true); // only outlines, which a ghost hides
    });

    it("forgets a decoy once it pops or leaves the snapshots", () => {
      const { remotes } = looked();
      remotes.push([other(1, 0), other(2, 5)], 0, 0);
      remotes.addOwnDecoys([1, 2]);
      remotes.forgetOwnDecoy(1);
      expect(remotes.isOwnDecoy(1)).toBe(false);
      remotes.push([], 3, 50);
      expect(remotes.isOwnDecoy(2)).toBe(false);
    });
  });
});
