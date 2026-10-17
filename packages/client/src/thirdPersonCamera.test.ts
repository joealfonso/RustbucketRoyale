import { describe, expect, it } from "vitest";
import { World, boxFromData, parseCameraStats } from "@rustbucket/shared";
import cameraJson from "../../../data/camera.json";
import { ThirdPersonCamera } from "./thirdPersonCamera";

const stats = parseCameraStats(cameraJson);
// Looking along -Z (yaw 0) puts the camera behind the mech at +Z. A wall just behind the pivot should stop it.
const wallBehind = new World([boxFromData({ name: "wall", center: [0, 5, 3], size: [40, 10, 1], color: "#fff" })]);
const openSpace = new World([]);

describe("ThirdPersonCamera", () => {
  it("sits at full distance in open space", () => {
    const rig = new ThirdPersonCamera(stats, 1.5);
    rig.update(0, 3, 0, 0, 0, openSpace, 1 / 60);
    expect(rig.camera.position.z).toBeCloseTo(stats.distance, 1); // shoulder offset adds a little sideways, not back
  });

  it("stays in front of a wall behind the mech", () => {
    const rig = new ThirdPersonCamera(stats, 1.5);
    rig.update(0, 3, 0, 0, 0, wallBehind, 1 / 60);
    expect(rig.camera.position.z).toBeLessThan(2.5);
  });

  it("eases back out instead of popping when the wall goes away", () => {
    const rig = new ThirdPersonCamera(stats, 1.5);
    rig.update(0, 3, 0, 0, 0, wallBehind, 1 / 60);
    rig.update(0, 3, 0, 0, 0, openSpace, 1 / 60);
    expect(rig.camera.position.z).toBeLessThan(stats.distance - 1);
  });
});
