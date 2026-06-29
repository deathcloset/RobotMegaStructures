import {
  EntityKind,
  NESTED_ZONE_HALF_H,
  NESTED_ZONE_HALF_W,
  PieceStatus,
  RobotStatusBit,
  type SectionInfo,
} from '@rms/shared';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { RenderEntity } from '../world/EntityStore';
import type { Camera } from './Camera';

/** Atmosphere band thickness (world units) above the surface — the haze the
 *  structure rises into (§1 "fades into the atmosphere"). */
const ATMOSPHERE = 540;
/** Surface motion ticks every this many world units (divides WORLD_WIDTH so the
 *  pattern is seamless across the wrap). */
const TICK_SPACING = 128;

/**
 * Pixi v8 stage. WebGL is forced (§5.3 — ~95% support; don't auto-pick WebGPU).
 * Two layers: a screen-space `backdrop` (sky, atmosphere, surface, stars — the
 * side-scroller aesthetic) behind a camera-transformed `world` of entity sprites.
 * Because the world is a cylinder, every sprite is drawn at the copy of its X
 * nearest the camera, so the wrap seam is invisible. Sprites are batched from a
 * few shared textures; a ParticleContainer is a later optimization once the counts
 * climb.
 */
export class Stage {
  readonly app = new Application();
  private readonly backdrop = new Container();
  private readonly sky = new Graphics();
  private readonly stars = new Graphics();
  private atmosphere!: Sprite;
  private readonly world = new Container();
  private robotTex!: Texture;
  private pieceTex!: Texture;
  private resourceTex!: Texture;
  private cargoTex!: Texture;
  private depositTex!: Texture;
  private flagTex!: Texture;
  private gateTex!: Texture;
  private readonly sprites = new Map<number, Sprite>();
  /** Small "held material" marker shown above a carrying robot. */
  private readonly cargo = new Map<number, Sprite>();
  /** Floating "ZONE n · count/cap" labels above each zone (ring + nested), by id. */
  private readonly labels = new Map<number, Text>();
  /** Enclosure outlines for nested chambers (redrawn each frame; world-space). */
  private readonly zoneRooms = new Graphics();
  private sections: SectionInfo[] = [];
  private myRobotId: number | null = null;
  // World geometry (from the welcome); 0 width disables wrap until we know it.
  private worldWidth = 0;
  private groundY = 896;
  // Camera transform captured each frame for the backdrop + wrap rendering.
  private camX = 0;
  private camY = 0;
  private camScale = 1;
  private readonly starField = makeStars(160);

  async init(mount: HTMLElement): Promise<void> {
    await this.app.init({
      preference: 'webgl',
      antialias: true,
      background: '#080a10', // deep space
      resizeTo: window,
    });
    mount.appendChild(this.app.canvas);
    this.atmosphere = new Sprite(makeAtmosphereTexture());
    this.atmosphere.anchor.set(0, 0);
    this.backdrop.addChild(this.sky, this.atmosphere, this.stars);
    this.app.stage.addChild(this.backdrop, this.world);
    // The chamber outlines sit at the back of the world layer, so robots inside a
    // nested zone render in front of (i.e. within) the room.
    this.world.addChild(this.zoneRooms);
    this.robotTex = this.makeCircleTexture(16);
    this.pieceTex = this.makeSquareTexture(30, 6);
    this.resourceTex = this.makeSquareTexture(34, 8);
    this.cargoTex = this.makeSquareTexture(12, 2);
    this.depositTex = this.makeSquareTexture(26, 4); // rendered as a faceted rock
    this.flagTex = this.makeFlagTexture();
    this.gateTex = this.makeGateTexture();
  }

