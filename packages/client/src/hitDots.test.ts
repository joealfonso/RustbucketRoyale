import { describe, expect, it } from "vitest";
import { HURT_BROKEN, HURT_HULL, HURT_PLATE, ZONE_ARMS, ZONE_LEGS, ZONE_TORSO, hurtKind, makeZonesFor, parseRoster, parseZones } from "@rustbucket/shared";
import { frontView, parseDiagram } from "./damageDiagram";
import { dotLook, hitSpot, parseHitDots, snapToZone, type Spot } from "./hitDots";
import diagramJson from "../../../data/damageDiagram.json";
import zonesJson from "../../../data/zones.json";
import rosterJson from "../../../data/roster.json";
import kitsJson from "../../../data/mechKits.json";

const config = parseDiagram(diagramJson);
const zones = parseZones(zonesJson);
const roster = parseRoster(rosterJson);
const zonesFor = makeZonesFor(zones, roster, kitsJson);
const sets = [["standard", zones] as const, ...roster.mechs.map((m, i) => [m.id, zonesFor(i)] as const)];

const inside = (rects: ReturnType<typeof frontView>["rects"], zone: number, s: Spot) =>
  rects.some((r) => (zone < 0 || r.zone === zone) && s.x >= r.x - 0.01 && s.x <= r.x + r.w + 0.01 && s.y >= r.y - 0.01 && s.y <= r.y + r.h + 0.01);
const centre = (b: { minX: number; maxX: number; minY: number; maxY: number }) => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] as const;

describe("hitSpot", () => {
  it.each(sets)("puts a hit in the middle of each of %s's boxes on that box's zone", (_, set) => {
    const { rects, frame } = frontView(set.boxes, set.boxZone, config);
    const out = { x: 0, y: 0 };
    set.boxes.forEach((box, i) => {
      const [x, y] = centre(box);
      hitSpot(rects, frame, set.boxZone[i]!, x, y, out);
      expect(inside(rects, set.boxZone[i]!, out)).toBe(true);
    });
  });

  it("maps the mech's frame straight onto the diagram, its right on the right and its head at the top", () => {
    const torso = { minX: -1, maxX: 1, minY: 0, maxY: 4, minZ: 0, maxZ: 1 };
    const { rects, frame } = frontView([torso], [ZONE_TORSO], config);
    const r = rects[0]!;
    const out = { x: 0, y: 0 };
    hitSpot(rects, frame, ZONE_TORSO, 0, 2, out);
    expect(out.x).toBeCloseTo(r.x + r.w / 2, 1);
    expect(out.y).toBeCloseTo(r.y + r.h / 2, 1);
    hitSpot(rects, frame, ZONE_TORSO, 0.5, 3, out);
    expect(out.x).toBeCloseTo(r.x + r.w * 0.75, 1);
    expect(out.y).toBeCloseTo(r.y + r.h * 0.25, 1);
  });

  it("pulls a hit onto the zone that was struck when the point is off it", () => {
    const torso = { minX: -1, maxX: 1, minY: 2, maxY: 4, minZ: 0, maxZ: 1 };
    const arm = { minX: 1.2, maxX: 2, minY: 2, maxY: 4, minZ: 0, maxZ: 1 };
    const legs = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: 0, maxZ: 1 };
    const { rects, frame } = frontView([torso, arm, legs], [ZONE_TORSO, ZONE_ARMS, ZONE_LEGS], config);
    const out = { x: 0, y: 0 };
    // A point on the torso, but the server said it was the arm: the dot goes on the arm's near edge.
    hitSpot(rects, frame, ZONE_ARMS, 0, 3, out);
    expect(inside(rects, ZONE_ARMS, out)).toBe(true);
    // Splash from far off to the left lands on the mech's left edge.
    hitSpot(rects, frame, -1, -20, 3, out);
    expect(inside(rects, -1, out)).toBe(true);
    expect(out.x).toBeCloseTo(rects.find((r) => r.zone === ZONE_TORSO)!.x, 1);
  });

  it("leaves a point already on the zone where it is", () => {
    const rects = [{ zone: ZONE_TORSO, x: 10, y: 10, w: 20, h: 20 }];
    const out = { x: 0, y: 0 };
    snapToZone(rects, ZONE_TORSO, 15, 25, out);
    expect(out).toEqual({ x: 15, y: 25 });
    snapToZone(rects, ZONE_TORSO, 0, 50, out);
    expect(out).toEqual({ x: 10, y: 30 });
  });
});

describe("hit kinds", () => {
  it("tells a plate dent, a hit into the part and a break apart", () => {
    expect(hurtKind(60, 60)).toBe(HURT_PLATE);
    expect(hurtKind(60, 40)).toBe(HURT_HULL);
    expect(hurtKind(10, 0)).toBe(HURT_BROKEN);
    expect(hurtKind(0, 0)).toBe(HURT_BROKEN);
    expect([HURT_PLATE, HURT_HULL, HURT_BROKEN].map(dotLook)).toEqual(["plate", "hull", "broken"]);
  });

  it("rejects bad dot settings", () => {
    expect(() => parseHitDots({ ...diagramJson.hits, maxDots: 0 })).toThrow();
    expect(() => parseHitDots({ ...diagramJson.hits, splashDots: 2.5 })).toThrow();
    expect(() => parseHitDots({ ...diagramJson.hits, fadeSeconds: "slow" })).toThrow();
  });
});
