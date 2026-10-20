import { describe, expect, it } from "vitest";
import { checkBuilder, triangleCount } from "./builderChecks";
import { container } from "./container";
import type { DressBox, KindBuilder } from "./kinds";
import { ruin } from "./ruin";
import { sheet } from "./sheet";
import { tower } from "./tower";

// The per-box variations (doors, vents, pipes, ladders, tears, vines, boarded windows) are chosen by each box's seed.
// Whatever a seed picks, the model must keep the builder rules: inside its box, so collision still matches the look,
// faces outward, within its triangle budget, the same every time.

const cases: [string, KindBuilder, [number, number, number][]][] = [
  ["container", container, [[12, 2.6, 2.6]]],
  ["sheet", sheet, [[16, 4, 1.5], [6, 4, 1], [1, 7, 26], [34, 7, 1]]],
  ["ruin", ruin, [[14, 5, 1], [1, 3.5, 8]]],
  ["tower", tower, [[10, 14, 10]]],
];

// One box of each size, both ways round, under many seeds.
function boxes(sizes: [number, number, number][], seeds: number): DressBox[] {
  const out: DressBox[] = [];
  sizes.forEach(([sx, sy, sz], i) => {
    for (let seed = 0; seed < seeds; seed++) {
      const [a, b] = seed % 2 === 0 ? [sx, sz] : [sz, sx];
      const x = 30 * i - 40 + seed * 0.37, z = 12 - seed * 0.53, y = seed % 3 === 0 ? 0 : 1.25;
      out.push({ min: [x - a / 2, y, z - b / 2], max: [x + a / 2, y + sy, z + b / 2], seed: seed * 7919 + i, color: "#8a5a3c" });
    }
  });
  return out;
}

describe("building variety", () => {
  for (const [name, builder, sizes] of cases) {
    it(`${name}: keeps the builder rules under every variation`, () => {
      expect(checkBuilder(builder, boxes(sizes, 24))).toEqual([]);
    });

    it(`${name}: two boxes of the same size do not come out alike`, () => {
      const looks = new Set(boxes(sizes.slice(0, 1), 12).filter((_, i) => i % 2 === 0).map((b) => {
        const pieces = builder(b);
        return `${triangleCount(pieces)}:${pieces.map((p) => p.paint).sort().join()}`;
      }));
      expect(looks.size).toBeGreaterThan(3);
    });
  }
});
