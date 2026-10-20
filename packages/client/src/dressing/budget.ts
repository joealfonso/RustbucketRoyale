import dressingJson from "../../../../data/dressing.json";
import type { DressBox } from "./kinds";

// How many triangles one dressed box may have (data/dressing.json "triangleBudget"): so many per cubic metre of its
// box, never under `min` (a small crate still needs its edges) and never over `max` (a 34 m wall gets more posts, not
// finer ones). builderChecks.ts holds every builder to it; details.ts stops adding variations before it.
export interface TriangleBudget {
  perCubicMetre: number;
  min: number;
  max: number;
}

export function parseTriangleBudget(raw: unknown): TriangleBudget {
  const b = raw as TriangleBudget;
  if (!b || typeof b !== "object") throw new Error("dressing.json: triangleBudget is missing");
  for (const k of ["perCubicMetre", "min", "max"] as const) {
    if (typeof b[k] !== "number" || !(b[k] > 0)) throw new Error(`dressing.json: triangleBudget.${k} must be a number above 0`);
  }
  if (b.max < b.min) throw new Error("dressing.json: triangleBudget.max must not be under min");
  return { perCubicMetre: b.perCubicMetre, min: b.min, max: b.max };
}

export const TRIANGLE_BUDGET = parseTriangleBudget(dressingJson.triangleBudget);

export function trianglesFor(box: DressBox, budget: TriangleBudget = TRIANGLE_BUDGET): number {
  const volume = (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]);
  return Math.min(budget.max, Math.max(budget.min, volume * budget.perCubicMetre));
}
