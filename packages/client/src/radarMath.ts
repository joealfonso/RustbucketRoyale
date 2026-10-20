export interface RadarPoint {
  x: number;
  y: number;
}

// A world offset (dx, dz from the centre mech) turned so the way you face is up the radar, then scaled. Writes into
// `out` so the frame loop allocates nothing. y grows downwards, as on a canvas.
export function placeOnRadar(dx: number, dz: number, yaw: number, scale: number, out: RadarPoint): RadarPoint {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const forward = dx * -sin + dz * -cos;
  const right = dx * cos + dz * -sin;
  out.x = right * scale;
  out.y = -forward * scale;
  return out;
}
