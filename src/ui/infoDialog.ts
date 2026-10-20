import type { RulesDoc, RulesSection, RulesTable } from "../app/rules.ts";
import { byId } from "./dom.ts";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | null, text?: string): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (className !== null) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
}

function drawTable(table: RulesTable): HTMLElement {
  const block = element("div", null);
  const wrap = element("div", "rules-table-wrap");
  const grid = element("table", "rules-table");
  const head = element("tr", null);
  table.head.forEach((cell, index) => {
    const th = element("th", null, cell);
    th.scope = "col";
    if (index > 0 && table.textual !== true) th.className = "num";
    head.append(th);
  });
  const thead = element("thead", null);
  thead.append(head);
  grid.append(thead);
  const body = element("tbody", null);
  for (const row of table.rows) {
    const tr = element("tr", null);
    row.forEach((cell, index) => {
      if (index === 0) {
        const th = element("th", null, cell);
        th.scope = "row";
        tr.append(th);
      } else {
        tr.append(element("td", table.textual === true ? null : "num", cell));
      }
    });
    body.append(tr);
  }
  grid.append(body);
  wrap.append(grid);
  block.append(wrap);
  // The note stays put when a wide table scrolls sideways.
  if (table.note !== undefined) block.append(element("p", "rules-note", table.note));
  return block;
}

function drawSection(section: RulesSection): HTMLElement {
  const block = element("section", "rules-section");
  block.append(element("h3", null, section.heading));
  for (const paragraph of section.text ?? []) block.append(element("p", null, paragraph));
  if (section.list !== undefined) {
    const list = element("ul", null);
    for (const item of section.list) list.append(element("li", null, item));
    block.append(list);
  }
  if (section.table !== undefined) block.append(drawTable(section.table));
  return block;
}

/** Shows a game's "how it works" page in the shared dialog. Everything is set as text, never as markup. */
export function showRules(doc: RulesDoc): void {
  byId("info-title").textContent = doc.title;
  byId("info-intro").textContent = doc.intro;
  byId("info-body").replaceChildren(...doc.sections.map(drawSection));
  const dialog = byId<HTMLDialogElement>("info-dialog");
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
}
