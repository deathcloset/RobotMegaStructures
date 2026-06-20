import { ARRIVE_EPSILON, ROBOT_SPEED, wrapDeltaX, wrapX } from '@rms/shared';

export interface Vec2 {
  x: number;
  y: number;
}
export interface MoveResult {
  x: number;
  y: number;
  arrived: boolean;
}

/**
 * Advance a point toward a target at constant speed. Pure (no I/O, no state).
 * When `wrapWidth > 0` the X axis is a cylinder: the step takes the short way
 * around the seam (`wrapDeltaX`) and the result is wrapped back into [0, width).
 * `wrapWidth = 0` (the default) keeps the old flat-plane behaviour.
 */
export function advanceToward(
  pos: Vec2,
  target: Vec2,
  dt: number,
  speed = ROBOT_SPEED,
  wrapWidth = 0,
): MoveResult {
  const dx = wrapWidth > 0 ? wrapDeltaX(pos.x, target.x, wrapWidth) : target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= ARRIVE_EPSILON) {
    return { x: target.x, y: target.y, arrived: true };
  }
  const travel = Math.min(dist, speed * dt);
  const nx = pos.x + (dx / dist) * travel;
  return {
    x: wrapWidth > 0 ? wrapX(nx, wrapWidth) : nx,
    y: pos.y + (dy / dist) * travel,
    arrived: false,
  };
}
