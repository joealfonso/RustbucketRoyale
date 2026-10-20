import { describe, expect, it } from "vitest";
import deathFxJson from "../../../data/deathFx.json";
import titanLookJson from "../../../data/titanLook.json";
import { parseDeathFx } from "./deathFx";
import { readFileSync } from "node:fs";
import { parseTitanLook, titanDeathFx } from "./titanLook";

const copy = () => JSON.parse(JSON.stringify(titanLookJson)) as Record<string, Record<string, unknown>>;

describe("parseTitanLook", () => {
  it("accepts the data file", () => {
    expect(parseTitanLook(titanLookJson).hud.bossBarMeters).toBeGreaterThan(0);
  });

  it("rejects a missing or negative number, and a bad gait", () => {
    const missing = copy(); delete missing.stomp!.puffs;
    expect(() => parseTitanLook(missing)).toThrow(/stomp.puffs/);
    const negative = copy(); negative.walk!.shakeForce = -1;
    expect(() => parseTitanLook(negative)).toThrow(/walk.shakeForce/);
    const gait = copy(); (gait.walk!.gait as Record<string, unknown>).stance = 2;
    expect(() => parseTitanLook(gait)).toThrow(/stance/);
  });

  it("rejects shares over 1 and a wrong number of zones", () => {
    const share = copy(); share.damage!.glowLeast = 1.5;
    expect(() => parseTitanLook(share)).toThrow(/glowLeast/);
    const zones = copy(); zones.damage!.zoneWear = [1, 1];
    expect(() => parseTitanLook(zones)).toThrow(/zoneWear/);
  });
});

describe("the Titan's hand", () => {
  it("is where the model's Mount_Hand is, so the held car sits in its grapple", () => {
    const glb = readFileSync(new URL("../../../assets/models/titan/Junk_Titan.glb", import.meta.url));
    const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as { nodes: { name?: string; translation?: number[] }[] };
    const mount = gltf.nodes.find((n) => n.name === "Mount_Hand")?.translation;
    const hand = parseTitanLook(titanLookJson).throw.hand;
    expect(mount).toBeDefined();
    mount!.forEach((v, i) => expect(hand[i]).toBeCloseTo(v, 3));
  });
});

describe("titanDeathFx", () => {
  it("grows the mech blow-apart to the Titan's size, slower in time by the square root", () => {
    const base = parseDeathFx(deathFxJson);
    const look = parseTitanLook(titanLookJson);
    const big = titanDeathFx(base, look.fall);
    expect(big.smoke.endSize).toBeCloseTo(base.smoke.endSize * look.fall.scale);
    expect(big.torso.seconds).toBeCloseTo(base.torso.seconds * Math.sqrt(look.fall.scale));
    expect(big.torso.degrees).toBe(look.fall.tumbleDegrees);
    expect(big.smoke.pourSeconds).toBe(look.fall.pourSeconds);
    expect(big.maxWrecks).toBe(1);
    expect(big.middleMeters).toBe(look.fall.middleMeters);
    expect(parseDeathFx(big)).toBe(big); // still a valid blow-apart
  });
});
