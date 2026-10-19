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
  private heap = new Int32Array(1024); // grows when a search needs more; `heapSize` entries are in use
  private heapSize = 0;
  private searchesLeft: number;
  // Whether the last route found goes all the way, rather than stopping where the search ran out of cells. A whole
  // route stays good on a map that never changes, so a bot only needs a new one when it strays from it.
  reachedGoal = false;

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
    this.reachedGoal = false;
    this.searchesLeft--;
    const start = this.nearestOpen(this.cellOf(startX, startZ));
    let goal = this.nearestOpen(this.cellOf(goalX, goalZ));
    if (start < 0 || goal < 0) return false;
    // A goal that cannot be reached from here: go to the nearest spot that can.
    const exact = this.region[goal] === this.region[start];
    if (!exact) goal = this.nearestInRegion(goal, this.region[start]!);
    if (start === goal) {
      out.push(exact ? goalX : this.centreX(goal), exact ? goalZ : this.centreZ(goal));
      this.reachedGoal = true;
      return true;
    }

    this.stamp++;
    const stamp = this.stamp;
    this.heapSize = 0;
    this.g[start] = 0;
    this.f[start] = this.stats.heuristicWeight * this.heuristic(start, goal);
    this.parent[start] = -1;
    this.seenStamp[start] = stamp;
    this.push(start);

    let best = start;
    let bestH = this.f[start]!;
    let expanded = 0;
    let reached = false;
    // Locals rather than fields in the loop below: it runs thousands of times per search.
    const { cols, rows, blocked, closedStamp, seenStamp, g, f, parent } = this;
    const goalCol = goal % cols, goalRow = Math.floor(goal / cols);
    const weight = this.stats.heuristicWeight;

    while (this.heapSize > 0 && expanded < this.stats.maxNodes) {
      const current = this.pop();
      if (closedStamp[current] === stamp) continue;
      closedStamp[current] = stamp;
      expanded++;
      if (current === goal) { reached = true; break; }

      const cx = current % cols, cz = Math.floor(current / cols);
      const hx = Math.abs(cx - goalCol), hz = Math.abs(cz - goalRow);
      const h = Math.max(hx, hz) + (DIAGONAL - 1) * Math.min(hx, hz);
      if (h < bestH) { bestH = h; best = current; }

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const next = nz * cols + nx;
          if (blocked[next] || closedStamp[next] === stamp) continue;
          // No cutting across the corner of a blocked cell.
          if (dx !== 0 && dz !== 0 && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
          const cost = g[current]! + (dx !== 0 && dz !== 0 ? DIAGONAL : 1);
          if (seenStamp[next] === stamp && cost >= g[next]!) continue;
          seenStamp[next] = stamp;
          g[next] = cost;
          parent[next] = current;
          const ax = Math.abs(nx - goalCol), az = Math.abs(nz - goalRow);
          f[next] = cost + weight * (Math.max(ax, az) + (DIAGONAL - 1) * Math.min(ax, az));
          this.push(next);
        }
      }
    }

    const end = reached ? goal : best;
    if (end === start) return false;
    this.reachedGoal = reached;
    const cells: number[] = [];
    for (let c = end; c !== -1; c = this.parent[c]!) cells.push(c);
    cells.reverse();

    const points: number[] = [startX, startZ];
    for (let i = 1; i < cells.length; i++) points.push(this.centreX(cells[i]!), this.centreZ(cells[i]!));
    if (reached && exact) points[points.length - 2] = goalX, points[points.length - 1] = goalZ;
    this.pull(points, out);
    return true;
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

  private lineClear(ax: number, az: number, bx: number, bz: number): boolean {
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(length / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.blocked[this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t)]) return false;
    }
    return true;
  }

  private heuristic(a: number, b: number): number {
    const dx = Math.abs((a % this.cols) - (b % this.cols));
    const dz = Math.abs(Math.floor(a / this.cols) - Math.floor(b / this.cols));
    return Math.max(dx, dz) + (DIAGONAL - 1) * Math.min(dx, dz);
  }

  // A plain binary heap ordered by f, in a typed array, moving a hole rather than swapping: route searches are most
  // of a large room's tick, and the swaps' throwaway arrays were a good part of that (docs/PERF.md). It makes the
  // same comparisons in the same order as the swapping version, so the routes are exactly the same.
  private push(node: number): void {
    if (this.heapSize === this.heap.length) {
      const bigger = new Int32Array(this.heap.length * 2);
      bigger.set(this.heap);
      this.heap = bigger;
    }
    const heap = this.heap, f = this.f;
    const value = f[node]!;
    let i = this.heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (f[heap[parent]!]! <= value) break;
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
      const value = f[last]!;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        let smallest = i, smallestValue = value;
        if (left < size && f[heap[left]!]! < smallestValue) { smallest = left; smallestValue = f[heap[left]!]!; }
        if (right < size && f[heap[right]!]! < smallestValue) smallest = right;
        if (smallest === i) break;
        heap[i] = heap[smallest]!;
        i = smallest;
      }
      heap[i] = last;
    }
    return top;
  }
}
