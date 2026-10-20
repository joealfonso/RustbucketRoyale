import { describe, expect, it } from "vitest";
import * as THREE from "three";
import lookJson from "../../../data/look.json";
import paletteJson from "../../../data/palette.json";
import { vfxConfig } from "./fx/quality";
import { createMechModel } from "./mechModel";
import { castShadows, parseSunShadowLook, shadowCentre, type SunShadowLook } from "./sunShadows";
import { Toon, groundMapping, parseLook, parsePalette } from "./toonMaterial";
import { WaterMesh } from "./waterMesh";
import { waterLook } from "./waterLook";

const levels = Object.keys(vfxConfig.levels);
const look = parseSunShadowLook(lookJson.shadows, levels);
const copy = (): SunShadowLook => JSON.parse(JSON.stringify(lookJson.shadows)) as SunShadowLook;
const toon = new Toon(parseLook(lookJson), parsePalette(paletteJson));

describe("shadow settings", () => {
  it("look.json has a shadow level for every effects quality level", () => {
    for (const name of levels) expect(look.levels[name]).toBeDefined();
  });

  it("rejects a missing level, a map size that is not a power of two, and numbers out of range", () => {
    const missing = copy();
    delete missing.levels[levels[0]!];
    expect(() => parseSunShadowLook(missing, levels)).toThrow(/levels needs/);
    const odd = copy();
    odd.levels[levels[0]!]!.mapSize = 1500;
    expect(() => parseSunShadowLook(odd, levels)).toThrow(/power of two/);
    const edge = copy();
    edge.edge = 0.7;
    expect(() => parseSunShadowLook(edge, levels)).toThrow(/edge/);
    const fade = copy();
    fade.fadeFrom = 1.5;
    expect(() => parseSunShadowLook(fade, levels)).toThrow(/fadeFrom/);
  });
});

describe("the shadow map following the camera", () => {
  const level = look.levels.normal ?? look.levels[levels[0]!]!;
  const sun = new THREE.Vector3(-0.85, 0.42, 0.18).normalize();
  const forward = new THREE.Vector3(0, -0.3, 1).normalize();
  const texel = (level.meters * 2) / level.mapSize;
  const across = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sun).normalize();
  const up = new THREE.Vector3().crossVectors(sun, across);

  it("sits ahead of the camera along the ground, on whole texels across the sun's rays", () => {
    const eye = new THREE.Vector3(123.4, 8.2, -56.7);
    const c = shadowCentre(eye, forward, sun, look, level, new THREE.Vector3());
    for (const axis of [across, up]) {
      const steps = c.dot(axis) / texel;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
    // Ahead by `ahead` of the radius, give or take the snap.
    const wanted = new THREE.Vector3(eye.x, eye.y, eye.z + level.meters * look.ahead);
    const off = c.clone().sub(wanted);
    off.addScaledVector(sun, -off.dot(sun)); // the snap never moves it along the rays, which changes nothing drawn
    expect(off.length()).toBeLessThan(texel);
  });

  it("holds still while the camera moves less than a texel, so shadow edges do not crawl", () => {
    const a = shadowCentre(new THREE.Vector3(10, 5, 10), forward, sun, look, level, new THREE.Vector3());
    let moved = 0;
    for (let i = 1; i <= 20; i++) {
      const b = shadowCentre(new THREE.Vector3(10 + (i * texel) / 50, 5, 10), forward, sun, look, level, new THREE.Vector3());
      const d = b.clone().sub(a);
      d.addScaledVector(sun, -d.dot(sun));
      if (d.length() > 1e-6) moved++;
    }
    expect(moved).toBeLessThanOrEqual(1);
  });
});

describe("what casts", () => {
  const materialOf = (m: THREE.Mesh) => m.material as THREE.Material;

  it("mech paint casts, its outline shells and glows never do", () => {
    const model = createMechModel("#2E8FD6", [60, 60, 100], toon, "paintWhite");
    castShadows(model.group);
    let casters = 0;
    model.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = materialOf(mesh);
      if (m.side === THREE.BackSide || m.type === "MeshBasicMaterial") expect(mesh.castShadow).toBe(false);
      if (mesh.castShadow) casters++;
    });
    expect(casters).toBeGreaterThan(0);
  });

  it("map boxes cast and their instanced outlines do not; the ground and the water never cast", () => {
    const group = new THREE.Group();
    const boxes = toon.instances("rustOrange", 4);
    boxes.addTo(group);
    const floor = toon.instances("moss", 1, true);
    floor.addTo(group);
    const box = toon.box(group, [0, 1, 0], [2, 2, 2], "scrapSteel");
    const scene = new THREE.Scene();
    const water = new WaterMesh(scene, waterLook.surface, toon.bands, (c) => toon.color(c));
    group.add(water.mesh);
    castShadows(group);
    expect(boxes.mesh.castShadow).toBe(true);
    expect(boxes.hull!.castShadow).toBe(false);
    expect(floor.mesh.castShadow).toBe(false);
    expect(box.mesh.castShadow).toBe(true);
    expect(box.hull.castShadow).toBe(false);
    expect(water.mesh.castShadow).toBe(false);
  });
});

describe("the ground under the contact darkening", () => {
  it("puts each terrain corner in the middle of its texel", () => {
    const terrain = { meters: 80, cell: 4, corners: 21 };
    const [scale, offset] = groundMapping(terrain);
    for (const i of [0, 7, 20]) {
      const x = i * terrain.cell - terrain.meters / 2;
      expect(x * scale + offset).toBeCloseTo((i + 0.5) / terrain.corners, 9);
    }
  });
});
