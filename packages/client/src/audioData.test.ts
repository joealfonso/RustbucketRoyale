import { describe, expect, it } from "vitest";
import audioJson from "../../../data/audio.json";
import weaponsJson from "../../../data/weapons.json";

// Joseph's standing rule: every gun gets its own sound. A new weapon in weapons.json without one fails here, so it
// cannot quietly fall back to the autocannon's shot.
describe("audio data", () => {
  it("gives every weapon its own shot sound, and every shot sound exists", () => {
    const shots = audioJson.weaponShots as Record<string, string>;
    const sounds = audioJson.sounds as Record<string, unknown>;
    for (const weapon of weaponsJson.weapons) {
      expect(shots[weapon.id], `data/audio.json weaponShots has no sound for "${weapon.id}"`).toBeDefined();
      expect(sounds[shots[weapon.id]!], `weaponShots names "${shots[weapon.id]}", which is not in sounds`).toBeDefined();
    }
  });
});
