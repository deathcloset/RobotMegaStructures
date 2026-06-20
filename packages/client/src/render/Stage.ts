import { EntityKind, PieceStatus, RobotStatusBit } from '@rms/shared';
import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { RenderEntity } from '../world/EntityStore';
import type { Camera } from './Camera';

/**
 * Pixi v8 stage. WebGL is forced (§5.3 — ~95% support; don't auto-pick WebGPU).
 * Entities are batched Sprites from a few shared textures, chosen by kind; a
 * ParticleContainer is a later optimization once Phase 2 pushes the counts up.
 */
export class Stage {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly grid = new Graphics();
  private robotTex!: Texture;
  private pieceTex!: Texture;
  private resourceTex!: Texture;
  private cargoTex!: Texture;
  private readonly sprites = new Map<number, Sprite>();
  /** Small "held material" marker shown above a carrying robot. */
  private readonly cargo = new Map<number, Sprite>();
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
    this.robotTex = this.makeCircleTexture(16);
    this.pieceTex = this.makeSquareTexture(30, 6);
    this.resourceTex = this.makeSquareTexture(34, 8);
    this.cargoTex = this.makeSquareTexture(12, 2);
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

  private makeCircleTexture(r: number): Texture {
    const g = new Graphics().circle(0, 0, r).fill(0xffffff);
    const tex = this.app.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  private makeSquareTexture(size: number, radius: number): Texture {
    const g = new Graphics().roundRect(0, 0, size, size, radius).fill(0xffffff);
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
        sprite = new Sprite(this.texFor(e.kind));
        sprite.anchor.set(0.5);
        this.world.addChild(sprite);
        this.sprites.set(e.id, sprite);
      }
      sprite.position.set(e.x, e.y);
      this.style(sprite, e);
    }
    for (const [id, sprite] of this.sprites) {
      if (!present.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
        this.dropCargo(id);
      }
    }
  }

  private texFor(kind: number): Texture {
    if (kind === EntityKind.Piece || kind === EntityKind.WeldPiece) return this.pieceTex;
    if (kind === EntityKind.Resource) return this.resourceTex;
    return this.robotTex;
  }

  private style(sprite: Sprite, e: RenderEntity): void {
    switch (e.kind) {
      case EntityKind.Piece: {
        const placed = e.status === PieceStatus.Placed;
        sprite.tint = placed ? 0xe0a24e : 0x5a86c0;
        sprite.alpha = placed ? 1 : 0.28;
        sprite.scale.set(1);
        break;
      }
      case EntityKind.WeldPiece: {
        // Distinct from normal pieces: violet ghost ("needs a buddy"), orange when
        // a holder is waiting for a welder, bright while welding, amber when done.
        if (e.status === PieceStatus.Placed) {
          sprite.tint = 0xe0a24e;
          sprite.alpha = 1;
        } else if (e.status === PieceStatus.InProgress) {
          sprite.tint = 0xffd23f;
          sprite.alpha = 0.95;
        } else if (e.status === PieceStatus.Reserved) {
          sprite.tint = 0xff8c42;
          sprite.alpha = 0.8;
        } else {
          sprite.tint = 0x9b6bd6;
          sprite.alpha = 0.34;
        }
        sprite.scale.set(1.1);
        break;
      }
      case EntityKind.Resource:
        sprite.tint = 0x4fb6a8;
        sprite.alpha = 1;
        sprite.scale.set(1);
        break;
      default: {
        const isMe = e.id === this.myRobotId;
        sprite.tint = isMe ? 0x46e3a0 : e.id < 0 ? 0x6b7785 : 0x4a90d9;
        sprite.alpha = 1;
        sprite.scale.set(isMe ? 0.6 : 0.42);
        this.styleCargo(e);
      }
    }
  }

  /** Show/hide the held-material marker above a robot per its Carrying bit. */
  private styleCargo(e: RenderEntity): void {
    const carrying = (e.status & RobotStatusBit.Carrying) !== 0;
    if (!carrying) {
      this.dropCargo(e.id);
      return;
    }
    let marker = this.cargo.get(e.id);
    if (!marker) {
      marker = new Sprite(this.cargoTex);
      marker.anchor.set(0.5);
      marker.tint = 0x4fb6a8;
      this.world.addChild(marker);
      this.cargo.set(e.id, marker);
    }
    marker.position.set(e.x, e.y - 15);
  }

  private dropCargo(id: number): void {
    const marker = this.cargo.get(id);
    if (marker) {
      marker.destroy();
      this.cargo.delete(id);
    }
  }
}
