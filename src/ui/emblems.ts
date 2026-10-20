import type { EmblemName } from "../app/catalog.ts";

/**
 * The small drawings on the lobby cards, as SVG. Each is built from numbers rather than traced, so
 * it stays crisp at any size, takes its colour from the page (`currentColor`) and weighs next to nothing.
 */

const SIZE = 120;
const CENTRE = SIZE / 2;

const points = (flat: readonly number[]): string => flat.map((value) => Math.round(value * 10) / 10).join(" ");

/** A gear outline with trapezoidal teeth, as an SVG polygon's points. */
export function gearPoints(teeth: number, innerRadius: number, outerRadius: number): string {
  const step = (2 * Math.PI) / teeth;
  const flat: number[] = [];
  for (let i = 0; i < teeth; i++) {
    for (const [offset, radius] of [
      [-0.27, innerRadius],
      [-0.17, outerRadius],
      [0.17, outerRadius],
      [0.27, innerRadius],
    ] as const) {
      const angle = (i + offset) * step;
      flat.push(CENTRE + Math.cos(angle) * radius, CENTRE + Math.sin(angle) * radius);
    }
  }
  return points(flat);
}

/** The anvil's outline, in the same units the forge scene draws it in, so the card and the scene show the same anvil. */
const ANVIL_OUTLINE = [
  288, 240, 318, 231, 345, 226, 362, 224, 556, 224, 568, 227, 570, 246, 526, 250, 504, 258, 504, 296, 536, 301, 536, 336, 364, 336, 364, 301, 396, 296, 396,
  258, 374, 250, 338, 249, 306, 246,
] as const;

/** Fits a flat x, y list into the emblem box, keeping its proportions and centring it. */
export function fitPoints(flat: readonly number[], boxWidth: number, boxHeight: number, centreY = CENTRE): number[] {
  const xs = flat.filter((_, i) => i % 2 === 0);
  const ys = flat.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return flat.map((value, i) =>
    i % 2 === 0 ? CENTRE + (value - minX - width / 2) * scale : centreY + (value - minY - height / 2) * scale,
  );
}

const GEAR = `
  <polygon points="${gearPoints(12, 38, 50)}" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="60" cy="60" r="27" fill="none" stroke="currentColor" stroke-width="3"/>
  <circle cx="60" cy="60" r="8" fill="currentColor"/>
  <path d="M60 33V52M60 68V87M33 60H52M68 60H87" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`;

const GEM = `
  <polygon points="30 40 45 18 75 18 90 40 60 104" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
  <path d="M30 40H90M45 18L50 40M75 18L70 40M60 18L50 40M60 18L70 40M50 40L60 104M70 40L60 104" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M96 14l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="currentColor"/>`;

const ANVIL = `
  <polygon points="${points(fitPoints(ANVIL_OUTLINE, 104, 52, 76))}" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
  <path d="M52 40L46 24M64 36L64 18M76 40L82 24M88 46L100 36M40 48L28 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;

const DRAWINGS: Readonly<Record<EmblemName, string>> = { gear: GEAR, gem: GEM, anvil: ANVIL };

/** The emblem as an SVG string. It is decorative, so it is hidden from screen readers. */
export function emblemSvg(name: EmblemName): string {
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" aria-hidden="true" focusable="false">${DRAWINGS[name]}</svg>`;
}
