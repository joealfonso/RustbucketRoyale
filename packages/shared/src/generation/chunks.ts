export interface ChunkBox {
  center: [number, number, number];
  size: [number, number, number];
  colorIndex: number;
}

export interface ChunkTemplate {
  id: string;
  weight: number;
  spawnable: boolean; // the middle of the chunk is kept clear, so a mech can start there
  dense: boolean; // big solid chunks that should not sit next to each other
  boxes: ChunkBox[];
}

export interface ChunkSet {
  size: number; // metres, chunks are square
  palette: string[];
  templates: ChunkTemplate[];
}

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

// Fails loudly on a bad chunk file. Box positions are in the chunk's own frame, from 0 to `size` on x and z.
export function parseChunkSet(raw: unknown): ChunkSet {
  const data = raw as { size?: unknown; templates?: unknown };
  if (typeof data?.size !== "number" || !(data.size > 0)) throw new Error("chunks.json: size must be above 0");
  if (!Array.isArray(data.templates) || data.templates.length === 0) throw new Error("chunks.json: needs templates");
  const size = data.size;

  const palette: string[] = [];
  const templates = (data.templates as Record<string, unknown>[]).map((t): ChunkTemplate => {
    const id = String(t.id);
    if (typeof t.weight !== "number" || !Number.isInteger(t.weight) || t.weight <= 0) throw new Error(`chunks.json: ${id} weight must be a whole number above 0`);
    if (!Array.isArray(t.boxes)) throw new Error(`chunks.json: ${id} needs boxes`);
    const boxes = (t.boxes as Record<string, unknown>[]).map((b): ChunkBox => {
      if (!isVec3(b.center) || !isVec3(b.size) || typeof b.color !== "string") throw new Error(`chunks.json: ${id} has a bad box`);
      const [cx, , cz] = b.center;
      const [sx, , sz] = b.size;
      if (cx - sx / 2 < 0 || cx + sx / 2 > size || cz - sz / 2 < 0 || cz + sz / 2 > size) throw new Error(`chunks.json: ${id} has a box outside the chunk`);
      let colorIndex = palette.indexOf(b.color);
      if (colorIndex < 0) colorIndex = palette.push(b.color) - 1;
      return { center: b.center, size: b.size, colorIndex };
    });
    return { id, weight: t.weight, spawnable: t.spawnable === true, dense: t.dense === true, boxes };
  });
  return { size, palette, templates };
}

// Turns a chunk box to one of the 8 ways a chunk can sit: 0 to 3 quarter turns, optionally mirrored.
// Only swaps and subtractions of exact numbers, so every machine gets identical results.
export function orient(box: ChunkBox, size: number, turns: number, mirror: boolean, out: { center: [number, number, number]; size: [number, number, number] }): void {
  let [x, y, z] = box.center;
  let [w, h, d] = box.size;
  if (mirror) x = size - x;
  for (let i = 0; i < turns; i++) {
    const nx = size - z;
    z = x;
    x = nx;
    const nw = d;
    d = w;
    w = nw;
  }
  out.center = [x, y, z];
  out.size = [w, h, d];
}
