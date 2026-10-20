import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { STEP, World, createShot, type OtherState } from "@rustbucket/shared";
import replayJson from "../../../data/replay.json";
import { KillReplay, parseReplay, playbackSpeed, replayStart, screenSeconds } from "./killReplay";
import { createMechModel, type MechModel } from "./mechModel";
import { RemoteMechs } from "./remoteMechs";

const config = parseReplay(replayJson);
const HP = [60, 60, 100];
const other = (id: number, x: number, hp = HP): OtherState => ({ id, x, y: 0, z: -20, yaw: 0, running: false, jetting: false, dead: false, looted: false, repairing: false, bot: true, hp, weapon: 0, armor: [0, 0, 0], upgrades: [-1, -1], mech: 0, ability: false });
const still = { vx: 0, vy: 0, vz: 0, jetting: false, running: false, abilityTime: 0 };
const open = new World([]);

// A fight seen from your screen: you (id 1) at the origin, the killer (id 5) walking along x 20 m away, a bystander
// (id 6). Frames every 1/60 s up to `untilMs`. The killer fires every 500 ms.
function fight(untilMs: number, killerFrom = 0) {
  const scene = new THREE.Scene();
  const remotes = new RemoteMechs(scene, 15, 200, 3 * STEP * 1000, HP);
  const own = createMechModel("#ffffff", HP);
  const replay = new KillReplay(config, HP.length);
  const camera = new THREE.PerspectiveCamera();
  let tick = 0;
  for (let now = 0; now <= untilMs; now += 1000 / 60) {
    if (now >= tick * 50) {
      const killerIn = now >= killerFrom;
      remotes.push(killerIn ? [other(5, now / 100), other(6, -10)] : [other(6, -10)], tick * 3, now);
      tick++;
    }
    remotes.update(now);
    replay.record(now, 1, own, still, { hp: now >= untilMs - 100 ? [0, 0, 0] : HP, dead: now >= untilMs - 100 }, remotes);
    if (Math.floor(now / 500) !== Math.floor((now - 1000 / 60) / 500) && now >= killerFrom) {
      replay.shot(now, 5, { ...createShot(), ox: now / 100, oz: -20, dz: 1, length: 20 }, 2, true);
    }
  }
  return { scene, remotes, own, replay, camera };
}

describe("kill replay data", () => {
  it("loads the real file and refuses nonsense", () => {
    expect(config.playSeconds).toBeLessThanOrEqual(config.keepSeconds);
    expect(() => parseReplay({ ...replayJson, playSeconds: 9 })).toThrow(/keepSeconds/);
    expect(() => parseReplay({ ...replayJson, sampleHz: 0 })).toThrow(/sampleHz/);
    expect(() => parseReplay({ ...replayJson, camera: { ...replayJson.camera, sharpness: -1 } })).toThrow(/camera.sharpness/);
    expect(() => parseReplay({ ...replayJson, slowMotion: { ...replayJson.slowMotion, speed: 0 } })).toThrow(/slowMotion.speed/);
  });
});

describe("kill replay timing", () => {
  const c = { ...config, speed: 1, slowMotion: { beforeSeconds: 0.5, afterSeconds: 0.5, speed: 0.5 } };

  it("slows down around the knockout only", () => {
    expect(playbackSpeed(0, 3000, c)).toBe(1);
    expect(playbackSpeed(2600, 3000, c)).toBe(0.5);
    expect(playbackSpeed(3400, 3000, c)).toBe(0.5);
    expect(playbackSpeed(3600, 3000, c)).toBe(1);
  });

  it("works out how long the replay takes on screen", () => {
    expect(screenSeconds(0, 4000, 3000, c)).toBeCloseTo(3 + 1 / 0.5);
    expect(screenSeconds(0, 2000, 3000, c)).toBeCloseTo(2); // no slow part in this stretch
  });

  it("starts the full length back, or when the killer came into view, and skips a killer barely seen", () => {
    const k = 10000;
    const fullStart = k + (config.afterSeconds - config.playSeconds) * 1000;
    expect(replayStart(k, 0, config)).toBe(fullStart);
    expect(replayStart(k, k - 1500, config)).toBe(k - 1500);
    expect(replayStart(k, k - config.minKillerSeconds * 1000 / 2, config)).toBeNaN();
    expect(replayStart(k, Number.NaN, config)).toBeNaN();
  });
});

