import { boxFromData } from "./world";
import type { ZoneSet } from "./zones";

const ZONES = ["legs", "arms", "torso"];

interface KitsHitboxData {
  roster?: string[];
  kits?: Record<string, { hitboxes?: Record<string, { center: number[]; size: number[] }[]> }>;
}

// Each player's hit boxes, by the roster mech they are dealt (player id modulo the roster, the same rule the client
// uses to draw them), from the boxes scripts/make-hitboxes.ts measured into data/mechKits.json. Only the boxes
// differ: hit points and the rest come from zones.json, read live so tuning still reaches them. A roster mech with no
// boxes, or no roster at all, uses the standard boxes in zones.json.
export function makeZonesFor(zones: ZoneSet, raw: unknown): (id: number) => ZoneSet {
  const data = raw as KitsHitboxData;
  const sets = (data.roster ?? []).map((kitId): ZoneSet => {
    const hitboxes = data.kits?.[kitId]?.hitboxes;
    if (!hitboxes) return zones;
    const set: ZoneSet = { ...zones, boxes: [], boxZone: [] };
    Object.defineProperty(set, "zones", { get: () => zones.zones }); // live hit points
    ZONES.forEach((name, zone) => {
      for (const b of hitboxes[name] ?? []) {
        set.boxes.push(boxFromData({ name, center: b.center as [number, number, number], size: b.size as [number, number, number], color: "" }));
        set.boxZone.push(zone);
      }
    });
    return set;
  });
  return (id) => (sets.length > 0 ? sets[id % sets.length]! : zones);
}
