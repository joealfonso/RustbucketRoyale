import * as THREE from "three";
import { solveLeg, stepGait, type GaitConfig, type GaitInput } from "./gait";
import type { MechModel } from "./mechModel";

const solved = new Float32Array(2);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Walks one mech for this frame: moves its gait on (gait.ts), then bends each leg so its foot lands where the gait
// puts it and sets the body's bob and lean. Returns a bit per leg for feet that came down this frame. A mech without
// leg joints, with its legs gone, or destroyed, does not walk. Allocates nothing.
export function walkMech(model: MechModel, config: GaitConfig, input: GaitInput, dt: number): number {
  const g = model.gait;
  const params = config.mechs[model.gaitId];
  if (!g || !params) return 0;
  if (model.dead || model.hp[0]! <= 0) {
    standStill(model);
    return 0;
  }
  stepGait(g, input, params, model.legSides, config.smoothing, dt);

  const body = model.body;
  body.position.y = model.crawlDrop + g.bob;
  body.rotation.set(model.crawlTilt + g.pitch, 0, g.roll);
  // The feet are placed in the mech's frame, the legs hang in the body's, which bobs and leans: undo that first.
  const cp = Math.cos(-g.pitch), sp = Math.sin(-g.pitch), cr = Math.cos(-g.roll), sr = Math.sin(-g.roll);
  for (let i = 0; i < model.legs.length; i++) {
    const leg = model.legs[i]!;
    const a = leg.restAnkle, h = leg.restHip, k = leg.restKnee;
    // A stride longer than the leg (a heavy mech at speed) keeps the foot planted and sliding at the end of its
    // reach rather than lifting it off the ground.
    const z = clamp(a.z + g.feet[i * 3 + 2]!, h.z - leg.reach, h.z + leg.reach);
    // Each foot keeps to its own side of the body, so a sideways step never sweeps it through the other leg.
    // The limit is a share of the leg's own standing width, so a wide-footed mech keeps a gap between its feet.
    const inner = a.x * config.footInward;
    const x = a.x > 0 ? Math.max(inner, a.x + g.feet[i * 3]!) : Math.min(inner, a.x + g.feet[i * 3]!);
    const y = a.y + g.feet[i * 3 + 1]! - body.position.y;
    const y1 = y * cp - z * sp, z1 = y * sp + z * cp;
    const x2 = x * cr - y1 * sr, y2 = x * sr + y1 * cr;
    // Sideways steps swing the whole leg out at the hip; the bend itself stays in the leg's own side view.
    const drop = h.y - a.y;
    const swing = Math.asin(clamp((x2 - a.x) / drop, -0.6, 0.6));
    leg.hip.rotation.z = swing;
    solveLeg(h.y, h.z, k.y, k.z, a.y, a.z, y2 - drop * (1 - Math.cos(swing)), z1, solved);
    leg.hip.rotation.x = solved[0]!;
    leg.knee.rotation.x = solved[1]!;
    // The foot stays level with the ground whatever the leg and body are doing.
    leg.ankle.rotation.set(-(solved[0]! + solved[1]!) - g.pitch, 0, -(swing + g.roll));
  }
  return g.footfalls;
}

// Back to the modelled pose: legs straight as built, body at its crawl or rest height.
function standStill(model: MechModel): void {
  for (const leg of model.legs) {
    leg.hip.rotation.set(0, 0, 0);
    leg.knee.rotation.set(0, 0, 0);
    leg.ankle.rotation.set(0, 0, 0);
  }
  model.body.position.y = model.crawlDrop;
  model.body.rotation.set(model.crawlTilt, 0, 0);
}

// Where a foot that just came down touches the ground, in the world, for its dust and its thud.
export function footInWorld(model: MechModel, leg: number, out: THREE.Vector3): THREE.Vector3 {
  const rest = model.legs[leg]!.restAnkle;
  const feet = model.gait!.feet;
  out.set(rest.x + feet[leg * 3]!, 0.05, rest.z + feet[leg * 3 + 2]!);
  return model.group.localToWorld(out);
}
