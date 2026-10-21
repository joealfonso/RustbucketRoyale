import * as THREE from "three";
import hangarJson from "../../../../data/hangar.json";
import { toGeometry } from "../dressing/dressing";
import { box, cylinder, merge, prism, turn, type MeshData, type V3 } from "../dressing/shapes";
import { freeze } from "../freeze";
import type { Toon } from "../toonMaterial";
import { hangingCable } from "./gantry";
import { segment } from "./hall";
import type { HangarConfig } from "./layout";

// Depth in the shot (gate V12). Near the camera: dark chains and cables hanging from the roof and the foot of a big
// gantry leg, at the frame's edges, so the hangar reads as a room you stand in rather than a picture. Far away: the
// daylight through the gap in the big door (the door and the catwalks are part of the hall, hall.ts). The daylight is
// flat colour drawn without fog, no bloom: the yard outside, junk piles against a pale sky.
// `still` is true when the player asked for reduced motion: then the chains hang dead straight.

export interface FramingConfig {
  paint: string; // the near silhouettes
  accent: string; // the safety band round the leg
  link: { length: number; width: number; wire: number };
  swayDegrees: number;
  chains: { top: V3; bottom: number; hook: boolean; swaySeconds: number }[];
  cables: { from: V3; to: V3; sag: number; radius: number }[];
  leg: { x: number; z: number; width: number; depth: number; foot: number; band: [number, number] };
  // `behind`: how far past the back wall the yard's far edge stands; piles are [x, half width, height above the horizon].
  daylight: { sky: string; land: string; behind: number; horizon: number; piles: [number, number, number][] };
}

export function parseFraming(raw: unknown): FramingConfig {
  const c = raw as FramingConfig;
  const fail = (what: string): never => { throw new Error(`hangar.json: framing.${what}`); };
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const positive = (v: unknown, what: string) => { if (!num(v) || !((v as number) > 0)) fail(`${what} must be a number above 0`); };
  const v3 = (v: unknown, what: string) => { if (!Array.isArray(v) || v.length !== 3 || !v.every(num)) fail(`${what} must be [x, y, z]`); };
  if (!c?.link || !c.leg || !c.daylight || !Array.isArray(c.chains) || !Array.isArray(c.cables)) fail("needs link, chains, cables, leg and daylight");
  for (const p of [c.paint, c.accent, c.daylight.sky, c.daylight.land]) if (typeof p !== "string" || p.length === 0) fail("paints must be palette names or hex colours");
  positive(c.link.length, "link.length");
  positive(c.link.width, "link.width");
  positive(c.link.wire, "link.wire");
  if (c.link.wire * 2 >= Math.min(c.link.length, c.link.width)) fail("link.wire must be under half the link's length and width");
  if (!num(c.swayDegrees) || c.swayDegrees < 0) fail("swayDegrees must be 0 or more");
  c.chains.forEach((ch, i) => {
    v3(ch.top, `chains[${i}].top`);
    positive(ch.swaySeconds, `chains[${i}].swaySeconds`);
    if (!num(ch.bottom) || ch.bottom >= ch.top[1] - 1) fail(`chains[${i}].bottom must be a metre or more under its top`);
  });
  c.cables.forEach((k, i) => { v3(k.from, `cables[${i}].from`); v3(k.to, `cables[${i}].to`); positive(k.sag, `cables[${i}].sag`); positive(k.radius, `cables[${i}].radius`); });
  for (const k of ["width", "depth", "foot"] as const) positive(c.leg[k], `leg.${k}`);
  if (!(c.leg.band[0] >= 0 && c.leg.band[1] > c.leg.band[0])) fail("leg.band must be [from, to] metres up the leg");
  for (const k of ["behind", "horizon"] as const) positive(c.daylight[k], `daylight.${k}`);
  return c;
}

interface Swing { group: THREE.Group; period: number; phase: number }

export class HangarFraming {
  readonly group = new THREE.Group();
  private swings: Swing[] = [];
  private sway: number;

  constructor(config: HangarConfig, toon: Toon) {
    const f = parseFraming(hangarJson.framing);
    this.sway = THREE.MathUtils.degToRad(f.swayDegrees);
    // Each hanging chain swings on its own about where it hangs from, so it is a group of its own.
    f.chains.forEach((ch, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(...ch.top);
      const length = ch.top[1] - ch.bottom - (ch.hook ? HOOK : 0);
      const parts = [chain([[0, 0, 0], [0, -length, 0]], f.link)];
      if (ch.hook) parts.push(hook(-length));
      addPainted(pivot, merge(...parts), f.paint, toon);
      this.group.add(pivot);
      // Spread the phases so the chains never swing in step.
      this.swings.push({ group: pivot, period: ch.swaySeconds, phase: i * 2.1 });
    });
    const fixed = new THREE.Group();
    addPainted(fixed, merge(...f.cables.map((k) => hangingCable(k.from, k.to, k.sag, k.radius, 18)), leg(f.leg, config.hall.height)), f.paint, toon);
    const [b0, b1] = f.leg.band;
    addPainted(fixed, box([f.leg.x, (b0 + b1) / 2, f.leg.z], [f.leg.width + 0.08, b1 - b0, f.leg.depth + 0.08]), f.accent, toon);
    this.daylight(config, f, toon, fixed);
    this.group.add(freeze(fixed));
  }

