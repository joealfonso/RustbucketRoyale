import type { AbilitySet, KnockoutHow, MatchStat, Roster, WeaponSet } from "@rustbucket/shared";

// The words on the knockout card and the results screen's fun stats (gate 14c), from what the server sends
// (protocol.ts KnockoutHow, MatchStat). Pure, so the wording is tested and the HUD only places it.

export interface CardWords {
  title: string;
  by: string; // who did it, or what
  how: string; // the causes, oldest first, or ""
}

export interface Names {
  roster: Roster | null;
  weapons: WeaponSet;
  abilities: AbilitySet;
  player: (id: number) => string; // "You", "Player 3", "Bot 12"
  selfId: number | null; // your own id, for an own goal
}

const OTHER_CAUSES: Record<string, string> = { grenade: "Grenade", barrel: "Exploding barrel", ring: "The zone", drop: "Supply drop", "titan:stomp": "the Junk Titan's stomp", "titan:car": "a car the Junk Titan threw" };

export function causeName(cause: string, names: Names): string {
  if (cause.startsWith("weapon:")) return names.weapons.weapons.find((w) => w.id === cause.slice(7))?.name ?? "Gunfire";
  if (cause.startsWith("ability:")) {
    const kind = cause.slice(8);
    return Object.values(names.abilities.mechs).find((a) => a.kind === kind)?.name ?? "Ability";
  }
  return OTHER_CAUSES[cause] ?? "Something";
}

// "KNOCKED OUT", "by Bot 12, Stiletto-B (bot)", "Pounce, then Scattergun". The zone or a supply drop has no killer.
export function knockoutWords(killerId: number | null, how: KnockoutHow | undefined, names: Names): CardWords {
  const causes = (how?.causes ?? []).map((c) => causeName(c, names));
  const how2 = causes.join(", then ");
  // No killer: the zone or a supply drop, named by its cause; with no cause at all (a fall), the card just says so.
  if (killerId === null) return { title: "Knocked out", by: causes.length ? `by ${causes[causes.length - 1]}` : "", how: causes.length > 1 ? how2 : "" };
  if (killerId === names.selfId) return { title: "Knocked out", by: causes.length ? `by your own ${causes[causes.length - 1]}` : "by yourself", how: causes.length > 1 ? how2 : "" };
  const mech = how && how.killerMech >= 0 ? names.roster?.mechs[how.killerMech]?.name : undefined;
  const who = mech ? `${names.player(killerId)}, ${mech}${how!.killerBot ? " (bot)" : ""}` : names.player(killerId);
  return { title: "Knocked out", by: `by ${who}`, how: how2 };
}

const STAT_WORDS: Record<MatchStat["kind"], (v: number) => string> = {
  longestRailShot: (v) => `Longest rail shot: ${Math.round(v)} m`,
  longestPounce: (v) => `Longest pounce: ${Math.round(v)} m`,
  treesFelled: (v) => `Trees felled: ${v}`,
  barrelsSetOff: (v) => `Barrels set off: ${v}`,
  propsSmashed: (v) => `Junk smashed: ${v}`,
  mostDamage: (v) => `Most damage: ${Math.round(v)}`,
  titanDamage: (v) => `Most damage to the Junk Titan: ${Math.round(v)}`,
};

// One line a stat: "Longest pounce: 31 m, Bot 4".
export function statLines(stats: readonly MatchStat[] | undefined, player: (id: number) => string): string[] {
  return (stats ?? []).map((s) => `${STAT_WORDS[s.kind](s.value)}, ${player(s.playerId)}`);
}
