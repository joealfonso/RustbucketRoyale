import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { shipEndsAt, type ShipPath } from "@rustbucket/shared";
import diveJson from "../../../data/dive.json";
import paletteJson from "../../../data/palette.json";
import lookJson from "../../../data/look.json";
import { parseDive } from "./dive";
import { DropSprites } from "./fx/dropSprites";
import { ShipView, shipLook } from "./shipView";
import shipKitJson from "../../../data/shipKit.json";
import { Toon, parseLook, parsePalette } from "./toonMaterial";

const dive = parseDive(diveJson);
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));
const make = () => new ShipView(toon, new DropSprites(new THREE.Scene(), (c) => toon.color(c), dive.toon), dive.ship, shipLook(shipKitJson, dive.ship.kit));
const path: ShipPath = { x0: -100, z0: 0, x1: 100, z1: 0, y: 250, speed: 20, startAt: -5 };

describe("ShipView", () => {
  it("puts its bay on the line at the match clock, nose along the line", () => {
    const ship = make();
    ship.setPath(path);
    ship.update(0, 0.016);
    expect(ship.group.visible).toBe(true);
    expect(ship.group.position.x).toBeCloseTo(0);
    expect(ship.group.position.y).toBe(250);
    // The ship's +z turned to point along the line (+x here).
    const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(ship.group.quaternion);
    expect(nose.x).toBeCloseTo(1);
  });

  it("flies off past the end of its line, then is gone; outside a match it is hidden", () => {
    const ship = make();
    ship.setPath(path);
    ship.update(shipEndsAt(path) + 5, 0.016);
    expect(ship.group.visible).toBe(true);
    expect(ship.group.position.x).toBeGreaterThan(100);
    ship.update(shipEndsAt(path) + 600, 0.016);
    expect(ship.group.visible).toBe(false);
    ship.update(-Infinity, 0.016);
    expect(ship.group.visible).toBe(false);
    ship.setPath(null);
    ship.update(0, 0.016);
    expect(ship.group.visible).toBe(false);
  });

  it("paints each part from the ship kit", () => {
    const look = shipLook(shipKitJson, dive.ship.kit);
    expect(look.paint.Hull).toBe(shipKitJson.kits.rustbucket.scheme.hull);
    expect(look.lodMeters[0]).toBe(0);
  });

  it("finds the stand-in's muzzle ahead of and below the bay", () => {
    const ship = make();
    ship.setPath(path);
    ship.update(0, 0.016);
    const at = new THREE.Vector3(), dir = new THREE.Vector3();
    ship.muzzleAt(at, dir);
    expect(at.x).toBeGreaterThan(0);
    expect(at.y).toBeLessThan(250);
    expect(dir.y).toBeLessThan(0);
  });
});