  // The yard outside the gap in the door: a sky, and the ground running to a horizon with junk piles on it. Flat
  // colour, unfogged, so it reads as bright outdoor light; the hall's own props stand dark against it.
  private daylight(c: HangarConfig, f: FramingConfig, toon: Toon, into: THREE.Group): void {
    const d = f.daylight, { backZ } = c.hall, [g0, g1] = c.hall.door.gap;
    const far = backZ - d.behind, wide = d.behind * 2;
    const flat = (mesh: MeshData, color: string) => into.add(new THREE.Mesh(toGeometry([mesh]), new THREE.MeshBasicMaterial({ color: toon.color(color), fog: false })));
    flat(box([(g0 + g1) / 2, c.hall.height / 2, far - 0.5], [g1 - g0 + wide * 2, c.hall.height * 2, 0.1]), d.sky);
    const land = [box([(g0 + g1) / 2, d.horizon / 2 - 2, far], [g1 - g0 + wide * 2, d.horizon + 4, 0.1])];
    for (const [x, half, height] of d.piles) {
      // A heap with a flat-ish top, leaning a little to one side, as scrap piles do.
      land.push(prism([[x - half, d.horizon], [x + half, d.horizon], [x + half * 0.3, d.horizon + height], [x - half * 0.4, d.horizon + height * 0.85]], "z", far, far + 0.1));
    }
    // The yard's floor between the wall and the horizon, so nothing shows under the land when seen from above it.
    land.push(box([(g0 + g1) / 2, -0.05, (far + backZ) / 2], [g1 - g0 + wide * 2, 0.1, backZ - far]));
    flat(merge(...land), d.land);
  }

  update(seconds: number, _dt: number, still: boolean): void {
    for (const s of this.swings) {
      const t = (seconds / s.period) * Math.PI * 2 + s.phase;
      // A slow pendulum, with a smaller sideways swing on another period so the path is never a flat arc.
      s.group.rotation.z = still ? 0 : Math.sin(t) * this.sway;
      s.group.rotation.x = still ? 0 : Math.sin(t * 0.73 + 1) * this.sway * 0.5;
    }
  }
}

const HOOK = 1.1; // how far the hook block and hook hang below the chain's last link

function addPainted(into: THREE.Group, mesh: MeshData, paint: string, toon: Toon): void {
  const geometry = toGeometry([mesh]);
  into.add(new THREE.Mesh(geometry, toon.material(paint)), new THREE.Mesh(geometry, toon.shellOutline(paint)));
}

// Chain links along a path, each a flat oval ring of four bars, every other one turned a quarter about the chain.
function chain(path: V3[], link: FramingConfig["link"]): MeshData {
  const { length: l, width: w, wire: t } = link;
  const ring = merge(
    box([0, (w - t) / 2, 0], [l, t, t]), box([0, -(w - t) / 2, 0], [l, t, t]),
    box([(l - t) / 2, 0, 0], [t, w - t * 2, t]), box([-(l - t) / 2, 0, 0], [t, w - t * 2, t]),
  );
  const turned = turn(ring, [Math.PI / 2, 0, 0]);
  const pitch = l - t * 2; // each link hangs inside the one above by the thickness of both wires
  const out: MeshData[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const span = Math.hypot(...d);
    const up = Math.atan2(d[1], Math.hypot(d[0], d[2])), heading = Math.atan2(-d[2], d[0]);
    for (let s = pitch / 2, n = 0; s < span; s += pitch, n++) {
      const at: V3 = [a[0] + (d[0] * s) / span, a[1] + (d[1] * s) / span, a[2] + (d[2] * s) / span];
      out.push(turn(turn(n % 2 ? turned : ring, [0, 0, up]), [0, heading, 0], [0, 0, 0], at));
    }
  }
  return merge(...out);
}

// A crane hook under its block, hanging from y = `at`: the block, a short shank, and the curved hook to one side.
function hook(at: number): MeshData {
  const parts = [box([0, at - 0.25, 0], [0.34, 0.42, 0.24], 0.04), cylinder([0, at - 0.25, 0], 0.13, 0.3, "z", 10)];
  const shank: V3 = [0, at - 0.46, 0], bend: V3 = [0, at - 0.78, 0];
  parts.push(segment(shank, bend, 0.1));
  // The bowl: round from the shank's foot, under, and up to the tip.
  const cx = 0.17, cy = at - 0.78, r = 0.17;
  let last = bend;
  for (let k = 1; k <= 6; k++) {
    const a = Math.PI + (k / 6) * Math.PI * 1.2;
    const p: V3 = [cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0];
    parts.push(segment(last, p, 0.1 - k * 0.006));
    last = p;
  }
  return merge(...parts);
}

// The foot of a big gantry leg near the camera: an I-beam rising out of the top of the frame, on a base plate with
// gussets and bolts. Only the foot shows; it is there to put something between you and the hall.
function leg(g: FramingConfig["leg"], height: number): MeshData {
  const { x, z, width: w, depth: d, foot } = g;
  const flange = 0.09, web = 0.07;
  const parts = [
    box([x - w / 2 + flange / 2, height / 2, z], [flange, height, d]),
    box([x + w / 2 - flange / 2, height / 2, z], [flange, height, d]),
    box([x, height / 2, z], [w - flange * 2, height, web]),
    box([x, 0.07, z], [foot, 0.14, foot], 0.02),
  ];
  // Gussets: triangles from the base plate up each flange's outer face, front and back.
  for (const side of [-1, 1]) {
    for (const dz of [-d / 3, d / 3]) {
      const fx = x + side * (w / 2), out = x + side * (foot / 2 - 0.05);
      parts.push(prism([[fx, 0.14], [out, 0.14], [fx, 0.85]], "z", z + dz - 0.03, z + dz + 0.03));
    }
  }
  for (const bx of [-1, 1]) for (const bz of [-1, 1]) parts.push(cylinder([x + bx * (foot / 2 - 0.15), 0.18, z + bz * (foot / 2 - 0.15)], 0.06, 0.1, "y", 6));
  return merge(...parts);
}
