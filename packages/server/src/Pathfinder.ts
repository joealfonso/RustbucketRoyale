import { raised, type BotPathStats, type NavGrid, type Terrain } from "@rustbucket/shared";

const DIAGONAL = Math.SQRT2;

// Finds a walkable route across the map for bots, on a coarse grid of 8 m cells made from the navigation grid.
// A coarse cell is blocked if anything a mech cannot step over stands up off the ground anywhere in it, so routes
// keep to open ground and go round buildings and walls. Bare hillside never blocks: slopes are capped at walking
// steepness when the map is made, so routes go straight over hills. Searches are capped, and when a goal cannot be
// reached the route goes as near as it can, so a bot is never left without somewhere to head. Water never blocks
// either, but it is slow, so routes cost more through it and go round ponds when going round is not much further.
export class Pathfinder {
  private cell: number;
  private cols: number;
  private rows: number;
  private originX: number;
  private originZ: number;
  private blocked: Uint8Array;
  private wet: Uint8Array; // 1 where most of a cell's ground is under wading water
  private region: Int32Array; // open cells that can reach each other share a number, blocked cells are -1

  // Scratch space, reused by every search. A stamp stands in for clearing the arrays each time.
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private seenStamp: Int32Array;
  private closedStamp: Int32Array;
  private stamp = 0;
  private heap = new Int32Array(1024);
  private heapSize = 0;
  private best = 0; // after a search that fell short, the cell it got closest to
  private cells: number[] = [];
  private points: number[] = [];
  private wetBefore: number[] = []; // for each route point, how many wet cells the route has crossed to reach it
  private searchesLeft: number;
  // Whether the last route found goes all the way, rather than stopping where the search ran out of cells or as near
  // as it gets to a goal it cannot reach. A whole route stays good on a map that never changes, so a bot only needs a
  // new one when it strays from it.
  reachedGoal = false;
  // Cells the last search looked at: its cost, the same on any computer however busy.
  cellsSearched = 0;

