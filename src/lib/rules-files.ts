// Reads and writes rule packs on disk: data/rules/<pack>/pack.yaml plus one
// YAML file per entry at <pack>/<kind dir>/<id>.yaml.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { Entry, Pack } from "../shared/rules/schema.ts";
import { KIND_DIRS, type PackEntries } from "../shared/rules/compendium.ts";

export const RULES_DIR = process.env.RULES_DIR || join(import.meta.dirname, "../../data/rules");

export type FileProblem = { file: string; message: string };

export function listPacks(dir = RULES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "pack.yaml")))
    .map((d) => d.name)
    .sort();
}

export function loadPack(packId: string, dir = RULES_DIR): { pack: PackEntries | null; problems: FileProblem[] } {
  const problems: FileProblem[] = [];
  const root = join(dir, packId);
  const packFile = join(root, "pack.yaml");
  const packParsed = Pack.safeParse(parse(readFileSync(packFile, "utf8")));
  if (!packParsed.success) {
    return { pack: null, problems: [{ file: packFile, message: packParsed.error.message }] };
  }
  const entries: Entry[] = [];
  for (const sub of Object.values(KIND_DIRS)) {
    const d = join(root, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((f) => f.endsWith(".yaml")).sort()) {
      const file = join(d, f);
      let raw: unknown;
      try {
        raw = parse(readFileSync(file, "utf8"));
      } catch (e) {
        problems.push({ file, message: `YAML: ${(e as Error).message}` });
        continue;
      }
      const r = Entry.safeParse(raw);
      if (!r.success) {
        problems.push({ file, message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
        continue;
      }
      if (`${r.data.id}.yaml` !== f) problems.push({ file, message: `id "${r.data.id}" doesn't match file name` });
      if (KIND_DIRS[r.data.kind as keyof typeof KIND_DIRS] !== sub) {
        problems.push({ file, message: `kind "${r.data.kind}" belongs in ${KIND_DIRS[r.data.kind as keyof typeof KIND_DIRS]}/` });
      }
      entries.push(r.data);
    }
  }
  return { pack: { pack: packParsed.data, entries }, problems };
}

export const entryPath = (packId: string, e: Pick<Entry, "kind" | "id">, dir = RULES_DIR) =>
  join(dir, packId, KIND_DIRS[e.kind as keyof typeof KIND_DIRS], `${e.id}.yaml`);

export function serializeEntry(e: Entry): string {
  return stringify(e, { lineWidth: 100 });
}

export function writeEntry(packId: string, e: Entry, dir = RULES_DIR): string {
  const file = entryPath(packId, e, dir);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, serializeEntry(e));
  return file;
}
