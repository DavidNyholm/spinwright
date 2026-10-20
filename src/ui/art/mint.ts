import { Container, Graphics } from "pixi.js";
import type { SymbolId } from "../../engine/index.ts";
import { plateFrame, tile } from "./clockwork.ts";
import { engravedText, group, METALS, metalGradient, rivet, verticalGradient } from "./metal.ts";
import type { Metal } from "./metal.ts";
import { PALETTE } from "./palette.ts";

/**
 * Artwork for "Mint", the third machine: stamped suit plates for the low symbols, small treasures for
 * the high ones, and the coin. Everything is drawn from shapes, so there are no image files.
 */

export const MINT_NAMES: Readonly<Record<SymbolId, string>> = {
  L1: "Spade",
  L2: "Club",
  L3: "Heart",
  L4: "Diamond",
  H1: "Ingots",
  H2: "Crown",
  H3: "Vault",
  C: "Coin",
};

const PLATES: Readonly<Record<string, Metal>> = {
  L1: METALS.iron,
  L2: METALS.verdigris,
  L3: METALS.rust,
  L4: METALS.brass,
};

/** The four suits, each centred on the origin and about sixty units across. */
function suitPath(symbol: string): Graphics {
  const path = new Graphics();
  switch (symbol) {
    case "L1": // spade: a heart turned over, on a flared stem
      path
        .moveTo(0, -32)
        .bezierCurveTo(-54, 4, -36, 42, 0, 18)
        .bezierCurveTo(36, 42, 54, 4, 0, -32)
        .closePath()
        .poly([-14, 40, -4, 12, 4, 12, 14, 40]);
      break;
    case "L2": // club: three round leaves on a flared stem
      path
        .circle(0, -17, 16)
        .circle(-19, 10, 16)
        .circle(19, 10, 16)
        .circle(0, 2, 13)
        .poly([-14, 40, -4, 10, 4, 10, 14, 40]);
      break;
    case "L3": // heart
      path
        .moveTo(0, 32)
        .bezierCurveTo(-56, -4, -36, -44, 0, -16)
        .bezierCurveTo(36, -44, 56, -4, 0, 32)
        .closePath();
      break;
    default: // diamond
      path.poly([0, -38, 27, 0, 0, 38, -27, 0]);
  }
  return path;
}

function suitPlate(width: number, height: number, symbol: string, metal: Metal): Container {
  const container = plateFrame(width, height, metal);
  // Two passes, so overlapping shapes (the club's leaves) show one outline round the whole: a thick stroke in
  // the edge colour underneath, then the gradient fill on top with no stroke of its own.
  const outline = suitPath(symbol).fill(metal.edge).stroke({ width: 7, color: metal.edge, join: "round" });
  const body = suitPath(symbol).fill(verticalGradient([0, metal.light], [1, metal.mid]));
  for (const part of [outline, body]) part.position.set(width / 2, height / 2 + 2);
  container.addChild(outline, body);
  return container;
}

/** A pyramid of three gold bars. */
function ingots(): Container {
  const gold = METALS.gold;
  const bar = (cx: number, cy: number): Container => {
    const w = 70;
    const h = 30;
    const top = new Graphics()
      .poly([cx - w / 2 + 9, cy - h / 2, cx + w / 2 - 9, cy - h / 2, cx + w / 2 - 17, cy - h / 2 - 12, cx - w / 2 + 17, cy - h / 2 - 12])
      .fill(verticalGradient([0, 0xfff7cf], [1, gold.light]))
      .stroke({ width: 2, color: gold.edge, join: "round" });
    const front = new Graphics()
      .poly([cx - w / 2 + 9, cy - h / 2, cx + w / 2 - 9, cy - h / 2, cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2])
      .fill(metalGradient(gold))
      .stroke({ width: 2.5, color: gold.edge, join: "round" });
    const stamp = new Graphics().roundRect(cx - 15, cy - 5, 30, 11, 3).stroke({ width: 2, color: gold.dark, alpha: 0.8 });
    const gleam = new Graphics().moveTo(cx - w / 2 + 13, cy - h / 2 + 5).lineTo(cx - 4, cy - h / 2 + 5).stroke({ width: 2.5, color: 0xffffff, alpha: 0.5, cap: "round" });
    return group(top, front, stamp, gleam);
  };
  const container = group(bar(-37, 30), bar(37, 30), bar(0, -4));
  container.position.set(0, 12);
  return container;
}

