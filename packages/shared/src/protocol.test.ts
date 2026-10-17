import { describe, expect, it } from "vitest";
import { createMechInput } from "./MechInput";
import { parseClientMessage } from "./protocol";

const input = (extra: Record<string, unknown> = {}) => JSON.stringify({ t: "input", seq: 1, ...createMechInput(), ...extra });

describe("parseClientMessage", () => {
  it("accepts a normal input and a start message", () => {
    expect(parseClientMessage(input())).toMatchObject({ t: "input", seq: 1 });
    expect(parseClientMessage('{"t":"start"}')).toEqual({ t: "start" });
  });

  it("keeps the client's reported lag, within bounds, and treats a missing or silly one as not reported", () => {
    expect(parseClientMessage(input({ lagMs: 85 }))).toMatchObject({ lagMs: 85 });
    expect(parseClientMessage(input({ lagMs: 99999 }))).toMatchObject({ lagMs: 1000 });
    expect(parseClientMessage(input({ lagMs: -5 }))).toMatchObject({ lagMs: 0 });
    expect(parseClientMessage(input())).toMatchObject({ lagMs: undefined });
    expect(parseClientMessage(input({ lagMs: "lots" }))).toMatchObject({ lagMs: undefined });
  });

  it("rejects junk", () => {
    for (const raw of ["", "nope", "[]", '{"t":"input"}', input({ seq: 0 }), input({ moveX: "1" }), input({ fire: 1 })]) {
      expect(parseClientMessage(raw), raw).toBeNull();
    }
  });
});
