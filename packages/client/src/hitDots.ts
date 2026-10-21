import { HURT_BROKEN, HURT_HULL } from "@rustbucket/shared";
import type { DiagramRect } from "./damageDiagram";

export interface HitDotsConfig {
  maxDots: number; // the pool: past this many on screen, the oldest dot is reused
  holdSeconds: number; // how long a dot stays at full strength
  fadeSeconds: number; // then how long it takes to fade out
  plateRadiusPx: number; // soaked by a plate: a small dent
  hullRadiusPx: number; // into the part
  brokenRadiusPx: number; // breaking a part, or landing in one already broken
  splashDots: number; // a blast, ram or stomp shows as this many dots
  splashRadiusPx: number; // spread round the side the splash came from
}

const KEYS = ["maxDots", "holdSeconds", "fadeSeconds", "plateRadiusPx", "hullRadiusPx", "brokenRadiusPx", "splashDots", "splashRadiusPx"] as const;

export function parseHitDots(raw: unknown): HitDotsConfig {
  const d = raw as Record<string, unknown>;
  for (const key of KEYS) {
    if (typeof d?.[key] !== "number" || !(d[key] as number >= 0)) throw new Error(`damageDiagram.json: hits.${key} must be a number, 0 or more`);
  }
  const c = d as unknown as HitDotsConfig;
  if (c.maxDots < 1 || c.splashDots < 1 || !Number.isInteger(c.maxDots) || !Number.isInteger(c.splashDots)) throw new Error("damageDiagram.json: hits.maxDots and hits.splashDots must be whole numbers, 1 or more");
  if (c.holdSeconds + c.fadeSeconds <= 0) throw new Error("damageDiagram.json: hits need some time on screen");
  return c;
}

// How the mech's own frame (metres right of and up from its feet) maps onto the diagram, from frontView.
export interface FrontFrame {
  scale: number;
  left: number;
  top: number;
  minX: number;
  maxY: number;
}

export interface Spot {
  x: number;
  y: number;
}

// Moves a diagram point onto the nearest drawn box of `zone` (any zone when it is -1). A point already on one stays.
export function snapToZone(rects: readonly DiagramRect[], zone: number, px: number, py: number, out: Spot): void {
  out.x = px;
  out.y = py;
  let best = Infinity;
  for (const r of rects) {
    if (zone >= 0 && r.zone !== zone) continue;
    const x = Math.min(r.x + r.w, Math.max(r.x, px));
    const y = Math.min(r.y + r.h, Math.max(r.y, py));
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < best) {
      best = d;
      out.x = x;
      out.y = y;
    }
  }
}

// Where a hit at (lx, ly) in the mech's own frame shows on the diagram, seen from behind like the boxes. Depth is
// dropped. It is then pulled onto the zone that was hit, because the boxes a shot struck can be ones too small to draw,
// and a dot beside the mech or on the wrong part would tell the pilot the wrong thing.
export function hitSpot(rects: readonly DiagramRect[], frame: FrontFrame, zone: number, lx: number, ly: number, out: Spot): void {
  snapToZone(rects, zone, frame.left + (lx - frame.minX) * frame.scale, frame.top + (frame.maxY - ly) * frame.scale, out);
}

export type DotLook = "plate" | "hull" | "broken";

export function dotLook(kind: number): DotLook {
  return kind === HURT_BROKEN ? "broken" : kind === HURT_HULL ? "hull" : "plate";
}

const SVG = "http://www.w3.org/2000/svg";

// The dots on the damage diagram where you were hit. A fixed pool of circles, each with one fade animation made up
// front and restarted per hit, so the frame loop never touches them and a hit allocates nothing but its attributes.
export class HitDots {
  private dots: SVGCircleElement[] = [];
  private fades: Animation[] = [];
  private next = 0;
  private rects: readonly DiagramRect[] = [];
  private frame: FrontFrame | null = null;
  private spot: Spot = { x: 0, y: 0 };
  private spread: Spot = { x: 0, y: 0 };
  private spreadX: number[] = [];
  private spreadY: number[] = [];
  private keyframes: Keyframe[];
  private timing: KeyframeAnimationOptions;

  constructor(private config: HitDotsConfig) {
    const total = config.holdSeconds + config.fadeSeconds;
    this.keyframes = [{ opacity: 1, offset: 0 }, { opacity: 1, offset: config.holdSeconds / total }, { opacity: 0, offset: 1 }];
    this.timing = { duration: total * 1000, fill: "forwards" };
    // The first splash dot sits where the splash came from, the rest round it in a ring.
    this.spreadX.push(0);
    this.spreadY.push(0);
    for (let i = 1; i < config.splashDots; i++) {
      const angle = ((i - 1) / (config.splashDots - 1)) * Math.PI * 2;
      this.spreadX.push(Math.cos(angle) * config.splashRadiusPx);
      this.spreadY.push(Math.sin(angle) * config.splashRadiusPx);
    }
  }

  // Called each time the diagram is rebuilt for a mech: a fresh pool on top of its zones.
  attach(svg: SVGSVGElement, rects: readonly DiagramRect[], frame: FrontFrame): void {
    this.rects = rects;
    this.frame = frame;
    const layer = document.createElementNS(SVG, "g");
    layer.setAttribute("class", "ddDots");
    this.dots = [];
    this.fades = [];
    this.next = 0;
    for (let i = 0; i < this.config.maxDots; i++) {
      const dot = document.createElementNS(SVG, "circle");
      layer.appendChild(dot);
      const fade = dot.animate(this.keyframes, this.timing);
      fade.finish(); // starts faded out
      this.dots.push(dot);
      this.fades.push(fade);
    }
    svg.appendChild(layer);
  }

  // zone -1 is splash: a small spread round the point it came from, on whatever parts are there.
  show(zone: number, lx: number, ly: number, kind: number): void {
    if (!this.frame) return;
    hitSpot(this.rects, this.frame, zone, lx, ly, this.spot);
    const look = dotLook(kind);
    if (zone >= 0) return this.place(this.spot.x, this.spot.y, look);
    for (let i = 0; i < this.spreadX.length; i++) {
      snapToZone(this.rects, -1, this.spot.x + this.spreadX[i]!, this.spot.y + this.spreadY[i]!, this.spread);
      this.place(this.spread.x, this.spread.y, look);
    }
  }

  private place(x: number, y: number, look: DotLook): void {
    const c = this.config;
    const i = this.next;
    this.next = (i + 1) % this.dots.length;
    const dot = this.dots[i]!;
    dot.setAttribute("cx", String(Math.round(x * 10) / 10));
    dot.setAttribute("cy", String(Math.round(y * 10) / 10));
    dot.setAttribute("r", String(look === "broken" ? c.brokenRadiusPx : look === "hull" ? c.hullRadiusPx : c.plateRadiusPx));
    dot.setAttribute("class", `ddDot ${look}`);
    const fade = this.fades[i]!;
    fade.currentTime = 0;
    fade.play();
  }
}
