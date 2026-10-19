import { World, type Box, type NavGrid, type PropInstance } from "@rustbucket/shared";
import type { MapForRoom } from "./Room";

// A generated map as a few flat arrays, so a map worker can hand it to the main thread by moving memory instead of
// copying 17,000 box objects and 5,000 props one by one. The World's lookup grid is rebuilt on arrival rather than
// sent: it takes about 2 ms on a large map, and every match needs a fresh World anyway (destroyed props switch
// their boxes off in it).
export interface PackedMap {
  boxes: Float64Array; // minX, minY, minZ, maxX, maxY, maxZ for each box
  props: Float64Array; // id, type, boxIndex, x, y, z for each prop
  propOfBox: Int32Array;
  nav: NavGrid; // its one big array is typed already
  spawns: [number, number, number][];
  meters: number;
}

const BOX_FIELDS = 6;
const PROP_FIELDS = 6;

// Float64 keeps every number exactly as generation made it, so the unpacked map is the same map, not a close one.
export function packMap(map: MapForRoom): PackedMap {
  const list = map.world.boxes;
  const boxes = new Float64Array(list.length * BOX_FIELDS);
  list.forEach((b, i) => boxes.set([b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ], i * BOX_FIELDS));
  const props = new Float64Array(map.props.length * PROP_FIELDS);
  map.props.forEach((p, i) => props.set([p.id, p.type, p.boxIndex, p.x, p.y, p.z], i * PROP_FIELDS));
  return { boxes, props, propOfBox: map.propOfBox, nav: map.nav, spawns: map.spawns, meters: map.meters };
}

// The buffers postMessage can move to the other thread instead of copying.
export function transferList(packed: PackedMap): ArrayBuffer[] {
  return [packed.boxes.buffer, packed.props.buffer, packed.propOfBox.buffer, packed.nav.top.buffer] as ArrayBuffer[];
}

export function unpackMap(packed: PackedMap): MapForRoom {
  const b = packed.boxes;
  const boxes: Box[] = new Array(b.length / BOX_FIELDS);
  for (let i = 0, k = 0; i < boxes.length; i++, k += BOX_FIELDS) {
    boxes[i] = { minX: b[k]!, minY: b[k + 1]!, minZ: b[k + 2]!, maxX: b[k + 3]!, maxY: b[k + 4]!, maxZ: b[k + 5]! };
  }
  const p = packed.props;
  const props: PropInstance[] = new Array(p.length / PROP_FIELDS);
  for (let i = 0, k = 0; i < props.length; i++, k += PROP_FIELDS) {
    props[i] = { id: p[k]!, type: p[k + 1]!, boxIndex: p[k + 2]!, x: p[k + 3]!, y: p[k + 4]!, z: p[k + 5]! };
  }
  return { world: new World(boxes), nav: packed.nav, spawns: packed.spawns, meters: packed.meters, props, propOfBox: packed.propOfBox };
}
