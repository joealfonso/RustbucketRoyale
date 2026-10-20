import type { Roster, RosterMech } from "@rustbucket/shared";

const STORE_KEY = "rustbucket.mech";

// The mech you last picked: ?mech=<id> in the address first, then what this browser remembers, else null.
export function savedMech(roster: Roster, params: URLSearchParams): number | null {
  let id = params.get("mech");
  if (id === null) {
    try { id = localStorage.getItem(STORE_KEY); } catch { id = null; } // storage can be blocked
  }
  const index = roster.mechs.findIndex((m) => m.id === id);
  return index >= 0 ? index : null;
}

function remember(mech: RosterMech): void {
  try { localStorage.setItem(STORE_KEY, mech.id); } catch { /* blocked storage only costs the memory */ }
}

// Three short bars per mech, each against the best in the roster, so the difference reads at a glance.
function bars(roster: Roster, m: RosterMech): string {
  const toughness = (r: RosterMech) => 3 / (r.damageTaken.legs + r.damageTaken.arms + r.damageTaken.torso);
  const flight = (r: RosterMech) => r.jets * r.lift;
  const rows: [string, (r: RosterMech) => number][] = [["Speed", (r) => r.speed], ["Jets", flight], ["Armor", toughness]];
  return rows.map(([label, value]) => {
    const best = Math.max(...roster.mechs.map(value));
    return `<span>${label}</span><i><b style="width:${Math.round((value(m) / best) * 100)}%"></b></i>`;
  }).join("");
}

// One row of mech cards inside `box`. Each knows its place in the row (--i), so they arrive one after another. Clicking a card picks it, remembers it in this browser and calls `onPick`.
// Returns a function that moves the highlight, for when the pick changes elsewhere.
export function mechCards(box: HTMLElement, roster: Roster, selected: number, onPick: (mech: number) => void): (mech: number) => void {
  box.innerHTML = roster.mechs.map((m, i) => `<button type="button" data-mech="${i}" style="--i:${i}"><strong>${m.name}</strong><em>${m.role}</em><div class="stats">${bars(roster, m)}</div></button>`).join("");
  const buttons = [...box.querySelectorAll<HTMLButtonElement>("button")];
  const highlight = (mech: number) => buttons.forEach((b, i) => b.classList.toggle("on", i === mech));
  highlight(selected);
  box.addEventListener("click", (e) => {
    e.stopPropagation(); // the pause screen behind the cards locks the mouse on click, and a pick should not
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mech]");
    if (!button) return;
    const mech = Number(button.dataset.mech);
    remember(roster.mechs[mech]!);
    highlight(mech);
    onPick(mech);
  });
  return highlight;
}
