import { describe, expect, it } from "vitest";
import { createRoomSearch, offlineSearch, playSearch, rejoinQuery, serverQuery } from "./roomLinks";

describe("room links", () => {
  it("puts tier, bots and difficulty in the Create room link", () => {
    expect(createRoomSearch({ tier: "arena", bots: "5", difficulty: "hard" })).toBe("?create&tier=arena&bots=5&difficulty=hard");
    expect(createRoomSearch({ tier: "small", bots: "", difficulty: "mixed" })).toBe("?create&tier=small&difficulty=mixed");
  });

  it("Play makes a room of the picked size filled with the picked bots, which starts itself only on that first page", () => {
    const play = new URLSearchParams(playSearch("medium", "hard").slice(1));
    expect(serverQuery(play).toString()).toBe("tier=medium&difficulty=hard"); // no bots count: fill to the tier size
    expect(play.has("play")).toBe(true);
    expect(rejoinQuery(play, "PLAY", "small").has("play")).toBe(false); // a reload or invite never starts it again
  });

  it("practises offline on the picked map size", () => {
    expect(offlineSearch("large")).toBe("?offline&tier=large");
  });

  it("tells the server the difficulty, cleaned up", () => {
    const from = (search: string) => serverQuery(new URLSearchParams(search)).toString();
    expect(from("?create&tier=arena&bots=5&difficulty=hard")).toBe("tier=arena&bots=5&difficulty=hard");
    expect(from("?create&tier=arena&difficulty=<script>")).toBe("tier=arena&difficulty=mixed");
    expect(from("?room=ABCD")).toBe("room=ABCD");
  });

  it("keeps the difficulty in the address a reload rejoins", () => {
    const again = rejoinQuery(new URLSearchParams("?create&tier=arena&bots=3&difficulty=easy&kit=grey"), "WXYZ", "arena");
    expect(again.toString()).toBe("room=WXYZ&tier=arena&bots=3&difficulty=easy&kit=grey");
    expect(rejoinQuery(new URLSearchParams("?room=WXYZ"), "WXYZ", "small").toString()).toBe("room=WXYZ&tier=small");
  });

  it("survives a reload: the rejoin address makes the same server query", () => {
    const first = new URLSearchParams(createRoomSearch({ tier: "small", bots: "", difficulty: "hard" }).slice(1));
    const reloaded = rejoinQuery(first, "QRST", "small");
    expect(serverQuery(reloaded).get("difficulty")).toBe("hard");
  });
});
