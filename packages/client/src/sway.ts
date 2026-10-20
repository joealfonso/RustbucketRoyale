// Secondary sway (gate V9b): antennas, masts, drones on their pylons, hanging hoses and weights lag behind the mech's
// moves and settle back on a stiff damped spring, bending about their base. Looks only. The numbers are in
// data/sway.json: one spring per kind of part (`profiles`), named by each moving part in data/mechKits.json.

export interface SwayProfile {
  hz: number; // how fast it swings back and forth, per second
  damping: number; // how quickly a swing dies: 1 settles without swinging past, lower rings on
  push: number; // radians a second of swing for each metre a second the mech's speed changes across the part
  turn: number; // share of a change in the mech's turning the part lags behind (1 stays put while the mech turns)
  maxDegrees: number; // the most it bends, so a hard landing never flops it about
}

export interface SwayConfig {
  offAtQuality: string[]; // effects levels (data/vfx.json) that leave everything still
  stepSeconds: number; // the spring is stepped in slices no longer than this, so a slow frame cannot blow it up
  maxSpeedChange: number; // metres a second: the most one frame's change of speed pushes (a landing, a dash)
  maxTurnChange: number; // radians a second: the same for turning
  jumpMeters: number; // a move this far in one frame is a cut (respawn, spectating someone else): nothing sways
  profiles: Record<string, SwayProfile>;
}

export function parseSway(raw: unknown, qualities: string[]): SwayConfig {
  const d = raw as SwayConfig;
  const fail = (what: string) => { throw new Error(`sway.json: ${what}`); };
  const above = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  for (const key of ["stepSeconds", "maxSpeedChange", "maxTurnChange", "jumpMeters"] as const) if (!above(d?.[key])) fail(`${key} must be above 0`);
  if (!Array.isArray(d.offAtQuality) || d.offAtQuality.some((q) => !qualities.includes(q))) fail(`offAtQuality lists effects levels (${qualities.join(", ")})`);
  if (!d.profiles || Object.keys(d.profiles).length === 0) fail("needs profiles");
  for (const [name, p] of Object.entries(d.profiles)) {
    for (const key of ["hz", "damping", "push", "maxDegrees"] as const) if (!above(p?.[key])) fail(`profiles.${name}.${key} must be above 0`);
    if (!(typeof p.turn === "number" && p.turn >= 0 && p.turn <= 1)) fail(`profiles.${name}.turn is a share, 0 to 1`);
  }
  return d;
}

// A part's bend as a rotation (axis times angle, radians, in its bone's frame) and how fast it is turning.
export interface SwayState { angle: Float64Array; spin: Float64Array }
export const createSwayState = (): SwayState => ({ angle: new Float64Array(3), spin: new Float64Array(3) });

// Lets the spring swing for `dt` seconds, then holds it inside its largest bend. Allocates nothing.
export function stepSway(s: SwayState, p: SwayProfile, dt: number, stepSeconds: number): void {
  const w = 2 * Math.PI * p.hz;
  const k = w * w, c = 2 * p.damping * w;
  const steps = Math.max(1, Math.ceil(dt / stepSeconds));
  const h = dt / steps;
  const { angle, spin } = s;
  for (let n = 0; n < steps; n++) {
    for (let i = 0; i < 3; i++) {
      // Semi-implicit Euler: speed first, then the angle with the new speed, which stays stable for stiff springs.
      spin[i] = spin[i]! + (-k * angle[i]! - c * spin[i]!) * h;
      angle[i] = angle[i]! + spin[i]! * h;
    }
  }
  const most = (p.maxDegrees * Math.PI) / 180;
  const size = Math.hypot(angle[0]!, angle[1]!, angle[2]!);
  if (size > most) {
    const shrink = most / size;
    for (let i = 0; i < 3; i++) { angle[i] = angle[i]! * shrink; spin[i] = spin[i]! * shrink; }
  }
}

export function resetSway(s: SwayState): void {
  s.angle.fill(0);
  s.spin.fill(0);
}
