import { describe, expect, it } from "vitest";
import { checkBuilder, sampleBoxes, triangleCount } from "./builderChecks";
import { container } from "./container";

describe("container", () => {
  it("keeps the builder rules for the real container size", () => {
    expect(checkBuilder(container, sampleBoxes([[12, 2.6, 2.6]]))).toEqual([]);
  });

  it("gives a longer container more ribs", () => {
    const [long] = sampleBoxes([[12, 2.6, 2.6]], 1);
    const [short] = sampleBoxes([[6, 2.6, 2.6]], 1);
    expect(triangleCount(container(long!))).toBeGreaterThan(triangleCount(container(short!)));
  });
});
