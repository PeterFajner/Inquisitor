// scripts/heights-check.ts runs this in a browser on /rules: every card
// rendered for real (as the canvas mounts it) and measured, next to the
// height card-height.tsx works out for it. Not part of the app.
import { render } from "preact";
import type { RulesPayload } from "../../shared/api.ts";
import { buildCompendium } from "../../shared/rules/compendium.ts";
import { cardHeight } from "./card-height.tsx";
import { Card } from "./Card.tsx";
import { ctxOf, namesOf } from "./ctx.ts";

export type ProbeRow = { key: string; w: number; real: number; calc: number };

const FACES = ["400 16px Ubuntu", "500 16px Ubuntu", "700 16px Ubuntu", "italic 400 16px Ubuntu", "italic 700 16px Ubuntu", "italic 500 16px Ubuntu"];

export async function probe(): Promise<{ rows: ProbeRow[]; calcMs: number }> {
  await Promise.all(FACES.map((f) => document.fonts.load(f, "a≤")));
  await document.fonts.ready;
  const payload = (await (await fetch("/api/v1/rules")).json()) as RulesPayload;
  const names = namesOf(buildCompendium(payload.packs));
  const box = document.createElement("div");
  box.className = "cv-measure";
  document.body.appendChild(box);
  const actions = { edit() {}, history() {} };
  const go = () => {};
  const rows: ProbeRow[] = [];
  let calcMs = 0;
  for (const { pack, entries } of payload.packs)
    for (const entry of entries) {
      const key = `${pack.id}:${entry.kind}/${entry.id}`;
      const meta = payload.meta?.[pack.id]?.[`${entry.kind}/${entry.id}`];
      const t0 = performance.now();
      const calc = cardHeight(key, entry, meta, names);
      calcMs += performance.now() - t0;
      const w = calc.w;
      const slot = document.createElement("div");
      slot.className = "cv-card";
      slot.style.width = `${w}px`;
      box.appendChild(slot);
      render(<Card cardKey={key} entry={entry} meta={meta} ctx={{ ...ctxOf(entry, names), go }} selected={false} signedIn={false} actions={actions} />, slot);
      const real = slot.getBoundingClientRect().height;
      render(null, slot);
      slot.remove();
      rows.push({ key, w, real, calc: calc.h });
    }
  box.remove();
  return { rows, calcMs };
}

(globalThis as { heightsProbe?: typeof probe }).heightsProbe = probe;
