import type { V3 } from "../../packages/client/src/dressing/shapes";

// What moves on a mech beyond its leg joints (gate V9b), written into <name>.kit.json beside the parts and read by
// packages/client/src/kitMotion.ts. Nothing here changes the model: the shapes stay in their parts, and the game lifts
// them out of the nearest level of detail by where they lie. A shape of one of `parts` belongs to an entry when every
// corner of it lies within `radius` of the line through `path`.
//  - A piston: `path` runs from the sleeve's mount to the rod's mount, each on its own bone ("body", or thigh, shin or
//    foot and the leg's side, as "shin_R"). Shapes whose middle lies less than `split` of the way along go with the
//    sleeve, the rest with the rod, and the game aims each end at the other's mount every frame, so the rod slides in
//    and out of the sleeve as the joint bends.
//  - A swaying part: on one bone, lagging behind the mech's moves on a spring (data/sway.json `profiles`). A whip
//    (an antenna, a mast, a drone on its pylon) bends about the first point of `path`; a swing (a hose hung between two
//    fittings) turns about the line between its first and last points, so both ends stay where they are fixed.
export interface MotionEntry {
  name: string;
  parts: string[];
  path: V3[];
  radius: number;
  piston?: [string, string];
  split?: number;
  sway?: string;
  bone?: string;
  swing?: true;
}

const round = (p: V3): V3 => p.map((v) => Math.round(v * 1000) / 1000) as V3;

// A piston from `from` (the sleeve's bone and mount) to `to` (the rod's). `split` defaults to halfway.
export function piston(name: string, parts: string[], from: [string, V3], to: [string, V3], radius: number, split?: number): MotionEntry {
  return { name, parts, path: [round(from[1]), round(to[1])], radius, piston: [from[0], to[0]], ...(split === undefined ? {} : { split }) };
}

export function sway(name: string, parts: string[], bone: string, path: V3[], radius: number, profile: string, swing = false): MotionEntry {
  return { name, parts, path: path.map(round), radius, sway: profile, bone, ...(swing ? { swing: true as const } : {}) };
}

// A copy of an entry mirrored onto another side: `move` maps each point, `sides` each side name (R to L, or FR to
// BR on four legs), which renames the entry, its bones and any part named for a side ("Leg_R", "Leg_FR_Hydraulics").
export function mirrored(entry: MotionEntry, move: (p: V3) => V3, sides: Record<string, string>): MotionEntry {
  const rename = (s: string) => s.split("_").map((word) => sides[word] ?? word).join("_");
  return {
    ...entry,
    name: rename(entry.name),
    parts: entry.parts.map(rename),
    path: entry.path.map((p) => round(move(p))),
    ...(entry.piston ? { piston: entry.piston.map(rename) as [string, string] } : {}),
    ...(entry.bone ? { bone: rename(entry.bone) } : {}),
  };
}

export const mirrorPoint = ([x, y, z]: V3): V3 => [-x, y, z];
export const leftOf = (entry: MotionEntry) => mirrored(entry, mirrorPoint, { R: "L" });
