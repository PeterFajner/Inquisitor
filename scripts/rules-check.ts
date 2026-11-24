// Validates every rule pack in RULES_DIR (default data/rules): schema, file
// names, and cross-references. `npm run rules:check [pack…]`; exits 1 on
// problems. With --summary, prints entry counts per kind.
import { listPacks, loadPack, RULES_DIR } from "../src/lib/rules-files.ts";
import { buildCompendium, checkCompendium, withoutHidden, type PackEntries } from "../src/shared/rules/compendium.ts";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const summary = process.argv.includes("--summary");
const packs = args.length ? args : listPacks();
if (!packs.length) {
  console.error(`no packs in ${RULES_DIR}`);
  process.exit(1);
}
let bad = 0;
const stack: PackEntries[] = [];
for (const id of packs) {
  const { pack, problems } = loadPack(id);
  for (const p of problems) console.error(`${p.file}: ${p.message}`);
  bad += problems.length;
  if (pack) stack.push(pack);
}
const c = buildCompendium(stack);
const xref = checkCompendium(c);
for (const m of xref) console.error(m);
bad += xref.length;
// The rules as the app gets them (hidden entries left out) must hold too.
const all = new Set(xref);
const served = checkCompendium(buildCompendium(withoutHidden(stack))).filter((m) => !all.has(m));
for (const m of served) console.error(`without hidden entries: ${m}`);
bad += served.length;
if (summary) {
  for (const k of ["archetypes", "talents", "exotics", "mutations", "powers", "items", "tables", "rules"] as const) {
    console.log(`${k}: ${c[k].size}`);
  }
}
console.log(bad ? `${bad} problem(s)` : "ok");
process.exit(bad ? 1 : 0);
