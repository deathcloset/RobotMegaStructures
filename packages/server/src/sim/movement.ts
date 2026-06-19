import { ARRIVE_EPSILON, ROBOT_SPEED } from '@rms/shared';

export interface Vec2 {
  x: number;
  y: number;
}
export interface MoveResult {
  x: number;
  y: number;
  arrived: boolean;
}

/** Advance a point toward a target at constant speed. Pure (no I/O, no state). */
export function advanceToward(
  pos: Vec2,
  target: Vec2,
  dt: number,
  speed = ROBOT_SPEED,
): MoveResult {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= ARRIVE_EPSILON) {
    return { x: target.x, y: target.y, arrived: true };
  }
  const travel = Math.min(dist, speed * dt);
  return { x: pos.x + (dx / dist) * travel, y: pos.y + (dy / dist) * travel, arrived: false };
}
