import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DROP_BALL, DROP_BURNING, DROP_HANGING, DROP_NONE, World, boxFromData, createMechInput, createMechState, parseMechStats, stepMech, type OtherState } from "@rustbucket/shared";
import diveJson from "../../../data/dive.json";
import dropJson from "../../../data/drop.json";
import mechJson from "../../../data/mech.json";
import { parseDive, startAltitude } from "./dive";
import { DiveCamera, simPitch } from "./diveCamera";
import { diveTilt } from "./divePose";
import { LandingMarker } from "./landingMarker";
import { RemoteMechs } from "./remoteMechs";

const dive = parseDive(diveJson);
const stats = parseMechStats(mechJson);
const DEG = Math.PI / 180;
const ground = new World([boxFromData({ name: "g", center: [0, -0.5, 0], size: [8000, 1, 8000], color: "" })]);

describe("the drop-in on the client", () => {
  it("reads dive.json and refuses a broken one", () => {
    expect(dive.camera.minPitchDegrees).toBeLessThan(stats.minPitch);
    expect(() => parseDive({ ...diveJson, camera: { ...diveJson.camera, pullBackMeters: -1 } })).toThrow(/pullBackMeters/);
    expect(() => parseDive({ ...diveJson, hud: { ...diveJson.hud, aimCall: "" } })).toThrow(/aimCall/);
    expect(() => parseDive({ ...diveJson, camera: { ...diveJson.camera, startPitchDegrees: -95 } })).toThrow(/startPitchDegrees/);
  });

  it("starts at the server's height for the tier, and not at all on the range", () => {
    expect(startAltitude(dropJson.altitudeMeters, "small")).toBe(dropJson.altitudeMeters.small);
    expect(startAltitude(dropJson.altitudeMeters, "range")).toBeNull();
  });

  it("lets you look further down while dropping, sends the server only the walking limit, and eases back after", () => {
    const camera = new DiveCamera(dive.camera, stats);
    const aim = { yaw: 0, pitch: 0 };
    camera.look(aim, 0, 100000, stats, true, 1 / 60);
    expect(aim.pitch).toBeCloseTo(dive.camera.minPitchDegrees * DEG, 6);
    expect(simPitch(aim.pitch, stats)).toBeCloseTo(stats.minPitch * DEG, 6);
    // Down: one frame later it is still below the walking limit, a second later back at it.
    camera.look(aim, 0, 0, stats, false, 1 / 60);
    expect(aim.pitch).toBeLessThan(stats.minPitch * DEG);
    for (let i = 0; i < 60; i++) camera.look(aim, 0, 0, stats, false, 1 / 60);
    expect(aim.pitch).toBeCloseTo(stats.minPitch * DEG, 6);
  });

  it("stays upright in the ball and rocks back for the burn", () => {
    expect(diveTilt(dive.pose, DROP_BALL)).toBe(0);
    expect(diveTilt(dive.pose, DROP_HANGING)).toBe(0);
    expect(diveTilt(dive.pose, DROP_BURNING)).toBeLessThanOrEqual(0);
  });

  it("marks where the ball really comes down, short of an aim out of reach", () => {
    const marker = new LandingMarker(dive.marker, "#ffffff", stats);
    const s = createMechState(stats, 0, 300, 0, 0);
    s.dropPhase = DROP_BALL;
    const input = createMechInput();
    input.targetX = 2000; input.targetZ = -40; // far beyond what the steering can reach in one fall
    marker.update(s, input, stats, ground, null, new THREE.Vector3(0, 300, 10), 1 / 60);
    expect(marker.group.visible).toBe(true);
    // The real thing at the game's own step.
    while (s.dropPhase !== DROP_NONE) stepMech(s, input, stats, 1 / 60, ground);
    // The coarse step lands within a few metres of the fine one over a fall of a few hundred.
    expect(Math.hypot(marker.at.x - s.x, marker.at.z - s.z)).toBeLessThan(6);
    expect(marker.at.y).toBeCloseTo(0, 3);
    expect(marker.at.x).toBeLessThan(1000);
  });

  it("hanging in the countdown, marks where falling now would come down", () => {
    const marker = new LandingMarker(dive.marker, "#ffffff", stats);
    const s = createMechState(stats, 0, 300, 0, 0);
    s.dropPhase = DROP_HANGING;
    const input = createMechInput();
    input.targetX = 30; input.targetZ = 20; // within reach
    marker.update(s, input, stats, ground, null, new THREE.Vector3(0, 300, 10), 1 / 60);
    expect(marker.group.visible).toBe(true);
    expect(Math.hypot(marker.at.x - 30, marker.at.z - 20)).toBeLessThan(6);
  });

  it("says when someone else's retro-jets light and when they touch down", () => {
    const remotes = new RemoteMechs(new THREE.Scene(), 15, 400, 50, [60, 60, 100]);
    const seen: [number, number][] = [];
    remotes.onDropPhase = (_m, from, to) => seen.push([from, to]);
    const other = (dropPhase: number): OtherState => ({ id: 3, x: 0, y: 0, z: 0, yaw: 0, running: false, jetting: false, dead: false, looted: false, repairing: false, bot: true, hp: [60, 60, 100], weapon: 0, armor: [0, 0, 0], upgrades: [-1, -1], mech: 0, ability: false, dropPhase });
    remotes.push([other(DROP_BALL)], 1, 0); // first seen mid fall: nothing to say yet
    remotes.push([other(DROP_BURNING)], 2, 50);
    remotes.push([other(DROP_NONE)], 3, 100);
    expect(seen).toEqual([[DROP_BALL, DROP_BURNING], [DROP_BURNING, DROP_NONE]]);
  });
});
