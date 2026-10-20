import { Container, Graphics } from "pixi.js";
import type { SymbolId } from "../../engine/index.ts";
import { engravedText, gearOutline, group, METALS, metalGradient, rivet, verticalGradient } from "./metal.ts";
import type { Metal } from "./metal.ts";
import { PALETTE } from "./palette.ts";

/**
 * Artwork for "Clockwork", the first machine: engraved metal plates for the low symbols and small
 * mechanisms for the high ones. Everything is drawn from shapes, so there are no image files.
 */

export const CLOCKWORK_NAMES: Readonly<Record<SymbolId, string>> = {
  L1: "Nine",
  L2: "Ten",
  L3: "Jack",
  L4: "Queen",
  L5: "King",
  L6: "Ace",
  H1: "Gear",
  H2: "Key",
  H3: "Watch",
  W: "Wild",
  S: "Scatter",
};

const PLATES: Readonly<Record<string, { text: string; metal: Metal }>> = {
  L1: { text: "9", metal: METALS.iron },
  L2: { text: "10", metal: METALS.verdigris },
  L3: { text: "J", metal: METALS.brass },
  L4: { text: "Q", metal: METALS.copper },
  L5: { text: "K", metal: METALS.rust },
  L6: { text: "A", metal: METALS.steel },
};

const RECESS = verticalGradient([0, 0x0f0c09], [1, 0x1d1712]);

/** The cell behind a symbol: barely there, so the symbol sits straight on the dark reel window. */
export function tile(width: number, height: number): Container {
  return group(
    new Graphics().roundRect(3, 3, width - 6, height - 6, 14).fill(verticalGradient([0, 0x1a1510], [1, 0x0f0c09])),
    new Graphics().roundRect(3, 3, width - 6, height - 6, 14).stroke({ width: 1, color: PALETTE.brassLight, alpha: 0.07 }),
  );
}

/** A riveted metal plate with a dark recess in the middle, ready for something to be engraved on it. */
export function plateFrame(width: number, height: number, metal: Metal): Container {
  const x = 11;
  const y = 11;
  const plateWidth = width - 22;
  const plateHeight = height - 22;
  const container = group(
    new Graphics().roundRect(x, y, plateWidth, plateHeight, 12).fill(metalGradient(metal)).stroke({ width: 3, color: metal.edge }),
    new Graphics().roundRect(x + 2, y + 2, plateWidth - 4, plateHeight - 4, 10).stroke({ width: 2, color: metal.light, alpha: 0.5 }),
    new Graphics()
      .roundRect(x + 13, y + 13, plateWidth - 26, plateHeight - 26, 7)
      .fill(RECESS)
      .stroke({ width: 2, color: metal.edge }),
  );
  for (const [cx, cy] of [
    [x + 8, y + 8],
    [x + plateWidth - 8, y + 8],
    [x + 8, y + plateHeight - 8],
    [x + plateWidth - 8, y + plateHeight - 8],
  ] as const) {
    container.addChild(rivet(cx, cy, 3.6, metal));
  }
  return container;
}

/** A riveted metal plate with the letter engraved on a dark recess. */
function plate(width: number, height: number, text: string, metal: Metal): Container {
  const container = plateFrame(width, height, metal);
  const letter = engravedText(text, text.length > 1 ? 80 : 98, metal.light, metal.edge, 5);
  letter.position.set(width / 2, height / 2 + 3);
  container.addChild(letter);
  return container;
}

function gear(outer: number, teeth: number, metal: Metal): Container {
  const inner = outer * 0.82;
  const container = group(
    new Graphics().poly(gearOutline(teeth, inner, outer, -Math.PI / 2)).fill(metalGradient(metal)).stroke({ width: 3, color: metal.edge, join: "round" }),
    new Graphics().circle(0, 0, inner * 0.8).stroke({ width: 3, color: metal.dark }),
    new Graphics().circle(0, 0, inner * 0.62).fill(verticalGradient([0, metal.dark], [1, metal.mid])).stroke({ width: 2, color: metal.edge }),
  );
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    container.addChild(
      new Graphics()
        .circle(Math.cos(angle) * inner * 0.4, Math.sin(angle) * inner * 0.4, inner * 0.12)
        .fill(0x0f0c09)
        .stroke({ width: 1.5, color: metal.light, alpha: 0.5 }),
    );
  }
  container.addChild(
    new Graphics().circle(0, 0, inner * 0.2).fill(metalGradient(metal)).stroke({ width: 2, color: metal.edge }),
    new Graphics().circle(0, 0, inner * 0.07).fill(metal.edge),
    new Graphics().arc(0, 0, outer * 0.9, Math.PI * 1.05, Math.PI * 1.45).stroke({ width: 3, color: 0xffffff, alpha: 0.35, cap: "round" }),
  );
  return container;
}

