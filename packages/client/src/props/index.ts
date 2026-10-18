import { barrel } from "./barrel";
import { crate } from "./crate";
import { junk } from "./junk";
import type { PropBuilder } from "./parts";

// The breakable prop models, keyed by the prop ids in data/props.json.
export type { PropBuilder } from "./parts";

export const PROP_MODELS: Record<string, PropBuilder> = { crate, junk, barrel };
