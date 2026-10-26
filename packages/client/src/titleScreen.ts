import { parseAbilities, parseBotDifficulty, type Roster } from "@rustbucket/shared";
import abilitiesJson from "../../../data/abilities.json";
import audioJson from "../../../data/audio.json";
import { Sound, type AudioConfig } from "./audio";
import { Hangar } from "./hangar/hangar";
import { mechCards } from "./mechPicker";
import { pickedRadio, rememberRadios } from "./playChoices";
import { createRoomSearch, offlineSearch, playSearch } from "./roomLinks";
import { uiSounds } from "./uiSounds";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The title screen: pick a mech, a map size and how hard the bots are, then Play (a yard of bots), join a friend's
// room by code, make a custom room (how many bots), or practise offline (alone, so the bot difficulty does not apply).
// The mech is chosen here and nowhere else. Every button reloads the page with the choice in the address (see
// main.ts). Behind it the hangar runs, with the picked mech standing in the loading bay.
export function showTitleScreen(roster: Roster, picked: number): void {
  const menu = byId("menu");
  menu.style.display = "grid";
  document.body.classList.add("titleScreen"); // hides the match HUD, which would otherwise show over the hangar
  const bots = byId<HTMLSelectElement>("botSelect");
  const code = byId<HTMLInputElement>("roomCode");
  // One map size and difficulty for Play, Create room and (the size only) offline practice, remembered in this
  // browser. A room you join by code keeps its maker's.
  rememberRadios("mapSize");
  rememberRadios("difficulty");
  const tier = () => pickedRadio("mapSize") ?? "small";
  const difficulty = () => parseBotDifficulty(pickedRadio("difficulty"));

  byId("play").addEventListener("click", () => { location.search = playSearch(tier(), difficulty()); });
  byId("createRoom").addEventListener("click", () => {
    location.search = createRoomSearch({ tier: tier(), bots: bots.value, difficulty: difficulty() });
  });
  const join = () => { if (code.value.trim()) location.search = `?room=${encodeURIComponent(code.value.trim().toUpperCase())}`; };
  byId("joinRoom").addEventListener("click", join);
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
  byId("playOffline").addEventListener("click", () => { location.search = offlineSearch(tier()); });

  // A picked mech is remembered in this browser, so the game it opens next starts you in it.
  let hangar: Hangar | null = null;
  const cards = byId("menuMechs");
  const abilities = parseAbilities(abilitiesJson);
  mechCards(cards, roster, picked, (mech) => { hangar?.select(mech); hangar?.hover(-1); }, (id) => abilities.mechs[id]?.name ?? "");
  // Pointing at a card lights that mech's bay in the hangar.
  cards.addEventListener("pointerover", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>("button[data-mech]");
    hangar?.hover(card ? Number(card.dataset.mech) : -1);
  });
  cards.addEventListener("pointerleave", () => hangar?.hover(-1));
  try {
    hangar = new Hangar(byId<HTMLCanvasElement>("game"), roster, picked);
  } catch (error) {
    // Without WebGL the menu still works over the plain background.
    console.warn("The hangar could not be drawn:", error);
  }
  uiSounds(menu, new Sound(audioJson as AudioConfig));
  // The panels slide in now (motion.css), after the hangar's first build has held the page, so the motion is seen
  // rather than spent while nothing could paint. Every button already works while they move.
  menu.classList.add("arrive");
}
