import type { BotPathStats, MechStats, World } from "@rustbucket/shared";

// Bot routes run straight through woods, because trunks are too thin to be walls on the 8 m route grid. So a bot
// steps round what is right in front of it itself: a trunk, a crate, a barrel, a boulder. Long walls and buildings
// are left to the route. The numbers are in data/bots.json "path" (steer...), guesses tuned by watching bots cross a
// dense wood in steer.test.ts. A bot keeps going round the side it picked unless the other way round is shorter by
// steerKeepSideMeters, so a wobbling heading does not flip it from side to side.
export type SteerSettings = Pick<BotPathStats, "steerLookMeters" | "steerClearanceMeters" | "steerMaxSizeMeters" | "steerKeepSideMeters">;
const MAX_NEARBY = 64; // more boxes than this within a few metres is not a wood, and the rest are ignored

export type SteerBody = Pick<MechStats, "halfWidth" | "height" | "stepHeight">;

// Which way a bot is stepping round what is in front of it, so it keeps to one side while it goes past.
export interface SteerMemory {
  steering: boolean; // it was stepping round something last time
  side: number; // +1 or -1: which way across its path it passes
}

export const createSteerMemory = (): SteerMemory => ({ steering: false, side: 1 });

// Reused for every call, so steering allocates nothing.
const nearby: number[] = [];
const lows = new Float64Array(MAX_NEARBY), highs = new Float64Array(MAX_NEARBY), alongs = new Float64Array(MAX_NEARBY);
const joined = new Uint8Array(MAX_NEARBY);

// Bends the wanted direction (dirX, dirZ) round the small boxes in the way within a few metres, and leaves it alone
// when nothing is. `within` is how far off the spot it is walking to is, when that is close: nothing past it is in
// the way. Writes the result, not normalised, into `out`. One small box query per call.
//
// Each box nearby blocks a band across the bot's path: the sideways offsets at which the bot, going straight on,
// would hit it. Bands that overlap join up, so two trunks too close to squeeze between, or a trunk beside a boulder,
// are one obstacle with two ends. If the bot's own line (offset 0) is inside a band, it heads for the nearer end.
export function steerRound(
  world: World, x: number, y: number, z: number, dirX: number, dirZ: number, body: SteerBody, settings: SteerSettings, memory: SteerMemory, out: { x: number; z: number },
  within = Infinity,
): void {
  const look = settings.steerLookMeters, clearance = settings.steerClearanceMeters;
  const maxSize = settings.steerMaxSizeMeters, keepSide = settings.steerKeepSideMeters;
  out.x = dirX; out.z = dirZ;
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-6) return;
  const dx = dirX / length, dz = dirZ / length;
  const acrossX = -dz, acrossZ = dx;

  // Both the mech and the boxes are squares lined up with the axes, so how far one reaches along any direction is
  // its half sizes times the direction's parts. That makes the band exact at every angle.
  const mechAcross = body.halfWidth * (Math.abs(acrossX) + Math.abs(acrossZ));
  const mechAlong = body.halfWidth * (Math.abs(dx) + Math.abs(dz));
  const reach = look + body.halfWidth + maxSize / 2;
  const count = world.query(Math.min(x, x + dx * reach) - reach, Math.min(z, z + dz * reach) - reach, Math.max(x, x + dx * reach) + reach, Math.max(z, z + dz * reach) + reach, nearby);

  let bands = 0;
  for (let i = 0; i < count && bands < MAX_NEARBY; i++) {
    const b = world.boxes[nearby[i]!]!;
    if (b.maxY <= y + body.stepHeight || b.minY >= y + body.height) continue; // stepped onto, or passed under
    const hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2;
    if (hx * 2 > maxSize || hz * 2 > maxSize) continue;
    const cx = b.minX + hx, cz = b.minZ + hz;
    const along = (cx - x) * dx + (cz - z) * dz;
    const depth = hx * Math.abs(dx) + hz * Math.abs(dz) + mechAlong;
    if (along + depth <= 0 || along - depth > Math.min(look, within)) continue; // behind it, still a way off, or past the spot
    // A box still ahead is given room to spare. One already alongside only blocks offsets that really touch it:
    // squeezing past one trunk, a bot must not be pushed off by the margin into the next.
    const ahead = along >= depth;
    const half = hx * Math.abs(acrossX) + hz * Math.abs(acrossZ) + mechAcross + (ahead ? clearance : 0);
    const side = (cx - x) * acrossX + (cz - z) * acrossZ;
    lows[bands] = side - half; highs[bands] = side + half; alongs[bands] = ahead ? along : Infinity; joined[bands] = 0;
    bands++;
  }

  // Start from the bands over offset 0 and join every band that overlaps, until none is left that does. Only boxes
  // ahead block the way: one alongside cannot be walked into going on, but it does stop a sidestep, so it still
  // joins the band and pushes that end out past it.
  let low = 0, high = 0, nearest = Infinity, blocked = false;
  for (let grown = true; grown;) {
    grown = false;
    for (let i = 0; i < bands; i++) {
      if (joined[i] || !(blocked ? lows[i]! < high && highs[i]! > low : lows[i]! < 0 && highs[i]! > 0)) continue;
      joined[i] = 1;
      low = Math.min(low, lows[i]!); high = Math.max(high, highs[i]!); nearest = Math.min(nearest, alongs[i]!);
      blocked = grown = true;
    }
  }
  if (!blocked || nearest === Infinity) { memory.steering = false; return; }

  // The nearer end, unless it was already going round the other and that is not much further.
  const side = -low < high ? -1 : 1;
  if (!memory.steering || Math.abs(side === 1 ? high : low) + keepSide < Math.abs(memory.side === 1 ? high : low)) memory.side = side;
  memory.steering = true;
  // Head for that end, level with the nearest thing ahead: far off that is a slight turn, close up a sharp one. There
  // is always some way forward in it, so a bot with a trunk at its side slides along it rather than pushing into it.
  const offset = memory.side === 1 ? high : low;
  const forward = nearest;
  const toX = dx * forward + acrossX * offset, toZ = dz * forward + acrossZ * offset;
  const toLength = Math.hypot(toX, toZ);
  if (toLength < 1e-6) return;
  out.x = (toX / toLength) * length;
  out.z = (toZ / toLength) * length;
}
