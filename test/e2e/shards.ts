// Every shard: one per archetype for the engine sweep (engine:<id>) and the
// UI sweep (ui:<id>), and one per feature area (feature:<name>).
import { engineArchetype, type EngineOptions } from "./engine/archetype.ts";
import { engineGlobal } from "./engine/global.ts";
import { engineTrades } from "./engine/trades.ts";
import { engineOpenPicks } from "./engine/open-picks.ts";
import { enginePacks, engineSubtypeRoll } from "./engine/records.ts";
import { engineRulesEntries } from "./engine/rules-entries.ts";
import { engineStatic } from "./engine/static.ts";
import type { Report } from "./lib/report.ts";
import { archetypeIds } from "./lib/rules.ts";
import { FEATURES } from "./ui/features.ts";
import { uiArchetype } from "./ui/archetype.ts";

export type RunOptions = EngineOptions & { results: string; uiSeeds: number; headful?: false };
export type Shard = { id: string; run(r: Report, o: RunOptions): Promise<void> };

export function shards(): Shard[] {
  const ids = archetypeIds();
  return [
    ...ids.map((id) => ({ id: `engine:${id}`, run: (r: Report, o: RunOptions) => engineArchetype(r, id, o) })),
    { id: "engine:rules-update", run: (r: Report, o: RunOptions) => engineGlobal(r, o) },
    { id: "engine:rules-update-entries", run: engineRulesEntries },
    { id: "engine:static", run: engineStatic },
    { id: "engine:trades", run: engineTrades },
    { id: "engine:open-picks", run: engineOpenPicks },
    { id: "engine:packs", run: enginePacks },
    { id: "engine:subtype-roll", run: engineSubtypeRoll },
    ...ids.map((id) => ({ id: `ui:${id}`, run: (r: Report, o: RunOptions) => uiArchetype(r, id, o) })),
    ...Object.entries(FEATURES).map(([name, run]) => ({ id: `feature:${name}`, run })),
  ];
}
