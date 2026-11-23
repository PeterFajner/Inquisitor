// The rules database: data/rules (RULES_DIR) is a git repository of rule
// packs (src/lib/rules-files.ts). This module keeps the loaded packs in
// memory and knows the version (the repo's HEAD commit). Read-only for now;
// edits (a commit per edit, authored by the editor's public id) come with
// the rules canvas.
import { execFileSync } from "node:child_process";
import { listPacks, loadPack, RULES_DIR } from "./rules-files.ts";
import type { PackEntries } from "../shared/rules/compendium.ts";
import type { RulesPayload } from "../shared/api.ts";

let cache: { version: string; payload: RulesPayload } | null = null;

export function rulesVersion(): string {
  try {
    return execFileSync("git", ["-C", RULES_DIR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "uncommitted";
  }
}

// Every pack with its entries, as the browser receives it.
export function rulesPayload(): RulesPayload {
  const version = rulesVersion();
  if (cache?.version === version) return cache.payload;
  const packs: PackEntries[] = [];
  for (const id of listPacks()) {
    const { pack, problems } = loadPack(id);
    for (const p of problems) console.warn(`rules: ${p.file}: ${p.message}`);
    if (pack) packs.push(pack);
  }
  cache = { version, payload: { version, packs } };
  return cache.payload;
}

export function invalidateRules(): void {
  cache = null;
}
