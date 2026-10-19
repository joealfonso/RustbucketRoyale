import { parseBotDifficulty, type Roster } from "@rustbucket/shared";
import { Hangar } from "./hangar/hangar";
import { mechCards } from "./mechPicker";
import { createRoomSearch } from "./roomLinks";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The title screen: pick a mech, then make a room (map, bots and how hard they are), join one by code, or practise
// offline. Every button reloads the page with the choice in the address (see main.ts). Behind it the hangar runs,
// with the picked mech standing in the loading bay.
export function showTitleScreen(roster: Roster, picked: number): void {
  byId("menu").style.display = "grid";
  document.body.classList.add("titleScreen"); // hides the match HUD, which would otherwise show over the hangar
  const tier = byId<HTMLSelectElement>("tierSelect");
  const bots = byId<HTMLSelectElement>("botSelect");
  const code = byId<HTMLInputElement>("roomCode");
  const difficulty = () => parseBotDifficulty(document.querySelector<HTMLInputElement>('input[name="difficulty"]:checked')?.value);

  byId("createRoom").addEventListener("click", () => {
    location.search = createRoomSearch({ tier: tier.value, bots: bots.value, difficulty: difficulty() });
  });
  const join = () => { if (code.value.trim()) location.search = `?room=${encodeURIComponent(code.value.trim().toUpperCase())}`; };
  byId("joinRoom").addEventListener("click", join);
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  byId("playOffline").addEventListener("click", () => { location.search = `?offline&tier=${encodeURIComponent(tier.value)}`; });

  // A picked mech is remembered in this browser, so the game it opens next starts you in it.
  let hangar: Hangar | null = null;
  mechCards(byId("menuMechs"), roster, picked, (mech) => hangar?.select(mech));
  try {
    hangar = new Hangar(byId<HTMLCanvasElement>("game"), roster, picked);
  } catch (error) {
    // Without WebGL the menu still works over the plain background.
    console.warn("The hangar could not be drawn:", error);
  }
}
