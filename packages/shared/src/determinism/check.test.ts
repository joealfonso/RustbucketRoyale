import { describe, expect, it } from "vitest";
import { findViolations } from "./check";

const bad = (code: string) => findViolations(code).length > 0;

describe("determinism check", () => {
  it("flags unseeded, time based and engine dependent calls", () => {
    for (const code of [
      "const a = Math.random();", "const a = Date.now();", "const a = new Date();", "const t = performance.now();",
      "const a = Math.sin(1);", "const a = Math.pow(2, 3);", "const a = 2 ** 3;", "crypto.getRandomValues(x);",
    ]) expect(bad(code), code).toBe(true);
  });

  it("allows plain integer maths and the seeded generator", () => {
    expect(bad("const a = Math.imul(3, 4) + Math.floor(2.5) + Math.sqrt(9) + rng.nextInt(6);")).toBe(false);
  });

  it("ignores the banned words inside comments and text", () => {
    expect(bad("// never use Math.random here\nconst s = 'Date.now';\n/* performance.now */ const a = 1;")).toBe(false);
  });

  it("reports the right line", () => {
    expect(findViolations("const a = 1;\nconst b = Math.random();\n")[0]!.line).toBe(2);
  });
});
