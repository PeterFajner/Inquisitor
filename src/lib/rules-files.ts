// Reads and writes rule packs on disk: data/rules/<pack>/pack.yaml plus one
// YAML file per entry at <pack>/<kind dir>/<id>.yaml.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { isCollection, isMap, isNode, isScalar, isSeq, parse, parseDocument, stringify, type Document } from "yaml";
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

// The same paths relative to the rules directory (as git names them).
export const entryRelPath = (packId: string, kind: string, id: string): string =>
  `${packId}/${KIND_DIRS[kind as keyof typeof KIND_DIRS]}/${id}.yaml`;
export const packRelPath = (packId: string): string => `${packId}/pack.yaml`;

// "<pack>/<kind dir>/<id>.yaml" -> its pack, kind and id (null for any other file).
const DIR_KINDS = Object.fromEntries(Object.entries(KIND_DIRS).map(([k, d]) => [d, k])) as Record<string, string>;
export function parseRelPath(path: string): { pack: string; kind: string; id: string } | null {
  const m = path.match(/^([^/]+)\/([^/]+)\/([^/]+)\.yaml$/);
  if (!m || !DIR_KINDS[m[2]]) return null;
  return { pack: m[1], kind: DIR_KINDS[m[2]], id: m[3] };
}

// An entry file's text -> the entry, or null when it isn't a valid one.
export function parseEntryText(text: string): Entry | null {
  try {
    const r = Entry.safeParse(parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// An entry file with only its canvas position changed, keeping the rest of
// the file (order, comments) as it was.
export function withPos(text: string, pos: [number, number]): string {
  const value = parse(text) as Record<string, unknown>;
  return editYaml(text, { ...value, pos }) ?? stringify({ ...value, pos }, YAML_OUT);
}

export function serializePack(p: Pack): string {
  return stringify(p, YAML_OUT);
}

// The transcription's YAML style: no line folding.
const YAML_OUT = { lineWidth: 0, doubleQuotedMinMultiLineLength: 1e9 } as const;

// Makes `node` (in `doc`) hold `value`, keeping every unchanged node as it
// was written (flow or block style, quoting, comments) and the order of
// existing keys; new keys go last.
function mergeNode(doc: Document, node: unknown, value: unknown): unknown {
  if (isNode(node) && isDeepStrictEqual(node.toJS(doc), value)) return node; // unchanged (aliases too)
  if (isScalar(node) && (value === null || typeof value !== "object")) {
    if (node.value !== value) node.value = value;
    return node;
  }
  if (isMap(node) && value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const pair of [...node.items]) {
      const k = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (!Object.hasOwn(v, k) || v[k] === undefined) node.delete(pair.key);
    }
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) continue;
      const pair = node.items.find((p) => (isScalar(p.key) ? String(p.key.value) : String(p.key)) === k);
      if (pair) pair.value = mergeNode(doc, pair.value, x) as never;
      else node.set(k, create(doc, x));
    }
    return node;
  }
  if (isSeq(node) && Array.isArray(value)) {
    node.items.splice(value.length);
    value.forEach((x, i) => {
      if (i < node.items.length) node.items[i] = mergeNode(doc, node.items[i], x) as never;
      else node.items.push(create(doc, x) as never);
    });
    return node;
  }
  const fresh = create(doc, value);
  if (isCollection(node) && isCollection(fresh) && node.flow) fresh.flow = true;
  return fresh;
}

// A new node; lists of plain values are written inline ([10, 20]).
function create(doc: Document, value: unknown): unknown {
  const n = doc.createNode(value);
  if (isSeq(n) && n.items.every((i) => isScalar(i))) n.flow = true;
  return n;
}

// `previous` (a YAML file) edited to hold `value`, or null when it can't be.
function editYaml(previous: string, value: unknown): string | null {
  const doc = parseDocument(previous);
  if (doc.errors.length || !isMap(doc.contents)) return null;
  doc.contents = mergeNode(doc, doc.contents, value) as never;
  const out = doc.toString(YAML_OUT);
  // yaml pads every flow collection ("[ a ]"); the files are written both
  // ways. Lines that differ from one of the old file's only in that padding
  // are put back as they were, if the result still says the same.
  const squeeze = (l: string) => l.replace(/([[{]) +/g, "$1").replace(/ +([\]}])/g, "$1");
  const old = new Map(previous.split("\n").map((l) => [squeeze(l), l]));
  const kept = out
    .split("\n")
    .map((l) => old.get(squeeze(l)) ?? l)
    .join("\n");
  try {
    if (isDeepStrictEqual(parse(kept), value)) return kept;
  } catch {
    // fall through
  }
  return out;
}

// An entry's file text: `previous` (the file it replaces) edited into it,
// or, for a new file, id, kind and name first.
export function serializeEntryLike(e: Entry, previous: string | null): string {
  const edited = previous == null ? null : editYaml(previous, JSON.parse(JSON.stringify(e)));
  if (edited != null) return edited;
  const { id, kind, name, ...rest } = e;
  return stringify({ id, kind, name, ...rest }, YAML_OUT);
}

// Every pack in `dir`, problems logged (as warnings) and skipped.
export function loadAllPacks(dir = RULES_DIR): PackEntries[] {
  const packs: PackEntries[] = [];
  for (const id of listPacks(dir)) {
    const { pack, problems } = loadPack(id, dir);
    for (const p of problems) console.warn(`rules: ${p.file}: ${p.message}`);
    if (pack) packs.push(pack);
  }
  return packs;
}

// The same in a child process, as JSON: parsing ~900 YAML files leaves tens
// of MB of garbage that V8 keeps as heap, so the server loads them in a
// process that then exits. Falls back to loading here.
export function loadAllPacksIsolated(dir = RULES_DIR): PackEntries[] {
  try {
    const out = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", fileURLToPath(import.meta.url)], {
      env: { ...process.env, RULES_DIR: dir },
      maxBuffer: 1 << 30,
      stdio: ["ignore", "pipe", "inherit"],
    });
    return JSON.parse(out.toString("utf8")) as PackEntries[];
  } catch (e) {
    console.warn(`rules: loading in a child process failed (${(e as Error).message}); loading here`);
    return loadAllPacks(dir);
  }
}

// Run directly: print every pack as JSON (loadAllPacksIsolated).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(loadAllPacks()));
}
