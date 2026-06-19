import type { Camera } from '../render/Camera';

export interface InputCallbacks {
  onMoveIntent: (worldX: number, worldY: number) => void;
}

/**
 * Pointer / wheel / touch → camera control + move intents. A tap that didn't
 * drag becomes a move intent; drags pan; wheel and two-finger pinch zoom toward
 * the cursor. Screen coords are CSS pixels (renderer runs at resolution 1).
 */
export class Input {
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly cb: InputCallbacks,
  ) {
    this.attach();
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragging = true;
    this.moved = false;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.pointers.size === 2) this.pinchDist = this.currentPinchDist();
  }

  private onMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      const d = this.currentPinchDist();
      if (this.pinchDist > 0) {
        const c = this.pinchCenter();
        this.camera.zoomAt(c.x, c.y, d / this.pinchDist);
      }
      this.pinchDist = d;
      this.moved = true;
      return;
    }

    if (this.dragging) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
      this.camera.pan(dx, dy);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    const wasTwo = this.pointers.size === 2;
    this.pointers.delete(e.pointerId);
    if (this.dragging && !this.moved && !wasTwo) {
      const w = this.camera.screenToWorld(e.clientX, e.clientY);
      this.cb.onMoveIntent(w.x, w.y);
    }
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) this.dragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.camera.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }

  private currentPinchDist(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
  }

  private pinchCenter(): { x: number; y: number } {
    const pts = [...this.pointers.values()];
    return { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
  }
}
