import { Worker } from "node:worker_threads";
import type { MapJob } from "./mapWorker";
import { unpackMap, type PackedMap } from "./mapPack";
import type { MapForRoom } from "./Room";

interface Waiting extends MapJob {
  resolve: (map: MapForRoom) => void;
  reject: (error: Error) => void;
}

type Reply = { id: number; map: PackedMap } | { id: number; error: string };

// A few worker threads that build match maps, so the 50 to 200 ms a large map takes never stalls the rooms
// ticking on the main thread. Jobs start in the order they were asked for; each worker does one at a time.
// A job whose map cannot be built rejects with the reason, and a worker that dies is replaced.
export class MapPool {
  private idle: Worker[] = [];
  private busy = new Map<Worker, Waiting>();
  private queue: Waiting[] = [];
  private nextId = 1;
  private closed = false;

  // The worker is TypeScript, so it loads tsx itself: under vitest the parent process has no tsx loader to inherit.
  constructor(size: number, private script: URL = new URL("./mapWorker.ts", import.meta.url)) {
    for (let i = 0; i < size; i++) this.idle.push(this.spawn());
  }

  generate(tier: string, seed: number): Promise<MapForRoom> {
    if (this.closed) return Promise.reject(new Error("The map pool is closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, tier, seed, resolve, reject });
      this.pump();
    });
  }

  // Stops every worker. Jobs not finished yet reject.
  async close(): Promise<void> {
    this.closed = true;
    const stopped = new Error("The map pool is closed");
    for (const job of this.queue) job.reject(stopped);
    for (const job of this.busy.values()) job.reject(stopped);
    this.queue = [];
    const workers = [...this.idle, ...this.busy.keys()];
    this.idle = [];
    this.busy.clear();
    await Promise.all(workers.map((w) => w.terminate()));
  }

  private spawn(): Worker {
    const worker = new Worker(this.script, { execArgv: ["--import", "tsx"] });
    // An idle worker must not keep the process alive, so a server or script that is done can exit without
    // remembering to close the pool. A busy one does, so a script awaiting a map is not cut off.
    worker.unref();
    // And again once it is running: on Node 25 with tsx loaded through --import, an unref made before the thread is up
    // did not hold, and an unused pool kept a finished process open (seen, cause not tracked down).
    worker.on("online", () => { if (!this.busy.has(worker)) worker.unref(); });
    worker.on("message", (reply: Reply) => {
      const job = this.busy.get(worker);
      if (!job || job.id !== reply.id) return;
      this.busy.delete(worker);
      worker.unref();
      this.idle.push(worker);
      if ("error" in reply) job.reject(new Error(reply.error));
      else job.resolve(unpackMap(reply.map));
      this.pump();
    });
    worker.on("error", (error: unknown) => this.lose(worker, error instanceof Error ? error : new Error(String(error))));
    worker.on("exit", (code) => this.lose(worker, new Error(`A map worker stopped (exit code ${code})`)));
    return worker;
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.shift()!;
      const job = this.queue.shift()!;
      this.busy.set(worker, job);
      worker.ref();
      const message: MapJob = { id: job.id, tier: job.tier, seed: job.seed };
      worker.postMessage(message);
    }
  }

  // A worker crashed: its job fails, and a fresh worker takes its place. "error" and "exit" both arrive for one
  // crash, so the second finds nothing left to do.
  private lose(worker: Worker, error: Error): void {
    const job = this.busy.get(worker);
    const wasIdle = this.idle.indexOf(worker);
    if (!job && wasIdle < 0) return;
    this.busy.delete(worker);
    if (wasIdle >= 0) this.idle.splice(wasIdle, 1);
    job?.reject(error);
    if (this.closed) return;
    this.idle.push(this.spawn());
    this.pump();
  }
}
