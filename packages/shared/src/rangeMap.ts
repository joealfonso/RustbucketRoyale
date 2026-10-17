import { addProp, type PropConfig, type PropInstance } from "./props";
import { boxFromData, type Box, type BoxData } from "./world";

export interface RangeData {
  spawn: [number, number, number];
  boxes: BoxData[];
  props?: { type: string; x: number; z: number }[];
}

// The hand made test range: a flat strip with a few test props. Shared so client and server build it the same way.
export function buildRange(data: RangeData, propConfig: PropConfig): { boxes: Box[]; boxColors: string[]; props: PropInstance[]; propOfBox: Int32Array } {
  const boxes = data.boxes.map(boxFromData);
  const boxColors = data.boxes.map((b) => b.color);
  const props: PropInstance[] = [];
  for (const p of data.props ?? []) {
    const type = propConfig.types.findIndex((t) => t.id === p.type);
    if (type < 0) throw new Error(`greybox.json: unknown prop type "${p.type}"`);
    addProp(boxes, props, propConfig, type, p.x, p.z);
    boxColors.push(propConfig.types[type]!.color);
  }
  const propOfBox = new Int32Array(boxes.length).fill(-1);
  for (const p of props) propOfBox[p.boxIndex] = p.id;
  return { boxes, boxColors, props, propOfBox };
}
