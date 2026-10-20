import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cspPolicy } from "./csp.ts";

/**
 * Checks a built site against the promises its Content Security Policy depends on, so a change that
 * would quietly weaken it fails loudly instead. Usage: node scripts/verifyBuild.ts [dir] [--qa]
 *
 * A normal build must not contain the QA panel or the QA hooks; a QA build (--qa) must.
 */
const { values, positionals } = parseArgs({ options: { qa: { type: "boolean", default: false } }, allowPositionals: true });
const dist = resolve(positionals[0] ?? "dist");
const problems: string[] = [];
const fail = (message: string): number => problems.push(message);

const htmlPath = join(dist, "index.html");
if (!existsSync(htmlPath)) {
  console.error(`No ${htmlPath}: build first.`);
  process.exit(2);
}
const html = readFileSync(htmlPath, "utf8");

// --- the page itself -------------------------------------------------------------------------------

const policyTags = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g) ?? [];
if (policyTags.length !== 1) fail(`expected exactly one Content-Security-Policy tag, found ${policyTags.length}`);
else if (!policyTags[0]!.includes(`content="${cspPolicy()}"`)) fail("the page's Content-Security-Policy is not the one in scripts/csp.ts");

const policyAt = html.indexOf('http-equiv="Content-Security-Policy"');
const firstLoad = Math.min(...["<script", "<link", "<style"].map((tag) => html.indexOf(tag)).filter((at) => at >= 0));
if (policyAt < 0 || policyAt > firstLoad) fail("the policy must come before every script, link and style, or it governs nothing that loaded earlier");
if (!(html.indexOf('<meta charset="UTF-8"') >= 0 && html.indexOf('<meta charset="UTF-8"') < 1024)) fail("the charset must be declared within the first 1024 bytes");

for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=/.test(script[1]!)) fail("an inline <script> would be blocked by the policy (and is what an injection looks like)");
  else if (script[2]!.trim() !== "") fail("a <script> with both src and a body");
}
if (/<style\b/i.test(html)) fail("an inline <style> would be blocked by the policy");
if (/\sstyle\s*=/i.test(html)) fail("an inline style attribute would be blocked by the policy");
if (/\son[a-z]+\s*=/i.test(html)) fail("an inline event handler attribute would be blocked by the policy");
if (/javascript:/i.test(html)) fail("a javascript: URL");

// Everything the page loads comes from the page's own folder, and exists.
for (const reference of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
  const target = reference[1]!;
  if (target.startsWith("#")) continue;
  if (!target.startsWith("./")) fail(`"${target}" is not a relative path inside the site`);
  else if (!existsSync(join(dist, target.split("?")[0]!))) fail(`"${target}" is referenced but not in the build`);
}

// --- what is in the folder ---------------------------------------------------------------------------

const top = readdirSync(dist).sort();
if (top.join(",") !== "assets,index.html") fail(`the build should hold only index.html and assets/, found: ${top.join(", ")}`);

const scripts = existsSync(join(dist, "assets")) ? readdirSync(join(dist, "assets")).filter((file) => file.endsWith(".js")) : [];
const code = scripts.map((file) => readFileSync(join(dist, "assets", file), "utf8")).join("\n");
if (scripts.length === 0) fail("no scripts in the build");

// The policy has no 'unsafe-eval', so code that builds functions from strings would throw at run time.
if (/\bnew Function\(|[^\w.$]eval\(/.test(code)) fail("the bundle builds code from strings (eval or new Function), which the policy forbids");

// QA hooks and the QA panel are compiled out of a normal build, and present in a QA build.
const QA_MARKERS = ["Force these stops on every spin", "QA tools", "switchTo"];
for (const marker of QA_MARKERS) {
  const present = code.includes(marker);
  if (values.qa && !present) fail(`a QA build is missing "${marker}"`);
  if (!values.qa && present) fail(`a normal build still contains "${marker}": the QA code was not removed`);
}

if (problems.length > 0) {
  console.error(`${dist}: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`${dist}: ok (${scripts.length} scripts, ${values.qa ? "QA build" : "no QA code"}, policy in place, nothing inline, nothing external)`);
