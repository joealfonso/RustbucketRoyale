import type { MechStats } from "./stats";

const DEG = Math.PI / 180;

export interface Aim {
  yaw: number;
  pitch: number;
}

// Mouse look. Moving the mouse right turns right, moving it up looks up.
export function applyLook(aim: Aim, dxPixels: number, dyPixels: number, stats: MechStats): void {
  aim.yaw -= dxPixels * stats.mouseSensitivity * DEG;
  aim.pitch -= dyPixels * stats.mouseSensitivity * DEG;
  aim.pitch = Math.min(stats.maxPitch * DEG, Math.max(stats.minPitch * DEG, aim.pitch));
}
