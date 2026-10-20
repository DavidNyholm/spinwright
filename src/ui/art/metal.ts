import { Container, FillGradient, Graphics, Text } from "pixi.js";
import { FONT_DISPLAY } from "./palette.ts";

/** Four tones that make a metal read as metal: a highlight, a body, a shadow and a dark outline. */
export interface Metal {
  readonly light: number;
  readonly mid: number;
  readonly dark: number;
  readonly edge: number;
}

export const METALS = {
  brass: { light: 0xf3d58a, mid: 0xc79a45, dark: 0x6e4f1c, edge: 0x3a2a0e },
  gold: { light: 0xfff0b0, mid: 0xe8b830, dark: 0x8a5e0c, edge: 0x3d2704 },
  copper: { light: 0xf0a77a, mid: 0xc2693a, dark: 0x6b3319, edge: 0x35170a },
  steel: { light: 0xe6ebef, mid: 0x9aa5ae, dark: 0x4a545c, edge: 0x1e2429 },
  iron: { light: 0xa7b4c2, mid: 0x5d6b7a, dark: 0x2c3540, edge: 0x12171c },
  verdigris: { light: 0x9fe0cb, mid: 0x3f9b86, dark: 0x1d4f45, edge: 0x0b2420 },
  rust: { light: 0xe59a86, mid: 0xb34a35, dark: 0x5a2016, edge: 0x2a0d08 },
} as const satisfies Record<string, Metal>;

const gradientCache = new Map<string, FillGradient>();

/**
 * A top-to-bottom gradient in local (per-shape) space. Gradients are cached by their stops, since
 * the same few are used over and over.
 */
export function verticalGradient(...stops: readonly (readonly [offset: number, color: number])[]): FillGradient {
  const key = stops.map(([offset, color]) => `${offset}:${color}`).join("|");
  let gradient = gradientCache.get(key);
  if (gradient === undefined) {
    gradient = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: stops.map(([offset, color]) => ({ offset, color })),
      textureSpace: "local",
    });
    gradientCache.set(key, gradient);
  }
  return gradient;
}

/** The standard brushed-metal look: light at the top, body in the middle, shadow at the bottom. */
export function metalGradient(metal: Metal): FillGradient {
  return verticalGradient([0, metal.light], [0.45, metal.mid], [1, metal.dark]);
}

export function mix(from: number, to: number, amount: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * amount);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** A domed rivet head. */
export function rivet(x: number, y: number, radius: number, metal: Metal = METALS.brass): Graphics {
  return new Graphics()
    .circle(x, y, radius)
    .fill(verticalGradient([0, metal.light], [1, metal.dark]))
    .stroke({ width: 1, color: metal.edge, alpha: 0.9 })
    .circle(x - radius * 0.3, y - radius * 0.35, radius * 0.3)
    .fill({ color: 0xffffff, alpha: 0.5 });
}

/** The points of a gear outline centred on the origin: `teeth` trapezoidal teeth between two radii. */
export function gearOutline(teeth: number, innerRadius: number, outerRadius: number, rotation = 0): number[] {
  const step = (2 * Math.PI) / teeth;
  const points: number[] = [];
  for (let i = 0; i < teeth; i++) {
    const centre = rotation + i * step;
    for (const [offset, radius] of [
      [-0.27, innerRadius],
      [-0.17, outerRadius],
      [0.17, outerRadius],
      [0.27, innerRadius],
    ] as const) {
      const angle = centre + offset * step;
      points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  }
  return points;
}

export function engravedText(
  text: string,
  size: number,
  fill: number,
  outline: number,
  outlineWidth = 6,
  letterSpacing = 0,
): Text {
  const result = new Text({
    text,
    style: {
      fontFamily: FONT_DISPLAY,
      fontSize: size,
      fontWeight: "800",
      fill,
      letterSpacing,
      stroke: { color: outline, width: outlineWidth, join: "round" },
      align: "center",
    },
  });
  result.anchor.set(0.5);
  return result;
}

/** Convenience for building a Container from several children at once. */
export function group(...children: Container[]): Container {
  const container = new Container();
  container.addChild(...children);
  return container;
}
