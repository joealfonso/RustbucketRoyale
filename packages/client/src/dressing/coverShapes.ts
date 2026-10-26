import type { CoverKind, GrassLook } from "./coverConfig";
import { rng, type DressPiece } from "./kinds";
import { box, convex, cylinder, turn, wedge, type MeshData, type V3 } from "./shapes";

// The models of the near ground cover, one per kind, each about half a metre to a metre across at scale 1, standing
// on y = 0 round the origin. Every instance of a kind draws the same model; turned, sized and tinted per instance,
// that is enough variety at the distances cover is drawn. Plants are cards and thin cones, drawn from both sides,
// with their normals bent towards the sky so they take the light like the ground they grow from, not like a fence.

type Rand = () => number;
const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
const DEAD = "#7A5A2E";

// One flat triangle, either winding (the material draws both sides).
const tri = (a: V3, b: V3, c: V3): MeshData => convex([[a, b, c]]);

// Bends every normal towards straight up by `share`.
function skyward(mesh: MeshData, share: number): MeshData {
  const n = mesh.normals;
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i]! * (1 - share), y = n[i + 1]! * (1 - share) + share, z = n[i + 2]! * (1 - share);
    const l = Math.hypot(x, y, z) || 1;
    n[i] = x / l; n[i + 1] = y / l; n[i + 2] = z / l;
  }
  return mesh;
}

// One blade: a three-sided spike, four triangles, its base a little under the ground.
function blade(r: Rand, h: number, w: number): MeshData {
  const base: V3[] = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + r() * 0.5;
    return [Math.cos(a) * w, -0.02, Math.sin(a) * w * 0.55] as V3;
  });
  const tip: V3 = [0, h, 0];
  return convex([base, [base[0]!, base[1]!, tip], [base[1]!, base[2]!, tip], [base[2]!, base[0]!, tip]]);
}

// A clump of grass: a few broad blades leaning out from a tight middle, all in the ground's own green (the clump's
// tint and the dry patches vary it per instance), so a field reads as soft tufts rather than a scribble of thin,
// high-contrast blades (V16a). The darker root is laid on per corner by cover.ts.
function grass(r: Rand, look: GrassLook): DressPiece[] {
  const out: DressPiece[] = [];
  const [w0, w1] = look.width as [number, number], [h0, h1] = look.height as [number, number], [l0, l1] = look.lean as [number, number];
  for (let i = 0; i < look.blades; i++) {
    const out01 = r();
    // Blades nearer the middle stand taller and straighter, so the clump has a crown, not a flat fan.
    const d = look.spread * out01, h = between(r, h0, h1) * (1 - 0.25 * out01);
    const a = (i / look.blades) * Math.PI * 2 + between(r, -0.4, 0.4);
    const lean = between(r, l0, l1) * (0.6 + 0.4 * out01);
    // Turned to face out from the middle, then leaned away from it.
    const facing = turn(blade(r, h, between(r, w0, w1)), [0, Math.PI / 2 - a, 0]);
    const leaned = turn(facing, [Math.sin(a) * lean, 0, -Math.cos(a) * lean]);
    out.push({ paint: "moss", mesh: skyward(turn(leaned, [0, 0, 0], [0, 0, 0], [Math.cos(a) * d, 0, Math.sin(a) * d]), look.skyward) });
  }
  return out;
}

// Flowering weeds: a rosette of leaves flat on the ground, and a few stalks with yellow or seed-white heads. The
// heads are the only bright spots in the green, a little colour in the junk.
function weeds(r: Rand): DressPiece[] {
  const out: DressPiece[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + between(r, -0.2, 0.2), length = between(r, 0.2, 0.3), width = length * 0.35;
    const c = Math.cos(a), s = Math.sin(a), up = 0.08;
    const tip: V3 = [c * length, up, s * length], mid: V3 = [c * length * 0.45, up * 0.6, s * length * 0.45];
    const side: V3 = [-s * width / 2, 0.02, c * width / 2];
    const l: V3 = [mid[0] + side[0], mid[1] + side[1], mid[2] + side[2]], rr: V3 = [mid[0] - side[0], mid[1] + side[1], mid[2] - side[2]];
    const paint = i % 2 === 0 ? "darkMoss" : "moss";
    out.push({ paint, mesh: skyward(tri([0, 0.01, 0], l, tip), 0.5) }, { paint, mesh: skyward(tri([0, 0.01, 0], tip, rr), 0.5) });
  }
  for (let i = 0; i < 3; i++) {
    const h = between(r, 0.45, 0.75), a = r() * Math.PI * 2, d = between(r, 0.02, 0.08);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, lean = between(r, -0.15, 0.15);
    const stalk = turn(blade(r, h, 0.022), [lean, 0, lean * 0.5], [0, 0, 0], [x, 0, z]);
    out.push({ paint: "darkMoss", mesh: skyward(stalk, 0.4) });
    // The head, a small eight-sided bud, sits where the leaned stalk ends.
    const [tx, ty, tz] = turn({ positions: [0, h, 0], normals: [0, 1, 0], indices: [] }, [lean, 0, lean * 0.5], [0, 0, 0], [x, 0, z]).positions as V3;
    const e = 0.05, bud: V3[] = [[tx + e, ty, tz], [tx, ty, tz + e], [tx - e, ty, tz], [tx, ty, tz - e]];
    const up: V3 = [tx, ty + e * 0.9, tz], down: V3 = [tx, ty - e * 0.9, tz];
    const head = convex(bud.flatMap((p, k) => [[p, bud[(k + 1) % 4]!, up], [bud[(k + 1) % 4]!, p, down]]));
    out.push({ paint: i < 2 ? "sparkYellow" : "warmLight", mesh: head });
  }
  return out;
}

