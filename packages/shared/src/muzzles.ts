import { rosterIndex, type Roster } from "./roster";

// Where shots leave each roster mech, in the mech's own frame (x right, y up, forward is -z): the muzzles marked on
// its model (Mount_Gun, Mount_Gun_2, ...), copied into data/mechKits.json by scripts/make-hitboxes.ts. A mech with
// two guns fires them in turn. Without a roster, or for a mech with none marked, shots leave the standard spot on the
// right forearm, which the tests are built around.
export const STANDARD_MUZZLE: readonly number[] = [1.2, 2.4, -1.4];

interface KitsMuzzleData {
  kits?: Record<string, { muzzles?: number[][] }>;
}

export function makeMuzzlesFor(roster: Roster | null, kitsRaw: unknown = null): (mech: number) => readonly (readonly number[])[] {
  const standard = [STANDARD_MUZZLE];
  if (!roster) return () => standard;
  const data = (kitsRaw ?? {}) as KitsMuzzleData;
  const sets = roster.mechs.map((m) => {
    const list = data.kits?.[m.id]?.muzzles?.filter((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite));
    return list && list.length > 0 ? list : standard;
  });
  return (mech) => sets[rosterIndex(roster, mech)]!;
}
