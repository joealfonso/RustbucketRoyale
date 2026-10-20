import type { Circle } from "@rustbucket/shared";
import type { RemoteMechs } from "./remoteMechs";
import { shapesByKind, warnByKind, type MarkShape, type RadarConfig } from "./radarData";
import { placeOnRadar, type RadarPoint } from "./radarMath";

interface Pulse {
  x: number;
  z: number;
  kind: number;
  bornMs: number;
}

const TAU = Math.PI * 2;
const ZONE_ARROW_LENGTH = 12;
const ZONE_ARROW_SIDE = 6;
const ZONE_BLINK_MS = 120;

// An amber scope in the bottom-right panel with you in the middle and forward at the top. Mechs very close show as
// filled dots, the same for bots and people so the radar never gives away who is who. Anything further off only shows
// when it makes a sound, as a mark whose shape says what kind of sound it was (radar.json), fading out. A sound beyond
// the edge shows its mark on the rim, pointing its way. The Junk Titan is a red cog wherever the server shows it. The
// zone edge is a dashed amber circle: magenta is kept for the zone ring in the world.
export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mid: number;
  private scale: number;
  private baseRange: number;
  private baseDetect: number;
  private shapes: MarkShape[];
  private warn: boolean[];
  private pulseMs: number;
  // A ring buffer of heard sounds, oldest first, so hearing and expiring allocate nothing.
  private pulses: Pulse[];
  private pulseStart = 0;
  private pulseCount = 0;
  private point: RadarPoint = { x: 0, y: 0 };
  private dash: number[];
  private noDash: number[] = [];
  private colours: { amber: string; dim: string; soot: string; warn: string; text: string };
  // What the mech callback needs, set at the start of each draw so the callback can be made once.
  private viewX = 0;
  private viewZ = 0;
  private viewYaw = 0;
  // Supply drops to mark this frame, as x, z pairs (see `markDrop`). Kept, not remade, so drawing allocates nothing.
  private drops: number[] = [];
  private dropCount = 0;
  // The Junk Titan to mark this frame (see `markTitan`), and how big; size 0 for none.
  private titanX = 0;
  private titanZ = 0;
  private titanSize = 0;
  private drawMech = (wx: number, wz: number, _bot: boolean, dead: boolean): void => {
    if (dead || Math.hypot(wx - this.viewX, wz - this.viewZ) > this.detectMeters) return;
    const p = placeOnRadar(wx - this.viewX, wz - this.viewZ, this.viewYaw, this.scale, this.point);
    const ctx = this.ctx;
    ctx.fillStyle = this.colours.text;
    ctx.beginPath();
    ctx.arc(this.mid + p.x, this.mid + p.y, this.config.mechDotSize, 0, TAU);
    ctx.fill();
  };

  constructor(private rangeMeters: number, private detectMeters: number, private config: RadarConfig) {
    this.canvas = document.getElementById("radar") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    this.baseRange = rangeMeters;
    this.baseDetect = detectMeters;
    this.mid = config.drawUnits / 2;
    this.scale = this.mid / rangeMeters;
    this.shapes = shapesByKind(config);
    this.warn = warnByKind(config);
    this.pulseMs = config.pulseSeconds * 1000;
    this.pulses = Array.from({ length: config.maxPulses }, () => ({ x: 0, z: 0, kind: 0, bornMs: 0 }));
    this.dash = config.zoneDash.slice();
    // The colours come from the HUD's tokens, so the radar can never drift from the rest of the HUD.
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    this.colours = { amber: token("--hud-amber"), dim: token("--hud-amber-dim"), soot: token("--hud-soot"), warn: token("--hud-warn"), text: token("--hud-text") };
    // The canvas is sized by CSS in rem, so it grows with the HUD. Its pixels follow that size times the screen's
    // pixel ratio, so it stays sharp. Measured on resize only, never in the frame loop.
    new ResizeObserver(() => this.fit()).observe(this.canvas);
    window.addEventListener("resize", () => this.fit());
    this.fit();
  }

  private fit(): void {
    const pixels = Math.max(1, Math.round(this.canvas.clientWidth * window.devicePixelRatio));
    if (this.canvas.width === pixels) return;
    this.canvas.width = pixels;
    this.canvas.height = pixels;
  }

  // An upgrade can stretch the radar: both how far it shows and how close mechs show without a sound.
  setRangeScale(scale: number): void {
    this.rangeMeters = this.baseRange * scale;
    this.detectMeters = this.baseDetect * scale;
    this.scale = this.mid / this.rangeMeters;
  }

  hear(x: number, z: number, kind: number, nowMs: number): void {
    const max = this.pulses.length;
    let index = (this.pulseStart + this.pulseCount) % max;
    if (this.pulseCount === max) {
      index = this.pulseStart;
      this.pulseStart = (this.pulseStart + 1) % max;
    } else this.pulseCount++;
    const p = this.pulses[index]!;
    p.x = x;
    p.z = z;
    p.kind = kind;
    p.bornMs = nowMs;
  }

  // A supply drop's landing spot, for the next `draw` only. Shown as a diamond, held at the edge when out of range.
  markDrop(x: number, z: number): void {
    this.drops[this.dropCount * 2] = x;
    this.drops[this.dropCount * 2 + 1] = z;
    this.dropCount++;
  }

  // The Junk Titan (gate 13c), for the next `draw` only: a red cog, bigger than any other mark, held at the edge when
  // out of range so you know which way it is.
  markTitan(x: number, z: number, size: number): void {
    this.titanX = x;
    this.titanZ = z;
    this.titanSize = size;
  }

  // `outside` turns the zone arrow red and makes it blink, so it never rests on colour alone.
  draw(x: number, z: number, yaw: number, remotes: RemoteMechs, ring: Circle | null, outside: boolean, nowMs: number): void {
    const ctx = this.ctx;
    const c = this.config;
    const mid = this.mid;
    const k = this.canvas.width / c.drawUnits;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, c.drawUnits, c.drawUnits);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.setLineDash(this.noDash);

    this.drawScope();

    ctx.save();
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 1, 0, TAU);
    ctx.clip();
    if (ring) this.drawZone(x, z, yaw, ring);
    ctx.restore();

    if (ring) this.drawZoneArrow(x, z, yaw, ring, outside, nowMs);
    this.drawPulses(x, z, yaw, nowMs);
    this.drawDrops(x, z, yaw, nowMs);
    this.drawTitan(x, z, yaw);

    this.viewX = x;
    this.viewZ = z;
    this.viewYaw = yaw;
    remotes.forEach(this.drawMech);

    // You, in the middle, pointing up the way you face.
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.colours.text;
    ctx.beginPath();
    ctx.moveTo(mid, mid - 6);
    ctx.lineTo(mid - 4, mid + 4);
    ctx.lineTo(mid + 4, mid + 4);
    ctx.closePath();
    ctx.fill();
  }

  // Soot disc, range rings, cross hairs and the edge. No sweep line: it only turned for looks and told you nothing.
  private drawScope(): void {
    const ctx = this.ctx;
    const c = this.config;
    const mid = this.mid;
    ctx.fillStyle = this.colours.soot;
    ctx.beginPath();
    ctx.arc(mid, mid, mid, 0, TAU);
    ctx.fill();
    // Darker than the panel round it, so the scope reads as a screen set into the frame.
    ctx.fillStyle = "#000";
    ctx.globalAlpha = c.discShade;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.colours.dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid, 2);
    ctx.lineTo(mid, c.drawUnits - 2);
    ctx.moveTo(2, mid);
    ctx.lineTo(c.drawUnits - 2, mid);
    for (let i = 1; i < c.rangeRings; i++) {
      ctx.moveTo(mid + (mid * i) / c.rangeRings, mid);
      ctx.arc(mid, mid, (mid * i) / c.rangeRings, 0, TAU);
    }
    ctx.stroke();
    // The close range where mechs show without a sound, a little brighter than the plain range rings.
    ctx.strokeStyle = this.colours.amber;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(mid, mid, this.detectMeters * this.scale, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.colours.dim;
    ctx.beginPath();
    ctx.arc(mid, mid, mid - 1, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  private drawZone(x: number, z: number, yaw: number, ring: Circle): void {
    const ctx = this.ctx;
    const p = placeOnRadar(ring.cx - x, ring.cz - z, yaw, this.scale, this.point);
    ctx.strokeStyle = this.colours.amber;
    ctx.lineWidth = this.config.zoneLineWidth;
    ctx.setLineDash(this.dash);
    ctx.beginPath();
    ctx.arc(this.mid + p.x, this.mid + p.y, ring.radius * this.scale, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(this.noDash);
    ctx.lineWidth = 1;
  }

  // When the zone edge is off the radar, or you are outside it, an arrow on the rim points to the middle of the zone.
  private drawZoneArrow(x: number, z: number, yaw: number, ring: Circle, outside: boolean, nowMs: number): void {
    const toCentre = Math.hypot(ring.cx - x, ring.cz - z);
    const edgeOffRadar = Math.abs(ring.radius - toCentre) > this.rangeMeters;
    if (!(outside || edgeOffRadar) || toCentre <= 1) return;
    if (outside && Math.floor(nowMs / ZONE_BLINK_MS) % 2 === 1) return;
    const ctx = this.ctx;
    const mid = this.mid;
    const p = placeOnRadar(ring.cx - x, ring.cz - z, yaw, this.scale, this.point);
    const angle = Math.atan2(p.y, p.x);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const tipX = mid + cos * (mid - 3), tipY = mid + sin * (mid - 3);
    const backX = mid + cos * (mid - 3 - ZONE_ARROW_LENGTH), backY = mid + sin * (mid - 3 - ZONE_ARROW_LENGTH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = outside ? this.colours.warn : this.colours.amber;
    ctx.strokeStyle = this.colours.soot;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(backX - sin * ZONE_ARROW_SIDE, backY + cos * ZONE_ARROW_SIDE);
    ctx.lineTo(backX + sin * ZONE_ARROW_SIDE, backY - cos * ZONE_ARROW_SIDE);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawDrops(x: number, z: number, yaw: number, nowMs: number): void {
    const ctx = this.ctx;
    const mid = this.mid;
    const size = 5 + (Math.floor(nowMs / 400) % 2); // a slow two-step throb, so it reads as live, not as a mech
    for (let i = 0; i < this.dropCount; i++) {
      const p = placeOnRadar(this.drops[i * 2]! - x, this.drops[i * 2 + 1]! - z, yaw, this.scale, this.point);
      const reach = Math.hypot(p.x, p.y), edge = mid - 6;
      const k = reach > edge ? edge / reach : 1;
      const px = mid + p.x * k, py = mid + p.y * k;
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.colours.amber;
      ctx.strokeStyle = this.colours.soot;
      ctx.beginPath();
      ctx.moveTo(px, py - size);
      ctx.lineTo(px + size, py);
      ctx.lineTo(px, py + size);
      ctx.lineTo(px - size, py);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    this.dropCount = 0;
  }

  // A ring with six teeth round a solid middle: no other mark has teeth, so it reads without its colour.
  private drawTitan(x: number, z: number, yaw: number): void {
    const s = this.titanSize;
    if (s <= 0) return;
    this.titanSize = 0;
    const ctx = this.ctx;
    const mid = this.mid;
    const p = placeOnRadar(this.titanX - x, this.titanZ - z, yaw, this.scale, this.point);
    const reach = Math.hypot(p.x, p.y), edge = mid - s * 1.5;
    const k = reach > edge ? edge / reach : 1;
    const px = mid + p.x * k, py = mid + p.y * k;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.colours.soot;
    ctx.beginPath();
    ctx.arc(px, py, s + 1, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = this.colours.warn;
    ctx.fillStyle = this.colours.warn;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, s, 0, TAU);
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      ctx.moveTo(px + Math.cos(a) * s, py + Math.sin(a) * s);
      ctx.lineTo(px + Math.cos(a) * s * 1.45, py + Math.sin(a) * s * 1.45);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, s * 0.45, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1;
  }

  private drawPulses(x: number, z: number, yaw: number, nowMs: number): void {
    const max = this.pulses.length;
    while (this.pulseCount > 0 && nowMs - this.pulses[this.pulseStart]!.bornMs >= this.pulseMs) {
      this.pulseStart = (this.pulseStart + 1) % max;
      this.pulseCount--;
    }
    const ctx = this.ctx;
    const c = this.config;
    const mid = this.mid;
    const rim = mid - c.markSize - 2;
    ctx.lineWidth = 2;
    for (let i = 0; i < this.pulseCount; i++) {
      const pulse = this.pulses[(this.pulseStart + i) % max]!;
      const age = (nowMs - pulse.bornMs) / this.pulseMs;
      const p = placeOnRadar(pulse.x - x, pulse.z - z, yaw, this.scale, this.point);
      const fromMid = Math.hypot(p.x, p.y);
      // Beyond the edge the mark sits on the rim, the way the sound came from, at its starting size.
      const onRim = fromMid > rim;
      const px = onRim ? (p.x / fromMid) * rim : p.x;
      const py = onRim ? (p.y / fromMid) * rim : p.y;
      const size = onRim ? c.markSize : c.markSize * (1 + age * c.markGrowth);
      const colour = this.warn[pulse.kind] ? this.colours.warn : this.colours.amber;
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      this.drawMark(this.shapes[pulse.kind] ?? "ring", mid + px, mid + py, size);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  private drawMark(shape: MarkShape, x: number, y: number, s: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    switch (shape) {
      case "ring":
        ctx.arc(x, y, s, 0, TAU);
        break;
      case "cross":
        ctx.moveTo(x - s, y - s);
        ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s);
        ctx.lineTo(x - s, y + s);
        break;
      case "burst":
        // Eight short spokes round an empty middle, so it reads as a blast and not a cross.
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.moveTo(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5);
          ctx.lineTo(x + Math.cos(a) * s * 1.4, y + Math.sin(a) * s * 1.4);
        }
        break;
      case "square":
        ctx.rect(x - s, y - s, s * 2, s * 2);
        break;
      case "diamond":
        ctx.moveTo(x, y - s * 1.3);
        ctx.lineTo(x + s * 1.3, y);
        ctx.lineTo(x, y + s * 1.3);
        ctx.lineTo(x - s * 1.3, y);
        ctx.closePath();
        break;
    }
    ctx.stroke();
  }
}
