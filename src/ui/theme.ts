import { Rectangle } from "pixi.js";
import type { Container, Renderer, Texture } from "pixi.js";
import type { SymbolId } from "../engine/index.ts";
import { CLOCKWORK_NAMES, drawClockworkSymbol } from "./art/clockwork.ts";

/**
 * A theme is the look of a game's symbols. The reels only ask for one Texture per symbol id, so a
 * different theme (or a different game) is just a different SymbolTheme: nothing else changes.
 */
export interface SymbolTheme {
  readonly id: string;
  /** A readable name for a symbol, for screen readers and messages. */
  name(symbol: SymbolId): string;
  draw(symbol: SymbolId, width: number, height: number): Container;
}

export const CLOCKWORK: SymbolTheme = {
  id: "clockwork",
  name: (symbol) => CLOCKWORK_NAMES[symbol] ?? symbol,
  draw: drawClockworkSymbol,
};

/** Textures are drawn at this multiple of stage size so they stay sharp on high-density screens. */
const TEXTURE_RESOLUTION = 2;

/** One texture per symbol, each exactly `width` x `height` stage units. */
export function createSymbolTextures(
  renderer: Renderer,
  theme: SymbolTheme,
  symbols: Iterable<SymbolId>,
  width: number,
  height: number,
): Map<SymbolId, Texture> {
  const textures = new Map<SymbolId, Texture>();
  for (const symbol of symbols) {
    if (textures.has(symbol)) continue;
    const drawing = theme.draw(symbol, width, height);
    textures.set(
      symbol,
      renderer.generateTexture({ target: drawing, frame: new Rectangle(0, 0, width, height), resolution: TEXTURE_RESOLUTION }),
    );
    drawing.destroy({ children: true });
  }
  return textures;
}
