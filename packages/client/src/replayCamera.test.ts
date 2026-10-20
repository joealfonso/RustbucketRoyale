import { describe, expect, it } from "vitest";
import { World, boxFromData } from "@rustbucket/shared";
import replayJson from "../../../data/replay.json";
import { createCameraPose, followPose, keepOutOfWalls, replayCameraPose } from "./replayCamera";

const c = replayJson.camera;

describe("replay camera", () => {
  it("sits behind the killer, over its right shoulder, looking at you", () => {
    const pose = createCameraPose();
    // Killer at the origin, you 30 m away along -z: the camera is behind it at +z, to its right (+x), above it.
    replayCameraPose(0, 0, 0, 1.2, 0, 0, -30, c, pose);
    expect(pose.z).toBeCloseTo(c.backMeters);
    expect(pose.x).toBeCloseTo(c.shoulderMeters);
    expect(pose.y).toBeCloseTo(c.pivotHeightMeters + c.upMeters);
    expect([pose.lookX, pose.lookY, pose.lookZ]).toEqual([0, c.lookHeightMeters, -30]);
  });

  it("follows the line to you, not the way the killer faces, so you stay in frame", () => {
    const pose = createCameraPose();
    replayCameraPose(0, 0, 0, 0, 30, 0, 0, c, pose); // you to the east, killer facing north
    expect(pose.x).toBeCloseTo(-c.backMeters);
    expect(pose.z).toBeCloseTo(c.shoulderMeters); // right of facing east is south (+z)
  });

  it("uses the killer's own facing when it is right on top of you", () => {
    const pose = createCameraPose();
    replayCameraPose(0, 0, 0, Math.PI, 0.5, 0, 0.5, c, pose); // yaw PI faces +z
    expect(pose.z).toBeCloseTo(-c.backMeters);
  });

  it("comes in front of a wall between the lens and the killer", () => {
    const pose = createCameraPose();
    replayCameraPose(0, 0, 0, 0, 0, 0, -30, c, pose);
    const wall = new World([boxFromData({ name: "wall", center: [0, 5, 3], size: [40, 20, 1], color: "#fff" })]);
    keepOutOfWalls(pose, wall, c.wallMarginMeters);
    expect(pose.z).toBeLessThan(2.5);
    const open = createCameraPose();
    replayCameraPose(0, 0, 0, 0, 0, 0, -30, c, open);
    keepOutOfWalls(open, new World([]), c.wallMarginMeters);
    expect(open.z).toBeCloseTo(c.backMeters);
  });

  it("eases toward a new pose instead of jumping", () => {
    const now = createCameraPose();
    const wanted = { ...createCameraPose(), x: 10, lookZ: -4 };
    followPose(now, wanted, 0.25);
    expect(now.x).toBeCloseTo(2.5);
    expect(now.lookZ).toBeCloseTo(-1);
  });
});
