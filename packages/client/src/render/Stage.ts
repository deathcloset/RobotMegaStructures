import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { RenderEntity } from '../world/EntityStore';
import type { Camera } from './Camera';

/**
 * Pixi v8 stage. WebGL is forced (§5.3 — ~95% support; don't auto-pick WebGPU).
 * Robots are batched Sprites from one shared texture; a ParticleContainer is a
 * later optimization once Phase 2 pushes the counts up.
 */
export class Stage {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly grid = new Graphics();
  private robotTex!: Texture;
  private readonly sprites = new Map<number, Sprite>();
  private myRobotId: number | null = null;
  private worldSize = 1024;

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      preference: 'webgl',
      antialias: true,
      background: '#0b0e13',
      resizeTo: window,
    });
    mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.grid);
    this.robotTex = this.makeRobotTexture();
    this.drawGrid();
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  get screen(): { w: number; h: number } {
    return { w: this.app.renderer.width, h: this.app.renderer.height };
  }

  setWorldSize(size: number): void {
    this.worldSize = size;
    this.drawGrid();
  }

  setMyRobot(id: number): void {
    this.myRobotId = id;
  }

  private makeRobotTexture(): Texture {
    const g = new Graphics().circle(0, 0, 16).fill(0xffffff);
    const tex = this.app.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  /** Move the camera by transforming the world container (not each sprite). */
  applyCamera(cam: Camera): void {
    cam.resize(this.app.renderer.width, this.app.renderer.height);
    this.world.scale.set(cam.scale);
    this.world.position.set(
      this.app.renderer.width / 2 - cam.x * cam.scale,
      this.app.renderer.height / 2 - cam.y * cam.scale,
    );
  }

  private drawGrid(): void {
    const step = 128;
    this.grid.clear();
    for (let g = step; g < this.worldSize; g += step) {
      this.grid.moveTo(g, 0).lineTo(g, this.worldSize);
      this.grid.moveTo(0, g).lineTo(this.worldSize, g);
    }
    this.grid.stroke({ color: 0x141b25, width: 1 });
    this.grid.rect(0, 0, this.worldSize, this.worldSize).stroke({ color: 0x223040, width: 2 });
  }

  /** Reconcile the sprite set against the current render entities. */
  render(entities: RenderEntity[]): void {
    const present = new Set<number>();
    for (const e of entities) {
      present.add(e.id);
      let sprite = this.sprites.get(e.id);
      if (!sprite) {
        sprite = new Sprite(this.robotTex);
        sprite.anchor.set(0.5);
        this.world.addChild(sprite);
        this.sprites.set(e.id, sprite);
      }
      sprite.position.set(e.x, e.y);
      const isMe = e.id === this.myRobotId;
      sprite.tint = isMe ? 0x46e3a0 : e.id < 0 ? 0x6b7785 : 0x4a90d9;
      sprite.scale.set(isMe ? 0.6 : 0.42);
    }
    for (const [id, sprite] of this.sprites) {
      if (!present.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }
}
