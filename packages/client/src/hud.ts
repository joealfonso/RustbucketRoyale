import { ZONE_BROKEN, ZONE_DAMAGED, zoneState, type Loadout, type MatchProgress, type RingNow, type RosterMech, type UpgradeDef, type WeaponStats, type ZoneSet } from "@rustbucket/shared";
import { percentLeft } from "./damageDiagram";
import { countUp, cssSeconds, replay } from "./uiMotion";

export interface RoomView {
  code: string;
  tier: string;
  state: "lobby" | "countdown" | "active" | "results";
  hostId: number;
  players: number;
  difficulty: string; // the room's bots: easy, normal, hard or mixed
}

const byId = (id: string) => document.getElementById(id)!;

// How long a kill feed line stays up before it slides out.
const FEED_SECONDS = 5;

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

// Whether the Titan's bar is up: while it stands within `meters` of you (gate 13c). A fallen one has no bar; its fall
// says it on its own.
export function bossBarShown(shown: boolean, fallen: boolean, dx: number, dz: number, meters: number): boolean {
  return shown && !fallen && dx * dx + dz * dz <= meters * meters;
}

// The right-click meter beside the gun in hand (gate 18a), in whole steps so the page changes only when it moves.
// windup: `value` is heat, `flag` overheated; charge: `value` is the charge share, `flag` full; slug: `flag` ready.
// Gate 18b: detonate: `value` is the share of the most rivets you can have stuck, `count` how many are; reel: `value`
// is how far the harpoon has cooled down, `flag` ready.
export const ALT_STEPS = 20;
export type AltKind = "windup" | "slug" | "charge" | "detonate" | "reel";
export interface AltMeter { step: number; label: string; state: "" | "hot" | "overheat" | "full" | "ready" }
export function altMeter(kind: AltKind, value: number, flag: boolean, out: AltMeter, count = 0): AltMeter {
  out.step = kind === "slug" ? (flag ? ALT_STEPS : 0) : Math.max(0, Math.min(ALT_STEPS, Math.round(value * ALT_STEPS)));
  if (kind === "detonate") {
    out.state = count > 0 ? "ready" : "";
    out.label = count > 0 ? `${count} STUCK` : "";
    return out;
  }
  if (kind === "reel") {
    out.state = flag ? "ready" : "";
    out.label = flag ? "READY" : "";
    return out;
  }
  if (kind === "windup") {
    out.state = flag ? "overheat" : value >= 0.7 ? "hot" : "";
    out.label = flag ? "OVERHEAT" : "";
  } else if (kind === "charge") {
    out.state = flag ? "full" : "";
    out.label = flag ? "PIERCE" : "";
  } else {
    out.state = flag ? "ready" : "";
    out.label = "";
  }
  return out;
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
  // Made here rather than in the page, and moved under the slot in hand each time the slots are redrawn.
  private altBox = document.createElement("div");
  private altName = document.createElement("span");
  private altGauge = document.createElement("i");
  private altLabel = document.createElement("span");
  private altShown = { name: "", kind: "", step: -1, state: "", label: "" };
  private altScratch: AltMeter = { step: 0, label: "", state: "" };
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
  private replayTag = byId("replayTag");
  private replayFill = byId("replayFill");
  private crosshair = byId("crosshair");
  private replayShown = -1; // the hundredths of the replay last drawn, so the bar is touched only when it moves
  private bossBar = byId("bossBar");
  private bossFill = byId("bossFill");
  private bossHp = byId("bossHp");
  private bossShown = -1; // the hit points in whole percent last drawn, -1 while hidden
  private promptOn = false;
  private flashTimer = 0; // while a flash (GO) is up, the countdown's clearing of the big text waits for it
  private stopCount: (() => void) | null = null;
  // Read once: how long a feed line takes to slide out, so it is removed only after (motion.css --ui-out).
  private feedOutMs = cssSeconds("--ui-out") * 1000;
  private plateCells = Array.from(document.querySelectorAll<HTMLElement>("#plates > div"));
  // The numbers last drawn, so a frame where nothing changed builds no strings at all.
  private shownProgress = [-1, -1, -1, -1, -1];
  private shownLoadout = [-2, -2, -2, -2, -2, -2];
  private shownPlates = [-1, -1, -1];
  private shownParts = [-1, -1, -1]; // percent left and state packed, so an unchanged part touches nothing

  constructor(onStart: () => void, onCopy: () => void) {
    this.altBox.id = "altFire";
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = "RMB";
    this.altGauge.appendChild(document.createElement("b"));
    this.altLabel.className = "altLabel";
    this.altBox.append(key, this.altName, this.altGauge, this.altLabel);
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
    this.text(this.roomInfo, `${room.tier} · ${room.difficulty} bots · ${room.players} ${room.players === 1 ? "player" : "players"}`);
    this.startButton.classList.toggle("hidden", !(room.state === "lobby" && room.hostId === youId));
    if (room.state !== "results") this.results.style.display = "none";
  }

  // The big centre text, which lands with a punch every time it changes to something.
  private big(value: string): void {
    if (this.lastText.get(this.bigText) === value) return;
    this.text(this.bigText, value);
    this.bigText.classList.toggle("words", value.length > 3);
    if (value) replay(this.bigText);
  }

  // `countdownWords` go before the countdown's number ("DROP IN 3" while you hang above the map), or nothing.
  setProgress(progress: MatchProgress, ring: RingNow | null, countdownWords = ""): void {
    const { state } = progress;
    // A countdown at 0 is the frame it ends on, not a number to show.
    if (state === "countdown") this.big(progress.seconds > 0 ? `${countdownWords ? `${countdownWords} ` : ""}${Math.ceil(progress.seconds)}` : "");
    else if (!this.flashTimer) this.big("");
    const live = state === "active";
    this.display(this.matchHud, live ? "grid" : "none");
    if (!live) return;
    const secs = Math.floor(progress.seconds);
    const ringLeft = ring ? Math.max(0, Math.ceil(ring.secondsToChange)) : -1;
    const ringKind = !ring ? -1 : ring.secondsToChange <= 0 ? 0 : ring.shrinking ? 1 : 2;
    const shown = this.shownProgress;
    if (shown[0] === progress.alive && shown[1] === progress.total && shown[2] === secs && shown[3] === ringLeft && shown[4] === ringKind) return;
    // Someone dropped: the count kicks, so a knockout anywhere on the map is felt in the corner of your eye.
    if (progress.alive < shown[0]!) replay(this.aliveText);
    shown[0] = progress.alive; shown[1] = progress.total; shown[2] = secs; shown[3] = ringLeft; shown[4] = ringKind;
    this.text(this.aliveText, String(progress.alive));
    this.text(this.aliveTotal, `of ${progress.total}`);
    this.text(this.timerText, clock(secs));
    if (ring) {
      this.text(this.ringLabel, ringLabel(ring.secondsToChange, ring.shrinking));
      this.text(this.ringText, ringKind === 0 ? "" : `${ringLeft} s`);
    }
  }

  // "GO" shows briefly when the countdown ends. Until it is gone, setProgress leaves the big text alone: it used to
  // clear it on the very next frame, so GO was never seen.
  flash(message: string, ms: number): void {
    this.big(message);
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => { this.flashTimer = 0; this.big(""); }, ms);
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
      this.loadoutBox.children[l.active]?.after(this.altBox);
    }
    for (let zone = 0; zone < this.plateCells.length; zone++) {
      const points = l.armor[zone] ?? 0;
      if (this.shownPlates[zone] === points) continue;
      this.shownPlates[zone] = points;
      const cell = this.plateCells[zone]!;
      const value = cell.querySelector<HTMLElement>(".plate .num")!;
      value.textContent = plateText(points);
      value.classList.toggle("empty", points <= 0);
      cell.style.setProperty("--fill", String(Math.min(1, points / (plates[zone] || 1))));
    }
  }

  // How much of each part is left before it breaks off, as a percent and a bar, red once the part is damaged.
  setParts(hp: readonly number[], set: ZoneSet): void {
    for (let zone = 0; zone < this.plateCells.length; zone++) {
      const percent = percentLeft(hp[zone] ?? 0, set.zones[zone]?.hp ?? 1);
      const state = zoneState(hp, set, zone);
      const packed = percent * 4 + state;
      if (this.shownParts[zone] === packed) continue;
      this.shownParts[zone] = packed;
      const cell = this.plateCells[zone]!;
      cell.querySelector(".part")!.textContent = String(percent);
      cell.style.setProperty("--part", String(percent / 100));
      cell.classList.toggle("damaged", state === ZONE_DAMAGED);
      cell.classList.toggle("broken", state === ZONE_BROKEN);
    }
  }

  // The gun in hand's right-click: its name, and a heat bar (OVERHEAT when it locks), a charge ring (it kicks and says
  // PIERCE when full), a ready dot, the rivets stuck (a bar of them and the count) or the harpoon's cooldown ring.
  // Hidden with a null name. `count` is the rivets stuck, for detonate.
  setAltFire(name: string | null, kind: AltKind, value: number, flag: boolean, count = 0): void {
    const m = altMeter(kind, value, flag, this.altScratch, count);
    const shown = this.altShown;
    const shownName = name ?? "";
    if (shown.name === shownName && shown.kind === kind && shown.step === m.step && shown.state === m.state && shown.label === m.label) return;
    // A rivet more, or the harpoon ready again: the gauge kicks, so it is felt without looking.
    const kick = shown.kind === kind && ((kind === "detonate" && m.label !== shown.label && m.step > shown.step) || (kind === "reel" && m.state === "ready" && shown.state !== "ready"));
    shown.label = m.label;
    const newly = m.state !== shown.state;
    if (shown.name !== shownName) { shown.name = shownName; this.altBox.style.display = name ? "flex" : "none"; this.altName.textContent = shownName; }
    if (shown.kind !== kind) { shown.kind = kind; this.altGauge.className = kind; }
    shown.step = m.step;
    shown.state = m.state;
    this.altBox.dataset.state = m.state;
    this.altGauge.style.setProperty("--fill", String(m.step / ALT_STEPS));
    this.altLabel.textContent = m.label;
    if ((newly && (m.state === "full" || m.state === "overheat")) || kick) replay(this.altGauge);
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

  // A hint shown near something to interact with, or hidden with an empty string. Hiding keeps the last words in
  // the box, so it fades out still saying them instead of shrinking to nothing.
  setPrompt(text: string): void {
    const on = text !== "";
    if (on !== this.promptOn) {
      this.promptOn = on;
      this.promptBox.classList.toggle("on", on);
    }
    if (on) this.text(this.promptBox, text);
  }

  feed(message: string): void {
    const line = document.createElement("div");
    line.textContent = message;
    this.feedBox.prepend(line);
    window.setTimeout(() => line.classList.add("out"), FEED_SECONDS * 1000);
    window.setTimeout(() => line.remove(), FEED_SECONDS * 1000 + this.feedOutMs);
  }

  // The match result. Your place rolls down from the size of the field to where you finished. `place` is null
  // for the winner and for someone who never had a mech.
  showResult(title: string, place: number | null, field: number, stats: readonly string[] = []): void {
    byId("resultTitle").textContent = title;
    // The match's fun numbers (knockoutCard.ts statLines), one line each, arriving one after another.
    byId("resultStats").replaceChildren(...stats.map((line, i) => {
      const item = document.createElement("li");
      item.textContent = line;
      item.style.setProperty("--i", String(i));
      return item;
    }));
    const sub = byId("resultSub");
    this.stopCount?.();
    this.stopCount = null;
    if (place === null) {
      sub.textContent = "Next match starting...";
    } else {
      const number = document.createElement("span");
      number.id = "resultPlace";
      // As wide as the biggest number it passes through, so the line does not twitch as the digits change.
      number.style.minWidth = `${String(Math.max(field, place)).length}ch`;
      sub.replaceChildren("You placed ", number, ". Next match starting...");
      this.stopCount = countUp(number, Math.max(field, place), place, cssSeconds("--ui-count"));
    }
    this.results.style.display = "flex";
  }

  // The kill replay (gate 13b): the REPLAY tag with how far through it is, and no crosshair over the clip.
  setReplay(playing: boolean, progress: number): void {
    this.display(this.replayTag, playing ? "flex" : "none");
    this.crosshair.classList.toggle("off", playing);
    const step = playing ? Math.round(progress * 100) : -1;
    if (step === this.replayShown) return;
    this.replayShown = step;
    if (step >= 0) this.replayFill.style.scale = `${step / 100} 1`;
  }

  // The Junk Titan's bar: its name and its hit points (`hp` a share, 0 to 1), or hidden. It kicks every few percent
  // it loses, so wearing it down is felt in the corner of your eye.
  setBoss(name: string, shown: boolean, hp: number): void {
    const step = shown ? Math.max(0, Math.min(100, Math.ceil(hp * 100))) : -1;
    if (step === this.bossShown) return;
    const was = this.bossShown;
    this.bossShown = step;
    this.bossBar.classList.toggle("shown", shown);
    if (!shown) { delete this.bossBar.dataset.beat; return; }
    this.text(byId("bossName"), name);
    this.bossFill.style.scale = `${step / 100} 1`;
    this.text(this.bossHp, `${step}%`);
    if (was < 0 || step > this.bossKickFrom) this.bossKickFrom = step;
    else if (this.bossKickFrom - step >= 3) { this.bossKickFrom = step; replay(this.bossBar); }
  }
  private bossKickFrom = 100; // the percent at the last kick: the next comes three percent below it

  // The knockout card (gate 14c): who got you and how, for a few seconds as the replay or the spectate camera takes over.
  showKnockout(title: string, by: string, how: string, seconds: number): void {
    byId("knockoutTitle").textContent = title;
    byId("knockoutBy").textContent = by;
    byId("knockoutBy").style.display = by ? "block" : "none";
    const howLine = byId("knockoutHow");
    howLine.textContent = how;
    howLine.style.display = how ? "block" : "none";
    const card = byId("knockout");
    card.classList.remove("shown");
    void card.offsetWidth; // restart the arrival animation for a second knockout in a row
    card.classList.add("shown");
    window.clearTimeout(this.knockoutTimer);
    this.knockoutTimer = window.setTimeout(() => card.classList.remove("shown"), seconds * 1000);
  }
  private knockoutTimer = 0;

  hideKnockout(): void {
    window.clearTimeout(this.knockoutTimer);
    byId("knockout").classList.remove("shown");
  }

  hideResult(): void {
    this.stopCount?.();
    this.stopCount = null;
    this.results.style.display = "none";
  }
}
