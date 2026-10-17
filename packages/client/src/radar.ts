import type { Circle } from "@rustbucket/shared";
import type { RemoteMechs } from "./remoteMechs";

const SIZE = 150;
const RING_DOTS = 90;

// A round map in the corner with you in the middle and forward at the top. It shows mechs within a short range
// as dots (bots red, people blue) and the edge of the safe zone as a line of blue dots. Noise pulses come later.
export class Radar {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private scale: number;

  constructor(private rangeMeters: number) {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    Object.assign(this.canvas.style, { position: "fixed", right: "16px", bottom: "16px", width: `${SIZE}px`, height: `${SIZE}px`, pointerEvents: "none" });
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.scale = SIZE / 2 / rangeMeters;
  }

  // `outside` turns the zone arrow red and makes it pulse. `nowMs` drives the pulse.
  draw(x: number, z: number, yaw: number, remotes: RemoteMechs, ring: Circle | null, outside: boolean, nowMs: number): void {
    const ctx = this.ctx;
    const mid = SIZE / 2;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // The world offset turned so that where you look is up the screen.
    const place = (wx: number, wz: number): [number, number] => {
      const dx = wx - x, dz = wz - z;
      const forward = dx * -sin + dz * -cos;
      const right = dx * cos + dz * -sin;
      return [mid + right * this.scale, mid - forward * this.scale];
    };

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.arc(mid, mid, mid, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(mid, mid, mid / 2, 0, Math.PI * 2);
    ctx.stroke();

    if (ring) {
      ctx.fillStyle = "#4da3ff";
      for (let i = 0; i < RING_DOTS; i++) {
        const angle = (i / RING_DOTS) * Math.PI * 2;
        const [px, py] = place(ring.cx + Math.cos(angle) * ring.radius, ring.cz + Math.sin(angle) * ring.radius);
        if (Math.hypot(px - mid, py - mid) <= mid - 2) ctx.fillRect(px - 1, py - 1, 3, 3);
      }
    }

    // When the zone edge is off the radar, or you are outside it, an arrow on the rim points to the middle of the zone.
    if (ring) {
      const toCentre = Math.hypot(ring.cx - x, ring.cz - z);
      const edgeOffRadar = Math.abs(ring.radius - toCentre) > this.rangeMeters;
      if ((outside || edgeOffRadar) && toCentre > 1) {
        const [px, py] = place(ring.cx, ring.cz);
        const angle = Math.atan2(py - mid, px - mid);
        const tipX = mid + Math.cos(angle) * (mid - 3), tipY = mid + Math.sin(angle) * (mid - 3);
        const backX = mid + Math.cos(angle) * (mid - 15), backY = mid + Math.sin(angle) * (mid - 15);
        const side = 6;
        const pulse = outside ? 0.55 + 0.45 * Math.sin(nowMs / 120) : 1;
        ctx.fillStyle = outside ? `rgba(255,70,60,${pulse})` : "#ffffff";
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(backX - Math.sin(angle) * side, backY + Math.cos(angle) * side);
        ctx.lineTo(backX + Math.sin(angle) * side, backY - Math.cos(angle) * side);
        ctx.closePath();
        ctx.fill();
      }
    }

    remotes.forEach((wx, wz, bot, dead) => {
      if (dead) return;
      const [px, py] = place(wx, wz);
      const edge = Math.hypot(px - mid, py - mid);
      if (edge > mid - 4) return; // out of range
      ctx.fillStyle = bot ? "#ff5a4d" : "#59b8ff";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(mid, mid - 6);
    ctx.lineTo(mid - 4, mid + 4);
    ctx.lineTo(mid + 4, mid + 4);
    ctx.closePath();
    ctx.fill();
  }
}
