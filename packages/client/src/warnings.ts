import { ZONE_ARMS, ZONE_LEGS, ZONE_TORSO } from "@rustbucket/shared";
import "./warnings.css";

// Every warning the code knows how to detect. Their text, level and priority (the order in the file) are data.
const IDS = ["outside", "torsoCritical", "legsBroken", "armsBroken", "fuelEmpty", "fuelLow"] as const;
export type WarningId = (typeof IDS)[number];
export type WarningLevel = "danger" | "caution";

export interface WarningDef {
  id: WarningId;
  text: string;
  level: WarningLevel;
}

export interface WarningsConfig {
  maxShown: number;
  blink: boolean;
  blinkSeconds: number;
  fuelLowFraction: number; // fuel share under which FUEL LOW shows, and only while the jets are held
  torsoCriticalFraction: number; // torso share under which TORSO CRITICAL shows: one more good hit ends you
  warnings: WarningDef[]; // highest priority first
}

// Fails loudly on a bad data file, same as the other tuning files.
export function parseWarnings(raw: unknown): WarningsConfig {
  const d = raw as Partial<WarningsConfig>;
  if (typeof d?.maxShown !== "number" || !(d.maxShown >= 1)) throw new Error("warnings.json: maxShown must be 1 or more");
  if (typeof d.blink !== "boolean") throw new Error("warnings.json: blink must be true or false");
  if (typeof d.blinkSeconds !== "number" || !(d.blinkSeconds > 0)) throw new Error("warnings.json: blinkSeconds must be above 0");
  for (const key of ["fuelLowFraction", "torsoCriticalFraction"] as const) {
    if (typeof d[key] !== "number" || !(d[key] > 0 && d[key] < 1)) throw new Error(`warnings.json: ${key} must be between 0 and 1`);
  }
  if (!Array.isArray(d.warnings)) throw new Error("warnings.json: warnings must be a list");
  const seen = new Set<string>();
  for (const w of d.warnings) {
    if (!IDS.includes(w?.id)) throw new Error(`warnings.json: unknown warning "${w?.id}"`);
    if (seen.has(w.id)) throw new Error(`warnings.json: "${w.id}" is listed twice`);
    seen.add(w.id);
    if (typeof w.text !== "string" || w.text === "") throw new Error(`warnings.json: "${w.id}" needs text`);
    if (w.level !== "danger" && w.level !== "caution") throw new Error(`warnings.json: "${w.id}" level must be danger or caution`);
  }
  return d as WarningsConfig;
}

// What the warnings look at, filled in place each frame so nothing is allocated.
export interface WarningInput {
  dead: boolean;
  outside: boolean;
  hp: readonly number[];
  maxHp: readonly number[];
  fuelFraction: number;
  fuelLocked: boolean;
  jetHeld: boolean;
}

export function createWarningInput(): WarningInput {
  return { dead: false, outside: false, hp: [], maxHp: [], fuelFraction: 1, fuelLocked: false, jetHeld: false };
}

function isActive(id: WarningId, s: WarningInput, c: WarningsConfig): boolean {
  switch (id) {
    case "outside": return s.outside;
    case "torsoCritical": return s.hp[ZONE_TORSO]! > 0 && s.hp[ZONE_TORSO]! < s.maxHp[ZONE_TORSO]! * c.torsoCriticalFraction;
    case "legsBroken": return s.hp[ZONE_LEGS]! <= 0;
    case "armsBroken": return s.hp[ZONE_ARMS]! <= 0;
    case "fuelEmpty": return s.fuelLocked;
    // Low fuel only matters while you are trying to fly, and not once it is already empty.
    case "fuelLow": return s.jetHeld && !s.fuelLocked && s.fuelFraction < c.fuelLowFraction;
  }
}

// One bit per warning in the data file's order, so a frame compares one number to see whether anything changed.
export function warningMask(s: WarningInput, c: WarningsConfig): number {
  if (s.dead) return 0;
  let mask = 0;
  c.warnings.forEach((w, i) => { if (isActive(w.id, s, c)) mask |= 1 << i; });
  return mask;
}

// The warnings to show for a mask: highest priority first, no more than maxShown.
export function shownWarnings(mask: number, c: WarningsConfig): WarningDef[] {
  const shown: WarningDef[] = [];
  for (let i = 0; i < c.warnings.length && shown.length < c.maxShown; i++) {
    if (mask & (1 << i)) shown.push(c.warnings[i]!);
  }
  return shown;
}

// Each tag pairs a marker shape with its text, so danger and caution differ by more than colour:
// danger is a filled "!!" block with a solid border and blinks, caution is a hollow "!" with a dashed border.
const MARKS: Record<WarningLevel, string> = { danger: "!!", caution: "!" };

// The warning tags in the upper centre of the HUD. Only touches the page when the set of warnings changes.
export class Warnings {
  private shownMask = -1;

  constructor(private root: HTMLElement, private config: WarningsConfig) {
    root.classList.add("warnings");
    root.classList.toggle("noBlink", !config.blink);
    root.style.setProperty("--warning-blink", `${config.blinkSeconds}s`);
  }

  update(s: WarningInput): void {
    const mask = warningMask(s, this.config);
    if (mask === this.shownMask) return;
    this.shownMask = mask;
    this.root.replaceChildren(...shownWarnings(mask, this.config).map((w) => {
      const tag = document.createElement("div");
      tag.className = `warningTag ${w.level}`;
      const mark = document.createElement("span");
      mark.className = "warningMark";
      mark.textContent = MARKS[w.level];
      const text = document.createElement("span");
      text.textContent = w.text;
      tag.append(mark, text);
      return tag;
    }));
  }
}