  /** A gate: a doorway slab standing on the surface (anchored at its base), tinted
   *  by the chamber's full-state. The entrance to a nested zone — tap to enter/leave. */
  private makeGateTexture(): Texture {
    const g = new Graphics();
    g.roundRect(0, 6, 30, 30, 5).fill(0xffffff); // door slab
    g.roundRect(6, 14, 18, 22, 3).fill(0x0a0e14); // dark opening (an archway read)
    const tex = this.app.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  /** A work-flag: a slim pole with a pennant near the top. The texture's pole base
   *  sits at the bottom so the sprite can be anchored to the ground. */
  private makeFlagTexture(): Texture {
    const g = new Graphics();
    g.rect(0, 0, 2.5, 30).fill(0xffffff); // pole
    g.poly([2.5, 1, 18, 6, 2.5, 12]).fill(0xffffff); // pennant
    const tex = this.app.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  get screen(): { w: number; h: number } {
    return { w: this.app.renderer.width, h: this.app.renderer.height };
  }

  /** Adopt the world geometry the server reported in the welcome. */
  setWorld(width: number, groundY: number): void {
    this.worldWidth = width;
    this.groundY = groundY;
  }

  setMyRobot(id: number): void {
    this.myRobotId = id;
  }

  /** Adopt the latest per-section cap/occupancy for the zone labels (§4.4). */
  setSections(sections: SectionInfo[]): void {
    this.sections = sections;
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

  /** Move the camera by transforming the world container (not each sprite) and
   *  refresh the screen-space backdrop to match. */
  applyCamera(cam: Camera): void {
    cam.resize(this.app.renderer.width, this.app.renderer.height);
    this.camX = cam.x;
    this.camY = cam.y;
    this.camScale = cam.scale;
    this.world.scale.set(cam.scale);
    this.world.position.set(
      this.app.renderer.width / 2 - cam.x * cam.scale,
      this.app.renderer.height / 2 - cam.y * cam.scale,
    );
    this.drawBackdrop();
  }

  /** Sky gradient, atmosphere haze, the surface line, motion ticks, and a slow
   *  star parallax — all in screen space, so they're naturally seamless across the
   *  wrap (the horizon is the same everywhere on the planet). */
  private drawBackdrop(): void {
    const w = this.app.renderer.width;
    const h = this.app.renderer.height;
    const scale = this.camScale;
    const groundScreenY = (this.groundY - this.camY) * scale + h / 2;

    // Atmosphere: a haze band sitting just above the surface (world-anchored).
    const atmoTop = (this.groundY - ATMOSPHERE - this.camY) * scale + h / 2;
    const atmoH = ATMOSPHERE * scale;
    this.atmosphere.position.set(0, atmoTop);
    this.atmosphere.width = w;
    this.atmosphere.height = Math.max(0, atmoH);
    this.atmosphere.visible = atmoH > 0 && atmoTop < h && atmoTop + atmoH > 0;

    // Stars in the sky region only, drifting slowly as you walk (parallax).
    const skyBottom = Math.min(groundScreenY, h);
    this.stars.clear();
    if (skyBottom > 0) {
      const drift = mod(this.camX * 0.12, w);
      for (const s of this.starField) {
        const sx = mod(s.x * w - drift, w);
        const sy = s.y * skyBottom;
        this.stars.circle(sx, sy, s.r).fill({ color: 0xcfd8e6, alpha: s.a });
      }
    }

    // Surface: a ground body, a rim-lit horizon line, and ticks that scroll past
    // as the camera pans (the side-scroller motion cue).
    this.sky.clear();
    if (groundScreenY < h) {
      this.sky.rect(0, groundScreenY, w, h - groundScreenY).fill(0x141a24);
      const halfViewW = w / 2 / scale;
      const left = this.camX - halfViewW;
      const startK = Math.floor(left / TICK_SPACING);
      const endK = Math.ceil((this.camX + halfViewW) / TICK_SPACING);
      for (let k = startK; k <= endK; k++) {
        const sx = (k * TICK_SPACING - this.camX) * scale + w / 2;
        this.sky.moveTo(sx, groundScreenY).lineTo(sx, groundScreenY + 10);
      }
      this.sky.stroke({ color: 0x223044, width: 1, alpha: 0.7 });
      this.sky
        .moveTo(0, groundScreenY)
        .lineTo(w, groundScreenY)
        .stroke({ color: 0x4a6c8e, width: 2 });
    }
  }

  /** Reconcile the sprite set against the current render entities, drawing each at
   *  the copy of its X nearest the camera (the cylinder seam stays invisible). */
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
      const rx = this.wrapNear(e.x);
      sprite.position.set(rx, e.y);
      this.style(sprite, e, rx);
    }
    for (const [id, sprite] of this.sprites) {
      if (!present.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
        this.dropCargo(id);
      }
    }
    this.drawLabels();
  }

  /** Floating zone labels for every zone (ring sections + nested chambers): a name +
   *  live count/cap, reddening when full. Each label floats at the server-sent anchor
   *  (a nested chamber doesn't sit at a section centre); nested zones also get an
   *  enclosure outline. Labels are counter-scaled to a constant on-screen size and
   *  wrap-positioned like everything else. */
  private drawLabels(): void {
    this.zoneRooms.clear();
    const present = new Set<number>();
    for (const s of this.sections) {
      present.add(s.id);
      let label = this.labels.get(s.id);
      if (!label) {
        label = new Text({
          text: '',
          style: {
            fontFamily: 'ui-monospace, monospace',
            fontSize: 13,
            fill: 0xffffff,
            align: 'center',
            stroke: { color: 0x05070b, width: 4 },
          },
        });
        label.anchor.set(0.5);
        this.world.addChild(label);
        this.labels.set(s.id, label);
      }
      const full = s.cap > 0 && s.count >= s.cap;
      const x = this.wrapNear(s.x);
      if (s.nested) {
        // A nested chamber: draw its enclosure (world-space, so it scales with zoom)
        // and float a distinct label just above it.
        this.drawZoneRoom(x, s.y, full);
        const txt = `◆ VAULT\n${s.count}/${s.cap}${full ? ' FULL' : ''}`;
        if (label.text !== txt) label.text = txt;
        label.tint = full ? 0xff8a5c : 0x9fe0ff;
        label.position.set(x, s.y - NESTED_ZONE_HALF_H - 28);
      } else {
        const txt = `ZONE ${s.id + 1}\n${s.count}/${s.cap || '∞'}${full ? ' FULL' : ''}`;
        if (label.text !== txt) label.text = txt;
        label.tint = full ? 0xff8a5c : 0xbcd2ea; // cheap recolour (no re-render)
        label.position.set(x, s.y);
      }
      label.scale.set(1 / this.camScale); // constant on-screen size at any zoom
    }
    for (const [id, label] of this.labels) {
      if (!present.has(id)) {
        label.destroy();
        this.labels.delete(id);
      }
    }
  }

  /** Draw one nested chamber's enclosure in world space — a soft-filled rounded rect
   *  whose border reddens when the chamber is full. */
  private drawZoneRoom(cx: number, cy: number, full: boolean): void {
    const color = full ? 0xff6b6b : 0x6bd6ff;
    this.zoneRooms
      .roundRect(
        cx - NESTED_ZONE_HALF_W,
        cy - NESTED_ZONE_HALF_H,
        NESTED_ZONE_HALF_W * 2,
        NESTED_ZONE_HALF_H * 2,
        12,
      )
      .fill({ color, alpha: 0.06 })
      .stroke({ color, width: 2, alpha: 0.5 });
  }

  /** The representative of world-X `x` closest to the camera, so an entity near
   *  the seam renders on whichever side the camera is looking at. */
  private wrapNear(x: number): number {
    if (this.worldWidth <= 0) return x;
    return x + Math.round((this.camX - x) / this.worldWidth) * this.worldWidth;
  }

  private texFor(kind: number): Texture {
    if (kind === EntityKind.Piece || kind === EntityKind.WeldPiece) return this.pieceTex;
    if (kind === EntityKind.Resource) return this.resourceTex;
    if (kind === EntityKind.Deposit) return this.depositTex;
    if (kind === EntityKind.Flag) return this.flagTex;
    if (kind === EntityKind.Gate) return this.gateTex;
    return this.robotTex;
  }

  private style(sprite: Sprite, e: RenderEntity, rx: number): void {
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
      case EntityKind.Deposit: {
        // An ore vein, drawn as a faceted rock (a rotated square). Richer veins
        // read bigger + brighter; a tapped-out vein dims until it regenerates.
        const richness = e.status; // 0..DEPOSIT_MAX
        sprite.rotation = Math.PI / 4;
        sprite.tint = richness > 0 ? 0xc8884a : 0x55524a;
        sprite.alpha = richness > 0 ? 0.95 : 0.4;
        sprite.scale.set(0.55 + 0.1 * richness);
        break;
      }
      case EntityKind.Flag: {
        // Anchored to its base so the pole stands on the ground. Your own flag is
        // bright (your robot's green); other players' flags are a muted amber.
        sprite.anchor.set(0.08, 1);
        const mine = e.status === this.myRobotId;
        sprite.tint = mine ? 0x46e3a0 : 0xc9a24e;
        sprite.alpha = mine ? 1 : 0.75;
        sprite.scale.set(1);
        break;
      }
      case EntityKind.Gate: {
        // A nested zone's entrance, standing on the surface (anchored at its base).
        // Cyan when there's room, red when the chamber is full (status === 1).
        sprite.anchor.set(0.5, 1);
        const full = e.status === 1;
        sprite.tint = full ? 0xff6b6b : 0x6bd6ff;
        sprite.alpha = 0.95;
        sprite.scale.set(1);
        break;
      }
      default: {
        const isMe = e.id === this.myRobotId;
        sprite.tint = isMe ? 0x46e3a0 : e.id < 0 ? 0x6b7785 : 0x4a90d9;
        sprite.alpha = 1;
        sprite.scale.set(isMe ? 0.6 : 0.42);
        this.styleCargo(e, rx);
      }
    }
  }

  /** Show/hide the held-material marker above a robot per its Carrying bit. */
  private styleCargo(e: RenderEntity, rx: number): void {
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
    marker.position.set(rx, e.y - 15);
  }

  private dropCargo(id: number): void {
    const marker = this.cargo.get(id);
    if (marker) {
      marker.destroy();
      this.cargo.delete(id);
    }
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}
function makeStars(n: number): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.random(),
      y: Math.random() ** 1.4, // bias toward the upper sky
      r: Math.random() < 0.85 ? 0.8 : 1.4,
      a: 0.25 + Math.random() * 0.5,
    });
  }
  return out;
}

/** A 1×N vertical gradient: transparent at the top → cool haze at the surface. */
function makeAtmosphereTexture(): Texture {
  const hCanvas = 128;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = hCanvas;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, hCanvas);
  grad.addColorStop(0, 'rgba(74, 110, 150, 0)');
  grad.addColorStop(1, 'rgba(74, 110, 150, 0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, hCanvas);
  return Texture.from(canvas);
}
