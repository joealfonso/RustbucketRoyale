import type { Sound } from "./audio";

// What counts as a control for UI sounds: buttons, the Custom room fold, the difficulty keys and the map selects.
const CONTROL = "button, summary, .segments label, select";

// Quiet UI sounds for every control inside `root`: a tick on hover, a click on press, a latch for picking a mech,
// and a whoosh for a fold opening (a click for it closing). Browsers only allow sound after a click or key on the
// page, so hovering before the first one is silent, and the first press is what starts the sound.
export function uiSounds(root: HTMLElement, sound: Sound): void {
  let hovered: Element | null = null;
  root.addEventListener("pointerover", (e) => {
    const control = (e.target as Element).closest(CONTROL);
    if (control === hovered) return;
    hovered = control;
    if (control) sound.play("uiHover");
  });
  root.addEventListener("pointerdown", () => sound.start());
  root.addEventListener("keydown", () => sound.start());
  // Caught on the way down, because the mech cards stop their clicks from bubbling (mechPicker.ts).
  root.addEventListener("click", (e) => {
    const control = (e.target as Element).closest(CONTROL);
    // The fold makes its own sound as it opens or closes (below); a label's click also reaches its hidden radio.
    if (!control || control.matches("summary") || (e.target as Element).matches(".segments input")) return;
    sound.play(control.matches("[data-mech]") ? "uiPick" : "uiClick");
  }, true);
  // The toggle event does not bubble, so it is caught on the way down too.
  root.addEventListener("toggle", (e) => sound.play((e.target as HTMLDetailsElement).open ? "uiWhoosh" : "uiClick"), true);
}
