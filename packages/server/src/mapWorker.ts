// One map worker thread (see MapPool.ts): builds the maps it is asked for, one at a time, and sends each back packed.
import { parentPort } from "node:worker_threads";
import { generatedMaps } from "./config";
import { packMap, transferList } from "./mapPack";

export interface MapJob {
  id: number;
  tier: string;
  seed: number;
}

const mapFor = generatedMaps();
const port = parentPort!;

port.on("message", (job: MapJob) => {
  try {
    const packed = packMap(mapFor(job.tier, job.seed));
    port.postMessage({ id: job.id, map: packed }, transferList(packed));
  } catch (error) {
    port.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) });
  }
});
