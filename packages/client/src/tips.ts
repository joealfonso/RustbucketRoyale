// Teaching by play (gate 14b): the click-to-play screen shows only move, aim, fire, jets and dash, and everything else
// is said once, at the moment it is useful, in the same prompt box as "Hold F: repair". Each tip is shown once per
// player, remembered in this browser, and a real prompt (take, loot, repair) always wins over a tip.

export const TIP_IDS = ["sprint", "ability", "grenade", "weapons", "drop", "secondary"] as const;
export type TipId = (typeof TIP_IDS)[number];

export interface TipsConfig {
  showSeconds: number;
  walkSecondsBeforeSprint: number; // the sprint tip waits for this much plain walking
  tips: Record<TipId, string>; // "{ability}" is replaced by the mech's ability name, "{secondary}" by the gun's right-click
}

export function parseTips(raw: unknown): TipsConfig {
  const d = raw as TipsConfig;
  if (!(d?.showSeconds > 0 && d.walkSecondsBeforeSprint >= 0)) throw new Error("tips.json: needs showSeconds above 0 and walkSecondsBeforeSprint");
  for (const id of TIP_IDS) if (typeof d.tips?.[id] !== "string" || d.tips[id].length === 0) throw new Error(`tips.json: needs a ${id} tip`);
  return d;
}

// Where the tips already shown are kept. Private windows and blocked storage throw: then tips repeat each visit.
export interface TipStore {
  load(): TipId[];
  save(ids: TipId[]): void;
}

const KEY = "rustbucket.tips";
export function browserTipStore(storage: () => Storage): TipStore {
  return {
    load: () => { try { return JSON.parse(storage().getItem(KEY) ?? "[]") as TipId[]; } catch { return []; } },
    save: (ids) => { try { storage().setItem(KEY, JSON.stringify(ids)); } catch { /* not remembered */ } },
  };
}

export class Tips {
  private shown: Set<TipId>;
  private text = "";
  private showingFor = 0;
  private walked = 0;

  constructor(private config: TipsConfig, private store: TipStore) {
    this.shown = new Set(store.load());
  }

  // Shows a tip unless it was shown before. `name` fills in the ability tip's ability or the secondary tip's fire.
  offer(id: TipId, name = ""): void {
    if (this.shown.has(id) || this.showingFor > 0) return;
    this.shown.add(id);
    this.store.save([...this.shown]);
    this.text = this.config.tips[id].replace("{ability}", name).replace("{secondary}", name);
    this.showingFor = this.config.showSeconds;
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
