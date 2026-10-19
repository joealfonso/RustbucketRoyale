import type { Loadout, MatchProgress, RingNow, RosterMech, UpgradeDef, WeaponStats } from "@rustbucket/shared";

export interface RoomView {
  code: string;
  tier: string;
  state: "lobby" | "countdown" | "active" | "results";
  hostId: number;
  players: number;
}

const byId = (id: string) => document.getElementById(id)!;

// The cooldown bar moves in this many steps, so the page changes a few times a second instead of every frame.
export const COOLDOWN_STEPS = 20;

// How far the ability's cooldown bar is filled, in whole steps: COOLDOWN_STEPS means ready.
export function cooldownStep(left: number, total: number): number {
  if (left <= 0 || total <= 0) return COOLDOWN_STEPS;
  return Math.max(0, Math.min(COOLDOWN_STEPS - 1, Math.floor((1 - left / total) * COOLDOWN_STEPS)));
}

// Match time as m:ss.
export function clock(seconds: number): string {
  const secs = Math.max(0, Math.floor(seconds));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

// What the zone is doing, said over the seconds left (shown beside it).
export function ringLabel(secondsToChange: number, shrinking: boolean): string {
  return secondsToChange <= 0 ? "Final zone" : shrinking ? "Zone closing" : "Zone holds";
}

// Armor plate points on one part, or a dash for none, so an empty part reads as empty and not as a zero to misread.
export function plateText(points: number): string {
  return points > 0 ? String(Math.round(points)) : "--";
}

// All the plain text and buttons for rooms and matches. Only touches the page when a value actually changes.
export class Hud {
  private roomBar = byId("roomBar");
  private roomText = byId("roomText");
  private roomInfo = byId("roomInfo");
  private radarFrame = byId("radarFrame");
  private startButton = byId("startButton");
  private bigText = byId("bigText");
  private matchHud = byId("matchHud");
  private aliveText = byId("aliveText");
  private aliveTotal = byId("aliveTotal");
  private timerText = byId("timerText");
  private ringLabel = byId("ringLabel");
  private ringText = byId("ringText");
  private feedBox = byId("feed");
  private results = byId("results");
  private lastText = new Map<HTMLElement, string>();
  private lastShown = new Map<HTMLElement, string>();
  private loadoutBox = byId("loadout");
  private mechBox = byId("mechTitle");
  private abilityBox = byId("ability");
  private abilityName = byId("abilityName");
  private abilityFill = byId("abilityFill");
  private abilityTime = byId("abilityTime");
  private aimCooldown = byId("aimCooldown");
  private aimCooldownTime = byId("aimCooldownTime");
  private abilityShown: string | null = null;
  private abilityKey = -1;
  private promptBox = byId("prompt");
  private plateCells = Array.from(document.querySelectorAll<HTMLElement>("#plates > div"));
  // The numbers last drawn, so a frame where nothing changed builds no strings at all.
  private shownProgress = [-1, -1, -1, -1, -1];
  private shownLoadout = [-2, -2, -2, -2, -2, -2];
  private shownPlates = [-1, -1, -1];

  constructor(onStart: () => void, onCopy: () => void) {
    this.startButton.addEventListener("click", onStart);
    byId("copyLink").addEventListener("click", onCopy);
  }

  private text(el: HTMLElement, value: string): void {
    if (this.lastText.get(el) === value) return;
    this.lastText.set(el, value);
    el.textContent = value;
  }

  private display(el: HTMLElement, value: string): void {
    if (this.lastShown.get(el) === value) return;
    this.lastShown.set(el, value);
    el.style.display = value;
  }

  setRoom(room: RoomView, youId: number): void {
    this.display(this.roomBar, "flex");
    // Only online play has a radar, and only online play has a room, so the frame shows with the room bar.
    this.display(this.radarFrame, "block");
    this.text(this.roomText, room.code);
    this.text(this.roomInfo, `${room.tier} · ${room.players} ${room.players === 1 ? "player" : "players"}`);
    this.startButton.classList.toggle("hidden", !(room.state === "lobby" && room.hostId === youId));
    if (room.state !== "results") this.results.style.display = "none";
  }

  setProgress(progress: MatchProgress, ring: RingNow | null): void {
    const { state } = progress;
    this.text(this.bigText, state === "countdown" ? String(Math.ceil(progress.seconds)) : "");
    const live = state === "active";
    this.display(this.matchHud, live ? "grid" : "none");
    if (!live) return;
    const secs = Math.floor(progress.seconds);
    const ringLeft = ring ? Math.max(0, Math.ceil(ring.secondsToChange)) : -1;
    const ringKind = !ring ? -1 : ring.secondsToChange <= 0 ? 0 : ring.shrinking ? 1 : 2;
    const shown = this.shownProgress;
    if (shown[0] === progress.alive && shown[1] === progress.total && shown[2] === secs && shown[3] === ringLeft && shown[4] === ringKind) return;
    shown[0] = progress.alive; shown[1] = progress.total; shown[2] = secs; shown[3] = ringLeft; shown[4] = ringKind;
    this.text(this.aliveText, String(progress.alive));
    this.text(this.aliveTotal, `of ${progress.total}`);
    this.text(this.timerText, clock(secs));
    if (ring) {
      this.text(this.ringLabel, ringLabel(ring.secondsToChange, ring.shrinking));
      this.text(this.ringText, ringKind === 0 ? "" : `${ringLeft} s`);
    }
  }

  // "GO" shows briefly when the countdown ends.
  flash(message: string, ms: number): void {
    this.text(this.bigText, message);
    window.setTimeout(() => this.text(this.bigText, ""), ms);
  }

  // The two weapon slots, the one in hand marked, the grenade count and fitted upgrades; and the plate points on
  // each part, with a short bar against one plate's worth.
  setLoadout(l: Loadout, weapons: readonly WeaponStats[], plates: readonly number[], upgrades: readonly UpgradeDef[]): void {
    const shown = this.shownLoadout;
    if (shown[0] !== l.slots[0] || shown[1] !== l.slots[1] || shown[2] !== l.active || shown[3] !== l.grenades || shown[4] !== l.upgrades[0] || shown[5] !== l.upgrades[1]) {
      shown[0] = l.slots[0]!; shown[1] = l.slots[1]!; shown[2] = l.active; shown[3] = l.grenades; shown[4] = l.upgrades[0]!; shown[5] = l.upgrades[1]!;
      const slot = (i: number) => {
        const name = l.slots[i]! >= 0 ? weapons[l.slots[i]!]?.name ?? "?" : "empty";
        return `<div class="${i === l.active ? "on" : ""}"><span class="key">${i + 1}</span>${name}</div>`;
      };
      const fitted = l.upgrades.filter((u) => u >= 0).map((u) => `<span class="swatch" style="background:${upgrades[u]?.color ?? "#fff"}"></span>${upgrades[u]?.name ?? "?"}`);
      const html = `${slot(0)}${slot(1)}<div class="on"><span class="key">G</span>Grenades <span class="num">x${l.grenades}</span></div>${fitted.length ? `<div class="upgrades">${fitted.join("")}</div>` : ""}`;
      this.loadoutBox.innerHTML = html;
    }
    for (let zone = 0; zone < this.plateCells.length; zone++) {
      const points = l.armor[zone] ?? 0;
      if (this.shownPlates[zone] === points) continue;
      this.shownPlates[zone] = points;
      const cell = this.plateCells[zone]!;
      const value = cell.lastElementChild as HTMLElement;
      value.textContent = plateText(points);
      value.classList.toggle("empty", points <= 0);
      cell.style.setProperty("--fill", String(Math.min(1, points / (plates[zone] || 1))));
    }
  }

  // The mech you are driving, and the one you picked for next match if it is a different one.
  setMech(mech: RosterMech, next: string | null): void {
    const html = `${mech.name} <small>${mech.role}</small>${next ? `<small class="next">Next match: ${next}</small>` : ""}`;
    if (this.lastText.get(this.mechBox) === html) return;
    this.lastText.set(this.mechBox, html);
    this.mechBox.innerHTML = html;
  }

  // Your mech's Q ability under its name: bright and saying READY when ready, dim with a filling bar and the seconds
  // left while it cools down, and those seconds again under the crosshair. Hidden for a mech without one.
  setAbility(name: string | null, cooldownLeft: number, cooldownSeconds: number): void {
    const step = name ? cooldownStep(cooldownLeft, cooldownSeconds) : -1;
    const ready = step === COOLDOWN_STEPS;
    const seconds = ready || !name ? 0 : Math.ceil(cooldownLeft);
    const key = step * 1000 + seconds;
    if (name === this.abilityShown && key === this.abilityKey) return;
    this.abilityShown = name;
    this.abilityKey = key;
    this.abilityBox.style.display = name ? "flex" : "none";
    this.aimCooldown.style.display = name && !ready ? "block" : "none";
    if (!name) return;
    this.text(this.abilityName, name);
    this.abilityBox.classList.toggle("ready", ready);
    this.abilityFill.style.width = `${(step / COOLDOWN_STEPS) * 100}%`;
    this.text(this.abilityTime, ready ? "READY" : `${seconds} s`);
    if (!ready) this.text(this.aimCooldownTime, `${seconds}`);
  }

  // A hint shown near something to interact with, or hidden with an empty string.
  setPrompt(text: string): void {
    this.display(this.promptBox, text ? "block" : "none");
    this.text(this.promptBox, text);
  }

  feed(message: string): void {
    const line = document.createElement("div");
    line.textContent = message;
    this.feedBox.prepend(line);
    window.setTimeout(() => line.remove(), 5000);
  }

  showResult(title: string, sub: string): void {
    byId("resultTitle").textContent = title;
    byId("resultSub").textContent = sub;
    this.results.style.display = "flex";
  }

  hideResult(): void {
    this.results.style.display = "none";
  }
}
