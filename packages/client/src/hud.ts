import type { Loadout, MatchProgress, RingNow, UpgradeDef, WeaponStats } from "@rustbucket/shared";

export interface RoomView {
  code: string;
  tier: string;
  state: "lobby" | "countdown" | "active" | "results";
  hostId: number;
  players: number;
}

const byId = (id: string) => document.getElementById(id)!;

// All the plain text and buttons for rooms and matches. Only touches the page when a value actually changes.
export class Hud {
  private roomBar = byId("roomBar");
  private roomText = byId("roomText");
  private startButton = byId("startButton");
  private bigText = byId("bigText");
  private aliveText = byId("aliveText");
  private timerText = byId("timerText");
  private ringText = byId("ringText");
  private feedBox = byId("feed");
  private results = byId("results");
  private zoneWarning = byId("zoneWarning");
  private lastText = new Map<HTMLElement, string>();
  private loadoutBox = byId("loadout");
  private promptBox = byId("prompt");
  private plateFills = Array.from(document.querySelectorAll<HTMLElement>("#zones .plate"));

  constructor(onStart: () => void, onCopy: () => void) {
    this.startButton.addEventListener("click", onStart);
    byId("copyLink").addEventListener("click", onCopy);
  }

  private text(el: HTMLElement, value: string): void {
    if (this.lastText.get(el) === value) return;
    this.lastText.set(el, value);
    el.textContent = value;
  }

  setRoom(room: RoomView, youId: number): void {
    this.roomBar.style.display = "flex";
    this.text(this.roomText, `Room ${room.code} · ${room.tier} · ${room.players} ${room.players === 1 ? "player" : "players"}`);
    this.startButton.classList.toggle("hidden", !(room.state === "lobby" && room.hostId === youId));
    if (room.state !== "results") this.results.style.display = "none";
  }

  setProgress(progress: MatchProgress, ring: RingNow | null, outside: boolean): void {
    const { state } = progress;
    this.text(this.bigText, state === "countdown" ? String(Math.ceil(progress.seconds)) : state === "lobby" ? "" : "");
    const live = state === "active";
    this.aliveText.style.display = live ? "block" : "none";
    this.timerText.style.display = live ? "block" : "none";
    this.ringText.style.display = live ? "block" : "none";
    if (live) {
      this.text(this.aliveText, `Alive ${progress.alive} of ${progress.total}`);
      const secs = Math.floor(progress.seconds);
      this.text(this.timerText, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`);
      if (ring) {
        const left = Math.ceil(ring.secondsToChange);
        this.text(this.ringText, ring.secondsToChange <= 0 ? "Final zone" : ring.shrinking ? `Zone closing: ${left} s` : `Zone holds: ${left} s`);
      }
    }
    this.zoneWarning.style.display = live && outside ? "block" : "none";
  }

  // "GO" shows briefly when the countdown ends.
  flash(message: string, ms: number): void {
    this.text(this.bigText, message);
    window.setTimeout(() => this.text(this.bigText, ""), ms);
  }

  // The two weapon slots, the one in hand highlighted, the grenade count, and armor as a thin bar under each zone.
  setLoadout(l: Loadout, weapons: readonly WeaponStats[], plates: readonly number[], upgrades: readonly UpgradeDef[]): void {
    const slot = (i: number) => {
      const name = l.slots[i]! >= 0 ? weapons[l.slots[i]!]?.name ?? "?" : "empty";
      return `<div class="${i === l.active ? "on" : ""}">${i + 1}  ${name}</div>`;
    };
    const fitted = l.upgrades.filter((u) => u >= 0).map((u) => `<span style="color:${upgrades[u]?.color ?? "#fff"}">${upgrades[u]?.name ?? "?"}</span>`);
    const html = `${slot(0)}${slot(1)}<div>G  grenades x${l.grenades}</div>${fitted.length ? `<div>+ ${fitted.join(", ")}</div>` : ""}`;
    if (this.lastText.get(this.loadoutBox) !== html) {
      this.lastText.set(this.loadoutBox, html);
      this.loadoutBox.innerHTML = html;
    }
    this.plateFills.forEach((fill, zone) => { fill.style.width = `${Math.min(1, (l.armor[zone] ?? 0) / (plates[zone] || 1)) * 100}%`; });
  }

  // A hint shown near something to interact with, or hidden with an empty string.
  setPrompt(text: string): void {
    this.promptBox.style.display = text ? "block" : "none";
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
