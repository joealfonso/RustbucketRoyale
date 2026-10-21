// The mixing rules behind audio.ts, kept free of Web Audio so they can be tested: how loud a sound reaches the ears,
// how late it arrives, and which playing sound gives way when there is no room for another.

export interface MixConfig {
  maxSame: number; // at most this many of one sound at once; a fourth autocannon shot replaces the quietest of the three
  speedOfSound: number; // metres a second: far blasts are seen before they are heard
  travelFromMeters: number; // nearer than this a sound is heard at once, so your own fight never feels laggy
  duck: { sounds: string[]; db: number; seconds: number; withinMeters: number }; // big sounds near you push the rest down
}

// Must match the PannerNode settings in audio.ts: the share of a sound's volume that reaches ears this far away.
export const REF_DISTANCE = 8;
export const ROLLOFF = 1.2;
export function heardLevel(volume: number, distance: number): number {
  const d = Math.max(distance, REF_DISTANCE);
  return volume * REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (d - REF_DISTANCE));
}

export function travelSeconds(distance: number, mix: MixConfig): number {
  return distance > mix.travelFromMeters ? (distance - mix.travelFromMeters) / mix.speedOfSound : 0;
}

export interface Voice {
  name: string;
  level: number; // heardLevel when it started
}

// Room for a new sound: the index of the playing voice to stop for it, -1 to play it without stopping any, or null to
// skip it. Over the cap for its own name, the quietest of that name gives way (or the new one is skipped if it is
// quieter still). With every voice in use, the quietest voice gives way if the new one is louder.
export function makeRoom(voices: readonly Voice[], name: string, level: number, maxVoices: number, maxSame: number): number | null {
  let same = 0, quietestSame = -1, quietest = -1;
  voices.forEach((v, i) => {
    if (v.name === name) {
      same++;
      if (quietestSame < 0 || v.level < voices[quietestSame]!.level) quietestSame = i;
    }
    if (quietest < 0 || v.level < voices[quietest]!.level) quietest = i;
  });
  if (same >= maxSame) return level > voices[quietestSame]!.level ? quietestSame : null;
  if (voices.length >= maxVoices) return quietest >= 0 && level > voices[quietest]!.level ? quietest : null;
  return -1;
}
