import { damageTakenFor, rosterIndex, type Roster } from "./roster";
import { boxFromData } from "./world";
import type { ZoneDef, ZoneSet } from "./zones";

const ZONES = ["legs", "arms", "torso"];

interface KitsHitboxData {
  kits?: Record<string, { hitboxes?: Record<string, { center: number[]; size: number[] }[]> }>;
}

// Each roster mech's hit zones, by its number in data/roster.json: the boxes scripts/make-hitboxes.ts measured
// into data/mechKits.json, and the share of each hit its parts take. Hit points and the rest come from zones.json,
// read live so tuning still reaches them. A mech with no boxes uses the standard boxes in zones.json; with no
// roster at all, every mech is the standard one.
export function makeZonesFor(zones: ZoneSet, roster: Roster | null, kitsRaw: unknown = null): (mech: number) => ZoneSet {
  if (!roster) return () => zones;
  const data = (kitsRaw ?? {}) as KitsHitboxData;
  const sets = roster.mechs.map((rosterMech, mech): ZoneSet => {
    const hitboxes = data.kits?.[rosterMech.id]?.hitboxes;
    // Built on top of the standard set, so its other numbers (repair time and the rest) stay live too.
    const set = Object.create(zones) as ZoneSet;
    set.boxes = hitboxes ? [] : zones.boxes;
    set.boxZone = hitboxes ? [] : zones.boxZone;
    const defs = zones.zones.map((_, zone): ZoneDef => ({
      get name() { return zones.zones[zone]!.name; },
      get hp() { return zones.zones[zone]!.hp; },
      get damageMultiplier() { return zones.zones[zone]!.damageMultiplier * damageTakenFor(roster, mech, zone); },
    }));
    Object.defineProperty(set, "zones", { get: () => defs });
    if (hitboxes) {
      ZONES.forEach((name, zone) => {
        for (const b of hitboxes[name] ?? []) {
          set.boxes.push(boxFromData({ name, center: b.center as [number, number, number], size: b.size as [number, number, number], color: "" }));
          set.boxZone.push(zone);
        }
      });
    }
    return set;
  });
  return (mech) => sets[rosterIndex(roster, mech)]!;
}