function skeletonKey(): Container {
  const steel = METALS.steel;
  const piece = (graphics: Graphics) => graphics.fill(metalGradient(steel)).stroke({ width: 2.5, color: steel.edge, join: 'round' });
  const container = group(
    // Shaft, two collars, and a two-tooth bit.
    piece(new Graphics().roundRect(-6.5, -22, 13, 84, 3)),
    piece(new Graphics().roundRect(-11, -14, 22, 8, 2)),
    piece(new Graphics().roundRect(-11, 0, 22, 8, 2)),
    piece(new Graphics().rect(6.5, 38, 26, 10)),
    piece(new Graphics().rect(6.5, 52, 17, 10)),
    // The bow: a ring with a bevelled inner edge.
    piece(new Graphics().circle(0, -46, 25)),
    new Graphics().circle(0, -46, 19).stroke({ width: 2, color: steel.light, alpha: 0.7 }),
    new Graphics().circle(0, -46, 11.5).fill(0x0f0c09).stroke({ width: 2.5, color: steel.edge }),
    new Graphics().moveTo(-2.5, -20).lineTo(-2.5, 56).stroke({ width: 2, color: 0xffffff, alpha: 0.45, cap: 'round' }),
  );
  container.rotation = -0.62;
  container.scale.set(0.95);
  container.position.set(8, 4);
  return container;
}

function pocketWatch(): Container {
  const gold = METALS.gold;
  const radius = 50;
  const container = group(
    new Graphics().roundRect(-8, -radius - 15, 16, 15, 3).fill(metalGradient(gold)).stroke({ width: 2.5, color: gold.edge }),
    new Graphics().circle(0, -radius - 23, 11).stroke({ width: 5, color: gold.mid }),
    new Graphics().circle(0, -radius - 23, 11).stroke({ width: 1.5, color: gold.edge }),
    new Graphics().circle(0, 0, radius).fill(metalGradient(gold)).stroke({ width: 3, color: gold.edge }),
    new Graphics().circle(0, 0, radius - 6).stroke({ width: 2, color: gold.dark }),
    new Graphics().circle(0, 0, radius - 9).fill(verticalGradient([0, 0xf8f0da], [1, 0xd9ccab])).stroke({ width: 1.5, color: gold.edge }),
  );

  const ticks = new Graphics();
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6 - Math.PI / 2;
    const major = i % 3 === 0;
    const from = radius - (major ? 22 : 18);
    const to = radius - 13;
    ticks.moveTo(Math.cos(angle) * from, Math.sin(angle) * from).lineTo(Math.cos(angle) * to, Math.sin(angle) * to);
  }
  ticks.stroke({ width: 2.2, color: 0x3a2a0e, cap: "round" });

  // Ten past ten, the way watches are always shown.
  const hand = (turns: number, length: number, width: number) => {
    const angle = turns * 2 * Math.PI - Math.PI / 2;
    return new Graphics().moveTo(0, 0).lineTo(Math.cos(angle) * length, Math.sin(angle) * length).stroke({ width, color: 0x2a1c05, cap: "round" });
  };
  container.addChild(
    ticks,
    hand(10 / 12 + 10 / 720, 20, 4.5),
    hand(10 / 60, 30, 3),
    new Graphics().circle(0, 0, 4.5).fill(metalGradient(gold)).stroke({ width: 1.5, color: gold.edge }),
    new Graphics().arc(0, 0, radius - 11, Math.PI * 1.05, Math.PI * 1.5).stroke({ width: 4, color: 0xffffff, alpha: 0.3, cap: "round" }),
  );
  container.position.set(0, 10);
  container.scale.set(0.98);
  return container;
}

