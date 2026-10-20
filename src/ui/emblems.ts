import type { EmblemName } from "../app/catalog.ts";

/**
 * The small drawings on the lobby cards. Each is a list of SVG shapes built from numbers rather than
 * traced, so it stays crisp at any size, takes its colour from the page (`currentColor`) and weighs
 * next to nothing. They are made with createElementNS, never by parsing markup, so no string ever
 * reaches the page as HTML.
 */

const SIZE = 120;
const CENTRE = SIZE / 2;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** One shape. Only these three kinds are ever drawn. */
export interface SvgNode {
  readonly tag: "polygon" | "circle" | "path";
  readonly attrs: Readonly<Record<string, string>>;
}

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

const outline = (pointList: string): SvgNode => ({
  tag: "polygon",
  attrs: { points: pointList, fill: "currentColor", "fill-opacity": "0.16", stroke: "currentColor", "stroke-width": "3", "stroke-linejoin": "round" },
});
const lines = (d: string, width: string): SvgNode => ({
  tag: "path",
  attrs: { d, fill: "none", stroke: "currentColor", "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" },
});
const solid = (tag: "circle" | "path", attrs: Record<string, string>): SvgNode => ({ tag, attrs: { ...attrs, fill: "currentColor" } });

const DRAWINGS: Readonly<Record<EmblemName, readonly SvgNode[]>> = {
  gear: [
    outline(gearPoints(12, 38, 50)),
    { tag: "circle", attrs: { cx: "60", cy: "60", r: "27", fill: "none", stroke: "currentColor", "stroke-width": "3" } },
    solid("circle", { cx: "60", cy: "60", r: "8" }),
    lines("M60 33V52M60 68V87M33 60H52M68 60H87", "4"),
  ],
  gem: [
    outline("30 40 45 18 75 18 90 40 60 104"),
    lines("M30 40H90M45 18L50 40M75 18L70 40M60 18L50 40M60 18L70 40M50 40L60 104M70 40L60 104", "2.2"),
    solid("path", { d: "M96 14l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" }),
  ],
  anvil: [outline(points(fitPoints(ANVIL_OUTLINE, 104, 52, 76))), lines("M52 40L46 24M64 36L64 18M76 40L82 24M88 46L100 36M40 48L28 40", "3")],
};

/** The shapes of an emblem, as plain data. */
export function emblemNodes(name: EmblemName): readonly SvgNode[] {
  return DRAWINGS[name];
}

/** The emblem as an SVG element. It is decorative, so it is hidden from screen readers. */
export function drawEmblem(name: EmblemName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("width", String(SIZE));
  svg.setAttribute("height", String(SIZE));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const node of DRAWINGS[name]) {
    const shape = document.createElementNS(SVG_NAMESPACE, node.tag);
    for (const [attribute, value] of Object.entries(node.attrs)) shape.setAttribute(attribute, value);
    svg.append(shape);
  }
  return svg;
}
