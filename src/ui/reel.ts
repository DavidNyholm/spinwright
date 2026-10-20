import { BlurFilter, Container, Graphics, Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
import type { SymbolId } from "../engine/index.ts";

const mod = (n: number, m: number): number => ((n % m) + m) % m;
/** Below this blur strength the filter is removed entirely; it costs a render pass. */
const MIN_BLUR = 0.5;

export interface ReelGeometry {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly rows: number;
}

/**
 * One reel: a looping strip scrolled past a window of `rows` cells.
 *
 * `position` is a continuous index into the strip for the symbol at the top of the window, and it
 * counts down as the reel spins, so symbols travel downward. Symbol `i` sits at
 * y = (i - position) * cellHeight, which means an integer position shows exactly
 * strip[position .. position + rows - 1], the same window the engine resolves for that stop.
 */
export class ReelView {
  readonly container = new Container();
  #strip: readonly SymbolId[];
  readonly #textures: ReadonlyMap<SymbolId, Texture>;
  readonly #geometry: ReelGeometry;
  /** One sprite per window row, plus one for the cell sliding in at the bottom. */
  readonly #sprites: Sprite[] = [];
  readonly #symbolByTexture = new Map<Texture, SymbolId>();
  readonly #belt = new Container();
  #blur: BlurFilter | null = null;
  #position = 0;
  /** Added to strip indices, so a spinning reel can be re-aligned to land on a chosen stop. */
  #shift = 0;
  #base = Number.NaN;

  constructor(strip: readonly SymbolId[], textures: ReadonlyMap<SymbolId, Texture>, geometry: ReelGeometry) {
    this.#strip = strip;
    this.#textures = textures;
    this.#geometry = geometry;
    for (const [symbol, texture] of textures) this.#symbolByTexture.set(texture, symbol);

    // Symbol textures are generated at exactly cell size, so sprites need no scaling.
    for (let i = 0; i <= geometry.rows; i++) {
      const sprite = new Sprite();
      this.#sprites.push(sprite);
      this.#belt.addChild(sprite);
    }

    const window = new Graphics().rect(0, 0, geometry.cellWidth, geometry.rows * geometry.cellHeight).fill(0xffffff);
    this.#belt.mask = window;
    this.container.addChild(this.#belt, window);
    this.setPosition(0);
  }

  get position(): number {
    return this.#position;
  }

  setPosition(position: number): void {
    const base = Math.floor(position);
    if (base !== this.#base) {
      this.#base = base;
      this.#retexture();
    }
    this.#position = position;
    for (let k = 0; k < this.#sprites.length; k++) {
      this.#sprites[k]!.y = (base + k - position) * this.#geometry.cellHeight;
    }
  }

  /**
   * Reads from a different strip from now on (the free spins have their own). Meant to be called as a
   * spin begins: the symbols in view are re-read from the new strip at once, which at that moment is hidden by the blur.
   */
  setStrip(strip: readonly SymbolId[]): void {
    this.#strip = strip;
    this.#base = Number.NaN;
    this.setPosition(this.#position);
  }

  /** Shifts which strip symbol sits at each index; the picture changes at once. */
  setShift(shift: number): void {
    this.#shift = mod(shift, this.#strip.length);
    this.#base = Number.NaN;
    this.setPosition(this.#position);
  }

  /** Shows the window for `stop`, at rest. Also resets the position and shift so they never grow unbounded. */
  showStop(stop: number): void {
    this.#shift = 0;
    this.#base = Number.NaN;
    this.setPosition(stop);
  }

  /**
   * What each window row is showing, read back from the sprites' textures, and whether every row sits
   * exactly on its cell. For QA: it checks the drawn picture rather than the reel's own bookkeeping.
   */
  shown(): { symbols: SymbolId[]; aligned: boolean } {
    const symbols: SymbolId[] = [];
    let aligned = true;
    for (let row = 0; row < this.#geometry.rows; row++) {
      const sprite = this.#sprites[row]!;
      symbols.push(this.#symbolByTexture.get(sprite.texture) ?? "?");
      if (sprite.y !== row * this.#geometry.cellHeight) aligned = false;
    }
    return { symbols, aligned };
  }

  /** The sprite in window row `row`. Only meaningful while the reel is at rest on an integer position. */
  cellSprite(row: number): Sprite {
    return this.#sprites[row]!;
  }

  setCellAlpha(row: number, alpha: number): void {
    this.#sprites[row]!.alpha = alpha;
  }

  resetCellAlpha(): void {
    for (const sprite of this.#sprites) sprite.alpha = 1;
  }

  setBlur(strength: number): void {
    if (strength < MIN_BLUR) {
      if (this.#blur !== null) this.#belt.filters = [];
      this.#blur = null;
      return;
    }
    if (this.#blur === null) {
      this.#blur = new BlurFilter({ strengthX: 0, strengthY: strength, quality: 2 });
      this.#belt.filters = [this.#blur];
    } else {
      this.#blur.strengthY = strength;
    }
  }

  #retexture(): void {
    const length = this.#strip.length;
    for (let k = 0; k < this.#sprites.length; k++) {
      const symbol = this.#strip[mod(this.#base + k + this.#shift, length)]!;
      const texture = this.#textures.get(symbol);
      if (texture === undefined) throw new Error(`No texture for symbol "${symbol}"`);
      this.#sprites[k]!.texture = texture;
    }
  }
}