/** The wild: a molten brass seal with a W, and a label so nobody has to guess what it does. */
function wildSeal(): Container {
  const molten: Metal = { light: PALETTE.amberHot, mid: 0xe8791a, dark: 0x8a3a05, edge: 0x3a1602 };
  const container = new Container();
  for (const [radius, alpha] of [
    [76, 0.06],
    [68, 0.09],
    [60, 0.12],
  ] as const) {
    container.addChild(new Graphics().circle(0, -8, radius).fill({ color: PALETTE.amber, alpha }));
  }
  const seal = gear(50, 14, molten);
  seal.position.set(0, -8);
  const centre = new Graphics().circle(0, -8, 30).fill(verticalGradient([0, 0x1a0e05], [1, 0x2c1608])).stroke({ width: 2.5, color: molten.edge });
  const w = engravedText("W", 50, PALETTE.amberHot, molten.edge, 4);
  w.position.set(0, -8);
  const label = group(
    new Graphics().roundRect(-44, 36, 88, 24, 5).fill(metalGradient(METALS.brass)).stroke({ width: 2.5, color: METALS.brass.edge }),
  );
  const labelText = engravedText("WILD", 22, 0x2a1c05, 0x2a1c05, 0, 2);
  labelText.position.set(0, 48.5);
  container.addChild(seal, centre, w, label, labelText);
  return container;
}

/** The scatter: a blueprint sheet with a compass drawn on it. */
function blueprint(): Container {
  const sheet = new Container();
  sheet.addChild(
    new Graphics().roundRect(-52, -40, 104, 76, 4).fill(verticalGradient([0, 0x2a86c0], [1, 0x14527f])).stroke({ width: 2, color: 0x9fe6f2 }),
  );
  const grid = new Graphics();
  for (let i = 1; i < 8; i++) grid.moveTo(-52 + i * 13, -40).lineTo(-52 + i * 13, 36);
  for (let i = 1; i < 6; i++) grid.moveTo(-52, -40 + i * 12.7).lineTo(52, -40 + i * 12.7);
  grid.stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
  const drawing = new Graphics()
    .circle(0, -2, 22)
    .stroke({ width: 2, color: 0xffffff, alpha: 0.85 })
    .circle(0, -2, 3)
    .fill({ color: 0xffffff, alpha: 0.9 })
    .moveTo(0, -34)
    .lineTo(-13, 18)
    .moveTo(0, -34)
    .lineTo(13, 18)
    .stroke({ width: 2.5, color: 0xffffff, alpha: 0.9, cap: "round" });
  sheet.addChild(grid, drawing);
  for (const x of [-58, 48]) {
    sheet.addChild(
      new Graphics()
        .roundRect(x, -43, 10, 82, 5)
        .fill(verticalGradient([0, 0xe9f9fc], [1, 0x8fc4d4]))
        .stroke({ width: 1.5, color: 0x1b5f93 }),
    );
  }
  sheet.rotation = 0.07;
  sheet.position.set(0, -8);

  const glow = new Graphics().circle(0, -8, 74).fill({ color: PALETTE.cyan, alpha: 0.07 }).circle(0, -8, 62).fill({ color: PALETTE.cyan, alpha: 0.08 });
  const label = group(
    new Graphics().roundRect(-52, 38, 104, 24, 5).fill(verticalGradient([0, 0xeafcff], [1, 0xa8dbe8])).stroke({ width: 2.5, color: 0x0d3a5c }),
  );
  const labelText = engravedText("SCATTER", 21, 0x0d3a5c, 0x0d3a5c, 0, 1.5);
  labelText.position.set(0, 50.5);
  return group(glow, sheet, label, labelText);
}

function glyph(symbol: SymbolId, width: number, height: number): Container {
  const plateLook = PLATES[symbol];
  if (plateLook !== undefined) return plate(width, height, plateLook.text, plateLook.metal);

  let art: Container;
  switch (symbol) {
    case "H1":
      art = gear(60, 12, METALS.brass);
      break;
    case "H2":
      art = skeletonKey();
      break;
    case "H3":
      art = pocketWatch();
      break;
    case "W":
      art = wildSeal();
      break;
    case "S":
      art = blueprint();
      break;
    default: {
      // A symbol this theme has no art for: show its id so a new game's strips can be checked before art exists.
      art = engravedText(symbol, 48, PALETTE.text, PALETTE.ink, 5);
    }
  }
  art.position.set(width / 2, height / 2);
  return art;
}

export function drawClockworkSymbol(symbol: SymbolId, width: number, height: number): Container {
  return group(tile(width, height), glyph(symbol, width, height));
}