describe("KillReplay", () => {
  it("plays nothing without a killer, or for a killer never seen", () => {
    const { replay } = fight(4000, 1e9);
    expect(replay.knockedOut(4000, 1, null)).toBe(false);
    expect(replay.knockedOut(4000, 1, 1)).toBe(false);
    expect(replay.knockedOut(4000, 1, 5)).toBe(false); // in range the whole time, but never in view
    expect(replay.knockedOut(4000, 1, 99)).toBe(false);
    expect(replay.busy).toBe(false);
  });

  it("waits a moment after the knockout, then replays from the killer's shoulder and hands over to watching it", () => {
    const { replay, remotes, own, camera } = fight(6000);
    expect(replay.knockedOut(6000, 1, 5)).toBe(true);
    expect(replay.waiting).toBe(true);
    let ended = -1, downs = 0, awayX = 0;
    const shots: number[] = [];
    replay.onEnd = (id) => { ended = id; };
    replay.onVictimDown = (model, x) => { downs++; awayX = x; expect(model).toBe(own); };
    replay.onShot = (id, shot) => { shots.push(id); expect(shot.length).toBe(20); };
    expect(replay.update(6100, 0.1, remotes, own, camera, open)).toBe(false); // still waiting
    const startAt = 6000 + config.afterSeconds * 1000;
    expect(replay.update(startAt, 0.016, remotes, own, camera, open)).toBe(true);
    expect(replay.playing).toBe(true);
    // The killer is drawn where it was, about playSeconds ago: x was time / 100.
    const at = new THREE.Vector3();
    remotes.positionOf(5, at);
    expect(at.x).toBeGreaterThan(18);
    expect(at.x).toBeLessThan(30);
    // Behind the killer, looking toward you at the origin.
    expect(camera.position.z).toBeLessThan(-20);
    let frames = 0;
    for (let now = startAt; replay.update(now, 1 / 60, remotes, own, camera, open); now += 1000 / 60) {
      frames++;
      expect(replay.progress).toBeGreaterThanOrEqual(0);
      expect(replay.progress).toBeLessThanOrEqual(1);
    }
    const onScreen = screenSeconds(6000 + (config.afterSeconds - config.playSeconds) * 1000, startAt, 6000, config);
    expect(frames / 60).toBeCloseTo(onScreen, 0);
    expect(downs).toBe(1);
    expect(awayX).toBeLessThan(0); // pushed away from the killer, who stood at +x
    // One every 500 ms from the replay's start to the knockout, where the recording here stops.
    expect(shots.length).toBeGreaterThanOrEqual(Math.floor((config.playSeconds - config.afterSeconds) * 2) - 1);
    expect(shots.every((id) => id === 5)).toBe(true);
    expect(ended).toBe(5);
    expect(replay.busy).toBe(false);
  });

  it("skips at once on any input while playing, but not while waiting", () => {
    const { replay, remotes, own, camera } = fight(6000);
    let ended = -1;
    replay.onEnd = (id) => { ended = id; };
    replay.knockedOut(6000, 1, 5);
    replay.skip(); // a click still from the fight
    const startAt = 6000 + config.afterSeconds * 1000;
    expect(replay.update(startAt, 0.016, remotes, own, camera, open)).toBe(true);
    replay.skip();
    expect(replay.update(startAt + 16, 0.016, remotes, own, camera, open)).toBe(false);
    expect(ended).toBe(5);
  });

  it("puts everyone back as they are now when it ends", () => {
    const { replay, remotes, own, camera } = fight(6000);
    replay.knockedOut(6000, 1, 5);
    const startAt = 6000 + config.afterSeconds * 1000;
    replay.update(startAt, 0.016, remotes, own, camera, open);
    // Hit while the replay plays: the snapshot is kept, but the replay's picture is not changed by it.
    remotes.push([other(5, 60, [0, 60, 100]), other(6, -10)], 1000, startAt);
    let killer: MechModel | null = null;
    remotes.forEachNear(0, 0, 1e6, (model) => { if (model.group.position.x > 0) killer = model; });
    expect(killer!.hp[0]).toBe(60);
    replay.cancel();
    expect(replay.busy).toBe(false);
    expect(killer!.hp[0]).toBe(0);
    remotes.forEachNear(0, 0, 1e6, (model) => { expect(model.group.visible).toBe(true); });
  });

  it("stops recording while it plays, so it never records itself", () => {
    const { replay, remotes, own, camera } = fight(6000);
    replay.knockedOut(6000, 1, 5);
    const startAt = 6000 + config.afterSeconds * 1000;
    replay.update(startAt, 0.016, remotes, own, camera, open);
    const newest = replay.frames.newestTime;
    const events = replay.events.size;
    replay.record(startAt + 500, 1, own, still, { hp: HP, dead: true }, remotes);
    replay.shot(startAt + 500, 5, createShot(), 0, false);
    expect(replay.frames.newestTime).toBe(newest);
    expect(replay.events.size).toBe(events);
  });
});