function crown(): Container {
  const gold = METALS.gold;
  const gem = (x: number, y: number, radius: number, color: number): Graphics =>
    new Graphics()
      .circle(x, y, radius)
      .fill(color)
      .stroke({ width: 1.5, color: gold.edge })
      .circle(x - radius * 0.3, y - radius * 0.35, radius * 0.3)
      .fill({ color: 0xffffff, alpha: 0.7 });
  const container = group(
    new Graphics()
      .poly([-50, 16, -58, -26, -28, -4, 0, -40, 28, -4, 58, -26, 50, 16])
      .fill(metalGradient(gold))
      .stroke({ width: 3, color: gold.edge, join: "round" }),
    new Graphics().roundRect(-54, 12, 108, 24, 6).fill(verticalGradient([0, gold.mid], [1, gold.dark])).stroke({ width: 3, color: gold.edge }),
    new Graphics().moveTo(-34, -2).lineTo(-26, 12).moveTo(34, -2).lineTo(26, 12).moveTo(0, -26).lineTo(0, 12).stroke({ width: 2, color: gold.dark, alpha: 0.6 }),
    gem(-58, -30, 7, 0xe0463a),
    gem(0, -44, 8, 0x4fd0e0),
    gem(58, -30, 7, 0xe0463a),
    gem(-30, 24, 5.5, 0x4fd0e0),
    gem(0, 24, 6.5, 0xe0463a),
    gem(30, 24, 5.5, 0x4fd0e0),
    new Graphics().moveTo(-42, 4).lineTo(-36, -12).stroke({ width: 3, color: 0xffffff, alpha: 0.4, cap: "round" }),
  );
  container.position.set(0, 4);
  return container;
}

/** A round vault door: a ring of bolts, and a wheel with six spokes. */
function vault(): Container {
  const steel = METALS.steel;
  const radius = 54;
  const container = group(
    new Graphics().circle(0, 0, radius).fill(metalGradient(steel)).stroke({ width: 3.5, color: steel.edge }),
    new Graphics().circle(0, 0, radius - 6).stroke({ width: 2, color: steel.light, alpha: 0.6 }),
    new Graphics().circle(0, 0, radius - 15).fill(verticalGradient([0, steel.dark], [1, steel.mid])).stroke({ width: 2.5, color: steel.edge }),
  );
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    container.addChild(rivet(Math.cos(angle) * (radius - 10), Math.sin(angle) * (radius - 10), 3.4, steel));
  }
  // Three lines through the centre make six spokes: a dark wide stroke, then a bright narrow one on top.
  const spokes = (): Graphics => {
    const lines = new Graphics();
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 2;
      lines.moveTo(-Math.cos(angle) * 36, -Math.sin(angle) * 36).lineTo(Math.cos(angle) * 36, Math.sin(angle) * 36);
    }
    return lines;
  };
  container.addChild(spokes().stroke({ width: 9, color: steel.edge, cap: "round" }), spokes().stroke({ width: 5, color: steel.light, cap: "round" }));
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 - Math.PI / 2;
    container.addChild(rivet(Math.cos(angle) * 36, Math.sin(angle) * 36, 6, METALS.brass));
  }
  container.addChild(
    new Graphics().circle(0, 0, 13).fill(metalGradient(METALS.brass)).stroke({ width: 2.5, color: METALS.brass.edge }),
    new Graphics().circle(0, 0, 4.5).fill(METALS.brass.edge),
    new Graphics().arc(0, 0, radius - 3, Math.PI * 1.05, Math.PI * 1.4).stroke({ width: 4, color: 0xffffff, alpha: 0.3, cap: "round" }),
  );
  container.position.set(0, 2);
  return container;
}

/** The points of a star centred on the origin. */
function starPoints(outer: number, inner: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  return points;
}

