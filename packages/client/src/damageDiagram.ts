import { ZONE_ARMS, ZONE_BROKEN, ZONE_COUNT, ZONE_DAMAGED, ZONE_LEGS, ZONE_TORSO, zoneState, type Box, type ZoneSet } from "@rustbucket/shared";
import { HitDots, parseHitDots, type FrontFrame, type HitDotsConfig } from "./hitDots";
import "./damageDiagram.css";

export interface DiagramConfig {
  widthPx: number;
  heightPx: number;
  labelRowPx: number; // a strip kept free under the mech (0 now the Parts box shows the percent left)
  paddingPx: number;
  minBoxArea: number; // square metres seen from the front; smaller boxes (bolts, barrels) only clutter a doll this size
  hatchSpacingPx: number;
  plateGapPx: number; // how far the armour frame stands off the boxes it covers
  hits: HitDotsConfig; // the dots where you were hit
}

const KEYS = ["widthPx", "heightPx", "labelRowPx", "paddingPx", "minBoxArea", "hatchSpacingPx", "plateGapPx"] as const;

// Fails loudly on a bad data file, same as the other tuning files.
export function parseDiagram(raw: unknown): DiagramConfig {
  const d = raw as Record<string, unknown>;
  for (const key of KEYS) {
    if (typeof d?.[key] !== "number" || !(d[key] as number >= 0)) throw new Error(`damageDiagram.json: ${key} must be a number, 0 or more`);
  }
  const c = { ...(d as unknown as DiagramConfig), hits: parseHitDots(d.hits) };
  if (c.heightPx - c.labelRowPx - 2 * c.paddingPx <= 0 || c.widthPx - 2 * c.paddingPx <= 0) throw new Error("damageDiagram.json: no room left to draw the mech");
  return c;
}

export interface DiagramRect {
  zone: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY);

// The mech's hit boxes seen from behind, as the pilot knows it (its right on the right), scaled to fit the slot
// above the label row and centred. Boxes below minBoxArea are left out, but every zone keeps its biggest box so
// none can vanish. Biggest first within each zone, so small parts draw on top of the big ones they sit on.
export function frontRects(boxes: readonly Box[], boxZone: readonly number[], c: DiagramConfig): DiagramRect[] {
  return frontView(boxes, boxZone, c).rects;
}

// The same, with the scale and offset used, so a point on the mech can be put on the diagram too (hitDots.ts).
export function frontView(boxes: readonly Box[], boxZone: readonly number[], c: DiagramConfig): { rects: DiagramRect[]; frame: FrontFrame } {
  const biggest: (Box | null)[] = [null, null, null];
  boxes.forEach((b, i) => {
    const best = biggest[boxZone[i]!];
    if (!best || area(b) > area(best)) biggest[boxZone[i]!] = b;
  });
  const kept = boxes.map((b, i) => ({ b, zone: boxZone[i]! })).filter(({ b, zone }) => area(b) >= c.minBoxArea || biggest[zone] === b);
  if (kept.length === 0) return { rects: [], frame: { scale: 0, left: 0, top: 0, minX: 0, maxY: 0 } };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { b } of kept) {
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
  }
  const roomW = c.widthPx - 2 * c.paddingPx;
  const roomH = c.heightPx - c.labelRowPx - 2 * c.paddingPx;
  const scale = Math.min(roomW / (maxX - minX), roomH / (maxY - minY));
  const left = c.paddingPx + (roomW - (maxX - minX) * scale) / 2;
  const top = c.paddingPx + (roomH - (maxY - minY) * scale) / 2;

  kept.sort((a, b) => a.zone - b.zone || area(b.b) - area(a.b));
  const rects = kept.map(({ b, zone }) => ({
    zone,
    x: round(left + (b.minX - minX) * scale),
    y: round(top + (maxY - b.maxY) * scale),
    w: round((b.maxX - b.minX) * scale),
    h: round((b.maxY - b.minY) * scale),
  }));
  return { rects, frame: { scale, left, top, minX, maxY } };
}

export type ZoneLook = "intact" | "damaged" | "broken";

// Each look differs in pattern as well as colour (solid, hatched, crossed-out outline), so it reads in greyscale.
export function zoneLook(state: number): ZoneLook {
  return state === ZONE_BROKEN ? "broken" : state === ZONE_DAMAGED ? "damaged" : "intact";
}

// Rounded up, so a zone still standing never reads 0.
export function percentLeft(hp: number, max: number): number {
  if (hp <= 0 || max <= 0) return 0;
  return Math.min(100, Math.ceil((hp / max) * 100));
}

export type PlateLook = "none" | "partial" | "full";

// A solid frame while the zone carries at least one whole plate's points, dashed once it is worn below that.
export function plateLook(armor: number, platePoints: number): PlateLook {
  if (armor <= 0) return "none";
  return armor >= platePoints ? "full" : "partial";
}

