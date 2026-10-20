import type { Box, World } from "./world";

export interface PropType {
  id: string;
  weight: number;
  size: [number, number, number];
  hp: number;
  color: string;
  explodes: boolean; // goes off like a grenade when destroyed
  dropsLoot: boolean; // can leave something behind when broken (what, and how often, is in loot.json)
  // Scenery (trees): placed by the forest pass, not scattered in chunks (weight 0), left out of the prop and loot
  // density checks, and too thin to count as a wall for bot routes.
  scenery?: boolean;
}

export interface PropConfig {
  perChunk: { min: number; max: number };
  keepClearOfSpawn: number; // metres kept free round the middle of a chunk where mechs start
  margin: number; // gap kept between a prop and the chunk's own boxes
  types: PropType[];
  barrelBlast: { radius: number; damage: number; delaySeconds: number };
  density: { minPerSquareKm: number; maxPerSquareKm: number };
  // Props that can drop loot: enough over the whole map, and a few near every spawn so nobody starts in a desert.
  lootDensity: { minPerSquareKm: number; maxPerSquareKm: number; nearSpawnMeters: number; minNearSpawn: number };
}

// One breakable object on the map. Its id is its place in the map's prop list, which comes from the seed,
// so every machine agrees on it. Its box is also in the map's collision boxes, at boxIndex.
export interface PropInstance {
  id: number;
  type: number;
  boxIndex: number;
  x: number;
  y: number; // middle of the box
  z: number;
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && n > 0);

export function parsePropConfig(raw: unknown): PropConfig {
  const d = raw as Record<string, unknown>;
  const per = d?.perChunk as { min?: unknown; max?: unknown } | undefined;
  if (!per || !Number.isInteger(per.min) || !Number.isInteger(per.max) || (per.min as number) < 0 || (per.max as number) < (per.min as number)) {
    throw new Error("props.json: perChunk needs whole numbers min <= max");
  }
  for (const key of ["keepClearOfSpawn", "margin"]) if (typeof d[key] !== "number") throw new Error(`props.json: ${key} must be a number`);
  if (!Array.isArray(d.types) || d.types.length === 0) throw new Error("props.json: needs types");
  for (const t of d.types as Record<string, unknown>[]) {
    if (typeof t.id !== "string" || !isVec3(t.size) || typeof t.hp !== "number" || !(t.hp > 0) || typeof t.color !== "string" || typeof t.explodes !== "boolean" || typeof t.dropsLoot !== "boolean") {
      throw new Error(`props.json: type ${String(t.id)} is incomplete`);
    }
    if (t.scenery === true ? t.weight !== 0 : !Number.isInteger(t.weight) || (t.weight as number) <= 0) throw new Error(`props.json: ${t.id} weight must be a whole number above 0 (exactly 0 for scenery)`);
  }
  const blast = d.barrelBlast as Record<string, unknown> | undefined;
  for (const key of ["radius", "damage", "delaySeconds"]) if (typeof blast?.[key] !== "number") throw new Error(`props.json: barrelBlast.${key} must be a number`);
  const density = d.density as Record<string, unknown> | undefined;
  for (const key of ["minPerSquareKm", "maxPerSquareKm"]) if (typeof density?.[key] !== "number") throw new Error(`props.json: density.${key} must be a number`);
  const loot = d.lootDensity as Record<string, unknown> | undefined;
  for (const key of ["minPerSquareKm", "maxPerSquareKm", "nearSpawnMeters", "minNearSpawn"]) if (typeof loot?.[key] !== "number") throw new Error(`props.json: lootDensity.${key} must be a number`);
  return d as unknown as PropConfig;
}

// Adds one prop standing on the ground at (x, z). Its box goes into `boxes`, and the prop into `props`.
// `baseY` is the ground it stands on: the lowest point under it, so no corner floats on a slope.
export function addProp(boxes: Box[], props: PropInstance[], config: PropConfig, type: number, x: number, z: number, baseY = 0): PropInstance {
  const [sx, sy, sz] = config.types[type]!.size;
  boxes.push({ minX: x - sx / 2, maxX: x + sx / 2, minY: baseY, maxY: baseY + sy, minZ: z - sz / 2, maxZ: z + sz / 2 });
  const prop: PropInstance = { id: props.length, type, boxIndex: boxes.length - 1, x, y: baseY + sy / 2, z };
  props.push(prop);
  return prop;
}

// The props a ram or a slam smashes from where a mech is: every standing prop whose box comes within `radius`
// across the ground and overlaps the mech's height. The server breaks them; the rammer's own client takes them out
// of its prediction at the same step, so a charge ploughs through a row of trees instead of being stopped by each
// trunk until the server's word arrives. Fills `out` with prop ids and returns how many. `scratch` is reused.
export function propsInReach(world: World, propOfBox: ArrayLike<number>, x: number, y: number, z: number, radius: number, height: number, scratch: number[], out: number[]): number {
  const boxes = world.query(x - radius, z - radius, x + radius, z + radius, scratch);
  let count = 0;
  for (let i = 0; i < boxes; i++) {
    const index = scratch[i]!;
    const id = propOfBox[index]!;
    if (id < 0) continue;
    const box = world.boxes[index]!;
    if (box.maxY < y || box.minY > y + height) continue;
    const nearX = Math.max(box.minX, Math.min(x, box.maxX)), nearZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    if (Math.hypot(nearX - x, nearZ - z) <= radius) out[count++] = id;
  }
  return count;
}

