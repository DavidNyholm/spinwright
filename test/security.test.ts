import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emblemNodes } from "../src/ui/emblems.ts";
import { CSP_DIRECTIVES, cspPolicy, securityMetaTags } from "../scripts/csp.ts";
import type { EmblemName } from "../src/app/catalog.ts";

const root = join(import.meta.dirname, "..");

/** Source text with comments removed, so a comment that mentions a forbidden call is not mistaken for one. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function sourceFiles(directory: string): { path: string; code: string }[] {
  return (readdirSync(join(root, directory), { recursive: true }) as string[])
    .filter((path) => path.endsWith(".ts"))
    .map((path) => ({ path: `${directory}/${path.replaceAll("\\", "/")}`, code: withoutComments(readFileSync(join(root, directory, path), "utf8")) }));
}

/** What the browser code must never do, and why. Each is matched against code with the comments taken out. */
const FORBIDDEN: readonly { readonly why: string; readonly pattern: RegExp }[] = [
  // Ways to turn text into markup. The page is written only through textContent and createElement, so
  // an injected string is always shown as text and never parsed.
  { why: "writes markup into the page", pattern: /\.(innerHTML|outerHTML)\b/ },
  { why: "writes markup into the page", pattern: /\binsertAdjacentHTML\b|\bdocument\.write(ln)?\b|\bcreateContextualFragment\b|\bsrcdoc\b/ },
  { why: "parses markup", pattern: /\bDOMParser\b/ },
  // Ways to turn text into code.
  { why: "runs a string as code", pattern: /(^|[^\w.$])eval\s*\(|\bnew\s+Function\b|(^|[^\w.$])Function\s*\(/ },
  { why: "runs a string as code", pattern: /\b(setTimeout|setInterval)\s*\(\s*["'`]/ },
  { why: "a javascript: URL", pattern: /javascript:/i },
  // The app makes no network requests at all (the policy has connect-src 'none'); none may creep in.
  { why: "makes a network request", pattern: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bimportScripts\b/ },
  { why: "loads code at run time", pattern: /\bimport\s*\(|\bnew\s+(Shared)?Worker\b|\bserviceWorker\b/ },
  // Ways out of the page, or to other pages' data.
  { why: "talks to another window", pattern: /\bwindow\.open\b|\bpostMessage\b|\bdocument\.cookie\b|\bdocument\.domain\b/ },
];

describe("the browser code", () => {
  const files = sourceFiles("src");

  it("is actually being scanned", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.path === "src/main.ts")).toBe(true);
    expect(files.some((file) => file.path === "src/pages/forgePage.ts")).toBe(true);
  });

  it.each(FORBIDDEN.map((rule) => [rule.why, rule] as const))("never %s", (_why, rule) => {
    const offenders = files.filter((file) => rule.pattern.test(file.code)).map((file) => file.path);
    expect(offenders, `${rule.why}: ${rule.pattern}`).toEqual([]);
  });

  it("reads and writes saved data only through the storage module", () => {
    const direct = files.filter((file) => file.path !== "src/app/storage.ts" && /\b(localStorage|sessionStorage|indexedDB)\b/.test(file.code));
    expect(direct.map((file) => file.path)).toEqual([]);
  });

  it("parses saved data in one place, and reads it field by field", () => {
    expect(files.filter((file) => /\bJSON\.parse\b/.test(file.code)).map((file) => file.path)).toEqual(["src/app/storage.ts"]);
    // Nothing parsed is copied over wholesale, so a forged "__proto__" or "constructor" key has nothing to land on.
    const copying = files.filter((file) => /\bObject\.assign\b/.test(file.code)).map((file) => file.path);
    expect(copying).toEqual(["src/main.ts"]);
    const main = files.find((file) => file.path === "src/main.ts")!.code;
    expect(main.indexOf("Object.assign(window")).toBeGreaterThan(main.indexOf("QA_ALLOWED && debugMode"));
  });

  it("changes the address only from the QA hooks", () => {
    const writers = files.filter((file) => /\blocation\.(hash|href|search|pathname)\s*=[^=]|\blocation\.(assign|replace)\s*\(/.test(file.code));
    expect(writers.map((file) => file.path)).toEqual(["src/main.ts"]);
    // And there it is inside the QA-only block.
    const main = files.find((file) => file.path === "src/main.ts")!.code;
    expect(main.indexOf("location.hash =")).toBeGreaterThan(main.indexOf("QA_ALLOWED && debugMode"));
  });

  it("has the scanner catch what it is looking for", () => {
    const bad: Record<string, string> = {
      'el.innerHTML = "<b>x</b>"': "writes markup into the page",
      'document.body.insertAdjacentHTML("beforeend", s)': "writes markup into the page",
      'eval("1")': "runs a string as code",
      'new Function("return 1")': "runs a string as code",
      'setTimeout("run()", 10)': "runs a string as code",
      'fetch("https://x.test")': "makes a network request",
      "new WebSocket(url)": "makes a network request",
      "navigator.sendBeacon(url, data)": "makes a network request",
      'const m = await import("./x.js")': "loads code at run time",
      "window.open(url)": "talks to another window",
      'location.href = "javascript:alert(1)"': "a javascript: URL",
    };
    for (const [code, why] of Object.entries(bad)) {
      expect(FORBIDDEN.some((rule) => rule.why === why && rule.pattern.test(withoutComments(code))), code).toBe(true);
    }
    // Whereas the same words in a comment, or ordinary code, are not mistaken for it.
    expect(FORBIDDEN.some((rule) => rule.pattern.test(withoutComments("// never use innerHTML or eval(x)\nconst fetched = 1;")))).toBe(false);
    expect(FORBIDDEN.some((rule) => rule.pattern.test(withoutComments("/* new Function */ el.textContent = text;")))).toBe(false);
  });
});

describe("the page", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");

  it("has no inline script, style or event handler, which the policy would block (and an injection would need)", () => {
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(script[1]).toMatch(/\bsrc=/);
      expect(script[2]!.trim()).toBe("");
    }
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("loads nothing from another site", () => {
    expect(html).not.toMatch(/(src|href)\s*=\s*["'](https?:)?\/\//i);
  });
});

describe("the Content Security Policy", () => {
  const policy = cspPolicy();

  it("denies by default and names every source it allows", () => {
    expect(CSP_DIRECTIVES["default-src"]).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES["script-src"]).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES["connect-src"]).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES["object-src"]).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES["base-uri"]).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES["form-action"]).toEqual(["'none'"]);
  });

  it("never allows inline code, eval, wildcards or other sites", () => {
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|strict-dynamic/);
    expect(policy).not.toMatch(/\*/);
    expect(policy).not.toMatch(/https?:/);
    for (const [directive, sources] of Object.entries(CSP_DIRECTIVES)) {
      for (const source of sources) expect(["'none'", "'self'", "data:", "'script'"], `${directive} ${source}`).toContain(source);
    }
  });

  it("allows data: only for images, which the film-grain background needs", () => {
    const withData = Object.entries(CSP_DIRECTIVES).filter(([, sources]) => sources.includes("data:")).map(([directive]) => directive);
    expect(withData).toEqual(["img-src"]);
  });

  it("requires Trusted Types for scripts, so even a stray markup write would throw", () => {
    expect(CSP_DIRECTIVES["require-trusted-types-for"]).toEqual(["'script'"]);
  });

  it("goes into the page as one well-formed tag, with no quote that could end its attribute early", () => {
    expect(policy).not.toContain('"');
    const tags = securityMetaTags();
    expect(tags.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    expect(tags).toContain(`content="${policy}"`);
    expect(tags).toContain('name="referrer" content="no-referrer"');
  });
});

describe("the lobby's drawings", () => {
  const ALLOWED_TAGS = new Set(["polygon", "circle", "path"]);
  const ALLOWED_ATTRIBUTES = new Set([
    "points", "d", "cx", "cy", "r", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-linejoin", "stroke-linecap",
  ]);

  it.each(["gear", "gem", "coin", "anvil"] satisfies EmblemName[])("%s is only shapes, with only drawing attributes, and plain numbers", (name) => {
    const nodes = emblemNodes(name);
    expect(nodes.length).toBeGreaterThan(1);
    for (const node of nodes) {
      expect(ALLOWED_TAGS.has(node.tag)).toBe(true);
      for (const [attribute, value] of Object.entries(node.attrs)) {
        expect(ALLOWED_ATTRIBUTES.has(attribute), attribute).toBe(true);
        expect(attribute).not.toMatch(/^on/i);
        expect(value).not.toMatch(/[<>"'&]|javascript:|url\(/i);
        if (attribute === "points") expect(value).toMatch(/^[-\d. ]+$/);
      }
    }
  });
});
