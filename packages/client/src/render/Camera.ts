/** Infinite-canvas camera: world point at screen centre + screen-px-per-world-unit. */
export class Camera {
  x = 512;
  y = 512;
  scale = 0.8;
  readonly minScale = 0.1;
  readonly maxScale = 8;

  constructor(
    private screenW: number,
    private screenH: number,
  ) {}

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
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
  }

  /** Zoom toward a screen anchor, keeping the world point under it fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
