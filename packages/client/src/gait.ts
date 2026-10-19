// How a mech walks, worked out from how fast it is really going, so the feet stay in step with prediction and with
// the smoothed picture of other mechs. Looks only: nothing here reaches the simulation or the hit boxes.
// The numbers are in data/gait.json, one set per roster mech, and tunable in the F1 panel.

export interface MechGait {
  walkStride: number; // metres covered by one full cycle (a step with each foot) at walk speed
  runStride: number; // the same at run speed; between the two it grows with speed
  // Share of the cycle each foot is planted at walk speed, and at run speed: lower means a short hop between steps.
  // A foot can only reach so far, so stride times stance over two must stay inside the leg's reach.
  stance: number;
  runStance: number;
  stepHeight: number; // how high a foot lifts at walk speed, metres
  runStepHeight: number;
  bob: number; // how far the body dips as each foot lands, at walk speed, metres
  runBob: number;
  sway: number; // degrees the body rolls over the planted foot
  lean: number; // degrees the body leans into its direction of travel at run speed
  dashLean: number; // degrees it leans into a dash
  tuck: number; // metres the feet pull up while in the air
  limp: number; // 0 to 1: how hard a damaged mech favours one leg
  turnStep: number; // metres of stepping for each radian turned on the spot, so turning shuffles the feet
  stepPitch: number; // footfall sound: below 1 a heavier stomp, above 1 a lighter step
  braceDrop: number; // metres the body sinks while braced (a mortar strike being called in): planted, not standing about
  dashStance: number; // metres the feet spread fore and aft in a dash: a braced lunge it slides in, not a sprint
  liftOutward: number; // 1 for insect legs (Cataclysm): a foot lifts by the leg swinging out at the hip, not by the knee
  sideStride: number; // share of the stride left when stepping sideways: legs cannot reach across the body like they reach ahead
}

export interface GaitConfig {
  farMeters: number; // beyond this other mechs stand still: nobody can see their feet
  smoothing: number; // how quickly speed, direction and leaning follow the mech, per second
  stepLoudness: number; // footfall volume while walking
  hearWalkMeters: number; // someone else walking is heard this close; running is heard as far as any sound
  footInward: number; // share of its standing width a foot may close in to, so legs never sweep across each other
  runStepLoudness: number;
  dustSeconds: number; // how long a footfall's dust lasts
  dustMeters: number; // and how big it gets
  mechs: Record<string, MechGait>;
}

const GAIT_KEYS: (keyof MechGait)[] = ["walkStride", "runStride", "stance", "runStance", "stepHeight", "runStepHeight", "bob", "runBob", "sway", "lean", "dashLean", "tuck", "limp", "turnStep", "stepPitch", "braceDrop", "dashStance", "sideStride", "liftOutward"];

// Fails loudly on a bad data file, like the rest of data/.
export function parseGait(raw: unknown): GaitConfig {
  const d = raw as Record<string, unknown>;
  for (const key of ["farMeters", "smoothing", "stepLoudness", "runStepLoudness", "hearWalkMeters", "footInward", "dustSeconds", "dustMeters"]) {
    if (typeof d?.[key] !== "number" || !Number.isFinite(d[key])) throw new Error(`gait.json: "${key}" must be a number`);
  }
  const mechs = d.mechs as Record<string, Record<string, unknown>> | undefined;
  if (!mechs || Object.keys(mechs).length === 0) throw new Error("gait.json: needs mechs");
  for (const [id, m] of Object.entries(mechs)) {
    for (const key of GAIT_KEYS) if (typeof m[key] !== "number" || !Number.isFinite(m[key])) throw new Error(`gait.json: ${id} "${key}" must be a number`);
    for (const key of ["stance", "runStance"]) if (!((m[key] as number) >= 0.1 && (m[key] as number) <= 0.9)) throw new Error(`gait.json: ${id} ${key} must be between 0.1 and 0.9`);
    if (!((m.walkStride as number) > 0 && (m.runStride as number) > 0)) throw new Error(`gait.json: ${id} strides must be above 0`);
  }
  return raw as GaitConfig;
}

// Where in the cycle each leg is, as a share of a cycle: legs on the same beat land together. Two legs alternate;
// four trot, each front leg with the back leg across from it.
export function legOffset(side: string): number {
  return side === "R" || side === "FR" || side === "BL" ? 0.5 : 0;
}

// What the gait needs to know about the mech this frame.
export interface GaitInput {
  vx: number; vz: number; // ground velocity, world metres a second
  yaw: number; // which way the body faces (three.js y rotation, forward is -z)
  grounded: boolean;
  dashing: boolean;
  limping: boolean; // legs damaged but not broken
  braced: boolean; // planted for a mortar strike: no stepping, body sunk
  walkSpeed: number; runSpeed: number; // this mech's own, from its stats
}

