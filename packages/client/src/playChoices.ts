// The title screen's choices remembered in this browser (map size, bot difficulty), so the next visit starts where
// the last one left off. A saved value is only used if the screen still offers it.
const STORE_KEY = (name: string) => `rustbucket.${name}`;

// Ticks the radio button in group `name` that was saved last time, and remembers each new pick.
export function rememberRadios(name: string): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORE_KEY(name)); } catch { /* storage can be blocked */ }
  const radios = [...document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)];
  const match = radios.find((r) => r.value === saved);
  if (match) match.checked = true;
  for (const radio of radios) {
    radio.addEventListener("change", () => {
      try { localStorage.setItem(STORE_KEY(name), radio.value); } catch { /* blocked storage only costs the memory */ }
    });
  }
}

// The picked value in a radio group, or null if none is ticked.
export function pickedRadio(name: string): string | null {
  return document.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"]:checked`)?.value ?? null;
}