// Torso first so legs and arms sit over it where they overlap, as they do on the model.
const DRAW_ORDER = [ZONE_TORSO, ZONE_LEGS, ZONE_ARMS];
const SVG = "http://www.w3.org/2000/svg";
const HATCH_ID = "damageDiagramHatch";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const key in attrs) el.setAttribute(key, String(attrs[key]));
  return el;
}

// The layers inside each zone, bottom to top. Every layer holds the same boxes; stroking them all first and then
// covering them with soot leaves only the zone's outer outline, so overlapping boxes read as one silhouette.
const LAYERS = ["plateLine", "plateCover", "line", "body", "hatch", "cross"] as const;

// The always-on schematic of your own mech in the HUD. Rebuilt only when you change mech; after that it only
// touches the page when a zone's look or its armour frame changes. The percent left is in the Parts box (hud.ts).
export class DamageDiagram {
  private svg: SVGSVGElement;
  private zones: SVGGElement[] = [];
  private shownMech = -1;
  private shownState = [-1, -1, -1];
  private shownPlate: (PlateLook | "")[] = ["", "", ""];
  private dots: HitDots;

  constructor(root: HTMLElement, private config: DiagramConfig) {
    this.dots = new HitDots(config.hits);
    this.svg = svgEl("svg", { viewBox: `0 0 ${config.widthPx} ${config.heightPx}`, width: config.widthPx, height: config.heightPx, class: "damageDiagram", role: "img", "aria-label": "Mech damage" });
    root.appendChild(this.svg);
  }

  update(mech: number, set: ZoneSet, hp: readonly number[], armor: readonly number[], platePoints: readonly number[]): void {
    if (mech !== this.shownMech) this.build(mech, set);
    for (let zone = 0; zone < ZONE_COUNT; zone++) {
      const state = zoneState(hp, set, zone);
      const plate = plateLook(armor[zone] ?? 0, platePoints[zone] ?? 1);
      if (state !== this.shownState[zone] || plate !== this.shownPlate[zone]) {
        this.shownState[zone] = state;
        this.shownPlate[zone] = plate;
        const look = zoneLook(state);
        this.zones[zone]!.setAttribute("class", `ddZone ${look} plate-${plate}`);
      }
    }
  }

  // A dot where your mech was hit (a hurt message): x, y in its own frame, zone -1 for splash.
  hit(zone: number, x: number, y: number, kind: number): void {
    this.dots.show(zone, x, y, kind);
  }

  private build(mech: number, set: ZoneSet): void {
    const c = this.config;
    this.shownMech = mech;
    this.shownState.fill(-1);
    this.shownPlate.fill("");
    this.svg.replaceChildren();

    const defs = svgEl("defs", {});
    const hatch = svgEl("pattern", { id: HATCH_ID, patternUnits: "userSpaceOnUse", width: c.hatchSpacingPx, height: c.hatchSpacingPx, patternTransform: "rotate(45)" });
    hatch.appendChild(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: c.hatchSpacingPx, class: "ddHatchLine" }));
    defs.appendChild(hatch);
    this.svg.appendChild(defs);

    const layers: Record<string, SVGGElement>[] = [];
    this.zones = [];
    for (let zone = 0; zone < ZONE_COUNT; zone++) {
      const group = svgEl("g", { class: "ddZone" });
      const byName: Record<string, SVGGElement> = {};
      for (const name of LAYERS) group.appendChild(byName[name] = svgEl("g", { class: name }));
      layers.push(byName);
      this.zones.push(group);
    }
    for (const zone of DRAW_ORDER) this.svg.appendChild(this.zones[zone]!);

    const gap = c.plateGapPx;
    const view = frontView(set.boxes, set.boxZone, c);
    for (const r of view.rects) {
      const zone = layers[r.zone]!;
      const framed = { x: r.x - gap, y: r.y - gap, width: r.w + 2 * gap, height: r.h + 2 * gap };
      zone.plateLine!.appendChild(svgEl("rect", framed));
      zone.plateCover!.appendChild(svgEl("rect", framed));
      const plain = { x: r.x, y: r.y, width: r.w, height: r.h };
      for (const name of ["line", "body", "hatch"]) zone[name]!.appendChild(svgEl("rect", plain));
      // The cross only shows once the zone is broken (by the stylesheet), so the shape changes, not just the colour.
      zone.cross!.appendChild(svgEl("path", { d: `M${r.x} ${r.y}L${round(r.x + r.w)} ${round(r.y + r.h)}M${round(r.x + r.w)} ${r.y}L${r.x} ${round(r.y + r.h)}` }));
    }
    this.dots.attach(this.svg, view.rects, view.frame);

  }
}
