import { describe, expect, it } from "vitest";
import audioJson from "../../../data/audio.json";
import { heardLevel, makeRoom, travelSeconds, type MixConfig } from "./soundMix";

const mix = audioJson.mix as MixConfig;

describe("sound mix", () => {
  it("fades with distance and is full volume up close", () => {
    expect(heardLevel(1, 2)).toBe(1);
    expect(heardLevel(1, 100)).toBeLessThan(heardLevel(1, 50));
  });

  it("delays only far sounds, by the speed of sound", () => {
    expect(travelSeconds(10, mix)).toBe(0);
    expect(travelSeconds(mix.travelFromMeters + mix.speedOfSound, mix)).toBeCloseTo(1);
  });

  it("lets a loud explosion take the place of the quietest sound when every voice is busy", () => {
    const voices = [{ name: "shot", level: 0.5 }, { name: "step", level: 0.05 }, { name: "shot", level: 0.3 }];
    expect(makeRoom(voices, "explosion", 0.9, 3, 6)).toBe(1);
    expect(makeRoom(voices, "explosion", 0.01, 3, 6)).toBeNull();
    expect(makeRoom(voices, "explosion", 0.9, 4, 6)).toBe(-1);
  });

  it("caps copies of one sound, keeping the loudest", () => {
    const voices = [{ name: "shot", level: 0.5 }, { name: "shot", level: 0.2 }];
    expect(makeRoom(voices, "shot", 0.4, 24, 2)).toBe(1);
    expect(makeRoom(voices, "shot", 0.1, 24, 2)).toBeNull();
  });
});