// One mech's walking, carried from frame to frame. Make it with createGait.
export interface GaitState {
  phase: number; // 0 to 1 through the cycle
  speed: number; // smoothed ground speed
  dirX: number; dirZ: number; // smoothed direction of travel in the mech's own frame, unit length
  move: number; // 0 standing to 1 striding, smoothed
  stepping: number; // 0 to 1: how much the feet lift (also when turning on the spot)
  air: number; // 0 on the ground to 1 in the air, smoothed
  brace: number; // 0 to 1, smoothed: how far into the braced crouch
  dash: number; // 0 to 1, smoothed: how far into the dash lunge
  lastYaw: number;
  planted: number; // bit per leg: which feet were down last frame
  started: boolean;
  // Outputs, written by stepGait.
  feet: Float32Array; // per leg x, y, z: where its foot goes, as an offset from where it stands at rest (mech frame)
  bob: number; // body height offset, metres
  pitch: number; roll: number; // body lean, radians (pitch negative leans forward)
  footfalls: number; // bit per leg: feet that came down this frame
  loud: number; // 0 to 1: walk to run, for how loud those footfalls are
}

export function createGait(legs: number): GaitState {
  return {
    phase: 0, speed: 0, dirX: 0, dirZ: -1, move: 0, stepping: 0, air: 0, brace: 0, dash: 0, lastYaw: 0, planted: (1 << legs) - 1, started: false,
    feet: new Float32Array(legs * 3), bob: 0, pitch: 0, roll: 0, footfalls: 0, loud: 0,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampUnit = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
const DEG = Math.PI / 180;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Advances one mech's walk by `dt` seconds. `sides` names each leg (legRig.ts order). Allocates nothing.
export function stepGait(s: GaitState, input: GaitInput, g: MechGait, sides: readonly string[], smoothing: number, dt: number): void {
  const follow = 1 - Math.exp(-smoothing * dt);
  // World velocity into the mech's own frame (x right, z back).
  const c = Math.cos(input.yaw), sn = Math.sin(input.yaw);
  const lx = input.vx * c - input.vz * sn;
  const lz = input.vx * sn + input.vz * c;
  const rawSpeed = Math.hypot(lx, lz);
  s.speed += (rawSpeed - s.speed) * follow;
  if (rawSpeed > 0.3) {
    s.dirX += (lx / rawSpeed - s.dirX) * follow;
    s.dirZ += (lz / rawSpeed - s.dirZ) * follow;
    const n = Math.hypot(s.dirX, s.dirZ) || 1;
    s.dirX /= n; s.dirZ /= n;
  }
  const turned = s.started ? Math.abs(wrapAngle(input.yaw - s.lastYaw)) : 0;
  s.lastYaw = input.yaw;
  s.started = true;

  const wasInAir = s.air > 0.5;
  s.air += ((input.grounded ? 0 : 1) - s.air) * Math.min(1, follow * 1.5);
  const onGround = 1 - s.air;
  s.move += (clamp01(s.speed / 1.5) - s.move) * follow;
  s.brace += ((input.braced ? 1 : 0) - s.brace) * follow;
  // A dash is thrust, not running: quick into the lunge, a little slower out of it.
  s.dash += ((input.dashing ? 1 : 0) - s.dash) * Math.min(1, follow * (input.dashing ? 3 : 1.5));

  const run = clamp01((s.speed - input.walkSpeed) / Math.max(0.1, input.runSpeed - input.walkSpeed));
  s.loud = run;
  // The cycle keeps the forward stride's pace in every direction, so stepping sideways is never quicker than walking.
  // Sideways the feet only travel sideStride of it (legs cannot reach across the body), so planted feet slide a
  // little; a quicker cycle would have kept them still, and read as frantic.
  const stride = g.walkStride + (g.runStride - g.walkStride) * run;
  const stepStride = stride * (1 - (1 - g.sideStride) * Math.abs(s.dirX));
  const lift = g.stepHeight + (g.runStepHeight - g.stepHeight) * run;
  const stance = g.stance + (g.runStance - g.stance) * run;

  // The cycle moves on by ground covered, so a planted foot moves back exactly as fast as the body moves forward.
  // Turning on the spot shuffles the feet too. A limping mech hurries off its bad leg. Braced, the feet stay put
  // even while it turns to aim, so it reads as dug in.
  // Dashing, the legs hold a lunge and slide, so the cycle stops rather than spinning up to dash speed.
  const advance = input.braced || input.dashing ? 0 : (s.speed + (turned / Math.max(dt, 1e-6)) * g.turnStep) * dt * onGround;
  const badDown = input.limping && ((s.phase + legOffset(sides[0] ?? "L")) % 1) < stance;
  const hurry = input.limping ? (badDown ? 1 + g.limp * 0.6 : 1 - g.limp * 0.25) : 1;
  s.phase = (s.phase + (advance / stride) * hurry) % 1;
  const stepWanted = clamp01(advance / Math.max(dt, 1e-6) / 1.5);
  s.stepping += (stepWanted - s.stepping) * follow;

  // Each foot: planted and sliding back under the body, or swinging forward through the air.
  const reach = (stepStride * stance) / 2;
  let planted = 0;
  for (let leg = 0; leg < sides.length; leg++) {
    const p = (s.phase + legOffset(sides[leg]!)) % 1;
    let along: number, up: number;
    if (p < stance) {
      along = reach - (p / stance) * 2 * reach;
      up = 0;
      planted |= 1 << leg;
    } else {
      const t = (p - stance) / (1 - stance);
      const eased = t * t * (3 - 2 * t);
      along = -reach + eased * 2 * reach;
      up = Math.sin(t * Math.PI) * lift * Math.max(s.stepping, s.move);
    }
    // In a dash the feet slide into a lunge along the direction of travel: the first leg of each pair leads.
    const lunge = (legOffset(sides[leg]!) === 0 ? 1 : -1) * g.dashStance;
    along = along * s.move * (1 - s.dash) + lunge * s.dash;
    up *= 1 - s.dash;
    // In the air the feet hang tucked up a little behind, and the stride fades out.
    const o = leg * 3;
    s.feet[o] = s.dirX * along * onGround;
    s.feet[o + 1] = up * onGround + g.tuck * s.air;
    s.feet[o + 2] = s.dirZ * along * onGround + 0.15 * s.air;
  }
  const landed = wasInAir && s.air <= 0.5;
  // No footfalls while sliding in a dash: the feet count as down the whole time, so the first step after it lands.
  if (s.dash > 0.3) planted = (1 << sides.length) - 1;
  s.footfalls = landed ? (1 << sides.length) - 1 : s.air > 0.5 || s.dash > 0.3 ? 0 : planted & ~s.planted;
  s.planted = planted;

  // The body dips as each foot lands, rolls over the planted foot, and leans into where it is going.
  const bob = g.bob + (g.runBob - g.bob) * run;
  const beat = 0.5 + 0.5 * Math.cos(s.phase * Math.PI * 4);
  const limpDip = badDown ? g.limp * bob : 0;
  const bobNow = -(bob * beat + limpDip) * s.move * onGround * (1 - s.dash) - g.braceDrop * s.brace;
  const rollNow = (Math.sin(s.phase * Math.PI * 2) * g.sway * (1 + (badDown ? g.limp : 0))) * DEG * s.move * onGround
    - clampUnit(lx / Math.max(1, input.runSpeed)) * g.lean * 0.5 * DEG;
  // Leaning grows up to run speed and no further: a dash adds its own lean on top, not a doubled run lean.
  let pitchNow = clampUnit(lz / Math.max(1, input.runSpeed)) * g.lean * DEG;
  if (input.dashing) pitchNow += (lz / Math.max(rawSpeed, 1)) * g.dashLean * DEG;
  s.bob += (bobNow - s.bob) * Math.min(1, follow * 2);
  s.roll += (rollNow - s.roll) * follow;
  s.pitch += (pitchNow - s.pitch) * follow;
}

// Two-bone leg in its side view (y up, z back): the thigh turns at the hip and the shin at the knee, both about the
// x axis, so the foot reaches `target`. Lengths come from the rest pose; the knee keeps bending the way it bends at
// rest. Writes [thigh, shin] turns in radians into `out`. A target out of reach is met as nearly as the leg allows.
export function solveLeg(
  hy: number, hz: number, ky: number, kz: number, ay: number, az: number, ty: number, tz: number, out: Float32Array | number[],
): void {
  const t1y = ky - hy, t1z = kz - hz; // thigh at rest
  const s1y = ay - ky, s1z = az - kz; // shin at rest
  const l1 = Math.hypot(t1y, t1z), l2 = Math.hypot(s1y, s1z);
  const bend = Math.sign(t1y * s1z - t1z * s1y) || 1;
  let dy = ty - hy, dz = tz - hz;
  let d = Math.hypot(dy, dz);
  const lo = Math.abs(l1 - l2) + 1e-4, hi = l1 + l2 - 1e-4;
  if (d < 1e-6) { dy = -1; dz = 0; d = 1; }
  const clamped = Math.min(hi, Math.max(lo, d));
  dy = (dy / d) * clamped; dz = (dz / d) * clamped;
  const cosHip = (l1 * l1 + clamped * clamped - l2 * l2) / (2 * l1 * clamped);
  const thighAngle = Math.atan2(dz, dy) - bend * Math.acos(Math.max(-1, Math.min(1, cosHip)));
  const kneeY = l1 * Math.cos(thighAngle), kneeZ = l1 * Math.sin(thighAngle);
  const thighTurn = thighAngle - Math.atan2(t1z, t1y);
  const shinTurn = Math.atan2(dz - kneeZ, dy - kneeY) - Math.atan2(s1z, s1y) - thighTurn;
  out[0] = wrapAngle(thighTurn);
  out[1] = wrapAngle(shinTurn);
}
