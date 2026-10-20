import { boulder } from "./boulder";
import { container } from "./container";
import type { KindBuilder } from "./kinds";
import { rock } from "./rock";
import { ruin } from "./ruin";
import { scrap } from "./scrap";
import { sheet } from "./sheet";
import { tower } from "./tower";

export { Dressing } from "./dressing";
export { scatter } from "./scatter";

// A builder for each box kind in data/chunks.json, and "boulder", which map generation adds on the hills. A kind
// with no builder ("plain") stays a plain toon box.
export const BUILDERS: Record<string, KindBuilder> = { container, sheet, ruin, rock, scrap, tower, boulder };
