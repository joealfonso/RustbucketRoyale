import { describe, expect, it } from "vitest";
import { rejoinAddress } from "./net";

describe("rejoin address", () => {
  it("comes back to the room by its code, whatever the first address asked for", () => {
    expect(rejoinAddress("ws://localhost:8080/?create&tier=small&bots=3", "NTHT")).toBe("ws://localhost:8080/?room=NTHT&rejoin");
    expect(rejoinAddress("wss://rust.example/?room=ab12", "AB12")).toBe("wss://rust.example/?room=AB12&rejoin");
  });
});
