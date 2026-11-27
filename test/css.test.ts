// Every component's CSS ends up in one app stylesheet (scripts/client.ts
// bundles all chunks' CSS into app.css), so a bare class selector defined in
// two component files applies on every page: the builder's .picker once hid
// the rules editor's reference picker, and the rules' .chip restyled the
// builder's. Component stylesheets must not share a bare class (base.css is
// the shared one).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// (canvas.css is the canvas engine's: its cv-* classes are meant to be
// extended by the pages that use it, like base.css.)
const FILES = [
  "builder/builder.css",
  "components/sitebar.css",
  "history/history.css",
  "history/page.css",
  "print/print.css",
  "rules/rules.css",
  "sheet/sheet.css",
  "export/download.css",
];

// Classes a selector starts with (".chip {", ".chip.good", ".picker[open]").
const bare = (file: string): Set<string> => {
  const css = readFileSync(new URL(`../src/client/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Set<string>();
  for (const m of css.matchAll(/(?:^|[}\n,])\s*(\.[A-Za-z][\w-]*)\s*[{,.:[]/g)) out.add(m[1]);
  return out;
};

test("component stylesheets define no bare class in common", () => {
  const engine = bare("canvas/canvas.css");
  const sets = FILES.map((f) => [f, new Set([...bare(f)].filter((c) => !engine.has(c)))] as const);
  const clashes: string[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const both = [...sets[i][1]].filter((c) => sets[j][1].has(c) && c !== ".icon-btn").sort();
      if (both.length) clashes.push(`${sets[i][0]} & ${sets[j][0]}: ${both.join(" ")}`);
    }
  }
  assert.deepEqual(clashes, []);
});