// A fern: fronds arching out and drooping, each folded along its midrib into a shallow V so it has some body from
// any side. Four triangles a segment, three segments a frond.
function fern(r: Rand): DressPiece[] {
  const out: DressPiece[] = [];
  const fronds = 7, segments = 3;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + between(r, -0.25, 0.25);
    const length = between(r, 0.5, 0.75), width = length * 0.28, rise = between(r, 0.6, 0.9);
    const c = Math.cos(a), s = Math.sin(a);
    const at = (t: number): V3 => {
      const d = length * t, y = length * (rise * t - (rise * 0.95) * t * t) + 0.02;
      return [c * d, y, s * d];
    };
    const half = (t: number) => width * 0.5 * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    const edge = (t: number, side: number): V3 => {
      const m = at(t), w = half(t) * side;
      return [m[0] - s * w, m[1] - half(t) * 0.35, m[2] + c * w];
    };
    const paint = r() < 0.12 ? DEAD : f % 2 === 0 ? "moss" : "darkMoss";
    for (let k = 0; k < segments; k++) {
      const t0 = k / segments, t1 = (k + 1) / segments;
      const m0 = at(t0), m1 = at(t1);
      for (const side of [-1, 1]) {
        const e0 = edge(t0, side), e1 = edge(t1, side);
        out.push({ paint, mesh: skyward(tri(m0, m1, e1), 0.55) }, { paint, mesh: skyward(tri(m0, e1, e0), 0.55) });
      }
    }
  }
  return out;
}

// Broken concrete and brick off the buildings, a stub of rebar, half sunk in the dirt.
function rubble(r: Rand): DressPiece[] {
  const out: DressPiece[] = [];
  const paints = ["warmLight", "scrapSteel", "scrapSteel", "deepRust"]; // broken pad concrete, a brick
  for (let i = 0; i < 4; i++) {
    const sx = between(r, 0.18, 0.42), sy = between(r, 0.1, 0.22), sz = between(r, 0.15, 0.32);
    const a = (i / 4) * Math.PI * 2 + between(r, -0.4, 0.4), d = i === 0 ? 0 : between(r, 0.2, 0.36);
    const shape = i % 2 === 1 ? wedge([0, 0, 0], [sx, sy, sz], 0.5) : box([0, 0, 0], [sx, sy, sz]);
    const placed = turn(shape, [between(r, -0.25, 0.25), r() * Math.PI, between(r, -0.25, 0.25)], [0, 0, 0], [Math.cos(a) * d, sy * 0.3, Math.sin(a) * d]);
    out.push({ paint: paints[i]!, mesh: placed });
  }
  const bar = turn(box([0, 0.12, 0], [0.04, 0.3, 0.04]), [0.5, 0.7, 0.2], [0, 0, 0], [0.05, 0, -0.05]);
  out.push({ paint: "rustOrange", mesh: bar });
  return out;
}

// Small scrap: a bent strip of sheet, a can on its side, a big nut and a bracket plate.
function scrap(r: Rand): DressPiece[] {
  const out: DressPiece[] = [];
  const bend = between(r, 0.4, 0.7);
  const leg = box([0.18, 0.025, 0], [0.36, 0.035, 0.14]);
  out.push(
    { paint: "rustOrange", mesh: turn(leg, [0, 0, 0], [0, 0, 0], [0, 0, 0.12]) },
    { paint: "rustOrange", mesh: turn(leg, [0, 0, bend], [0, 0, 0], [-0.33, 0, 0.12]) },
  );
  out.push({ paint: r() < 0.5 ? "sparkYellow" : "scrapSteel", mesh: cylinder([0.1, 0.07, -0.18], 0.07, 0.17, "x", 7) });
  out.push({ paint: "soot", mesh: cylinder([-0.18, 0.025, -0.15], 0.06, 0.05, "y", 6) });
  out.push({ paint: "frameNavy", mesh: turn(box([0, 0, 0], [0.28, 0.025, 0.22]), [0.18, 0.6, 0], [0, 0, 0], [0.3, 0.04, 0.02]) });
  return out;
}

const MAKERS: Record<CoverKind, (r: Rand, grassLook: GrassLook) => DressPiece[]> = { grass, weeds, fern, rubble, scrap };

// Kinds whose model is solid enough for an outline. Plants have none: a dark line round every blade turns a
// field of grass into scribble.
export const OUTLINED: ReadonlySet<CoverKind> = new Set(["rubble", "scrap"]);

// The model of one kind, the same every time for the same look.
export function coverModel(kind: CoverKind, grassLook: GrassLook): DressPiece[] {
  return MAKERS[kind](rng(0xc0fe + kind.length * 7919 + kind.charCodeAt(0)), grassLook);
}

// How bright a grass corner `y` metres up its blade is drawn: rootShade at the foot rising to tipShade at rootMeters,
// so each clump sits into the ground (a contact shadow painted in, no extra triangles).
export function bladeShade(y: number, look: GrassLook): number {
  const t = Math.min(1, Math.max(0, y / look.rootMeters));
  return look.rootShade + (look.tipShade - look.rootShade) * t;
}
