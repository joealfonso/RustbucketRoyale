import type { BotPathStats, NavGrid } from "@rustbucket/shared";

const DIAGONAL = Math.SQRT2;

// Finds a walkable route across the map for bots, on a coarse grid of 8 m cells made from the navigation grid.
// A coarse cell is blocked if anything a mech cannot step over stands anywhere in it, so routes keep to open ground
// and go round buildings, walls and hills. Searches are capped, and when a goal cannot be reached the route goes
// as near as it can, so a bot is never left without somewhere to head.
export class Pathfinder {
  private cell: number;
  private cols: number;
  private rows: number;
  private originX: number;
  private originZ: number;
  private blocked: Uint8Array;
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
  private searchesLeft: number;

  constructor(nav: NavGrid, private stats: BotPathStats) {
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
        if (nav.top[z * nav.cols + x]! > nav.stepHeight) this.blocked[Math.floor(z / factor) * this.cols + Math.floor(x / factor)] = 1;
      }
    }
    const n = this.cols * this.rows;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seenStamp = new Int32Array(n);
    this.closedStamp = new Int32Array(n);
    this.region = this.findRegions();
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
    this.searchesLeft--;
    const start = this.nearestOpen(this.cellOf(startX, startZ));
    let goal = this.nearestOpen(this.cellOf(goalX, goalZ));
    if (start < 0 || goal < 0) return false;
    // A goal that cannot be reached from here: go to the nearest spot that can.
    const exact = this.region[goal] === this.region[start];
    if (!exact) goal = this.nearestInRegion(goal, this.region[start]!);
    if (start === goal) { out.push(exact ? goalX : this.centreX(goal), exact ? goalZ : this.centreZ(goal)); return true; }

    const reached = this.search(start, goal);
    const end = reached ? goal : this.best;
    if (end === start) return false;
    const cells = this.cells;
    cells.length = 0;
    for (let c = end; c !== -1; c = this.parent[c]!) cells.push(c);
    cells.reverse();

    const points = this.points;
    points.length = 0;
    points.push(startX, startZ);
    for (let i = 1; i < cells.length; i++) points.push(this.centreX(cells[i]!), this.centreZ(cells[i]!));
    if (reached && exact) points[points.length - 2] = goalX, points[points.length - 1] = goalZ;
    this.pull(points, out);
    return true;
  }

  // A* from start to goal over the open cells, at most maxNodes cells looked at. Returns whether it got there;
  // if not, `best` is the cell it got closest to. This loop is most of a large room's tick. Wander goals on the large
  // map are 800 m away on average, and the plain shortest-route search looked at about 1900 cells for one. Weighting the
  // distance still to go (`heuristicWeight`) pulls the search towards the goal: at 1.3 it looks at about 500 cells for
  // routes about 5% longer, which a bot that replans every 2 s and picks a new goal every 12 s never shows.
  private search(start: number, goal: number): boolean {
    const { cols, rows, blocked, g, f, parent, seenStamp, closedStamp } = this;
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
      if (current === goal) { this.best = best; return true; }

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
          const cost = here + (diagonal ? DIAGONAL : 1);
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
    return false;
  }

  // Straightens the route: from each point, jump to the furthest later point that can be reached in a straight line.
  private pull(points: number[], out: number[]): void {
    const count = points.length / 2;
    let i = 0;
    while (i < count - 1) {
      let farthest = i + 1;
      for (let j = count - 1; j > i + 1; j--) {
        if (this.lineClear(points[i * 2]!, points[i * 2 + 1]!, points[j * 2]!, points[j * 2 + 1]!)) { farthest = j; break; }
      }
      out.push(points[farthest * 2]!, points[farthest * 2 + 1]!);
      i = farthest;
    }
  }

  // Samples the line every half cell. Straightening tries many lines per route, so this works out the cells inline,
  // the same way cellOf does.
  private lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    const { blocked, cols, rows, originX, originZ, cell } = this;
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (cell * 0.5));
    const lastCol = cols - 1, lastRow = rows - 1;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      let cx = Math.floor((ax + (bx - ax) * t - originX) / cell);
      let cz = Math.floor((az + (bz - az) * t - originZ) / cell);
      cx = cx < 0 ? 0 : cx > lastCol ? lastCol : cx;
      cz = cz < 0 ? 0 : cz > lastRow ? lastRow : cz;
      if (blocked[cz * cols + cx]) return false;
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
