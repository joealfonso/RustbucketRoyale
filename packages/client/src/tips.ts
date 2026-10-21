// Teaching by play (gate 14b): the click-to-play screen shows only move, aim, fire, jets and dash, and everything else
// is said once, at the moment it is useful, in the same prompt box as "Hold F: repair". Each tip is shown once per
// player, remembered in this browser, and a real prompt (take, loot, repair) always wins over a tip.

// "detonate" and "reel" (gate 18b) teach the rivet gun's and the harpoon's right-click, in place of "secondary".
// "health" is said the first time a health plate lies close by. "supplyDrop" is said when the first drop is announced
// and "titan" the first time the Junk Titan's boss bar shows.
export const TIP_IDS = ["sprint", "ability", "grenade", "weapons", "drop", "secondary", "detonate", "reel", "health", "supplyDrop", "titan"] as const;
export type TipId = (typeof TIP_IDS)[number];

export interface TipsConfig {
  showSeconds: number;
  walkSecondsBeforeSprint: number; // the sprint tip waits for this much plain walking
  healthTipMeters: number; // the health tip waits for a plate this close
  tips: Record<TipId, string>; // "{ability}" is replaced by the mech's ability name, "{secondary}" by the gun's right-click
}

export function parseTips(raw: unknown): TipsConfig {
  const d = raw as TipsConfig;
  if (!(d?.showSeconds > 0 && d.walkSecondsBeforeSprint >= 0 && d.healthTipMeters > 0)) throw new Error("tips.json: needs showSeconds above 0, walkSecondsBeforeSprint and healthTipMeters above 0");
  for (const id of TIP_IDS) if (typeof d.tips?.[id] !== "string" || d.tips[id].length === 0) throw new Error(`tips.json: needs a ${id} tip`);
  return d;
}

// Where the tips already shown are kept, as plain strings: a tip id, or "secondary:<gun>" so each gun teaches its own
// right-click once. Old lists holding a bare "secondary" still load and are simply never matched again.
// Private windows and blocked storage throw: then tips repeat each visit.
export interface TipStore {
  load(): string[];
  save(keys: string[]): void;
}

const KEY = "rustbucket.tips";
export function browserTipStore(storage: () => Storage): TipStore {
  return {
    load: () => {
      try {
        const saved: unknown = JSON.parse(storage().getItem(KEY) ?? "[]");
        return Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string") : [];
      } catch { return []; }
    },
    save: (keys) => { try { storage().setItem(KEY, JSON.stringify(keys)); } catch { /* not remembered */ } },
  };
}

export class Tips {
  private shown: Set<string>;
  private text = "";
  private showingFor = 0;
  private walked = 0;

  constructor(private config: TipsConfig, private store: TipStore) {
    this.shown = new Set(store.load());
  }

  // Shows a tip unless it was shown before. `name` fills in the ability tip's ability or the secondary tip's fire; the
  // secondary tip is remembered per gun, so each gun with a right-click teaches it once.
  // Returns true when there is nothing left to do (shown now, or seen before), false when another tip is on screen,
  // so a caller holding a one-off event can try again next frame.
  offer(id: TipId, name = ""): boolean {
    const key = id === "secondary" ? `secondary:${name}` : id;
    if (this.shown.has(key)) return true;
    if (this.showingFor > 0) return false;
    this.shown.add(key);
    this.store.save([...this.shown]);
    this.text = this.config.tips[id].replace("{ability}", name).replace("{secondary}", name);
    this.showingFor = this.config.showSeconds;
    return true;
  }

  // Counts plain walking toward the sprint tip. Call each frame of a match with whether you walked without sprinting.
  walking(dt: number, walkingNotRunning: boolean): void {
    if (walkingNotRunning) this.walked += dt;
    if (this.walked >= this.config.walkSecondsBeforeSprint) this.offer("sprint");
  }

  // The tip to show now, or "" once it has had its time.
  current(dt: number): string {
    if (this.showingFor <= 0) return "";
    this.showingFor -= dt;
    return this.showingFor > 0 ? this.text : "";
  }
}