  constructor(nav: NavGrid, private stats: BotPathStats, private terrain: Terrain | null = null) {
    this.searchesLeft = stats.searchesPerTick;
    const factor = Math.max(1, Math.round(stats.cellMeters / nav.cell));
    this.cell = nav.cell * factor;
    this.cols = Math.ceil(nav.cols / factor);
    this.rows = Math.ceil(nav.rows / factor);
    this.originX = nav.originX;
    this.originZ = nav.originZ;
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let z = 0; z < nav.rows; z++) {
      for (let x = 0; x < nav.cols; x++) {
        if (raised(nav, z * nav.cols + x) > nav.stepHeight) this.blocked[Math.floor(z / factor) * this.cols + Math.floor(x / factor)] = 1;
      }
    }
    this.wet = this.findWater(nav, factor, terrain);
    const n = this.cols * this.rows;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seenStamp = new Int32Array(n);
    this.closedStamp = new Int32Array(n);
    this.region = this.findRegions();
  }

  // A coarse cell counts as wet when more than half its nav cells are deep enough to wade in, the same test
  // Terrain.wading makes for a mech's feet. A dry map has none.
  private findWater(nav: NavGrid, factor: number, terrain: Terrain | null): Uint8Array {
    const wet = new Uint8Array(this.cols * this.rows);
    if (!terrain || terrain.waterLevelCm === null) return wet;
    const under = new Uint16Array(this.cols * this.rows), total = new Uint16Array(this.cols * this.rows);
    const surface = terrain.waterLevel - terrain.wadeMeters;
    for (let z = 0; z < nav.rows; z++) {
      for (let x = 0; x < nav.cols; x++) {
        const c = Math.floor(z / factor) * this.cols + Math.floor(x / factor);
        total[c]!++;
        if (nav.ground[z * nav.cols + x]! < surface) under[c]!++;
      }
    }
    for (let c = 0; c < wet.length; c++) if (under[c]! * 2 > total[c]!) wet[c] = 1;
    return wet;
  }

  // Labels each patch of open cells that can be walked between, with the same moves the search makes.
  // The large map has hundreds of small sealed pockets, and a search for a goal in one would look at every cell
  // it can reach before giving up.
  private findRegions(): Int32Array {
    const region = new Int32Array(this.cols * this.rows).fill(-1);
    const stack = this.parent; // free until the first search
    let next = 0;
    for (let first = 0; first < region.length; first++) {
      if (this.blocked[first] || region[first]! >= 0) continue;
      region[first] = next;
      let top = 0;
      stack[top++] = first;
      while (top > 0) {
        const c = stack[--top]!;
        const cx = c % this.cols, cz = Math.floor(c / this.cols);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
            const n = nz * this.cols + nx;
            if (this.blocked[n] || region[n]! >= 0) continue;
            if (dx !== 0 && dz !== 0 && (this.blocked[cz * this.cols + nx] || this.blocked[nz * this.cols + cx])) continue;
            region[n] = next;
            stack[top++] = n;
          }
        }
      }
      next++;
    }
    return region;
  }

  private cellOf(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.originX) / this.cell)));
    const cz = Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.originZ) / this.cell)));
    return cz * this.cols + cx;
  }

  private centreX(c: number): number {
    return this.originX + ((c % this.cols) + 0.5) * this.cell;
  }

  private centreZ(c: number): number {
    return this.originZ + (Math.floor(c / this.cols) + 0.5) * this.cell;
  }

  // On the 2000 m map one search can look at thousands of cells, and several bots asking on the same tick made the
  // slow ticks. So a room runs only a few searches per tick and the other bots keep their old route a tick longer.
  // The room calls this once per tick.
  newTick(): void {
    this.searchesLeft = this.stats.searchesPerTick;
  }

  canSearch(): boolean {
    return this.searchesLeft > 0;
  }

  isBlocked(x: number, z: number): boolean {
    return this.blocked[this.cellOf(x, z)] === 1;
  }

  // The nearest open cell to this one, looking a few cells out. Returns -1 if everything near is blocked.
  private nearestOpen(c: number): number {
    if (!this.blocked[c]) return c;
    const cx = c % this.cols, cz = Math.floor(c / this.cols);
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= this.cols || z >= this.rows) continue;
          if (!this.blocked[z * this.cols + x]) return z * this.cols + x;
        }
      }
    }
    return -1;
  }

  // The nearest cell to this one that is in the given region: square rings outwards, and the closest cell of the
  // first ring that has any. There is always one, since the region is not empty.
  private nearestInRegion(c: number, region: number): number {
    const cx = c % this.cols, cz = Math.floor(c / this.cols);
    const most = Math.max(this.cols, this.rows);
    for (let r = 1; r < most; r++) {
      let best = -1, bestSquared = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= this.rows) continue;
        const step = Math.abs(dz) === r ? 1 : 2 * r; // whole top and bottom rows, only the ends of the others
        for (let dx = -r; dx <= r; dx += step) {
          const x = cx + dx;
          if (x < 0 || x >= this.cols || this.region[z * this.cols + x] !== region) continue;
          if (dx * dx + dz * dz < bestSquared) { best = z * this.cols + x; bestSquared = dx * dx + dz * dz; }
        }
      }
      if (best >= 0) return best;
    }
    return c;
  }

  // Fills `out` with x, z, x, z... for the waypoints from here to the goal, not counting the start.
  // Returns false only when no route towards the goal could be found at all.
  findPath(startX: number, startZ: number, goalX: number, goalZ: number, out: number[]): boolean {
    out.length = 0;
    this.reachedGoal = false;
    this.cellsSearched = 0;
    this.searchesLeft--;
    const start = this.nearestOpen(this.cellOf(startX, startZ));
    if (start < 0) return false;
    // A goal out at sea, past an island's limit, can lie further from open ground than nearestOpen looks: it is
    // swapped for the nearest reachable spot below, like any goal that cannot be reached.
    const goalCell = this.cellOf(goalX, goalZ);
    let goal = this.nearestOpen(goalCell);
    if (goal < 0 && this.terrain?.island) goal = this.nearestInRegion(goalCell, this.region[start]!);
    if (goal < 0) return false;
    // A goal that cannot be reached from here: go to the nearest spot that can.
    const sameRegion = this.region[goal] === this.region[start];
    if (!sameRegion) goal = this.nearestInRegion(goal, this.region[start]!);
    // Nor is a goal out at sea: the route ends on the shore, so the bot gives it up there instead of wading at the limit.
    const exact = sameRegion && (this.terrain?.mayStand(goalX, goalZ) ?? true);
    // A route to the nearest reachable spot does not reach the goal, however well the search went. Saying it did kept
    // bots standing for minutes in clearings the grid sees as sealed in, sure they had arrived.
    if (start === goal) {
      out.push(exact ? goalX : this.centreX(goal), exact ? goalZ : this.centreZ(goal));
      this.reachedGoal = exact;
      return true;
    }

    const reached = this.search(start, goal);
    const end = reached ? goal : this.best;
    if (end === start) return false;
    this.reachedGoal = reached && exact;
    const cells = this.cells;
    cells.length = 0;
    for (let c = end; c !== -1; c = this.parent[c]!) cells.push(c);
    cells.reverse();

    const points = this.points, wetBefore = this.wetBefore;
    points.length = 0;
    wetBefore.length = 0;
    points.push(startX, startZ);
    wetBefore.push(0);
    for (let i = 1; i < cells.length; i++) {
      points.push(this.centreX(cells[i]!), this.centreZ(cells[i]!));
      wetBefore.push(wetBefore[i - 1]! + this.wet[cells[i]!]!);
    }
    if (reached && exact) points[points.length - 2] = goalX, points[points.length - 1] = goalZ;
    this.pull(points, out);
    return true;
  }

  // A* from start to goal over the open cells, at most maxNodes cells looked at. Returns whether it got there;
  // if not, `best` is the cell it got closest to. This loop is most of a large room's tick. Wander goals on the large
  // map are 800 m away on average, and the plain shortest-route search looked at about 1900 cells for one. Weighting the
  // distance still to go (`heuristicWeight`) pulls the search towards the goal: fewer cells looked at for slightly
  // longer routes (numbers in docs/PERF.md).
  private search(start: number, goal: number): boolean {
    const { cols, rows, blocked, wet, g, f, parent, seenStamp, closedStamp } = this;
    const goalX = goal % cols, goalZ = Math.floor(goal / cols);
    const stamp = ++this.stamp;
    this.heapSize = 0;
    g[start] = 0;
    f[start] = octile(start % cols - goalX, Math.floor(start / cols) - goalZ);
    parent[start] = -1;
    seenStamp[start] = stamp;
    this.push(start);

    let best = start;
    let bestH = f[start]!;
    let expanded = 0;
    const maxNodes = this.stats.maxNodes;
    const weight = this.stats.heuristicWeight;

    while (this.heapSize > 0 && expanded < maxNodes) {
      const current = this.pop();
      if (closedStamp[current] === stamp) continue;
      closedStamp[current] = stamp;
      expanded++;
      if (current === goal) { this.best = best; this.cellsSearched = expanded; return true; }

      const cx = current % cols, cz = Math.floor(current / cols);
      const h = octile(cx - goalX, cz - goalZ);
      if (h < bestH) { bestH = h; best = current; }

      const here = g[current]!;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = cz + dz;
        if (nz < 0 || nz >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= cols) continue;
          const next = nz * cols + nx;
          if (blocked[next] || closedStamp[next] === stamp) continue;
          const diagonal = dx !== 0 && dz !== 0;
          // No cutting across the corner of a blocked cell.
          if (diagonal && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
          const cost = here + (diagonal ? DIAGONAL : 1) * (wet[next] ? this.stats.waterCost : 1);
          if (seenStamp[next] === stamp && cost >= g[next]!) continue;
          seenStamp[next] = stamp;
          g[next] = cost;
          parent[next] = current;
          f[next] = cost + weight * octile(nx - goalX, nz - goalZ);
          this.push(next);
        }
      }
    }
    this.best = best;
    this.cellsSearched = expanded;
    return false;
  }

  // Straightens the route: from each point, jump to the furthest later point that can be reached in a straight line.
  // A straight line may only cross water where the route itself waded, or straightening would cut back across the
  // pond the search went round.
  private pull(points: number[], out: number[]): void {
    const count = points.length / 2;
    const wetBefore = this.wetBefore;
    let i = 0;
    while (i < count - 1) {
      let farthest = i + 1;
      for (let j = count - 1; j > i + 1; j--) {
        const wades = wetBefore[j]! > wetBefore[i]!;
        if (this.lineClear(points[i * 2]!, points[i * 2 + 1]!, points[j * 2]!, points[j * 2 + 1]!, wades)) { farthest = j; break; }
      }
      out.push(points[farthest * 2]!, points[farthest * 2 + 1]!);
      i = farthest;
    }
  }

  // Whether a mech can walk in a straight line between two spots without meeting anything the routes go round.
  // The cell the walk starts in is not checked: a coarse cell is blocked by anything in it, so a mech walking along
  // the edge of a building often stands in one.
  canWalkStraight(ax: number, az: number, bx: number, bz: number): boolean {
    const from = this.cellOf(ax, az);
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(length / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const c = this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (c !== from && this.blocked[c]) return false;
    }
    return true;
  }

  // Samples the line every half cell. Straightening tries many lines per route, so this works out the cells inline,
  // the same way cellOf does.
  private lineClear(ax: number, az: number, bx: number, bz: number, waterAllowed: boolean): boolean {
    const { blocked, wet, cols, rows, originX, originZ, cell } = this;
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (cell * 0.5));
    const lastCol = cols - 1, lastRow = rows - 1;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      let cx = Math.floor((ax + (bx - ax) * t - originX) / cell);
      let cz = Math.floor((az + (bz - az) * t - originZ) / cell);
      cx = cx < 0 ? 0 : cx > lastCol ? lastCol : cx;
      cz = cz < 0 ? 0 : cz > lastRow ? lastRow : cz;
      if (blocked[cz * cols + cx] || (!waterAllowed && wet[cz * cols + cx])) return false;
    }
    return true;
  }

  // A binary heap of cells ordered by f. A cell can sit in it more than once; the stale copies are skipped when popped.
  private push(node: number): void {
    if (this.heapSize === this.heap.length) {
      const bigger = new Int32Array(this.heap.length * 2);
      bigger.set(this.heap);
      this.heap = bigger;
    }
    const heap = this.heap, f = this.f;
    const key = f[node]!;
    let i = this.heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (f[heap[parent]!]! <= key) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = node;
  }

  private pop(): number {
    const heap = this.heap, f = this.f;
    const top = heap[0]!;
    const size = --this.heapSize;
    if (size > 0) {
      const last = heap[size]!;
      const key = f[last]!;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        let smallest = -1, smallestKey = key;
        if (left < size && f[heap[left]!]! < smallestKey) { smallest = left; smallestKey = f[heap[left]!]!; }
        if (right < size && f[heap[right]!]! < smallestKey) smallest = right;
        if (smallest < 0) break;
        heap[i] = heap[smallest]!;
        i = smallest;
      }
      heap[i] = last;
    }
    return top;
  }
}

// The length of the shortest grid walk over this many cells across and down, with diagonal steps allowed.
function octile(dx: number, dz: number): number {
  if (dx < 0) dx = -dx;
  if (dz < 0) dz = -dz;
  return Math.max(dx, dz) + (DIAGONAL - 1) * Math.min(dx, dz);
}
