import type { Camera } from '../render/Camera';

export interface InputCallbacks {
  /** A tap (pointer down→up without dragging) at a world point. The caller
   *  decides whether it's a move or an interact (it has the entity list). */
  onTap: (worldX: number, worldY: number) => void;
  /** A long-press (held in place) at a world point — plants the work-flag. */
  onLongPress: (worldX: number, worldY: number) => void;
}

/** Hold this long without moving to register a long-press (plant a flag). */
const LONG_PRESS_MS = 450;

/**
 * Pointer / wheel / touch → camera control + taps. A tap that didn't drag is
 * reported to the caller; drags pan; wheel and two-finger pinch zoom toward the
 * cursor. Screen coords are CSS pixels (renderer runs at resolution 1).
 */
export class Input {
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  // Long-press (plant flag) tracking.
  private longPressTimer: number | null = null;
  private longPressed = false;
  private downX = 0;
  private downY = 0;

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
    if (this.pointers.size === 2) {
      this.pinchDist = this.currentPinchDist();
      this.cancelLongPress(); // a second finger is a pinch, not a flag plant
    } else if (this.pointers.size === 1) {
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.longPressed = false;
      this.longPressTimer = window.setTimeout(() => this.fireLongPress(), LONG_PRESS_MS);
    }
  }

  private fireLongPress(): void {
    this.longPressTimer = null;
    if (this.moved || this.pointers.size !== 1) return;
    this.longPressed = true; // suppress the tap that the upcoming pointerup would fire
    const w = this.camera.screenToWorld(this.downX, this.downY);
    this.cb.onLongPress(w.x, w.y);
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
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
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        this.moved = true;
        this.cancelLongPress(); // a drag is a pan, not a flag plant
      }
      this.camera.pan(dx, dy);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    const wasTwo = this.pointers.size === 2;
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    if (this.dragging && !this.moved && !wasTwo && !this.longPressed) {
      const w = this.camera.screenToWorld(e.clientX, e.clientY);
      this.cb.onTap(w.x, w.y);
    }
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.longPressed = false;
    }
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
