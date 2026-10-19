import * as THREE from "three";
import type { KitPart, LoadedKit } from "./mechKit";
import type { Toon } from "./toonMaterial";

// A kit mech is drawn from few meshes, not one per part (docs/PERF.md, "Mech parts merged"). Parts that move together
// (the body, or one leg piece on its joint), belong to one hit zone and show in the same damage states become one
// object, and inside it everything drawn with the same kind of material is one mesh. Paint colours travel per vertex,
// so all the rusting paint of a zone is one mesh whatever its colours, as are the plain frames, the glows and every
// outline. The pilot's accent and the gun keep materials of their own, because their colour is per mech or changes in
// play. The geometry depends only on the kit and the body and trim paints, so mechs of one kit share it.

// What a fill is drawn with, as createMechModel chooses it: rusting paint, plain paint that never rusts, flat lit glow,
// or the colour of the weapon in hand.
export type FillLook = "rust" | "plain" | "glow" | "weapon";

export interface MergedPiece {
  zone: number;
  shownIn: number; // one bit per zone state it shows in: 1 intact, 2 damaged, 4 broken
  segment: number; // the leg piece it hangs on (legRig.ts numbering), or -1 for the body
  // Each level of detail, nearest first; null where nothing of this kind is left at that level.
  fills: { look: FillLook; accent: boolean; lods: (THREE.BufferGeometry | null)[] }[];
  outlines: { accent: boolean; lods: (THREE.BufferGeometry | null)[] }[];
}

// A part with no damaged version shows its intact one while damaged (setMechDamage), so both states share a bit set.
export function shownIn(part: KitPart, state: number): number {
  return state === 0 && !part.states[1] ? 0b011 : 1 << state;
}

export function lookOf(part: KitPart): FillLook {
  return part.paint === "weapon" ? "weapon" : part.glow ? "glow" : part.rusts ? "rust" : "plain";
}

interface Member { lods: THREE.BufferGeometry[]; fill: THREE.Color | null; outline: THREE.Color | null; look: FillLook; accent: boolean }

const cache = new WeakMap<LoadedKit, Map<string, MergedPiece[]>>();

// The kit's merged pieces for this body and trim paint. Colours come from the palette, which is fixed while the game
// runs, so the cache only needs the paint names.
export function mergedPieces(kit: LoadedKit, toon: Toon, bodyColor: string, trimColor: string): MergedPiece[] {
  let byPaint = cache.get(kit);
  if (!byPaint) cache.set(kit, (byPaint = new Map()));
  const key = `${bodyColor}|${trimColor}`;
  let pieces = byPaint.get(key);
  if (!pieces) byPaint.set(key, (pieces = merge(kit, toon, bodyColor, trimColor)));
  return pieces;
}

function merge(kit: LoadedKit, toon: Toon, bodyColor: string, trimColor: string): MergedPiece[] {
  const groups = new Map<string, { zone: number; shownIn: number; segment: number; members: Member[] }>();
  const add = (zone: number, shown: number, segment: number, member: Member) => {
    const key = `${segment}|${zone}|${shown}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { zone, shownIn: shown, segment, members: [] }));
    group.members.push(member);
  };
  for (const part of kit.parts) {
    const accent = part.paint === "accent";
    const look = lookOf(part);
    const paint = part.color ? toon.color(part.color) : part.paint === "trim" ? toon.color(trimColor) : toon.color(bodyColor);
    // The same colours the parts had as separate meshes: the paint itself, and the shared outline's darkened colour.
    const fill = accent || look === "weapon" ? null : new THREE.Color(paint);
    const outline = accent ? null : toon.shellOutline(look === "weapon" ? trimColor : paint).color.clone();
    part.states.forEach((state, i) => {
      if (!state) return;
      const shown = shownIn(part, i);
      if (state.pieces && kit.legs.length > 0) {
        for (const { piece, lods } of state.pieces) add(part.zone, shown, piece, { lods, fill, outline, look, accent });
      } else add(part.zone, shown, -1, { lods: state.lods, fill, outline, look, accent });
    });
  }
  return [...groups.values()].map(({ zone, shownIn, segment, members }) => {
    const levels = Math.max(...members.map((m) => m.lods.length));
    // A part with fewer levels keeps showing its simplest one, as its own LOD object did.
    const at = (m: Member, level: number) => m.lods[Math.min(level, m.lods.length - 1)]!;
    const fills: MergedPiece["fills"] = [];
    for (const m of members) {
      if (fills.some((f) => f.look === m.look && f.accent === m.accent)) continue;
      const same = members.filter((o) => o.look === m.look && o.accent === m.accent);
      fills.push({ look: m.look, accent: m.accent, lods: levelsOf(levels, (level) => same.map((o) => ({ geometry: at(o, level), color: o.fill })), "normal") });
    }
    const outlines: MergedPiece["outlines"] = [];
    for (const accent of [false, true]) {
      const same = members.filter((o) => o.accent === accent);
      if (same.length > 0) outlines.push({ accent, lods: levelsOf(levels, (level) => same.map((o) => ({ geometry: at(o, level), color: o.outline })), "outlineNormal") });
    }
    return { zone, shownIn, segment, fills, outlines };
  });
}

type Source = { geometry: THREE.BufferGeometry; color: THREE.Color | null };

function levelsOf(levels: number, sourcesAt: (level: number) => Source[], normal: "normal" | "outlineNormal"): (THREE.BufferGeometry | null)[] {
  const out: (THREE.BufferGeometry | null)[] = [];
  for (let level = 0; level < levels; level++) out.push(joined(sourcesAt(level).filter((s) => cornersOf(s.geometry) > 0), normal));
  return out;
}

const cornersOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position?.count ?? 0);

// One geometry from several, as plain triangles: position, the one normal its material uses, and each source's colour
// on every corner when it has one. A single uncoloured source is used as it is, so it is not copied.
export function joined(sources: Source[], normal: "normal" | "outlineNormal"): THREE.BufferGeometry | null {
  if (sources.length === 0) return null;
  if (sources.length === 1 && !sources[0]!.color) return sources[0]!.geometry;
  const corners = sources.reduce((n, s) => n + cornersOf(s.geometry), 0);
  const position = new Float32Array(corners * 3);
  const normals = new Float32Array(corners * 3);
  const colors = sources[0]!.color ? new Float32Array(corners * 3) : null;
  let at = 0;
  for (const { geometry, color } of sources) {
    const p = geometry.attributes.position!;
    // A model without its own outline normals pushes its shell out along the face normals, as the shader would.
    const n = geometry.attributes[normal] ?? geometry.attributes.normal!;
    const index = geometry.index;
    for (let c = 0, count = cornersOf(geometry); c < count; c++, at += 3) {
      const v = index ? index.getX(c) : c;
      position[at] = p.getX(v); position[at + 1] = p.getY(v); position[at + 2] = p.getZ(v);
      normals[at] = n.getX(v); normals[at + 1] = n.getY(v); normals[at + 2] = n.getZ(v);
      if (colors && color) { colors[at] = color.r; colors[at + 1] = color.g; colors[at + 2] = color.b; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute(normal, new THREE.BufferAttribute(normals, 3));
  if (colors) g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}
