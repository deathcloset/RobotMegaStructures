import { wrapX } from '@rms/shared';

/** Infinite-canvas camera over a CYLINDER: the X axis wraps, Y is free. The world
 *  point at screen centre + screen-px-per-world-unit. */
export class Camera {
  x = 512;
  y = 512;
  scale = 0.8;
  readonly maxScale = 8;
  /** Circumference; 0 until the welcome arrives (then X wraps + zoom-out is
   *  capped at one lap). */
  private worldWidth = 0;

  constructor(
    private screenW: number,
    private screenH: number,
  ) {}

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.scale = clamp(this.scale, this.minScale, this.maxScale);
  }

  /** Learn the planet circumference: enables X wrap and the zoom-out floor. */
  setWorldWidth(width: number): void {
    this.worldWidth = width;
    this.scale = clamp(this.scale, this.minScale, this.maxScale);
  }

  /** Don't let the player zoom out past seeing exactly one full lap — beyond that
   *  the cylinder would visibly tile (the same content twice). */
  get minScale(): number {
    return this.worldWidth > 0 ? this.screenW / this.worldWidth : 0.1;
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.scale + this.screenW / 2,
      y: (wy - this.y) * this.scale + this.screenH / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.screenW / 2) / this.scale + this.x,
      y: (sy - this.screenH / 2) / this.scale + this.y,
    };
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.scale;
    this.y -= dyScreen / this.scale;
    this.normalize();
  }

  /** Zoom toward a screen anchor, keeping the world point under it fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.normalize();
  }

  /** Keep the camera's X within [0, width) so it loops cleanly around the planet. */
  private normalize(): void {
    if (this.worldWidth > 0) this.x = wrapX(this.x, this.worldWidth);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
