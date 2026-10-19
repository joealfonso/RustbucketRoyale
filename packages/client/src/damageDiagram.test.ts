import { describe, expect, it } from "vitest";
import { makeZonesFor, parseRoster, parseZones, ZONE_ARMS, ZONE_BROKEN, ZONE_DAMAGED, ZONE_INTACT, ZONE_LEGS, ZONE_TORSO } from "@rustbucket/shared";
import { frontRects, parseDiagram, percentLeft, plateLook, zoneLook } from "./damageDiagram";
import diagramJson from "../../../data/damageDiagram.json";
import zonesJson from "../../../data/zones.json";
import rosterJson from "../../../data/roster.json";
import kitsJson from "../../../data/mechKits.json";

const config = parseDiagram(diagramJson);
const zones = parseZones(zonesJson);
const roster = parseRoster(rosterJson);
const zonesFor = makeZonesFor(zones, roster, kitsJson);

const sets = [["standard", zones] as const, ...roster.mechs.map((m, i) => [m.id, zonesFor(i)] as const)];

describe("frontRects", () => {
  it.each(sets)("fits %s inside the slot, above the label row", (_, set) => {
    const rects = frontRects(set.boxes, set.boxZone, config);
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(config.paddingPx - 0.01);
      expect(r.y).toBeGreaterThanOrEqual(config.paddingPx - 0.01);
      expect(r.x + r.w).toBeLessThanOrEqual(config.widthPx - config.paddingPx + 0.01);
      expect(r.y + r.h).toBeLessThanOrEqual(config.heightPx - config.labelRowPx - config.paddingPx + 0.01);
    }
    // Every zone keeps at least one box, so none can vanish from the doll.
    for (const zone of [ZONE_LEGS, ZONE_ARMS, ZONE_TORSO]) expect(rects.some((r) => r.zone === zone)).toBe(true);
  });

  it.each(sets)("draws %s with legs under the torso and arms out to the sides", (_, set) => {
    const rects = frontRects(set.boxes, set.boxZone, config);
    const lowest = (zone: number) => Math.max(...rects.filter((r) => r.zone === zone).map((r) => r.y + r.h));
    const highest = (zone: number) => Math.min(...rects.filter((r) => r.zone === zone).map((r) => r.y));
    expect(lowest(ZONE_LEGS)).toBeGreaterThan(lowest(ZONE_TORSO));
    expect(highest(ZONE_TORSO)).toBeLessThan(highest(ZONE_LEGS));
    const arms = rects.filter((r) => r.zone === ZONE_ARMS);
    expect(Math.min(...arms.map((r) => r.x))).toBeLessThan(config.widthPx / 2);
    expect(Math.max(...arms.map((r) => r.x + r.w))).toBeGreaterThan(config.widthPx / 2);
  });

  it("keeps the mech's proportions and centres it", () => {
    // One 2 m wide by 4 m tall box: the height fills the room, the width follows at the same scale.
    const box = { minX: -1, maxX: 1, minY: 0, maxY: 4, minZ: 0, maxZ: 1 };
    const [r] = frontRects([box], [ZONE_TORSO], config);
    const roomH = config.heightPx - config.labelRowPx - 2 * config.paddingPx;
    expect(r!.h).toBeCloseTo(roomH, 1);
    expect(r!.w).toBeCloseTo(roomH / 2, 1);
    expect(r!.x + r!.w / 2).toBeCloseTo(config.widthPx / 2, 1);
  });

  it("keeps the pilot's right on the right", () => {
    const right = { minX: 1, maxX: 2, minY: 2, maxY: 3, minZ: 0, maxZ: 1 };
    const left = { minX: -2, maxX: -1, minY: 2, maxY: 3, minZ: 0, maxZ: 1 };
    const rects = frontRects([right, left], [ZONE_ARMS, ZONE_TORSO], config);
    expect(rects.find((r) => r.zone === ZONE_ARMS)!.x).toBeGreaterThan(rects.find((r) => r.zone === ZONE_TORSO)!.x);
  });

  it("drops tiny boxes but never a zone's biggest one", () => {
    const big = { minX: -1, maxX: 1, minY: 2, maxY: 4, minZ: 0, maxZ: 1 };
    const bolt = { minX: 0, maxX: 0.05, minY: 1, maxY: 1.05, minZ: 0, maxZ: 1 };
    const smallLeg = { minX: 0, maxX: 0.05, minY: 0, maxY: 0.05, minZ: 0, maxZ: 1 };
    const rects = frontRects([big, bolt, smallLeg], [ZONE_TORSO, ZONE_TORSO, ZONE_LEGS], config);
    expect(rects.filter((r) => r.zone === ZONE_TORSO)).toHaveLength(1);
    expect(rects.filter((r) => r.zone === ZONE_LEGS)).toHaveLength(1);
  });
});

describe("zone looks", () => {
  it("maps each zone state to its own pattern", () => {
    expect(zoneLook(ZONE_INTACT)).toBe("intact");
    expect(zoneLook(ZONE_DAMAGED)).toBe("damaged");
    expect(zoneLook(ZONE_BROKEN)).toBe("broken");
  });

  it("rounds percent up so a standing zone never reads 0", () => {
    expect(percentLeft(60, 60)).toBe(100);
    expect(percentLeft(0.2, 60)).toBe(1);
    expect(percentLeft(0, 60)).toBe(0);
    expect(percentLeft(30, 60)).toBe(50);
  });

  it("frames a zone solid with a whole plate, dashed when worn, not at all when bare", () => {
    expect(plateLook(0, 30)).toBe("none");
    expect(plateLook(12, 30)).toBe("partial");
    expect(plateLook(30, 30)).toBe("full");
    expect(plateLook(45, 30)).toBe("full");
  });

  it("rejects a data file with no room to draw", () => {
    expect(() => parseDiagram({ ...diagramJson, heightPx: 10 })).toThrow();
    expect(() => parseDiagram({ ...diagramJson, minBoxArea: "a" })).toThrow();
  });
});
