import { Container, Graphics } from "pixi.js";
import type { SymbolId } from "../../engine/index.ts";
import { engravedText, group, mix, verticalGradient } from "./metal.ts";
import { PALETTE } from "./palette.ts";

/**
 * Artwork for "Crucible", the second machine: six cut gems and an ember. Each gem has its own
 * shape as well as its own colour, so they can be told apart without relying on colour alone.
 */

export const FOUNDRY_NAMES: Readonly<Record<SymbolId, string>> = {
  G1: "Amber",
  G2: "Jade",
  G3: "Sapphire",
  G4: "Amethyst",
  G5: "Ruby",
  G6: "Diamond",
  E: "Ember",
};

type Outline = readonly number[];

const regular = (sides: number, radius: number, rotation: number): number[] =>
  Array.from({ length: sides }, (_, i) => {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }).flat();

/** Outlines are centred on the origin and about 40 units out; every outline has 6 to 12 corners. */
const OUTLINES: Readonly<Record<string, Outline>> = {
  // A hexagon with a point at the top.
  G1: regular(6, 41, -Math.PI / 2),
  // A round brilliant, as a twelve-sided cut.
  G2: regular(12, 40, 0),
  // A cushion: a square with its corners shaved off.
  G3: [-22, -37, 22, -37, 37, -22, 37, 22, 22, 37, -22, 37, -37, 22, -37, -22],
  // A marquise: tall, pointed top and bottom.
  G4: [0, -46, 22, -26, 28, 0, 22, 26, 0, 46, -22, 26, -28, 0, -22, -26],
  // A trillion: a rounded triangle.
  G5: [0, -42, 20, -22, 40, 26, 22, 36, -22, 36, -40, 26, -20, -22],
  // A classic diamond: flat top, wide shoulders, point below.
  G6: [-24, -34, 24, -34, 42, -10, 0, 44, -42, -10],
};

const COLORS: Readonly<Record<string, number>> = {
  G1: 0xf2a33a,
  G2: 0x3fcf8e,
  G3: 0x3d7bf0,
  G4: 0xa35cf0,
  G5: 0xe8334f,
  G6: 0xcdf3ff,
};

function sparkle(x: number, y: number, size: number): Graphics {
  return new Graphics()
    .moveTo(x - size, y)
    .lineTo(x + size, y)
    .moveTo(x, y - size)
    .lineTo(x, y + size)
    .stroke({ width: 2, color: 0xffffff, alpha: 0.9, cap: "round" })
    .circle(x, y, size * 0.35)
    .fill({ color: 0xffffff, alpha: 0.95 });
}

/** A cut stone: a gradient body, alternating light and dark facets, a lit table and a glint. */
function gem(outline: Outline, color: number): Container {
  const corners = outline.length / 2;
  const table = outline.map((v) => v * 0.5);
  const container = new Container();
  container.addChild(
    new Graphics().circle(0, 0, 50).fill({ color, alpha: 0.1 }),
    new Graphics()
      .poly([...outline])
      .fill(verticalGradient([0, mix(color, 0xffffff, 0.45)], [0.5, color], [1, mix(color, 0x000000, 0.55)]))
      .stroke({ width: 3, color: mix(color, 0x000000, 0.65), join: "round" }),
  );
  for (let i = 0; i < corners; i++) {
    const j = (i + 1) % corners;
    container.addChild(
      new Graphics()
        .poly([outline[2 * i]!, outline[2 * i + 1]!, outline[2 * j]!, outline[2 * j + 1]!, table[2 * j]!, table[2 * j + 1]!, table[2 * i]!, table[2 * i + 1]!])
        .fill(i % 2 === 0 ? { color: 0xffffff, alpha: 0.18 } : { color: 0x000000, alpha: 0.2 })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.14 }),
    );
  }
  container.addChild(
    new Graphics()
      .poly(table)
      .fill({ color: mix(color, 0xffffff, 0.55), alpha: 0.5 })
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.4 }),
    sparkle(-14, -18, 7),
  );
  return container;
}

/** The scatter: a glowing coal with tall flames in front, so it stands out on a busy board. */
function ember(): Container {
  const container = new Container();
  for (const [radius, alpha] of [
    [64, 0.1],
    [54, 0.14],
    [44, 0.2],
  ] as const) {
    container.addChild(new Graphics().circle(0, 0, radius).fill({ color: 0xff7a1a, alpha }));
  }
  const flame = (points: number[], inner: number, outer: number) =>
    new Graphics().poly(points).fill(verticalGradient([0, outer], [1, inner]));
  container.addChild(
    new Graphics()
      .poly([-31, 12, -21, 1, -4, -2, 15, 0, 29, 10, 33, 27, 18, 37, -4, 40, -25, 35, -33, 24])
      .fill(verticalGradient([0, 0x8a3a1a], [0.5, 0x3d1b10], [1, 0x1a0c07]))
      .stroke({ width: 3, color: 0x120704, join: "round" }),
    new Graphics()
      .moveTo(-22, 20)
      .lineTo(-6, 12)
      .lineTo(4, 27)
      .lineTo(22, 18)
      .stroke({ width: 3.5, color: 0xff8a1a, cap: "round", join: "round" })
      .moveTo(-12, 33)
      .lineTo(2, 27)
      .stroke({ width: 2.5, color: 0xffc060, cap: "round" }),
    flame([-24, 12, -16, -16, -8, 0, -3, -34, 5, -10, 11, -28, 17, -8, 26, 12], 0xff5a00, 0xffd27a),
    flame([-12, 12, -6, -6, -1, -18, 6, -2, 13, 12], 0xffa000, 0xfff6cc),
    sparkle(22, -22, 6),
  );
  const label = engravedText("EMBER", 17, PALETTE.amberHot, 0x1a0c07, 4, 2);
  label.position.set(0, 50);
  container.addChild(label);
  return container;
}

function tile(width: number, height: number, tint: number): Container {
  return group(
    new Graphics().roundRect(3, 3, width - 6, height - 6, 14).fill(verticalGradient([0, 0x1e1812], [1, 0x0f0c09])),
    new Graphics().roundRect(3, 3, width - 6, height - 6, 14).stroke({ width: 1.5, color: tint, alpha: 0.28 }),
  );
}

export function drawFoundrySymbol(symbol: SymbolId, width: number, height: number): Container {
  const outline = OUTLINES[symbol];
  const color = COLORS[symbol];
  let art: Container;
  let tint: number = PALETTE.brassDark;
  if (outline !== undefined && color !== undefined) {
    art = gem(outline, color);
    tint = color;
  } else if (symbol === "E") {
    art = ember();
    tint = 0xff7a1a;
  } else {
    art = engravedText(symbol, 40, PALETTE.text, PALETTE.ink, 5);
  }
  // Scale the 100-unit drawing to fit the cell with a margin.
  const fit = (Math.min(width, height) - 18) / 96;
  art.scale.set(fit);
  art.position.set(width / 2, height / 2 - (symbol === "E" ? 2 : 0));
  return group(tile(width, height, tint), art);
}
