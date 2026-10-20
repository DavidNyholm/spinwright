import { Container, Graphics, Rectangle, Text } from "pixi.js";
import type { Renderer, Texture } from "pixi.js";
import type { SymbolId } from "../engine/index.ts";

/**
 * Placeholder look for the classic game's symbols, drawn with vector shapes so the project needs no
 * art files. A different theme is a different set of textures: the reels only ask for a Texture per
 * symbol id, so nothing else changes.
 */

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const TILE_FILL = 0x151933;
/** Textures are drawn at this multiple of stage size so they stay sharp on high-density screens. */
const TEXTURE_RESOLUTION = 2;

type Look =
  | { kind: "letter"; text: string; color: number }
  | { kind: "gem" | "star" | "seven" | "wild" | "scatter"; color: number };

const LOOKS: Readonly<Record<SymbolId, Look>> = {
  L1: { kind: "letter", text: "9", color: 0x4fc3f7 },
  L2: { kind: "letter", text: "10", color: 0x81c784 },
  L3: { kind: "letter", text: "J", color: 0xba68c8 },
  L4: { kind: "letter", text: "Q", color: 0xffb74d },
  L5: { kind: "letter", text: "K", color: 0xf06292 },
  L6: { kind: "letter", text: "A", color: 0xe57373 },
  H1: { kind: "gem", color: 0x7e57c2 },
  H2: { kind: "star", color: 0xffa726 },
  H3: { kind: "seven", color: 0xff5252 },
  W: { kind: "wild", color: 0xffc107 },
  S: { kind: "scatter", color: 0xd81b60 },
};

const NAMES: Readonly<Record<SymbolId, string>> = {
  L1: "Nine",
  L2: "Ten",
  L3: "Jack",
  L4: "Queen",
  L5: "King",
  L6: "Ace",
  H1: "Gem",
  H2: "Star",
  H3: "Seven",
  W: "Wild",
  S: "Scatter",
};

/** A readable name for a symbol, for screen readers and messages. */
export function symbolName(symbol: SymbolId): string {
  return NAMES[symbol] ?? symbol;
}

function lighten(color: number, amount: number): number {
  const channel = (shift: number) => {
    const value = (color >> shift) & 0xff;
    return Math.round(value + (255 - value) * amount);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function polygon(radius: number, sides: number, rotation: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  return points;
}

function label(text: string, size: number, fill: number, strokeColor: number, strokeWidth: number, italic = false): Text {
  const result = new Text({
    text,
    style: {
      fontFamily: FONT,
      fontSize: size,
      fontWeight: "800",
      fontStyle: italic ? "italic" : "normal",
      fill,
      stroke: { color: strokeColor, width: strokeWidth, join: "round" },
      align: "center",
    },
  });
  result.anchor.set(0.5);
  return result;
}

function drawGlyph(look: Look | undefined, symbol: SymbolId): Container {
  const glyph = new Container();
  if (look === undefined) {
    glyph.addChild(label(symbol, 52, 0xb0bec5, 0x0b0d1a, 6));
    return glyph;
  }
  switch (look.kind) {
    case "letter":
      glyph.addChild(label(look.text, 92, look.color, 0x0b0d1a, 8));
      break;
    case "gem": {
      glyph.addChild(
        new Graphics().poly(polygon(58, 6, Math.PI / 6)).fill(look.color).stroke({ width: 5, color: lighten(look.color, 0.55) }),
        new Graphics().poly(polygon(34, 6, Math.PI / 6)).fill(lighten(look.color, 0.35)),
        new Graphics().poly([-30, -22, -6, -42, 8, -26, -14, -8]).fill({ color: 0xffffff, alpha: 0.55 }),
      );
      break;
    }
    case "star":
      glyph.addChild(
        new Graphics().star(0, 4, 5, 62, 28, -Math.PI / 2).fill(look.color).stroke({ width: 5, color: lighten(look.color, 0.6) }),
        new Graphics().star(0, 4, 5, 30, 14, -Math.PI / 2).fill({ color: 0xffffff, alpha: 0.35 }),
      );
      break;
    case "seven":
      glyph.addChild(label("7", 112, 0xffd54f, 0xb71c1c, 10, true));
      break;
    case "wild":
      glyph.addChild(
        new Graphics().star(0, 0, 12, 68, 54, 0).fill(lighten(look.color, 0.55)),
        new Graphics().circle(0, 0, 50).fill(look.color).stroke({ width: 5, color: 0xff6f00 }),
        label("WILD", 29, 0x3e2723, 0xfff8e1, 3),
      );
      break;
    case "scatter":
      glyph.addChild(
        new Graphics().star(0, 0, 10, 70, 50, 0).fill(look.color).stroke({ width: 4, color: 0xff80ab }),
        new Graphics().circle(0, 0, 38).fill(0x311b92).stroke({ width: 3, color: 0xb388ff }),
        new Graphics().roundRect(-60, -15, 120, 30, 8).fill({ color: 0x0b0d1a, alpha: 0.9 }),
        label("SCATTER", 19, 0xffffff, 0x000000, 2),
      );
      break;
  }
  return glyph;
}

function drawSymbol(symbol: SymbolId, width: number, height: number): Container {
  const look = LOOKS[symbol];
  const edge = look?.color ?? 0x546e7a;
  const root = new Container();
  root.addChild(
    new Graphics().roundRect(4, 4, width - 8, height - 8, 18).fill(TILE_FILL).stroke({ width: 3, color: edge, alpha: 0.55 }),
    new Graphics().roundRect(9, 9, width - 18, (height - 18) * 0.42, 14).fill({ color: 0xffffff, alpha: 0.05 }),
  );
  const glyph = drawGlyph(look, symbol);
  glyph.position.set(width / 2, height / 2);
  root.addChild(glyph);
  return root;
}

/** One texture per symbol, each exactly `width` x `height` stage units. */
export function createSymbolTextures(
  renderer: Renderer,
  symbols: Iterable<SymbolId>,
  width: number,
  height: number,
): Map<SymbolId, Texture> {
  const textures = new Map<SymbolId, Texture>();
  for (const symbol of symbols) {
    if (textures.has(symbol)) continue;
    const drawing = drawSymbol(symbol, width, height);
    textures.set(
      symbol,
      renderer.generateTexture({ target: drawing, frame: new Rectangle(0, 0, width, height), resolution: TEXTURE_RESOLUTION }),
    );
    drawing.destroy({ children: true });
  }
  return textures;
}
