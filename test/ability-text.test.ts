// The builder's ability text: lines kept; options not chosen left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadPack } from "../src/lib/rules-files.ts";
import { buildCompendium } from "../src/shared/rules/compendium.ts";
import { abilityText } from "../src/client/builder/ability-text.ts";

const { pack } = loadPack("loyalist", join(import.meta.dirname, "../data/rules"));

test("ability text: only the chosen prayer of Word of the Emperor", { skip: !pack }, () => {
  const c = buildCompendium([pack!]);
  const all = abilityText(c, "exotic", "word-of-the-emperor");
  assert.ok(all.includes("\nCurse Of Undoing:") && all.includes("\nStunning Sermon:"), "unchosen: every prayer, one per line");
  const one = abilityText(c, "exotic", "word-of-the-emperor", ["Catechism Of Hate"]);
  assert.equal(
    one,
    "(Or Word Of Heresy)\nA character can use an action to pray in the Emperor’s name.\nCatechism Of Hate: All friendly listeners get Frenzy and Furious Assault until this character’s next activation.",
  );
  // a chosen variant that isn't one of its options changes nothing
  assert.equal(abilityText(c, "exotic", "word-of-the-emperor", ["Right eye"]), all);
});

test("ability text: the first prayer chosen loses the introducing sentence too", { skip: !pack }, () => {
  const c = buildCompendium([pack!]);
  assert.equal(
    abilityText(c, "exotic", "word-of-the-emperor", ["Curse Of Undoing"]),
    "(Or Word Of Heresy)\nA character can use an action to pray in the Emperor’s name.\nCurse Of Undoing: This character may attempt to nullify an ongoing psychic power as if they were a psyker.",
  );
});
