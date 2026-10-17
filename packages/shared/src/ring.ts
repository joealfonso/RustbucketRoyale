// The shrinking safe zone. A schedule is fixed circles (where the ring settles after each stage) plus
// timings. The server picks the circle positions once per match and sends the whole schedule, so a client
// only needs the match clock to know exactly where the ring is, with no per frame updates.
export interface RingStageConfig {
  radiusFraction: number; // of the map side length
  waitSeconds: number; // the ring holds still this long, then starts shrinking
  shrinkSeconds: number;
  damagePerSecond: number; // taken by each zone of a mech standing outside
}

export interface RingConfig {
  initialRadiusFraction: number;
  maxCenterShiftFraction: number; // how far a new circle's centre may sit from the old one, as a share of the room to spare
  maxEdgeSpeedFraction: number; // the ring edge may move no faster than this share of walk speed
  tiers: Record<string, RingStageConfig[]>;
}

export interface Circle {
  cx: number;
  cz: number;
  radius: number;
}

export interface RingStage extends Circle {
  waitSeconds: number;
  shrinkSeconds: number;
  damagePerSecond: number;
}

export interface RingSchedule {
  initial: Circle;
  stages: RingStage[];
}

export function parseRingConfig(raw: unknown): RingConfig {
  const d = raw as Record<string, unknown>;
  for (const key of ["initialRadiusFraction", "maxCenterShiftFraction", "maxEdgeSpeedFraction"]) {
    if (typeof d?.[key] !== "number" || !Number.isFinite(d[key])) throw new Error(`ring.json: ${key} must be a number`);
  }
  const tiers = d.tiers as Record<string, Record<string, unknown>[]> | undefined;
  if (!tiers || typeof tiers !== "object") throw new Error("ring.json: needs tiers");
  for (const [name, stages] of Object.entries(tiers)) {
    if (!Array.isArray(stages) || stages.length === 0) throw new Error(`ring.json: ${name} needs stages`);
    stages.forEach((stage, i) => {
      for (const key of ["radiusFraction", "waitSeconds", "shrinkSeconds", "damagePerSecond"]) {
        if (typeof stage[key] !== "number" || !(stage[key] as number > 0)) throw new Error(`ring.json: ${name} stage ${i + 1} ${key} must be above 0`);
      }
    });
  }
  return d as unknown as RingConfig;
}

// Picks where each stage's circle sits. `random` returns a number from 0 up to but not including 1.
// Each circle stays inside the one before, and its centre moves only part of the way it could,
// which keeps the ring edge slow enough for a walking mech to keep ahead of it.
export function makeRingSchedule(config: RingConfig, tier: string, meters: number, random: () => number): RingSchedule {
  const stages = config.tiers[tier];
  if (!stages) throw new Error(`ring.json has no stages for tier "${tier}"`);
  const initial: Circle = { cx: 0, cz: 0, radius: config.initialRadiusFraction * meters };

  let previous = initial;
  const out: RingStage[] = stages.map((stage) => {
    const radius = stage.radiusFraction * meters;
    const room = Math.max(0, previous.radius - radius) * config.maxCenterShiftFraction;
    // A random point in a disc of radius `room` around the old centre.
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * room;
    const circle: Circle = { cx: previous.cx + Math.cos(angle) * distance, cz: previous.cz + Math.sin(angle) * distance, radius };
    previous = circle;
    return { ...circle, waitSeconds: stage.waitSeconds, shrinkSeconds: stage.shrinkSeconds, damagePerSecond: stage.damagePerSecond };
  });
  return { initial, stages: out };
}

// How long until the last circle is reached.
export function ringDuration(schedule: RingSchedule): number {
  return schedule.stages.reduce((sum, s) => sum + s.waitSeconds + s.shrinkSeconds, 0);
}

// The fastest the ring edge ever moves, in metres a second. Counts both the shrinking and the centre sliding.
export function maxEdgeSpeed(schedule: RingSchedule): number {
  let previous = schedule.initial;
  let fastest = 0;
  for (const s of schedule.stages) {
    const move = Math.hypot(s.cx - previous.cx, s.cz - previous.cz) + (previous.radius - s.radius);
    fastest = Math.max(fastest, move / s.shrinkSeconds);
    previous = s;
  }
  return fastest;
}

export interface RingNow extends Circle {
  stage: number; // the stage being waited for or shrunk to, counting from 1
  shrinking: boolean;
  damagePerSecond: number;
  secondsToChange: number; // until the ring next starts or stops shrinking, 0 once it has settled for good
}

export function createRingNow(): RingNow {
  return { cx: 0, cz: 0, radius: 0, stage: 1, shrinking: false, damagePerSecond: 0, secondsToChange: 0 };
}

// Where the ring is `time` seconds into the match. Writes into `out` so a frame loop allocates nothing.
export function ringAt(schedule: RingSchedule, time: number, out: RingNow): RingNow {
  let from: Circle = schedule.initial;
  let t = Math.max(0, time);

  for (let i = 0; i < schedule.stages.length; i++) {
    const s = schedule.stages[i]!;
    out.stage = i + 1;
    out.damagePerSecond = s.damagePerSecond;
    if (t < s.waitSeconds) {
      return setRing(out, from, from.cx, from.cz, from.radius, false, s.waitSeconds - t);
    }
    t -= s.waitSeconds;
    if (t < s.shrinkSeconds) {
      const f = t / s.shrinkSeconds;
      return setRing(out, s, from.cx + (s.cx - from.cx) * f, from.cz + (s.cz - from.cz) * f, from.radius + (s.radius - from.radius) * f, true, s.shrinkSeconds - t);
    }
    t -= s.shrinkSeconds;
    from = s;
  }
  return setRing(out, from, from.cx, from.cz, from.radius, false, 0);
}

function setRing(out: RingNow, _target: Circle, cx: number, cz: number, radius: number, shrinking: boolean, secondsToChange: number): RingNow {
  out.cx = cx; out.cz = cz; out.radius = radius; out.shrinking = shrinking; out.secondsToChange = secondsToChange;
  return out;
}

export function isOutsideRing(ring: Circle, x: number, z: number): boolean {
  return Math.hypot(x - ring.cx, z - ring.cz) > ring.radius;
}
