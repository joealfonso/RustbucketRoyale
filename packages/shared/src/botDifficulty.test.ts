import { describe, expect, it } from "vitest";
import botsJson from "../../../data/bots.json";
import { BOT_DIFFICULTIES, parseBotDifficulty } from "./botDifficulty";

describe("bot difficulty from a link", () => {
  it("keeps the four known choices, in any case", () => {
    expect(parseBotDifficulty("easy")).toBe("easy");
    expect(parseBotDifficulty("normal")).toBe("normal");
    expect(parseBotDifficulty("HARD")).toBe("hard");
    expect(parseBotDifficulty(" mixed ")).toBe("mixed");
  });

  it("falls back to the mix for anything else", () => {
    expect(parseBotDifficulty(null)).toBe("mixed");
    expect(parseBotDifficulty(undefined)).toBe("mixed");
    expect(parseBotDifficulty("")).toBe("mixed");
    expect(parseBotDifficulty("insane")).toBe("mixed");
    expect(parseBotDifficulty("__proto__")).toBe("mixed");
  });

  it("names only difficulties that exist in bots.json, plus the mix", () => {
    for (const d of BOT_DIFFICULTIES) if (d !== "mixed") expect(botsJson.difficulties).toHaveProperty(d);
  });
});