/** A coin lying flat: a milled rim, a sunk face and a highlight. */
export function coinDisc(radius: number, metal: Metal): Container {
  const container = group(
    new Graphics().circle(2.5, 4, radius).fill({ color: 0x000000, alpha: 0.4 }),
    new Graphics().circle(0, 0, radius).fill(metalGradient(metal)).stroke({ width: 3, color: metal.edge }),
  );
  const milling = new Graphics();
  for (let i = 0; i < 36; i++) {
    const angle = (i * 2 * Math.PI) / 36;
    milling.moveTo(Math.cos(angle) * radius * 0.88, Math.sin(angle) * radius * 0.88).lineTo(Math.cos(angle) * radius * 0.97, Math.sin(angle) * radius * 0.97);
  }
  container.addChild(
    milling.stroke({ width: 1.6, color: metal.edge, alpha: 0.5 }),
    new Graphics().circle(0, 0, radius * 0.8).fill(verticalGradient([0, metal.dark], [1, metal.mid])).stroke({ width: 2, color: metal.edge }),
    new Graphics().circle(0, 0, radius * 0.76).stroke({ width: 1.5, color: metal.light, alpha: 0.55 }),
    new Graphics().arc(0, 0, radius * 0.93, Math.PI * 1.08, Math.PI * 1.42).stroke({ width: 3.5, color: 0xffffff, alpha: 0.32, cap: "round" }),
  );
  return container;
}

/** A coin face-down: a star stamped on the sunk face, with no value showing yet. */
export function coinBack(radius: number, metal: Metal): Container {
  const container = coinDisc(radius, metal);
  container.addChild(
    new Graphics().poly(starPoints(radius * 0.52, radius * 0.22)).fill(verticalGradient([0, metal.light], [1, metal.mid])).stroke({ width: 2.5, color: metal.edge, join: "round" }),
  );
  return container;
}

/** A coin face-up, showing what it is worth: one or two lines of engraved text. */
export function coinFront(radius: number, metal: Metal, lines: readonly { readonly text: string; readonly size: number }[]): Container {
  const container = coinDisc(radius, metal);
  const total = lines.reduce((sum, line) => sum + line.size, 0);
  let top = -total / 2;
  for (const line of lines) {
    const text = engravedText(line.text, line.size, metal.light, metal.edge, Math.max(3, line.size / 7));
    text.position.set(0, top + line.size / 2 + 2);
    container.addChild(text);
    top += line.size;
  }
  return container;
}

/** The metal of a coin: brass for the ordinary ones, then copper, silver and gold for the jackpots by rank. */
export function coinMetal(jackpotRank: number | null): Metal {
  if (jackpotRank === null) return METALS.brass;
  return [METALS.copper, METALS.steel, METALS.gold][Math.min(jackpotRank, 2)]!;
}

/** The bonus symbol on the reels: a gold coin with a star, labelled so nobody has to guess what it does. */
function coinSymbol(): Container {
  const gold = METALS.gold;
  const container = new Container();
  for (const [radius, alpha] of [
    [76, 0.06],
    [68, 0.09],
    [60, 0.12],
  ] as const) {
    container.addChild(new Graphics().circle(0, -8, radius).fill({ color: PALETTE.amber, alpha }));
  }
  const coin = coinBack(47, gold);
  coin.position.set(0, -10);
  const label = group(new Graphics().roundRect(-40, 34, 80, 24, 5).fill(metalGradient(METALS.brass)).stroke({ width: 2.5, color: METALS.brass.edge }));
  const labelText = engravedText("COIN", 22, 0x2a1c05, 0x2a1c05, 0, 3);
  labelText.position.set(0, 46.5);
  container.addChild(coin, label, labelText);
  return container;
}

function glyph(symbol: SymbolId, width: number, height: number): Container {
  const plateMetal = PLATES[symbol];
  if (plateMetal !== undefined) return suitPlate(width, height, symbol, plateMetal);

  let art: Container;
  switch (symbol) {
    case "H1":
      art = ingots();
      break;
    case "H2":
      art = crown();
      break;
    case "H3":
      art = vault();
      break;
    case "C":
      art = coinSymbol();
      break;
    default:
      // A symbol this theme has no art for: show its id so a new game's strips can be checked before art exists.
      art = engravedText(symbol, 48, PALETTE.text, PALETTE.ink, 5);
  }
  art.position.set(width / 2, height / 2);
  return art;
}

export function drawMintSymbol(symbol: SymbolId, width: number, height: number): Container {
  return group(tile(width, height), glyph(symbol, width, height));
}
