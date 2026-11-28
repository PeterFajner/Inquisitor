/// <reference lib="dom.iterable" />
// States the feature tours never reach, each a shard:
// - feature:network: offline, a slow network, a save the server fails, the
//   server restarted while a character is open, the rules' event stream
//   dropped (a restart) and an edit made meanwhile arriving;
// - feature:accounts: a second browser signing in to an account that has
//   characters (its visitor's characters merge in), one character edited in
//   two tabs (nothing lost), a session cookie deleted or forged;
// - feature:download-states: a Warband download with a companion (its own
//   sheet), the Preview of a character with one, many characters to pick
//   from (the list scrolls, search finds one), the dropdown at phone width,
//   settings that follow a sign-in;
// - feature:history-states: versions across a rules update, an old version
//   made current again, a duplicate of a duplicate;
// - feature:docx: the .docx's cells (stats, derived values, armour, # Rld,
//   quantities);
// - feature:rules-update-states: a change that removes the character's
//   option, its archetype deleted, Update with overrides, Apply then Undo and
//   Redo, the Update button after the edit is made while on the rules and
//   history pages.
import { join } from "node:path";
import * as ops from "../../../src/client/builder/ops.ts";
import { powerScore } from "../../../src/shared/engine/balance.ts";
import type { CharacterRecord } from "../../../src/shared/engine/record.ts";
import { walkEffects } from "../../../src/shared/rules/compendium.ts";
import { toSheetCharacter } from "../../../src/shared/sheet-map.ts";
import { SHEET_LOCATIONS, SHEET_STATS } from "../../../src/shared/sheet.ts";
import { PHONE, type Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import { api, headRecord, idle, newCharacter, openBuilder, openCharacter, openList, saveRecord, Session } from "../lib/ui.ts";
import { docxText, unzipEntry } from "../lib/zip.ts";
import type { RunOptions } from "../shards.ts";
import { randomBuild } from "../engine/archetype.ts";
import { accountAction, authenticator, signUp } from "./f-account.ts";
import { withSession } from "./f-builder.ts";
import { openRules } from "./f-rules.ts";

const versions = async (page: Page, id: string) => ((await api(page, "GET", `/api/v1/characters/${id}`)).body.character?.versions?.length ?? 0) as number;
const clickStatsReroll = async (page: Page) => {
  await page.eval(() => [...document.querySelectorAll(".csec-title")].find((x) => x.textContent?.startsWith("Stats"))!.querySelector("button")!.setAttribute("data-e2e", "reroll"));
  await page.click('[data-e2e="reroll"]');
};
/** The Stats card's totals as shown. */
const shownTotals = (page: Page) => page.eval(() => [...document.querySelectorAll(".cstats tbody tr")].map((tr) => tr.querySelector(".cstats-total")?.textContent ?? ""));
const totalsOf = (rec: CharacterRecord) => {
  const ch = ops.view(realCompendium(), rec).character;
  return ["WS", "BS", "S", "T", "I", "Wp", "Sg", "Nv", "Ld"].map((s) => String(ch.stats[s as "WS"].final));
};

// --- network ---------------------------------------------------------------------------

export async function networkFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "imperial-guard", "fighter");
    const base: Repro = { archetype: "imperial-guard", subtype: "fighter", steps: ["New character Imperial Guard Fighter"] };
    const net = (offline: boolean, latency = 0) => page.send("Network.emulateNetworkConditions", { offline, latency, downloadThroughput: -1, uploadThroughput: -1 });
    await page.send("Network.enable");

    // Slow: a 1.5 s round trip; the reroll still saves, once.
    await s.step("on a slow network a Reroll saves once", { ...base, steps: [...base.steps!, "network 1500 ms latency", "Stats: Reroll"] }, async () => {
      const n0 = await versions(page, id);
      await net(false, 1500);
      await clickStatsReroll(page);
      await idle(page, 30_000);
      await net(false, 0);
      const n1 = await versions(page, id);
      if (n1 !== n0 + 1) throw new Error(`versions ${n0} → ${n1}`);
      const shown = await shownTotals(page);
      const head = totalsOf(await headRecord(page, id));
      if (shown.join() !== head.join()) throw new Error(`shown ${shown} ≠ saved ${head}`);
    });

    // Offline: a Reroll can't save. What is shown afterwards must be what the server has once back online.
    await s.step("offline, a Reroll doesn't leave the page showing an unsaved character", { ...base, steps: [...base.steps!, "offline", "Stats: Reroll", "online", "reload"] }, async () => {
      page.allow.push(/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|net::/);
      const n0 = await versions(page, id);
      await net(true);
      await clickStatsReroll(page);
      await new Promise((res) => setTimeout(res, 1500));
      const shownOffline = await shownTotals(page);
      await net(false);
      await idle(page, 20_000).catch(() => {});
      const n1 = await versions(page, id);
      const head = totalsOf(await headRecord(page, id));
      // Either it saved once it could (a version more, shown) or it went back to what was saved.
      const shownNow = await shownTotals(page);
      page.allow.pop();
      if (n1 === n0 && shownNow.join() !== head.join()) throw new Error(`after going offline and back, shown ${shownNow} but the server has ${head} (offline it showed ${shownOffline}; nothing saved)`);
      if (n1 > n0 + 1) throw new Error(`versions ${n0} → ${n1}`);
      await page.reload();
      await page.waitFor(() => !!document.querySelector(".char-view"));
      await idle(page);
      const after = await shownTotals(page);
      if (after.join() !== head.join()) throw new Error(`after a reload shown ${after}, saved ${head}`);
    });

    // A save the server fails (500): the page must not show a version the server doesn't have.
    await s.step("a save the server fails isn't shown as saved", { ...base, steps: [...base.steps!, "POST …/versions answered 500 (CDP Fetch)", "Stats: Reroll"] }, async () => {
      page.allow.push(/500 \(Internal Server Error\)|status of 500/);
      await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/characters/*/versions*", requestStage: "Request" }] });
      const off = s.chrome.on(page.sessionId, (method, p) => {
        if (method === "Fetch.requestPaused") void page.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 500, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from('{"error":"e2e"}').toString("base64") });
      });
      const n0 = await versions(page, id);
      try {
        await clickStatsReroll(page);
        await idle(page).catch(() => {});
        await new Promise((res) => setTimeout(res, 500));
      } finally {
        off();
        await page.send("Fetch.disable");
      }
      const n1 = await versions(page, id);
      const head = totalsOf(await headRecord(page, id));
      const shown = await shownTotals(page);
      page.allow.pop();
      if (n1 !== n0) throw new Error(`versions ${n0} → ${n1} though the save failed`);
      if (shown.join() !== head.join()) throw new Error(`the failed save is shown: ${shown}, the server has ${head}`);
    });
    await s.checkText("after a failed save", base);

    // The server restarted while the character is open: the next edit saves.
    await s.step("after a server restart the open character still saves", { ...base, steps: [...base.steps!, "the server restarted", "Stats: Reroll"] }, async () => {
      page.allow.push(/ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|rules\/events|Failed to fetch/);
      await s.app.restart();
      const n0 = await versions(page, id);
      await clickStatsReroll(page);
      await idle(page, 20_000);
      const n1 = await versions(page, id);
      page.allow.pop();
      if (n1 !== n0 + 1) throw new Error(`versions ${n0} → ${n1}`);
    });
  });
  // The event stream dropped (a restart), an edit made while it reconnects: it still arrives.
  await withSession(r, o, async (s) => {
    const page = s.page;
    await s.step("sign up", {}, () => signUp(s, page));
    const KEY = "loyalist:talent/dodge";
    const other = await s.newPage(undefined, { isolated: true });
    other.allow.push(/ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|rules\/events|Failed to fetch|ERR_INCOMPLETE_CHUNKED_ENCODING/);
    await openRules(other, s.app.url, `#${KEY}`);
    await s.step("an edit made while the event stream reconnects arrives", { steps: ["another browser on /rules", "the server restarted", "an edit at once (before it reconnects)"] }, async () => {
      await s.app.restart();
      const rules = (await api(page, "GET", "/api/v1/rules")).body as { packs: { pack: { id: string }; entries: any[] }[]; meta: Record<string, Record<string, { commit: string }>> };
      const entry = structuredClone(rules.packs.find((p) => p.pack.id === "loyalist")!.entries.find((e) => e.kind === "talent" && e.id === "dodge"));
      entry.text = `${entry.text} E2E-reconnect`;
      const res = await api(page, "POST", "/api/v1/rules/entries", { pack: "loyalist", entry, base: rules.meta.loyalist["talent/dodge"].commit });
      if (res.status !== 200) throw new Error(`save ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
      const arrived = await other.waitFor((k: string) => !!document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent?.includes("E2E-reconnect"), [KEY], { timeout: 20_000 }).then(() => true, () => false);
      if (!arrived) {
        // Reconnected at all? A second edit, made well after the restart.
        const again = (await api(page, "GET", "/api/v1/rules")).body as typeof rules;
        const e2 = structuredClone(again.packs.find((p) => p.pack.id === "loyalist")!.entries.find((e) => e.kind === "talent" && e.id === "dodge"));
        e2.text = `${e2.text} E2E-later`;
        await api(page, "POST", "/api/v1/rules/entries", { pack: "loyalist", entry: e2, base: again.meta.loyalist["talent/dodge"].commit });
        const later = await other.waitFor((k: string) => !!document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent?.includes("E2E-later"), [KEY], { timeout: 15_000 }).then(() => true, () => false);
        const both = await other.eval((k: string) => document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent?.includes("E2E-reconnect") ?? false, KEY);
        throw new Error(later ? `the edit made while it reconnected was missed (a later edit arrived${both ? ", carrying it" : ", without it"})` : "after the restart no edit arrives at all (the event stream never reconnects)");
      }
    }, other);
    await other.close();
  });
}

// --- accounts -----------------------------------------------------------------------------

export async function accountsFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    const auth = await authenticator(page);
    await openBuilder(page, s.app.url);
    await newCharacter(page, "kroot", realCompendium().archetypes.get("kroot")!.subtypes[0].id);
    await accountAction(s, page, "Create account");
    const base: Repro = { steps: ["browser A: a character, Create account (passkey)"] };
    // Browser B: a visitor with two characters, then the same passkey signs in.
    const b = await s.newPage(undefined, { isolated: true });
    const authB = await authenticator(b);
    const creds = (await page.send<{ credentials: unknown[] }>("WebAuthn.getCredentials", { authenticatorId: auth })).credentials;
    for (const cr of creds) await b.send("WebAuthn.addCredential", { authenticatorId: authB, credential: cr });
    await s.step("signing in from a second browser merges its visitor's characters", { steps: [...base.steps!, "browser B: two characters as a visitor", "browser B: Sign in (the same passkey)"] }, async () => {
      await openBuilder(b, s.app.url);
      await newCharacter(b, "cherubim", realCompendium().archetypes.get("cherubim")!.subtypes[0].id);
      await newCharacter(b, "desperados", realCompendium().archetypes.get("desperados")!.subtypes[0].id);
      await accountAction(s, b, "Sign in");
      await b.waitFor(() => document.querySelectorAll(".char-list .char-row:not(.wb-row)").length === 3, [], { what: "3 characters in browser B", timeout: 15_000 });
      await page.reload();
      await page.waitFor(() => document.querySelector(".builder")?.getAttribute("aria-busy") === "false");
      await openList(page);
      await page.waitFor(() => document.querySelectorAll(".char-list .char-row:not(.wb-row)").length === 3, [], { what: "3 characters in browser A after a reload" });
    }, b);
    await s.checkText("browser B signed in", base, b);
    // One character, two tabs: each edit is a version; nothing is lost.
    const id = ((await api(page, "GET", "/api/v1/characters")).body.characters as { id: string }[])[0].id;
    const tab2 = await s.newPage();
    await s.step("one character edited in two tabs loses neither edit", { steps: [...base.steps!, `two tabs on /c/${id}`, "tab 1: Stats Reroll", "tab 2 (not reloaded): Stats Reroll"] }, async () => {
      await openCharacter(page, s.app.url, id);
      await openCharacter(tab2, s.app.url, id);
      const n0 = await versions(page, id);
      await clickStatsReroll(page);
      await idle(page);
      await clickStatsReroll(tab2);
      await idle(tab2);
      const n1 = await versions(page, id);
      if (n1 !== n0 + 2) throw new Error(`versions ${n0} → ${n1}`);
      const head = totalsOf(await headRecord(page, id));
      const shown2 = await shownTotals(tab2);
      if (shown2.join() !== head.join()) throw new Error(`tab 2 shows ${shown2}, the head is ${head}`);
    }, tab2);
    await tab2.close();
    // (browser A's authenticator gets the passkey as B left it: its sign count went up when B signed in;
    // in A, the default browser context, the cookie can be deleted by CDP)
    for (const cr of (await b.send<{ credentials: { credentialId: string }[] }>("WebAuthn.getCredentials", { authenticatorId: authB })).credentials) {
      await page.send("WebAuthn.removeCredential", { authenticatorId: auth, credentialId: cr.credentialId }).catch(() => {});
      await page.send("WebAuthn.addCredential", { authenticatorId: auth, credential: cr });
    }
    // The session cookie deleted: a visitor again, nothing of the account shown; signing in brings it back.
    await s.step("a deleted session cookie is a new visitor; Sign in restores the account", { steps: [...base.steps!, "delete the session cookie", "reload", "Sign in"] }, async () => {
      await page.send("Network.enable");
      const { cookies } = await page.send<{ cookies: { name: string; domain: string; path: string }[] }>("Network.getCookies", { urls: [s.app.url] });
      const sess = cookies.filter((x) => x.name === "inquisitor_session");
      if (!sess.length) throw new Error(`no session cookie: ${cookies.map((x) => x.name).join(", ")}`);
      for (const x of sess) await page.send("Network.deleteCookies", { name: x.name, domain: x.domain, path: x.path });
      await page.goto(`${s.app.url}/`);
      await page.waitFor(() => document.querySelector(".builder")?.getAttribute("aria-busy") === "false");
      await idle(page);
      const n = ((await api(page, "GET", "/api/v1/characters")).body.characters ?? []).length;
      if (n !== 0) {
        const left = (await page.send<{ cookies: { name: string; value: string }[] }>("Network.getCookies", { urls: [s.app.url] })).cookies;
        throw new Error(`${n} characters without a session (cookies now: ${left.map((x) => `${x.name}=${x.value.slice(0, 6)}…`).join(", ")}; deleted ${sess.map((x) => `${x.domain}${x.path}`).join(", ")})`);
      }
      await accountAction(s, page, "Sign in");
      await openList(page);
      await page.waitFor(() => document.querySelectorAll(".char-list .char-row:not(.wb-row)").length === 3, [], { what: "3 characters after signing in again" });
    });
    await s.step("a forged session cookie is no session (no error page)", { steps: ["a session cookie of garbage", "reload"] }, async () => {
      page.allow.push(/401/);
      await page.send("Network.setCookie", { name: "inquisitor_session", value: "e2e-not-a-session-token", url: s.app.url });
      await page.goto(`${s.app.url}/`);
      await page.waitFor(() => !!document.querySelector(".builder"), [], { what: "the builder" });
      await idle(page);
      const res = await api(page, "GET", "/api/v1/account");
      if (res.status >= 500) throw new Error(`/api/v1/account ${res.status}`);
      if ((res.body as { account?: { signed_in?: boolean } }).account?.signed_in) throw new Error("signed in with a forged cookie");
      page.allow.pop();
    });
    await b.close();
  });
}

// --- downloads --------------------------------------------------------------------------------

/** A saved character from the first seed whose character passes `want`. */
async function seeded(s: Session, arch: string, sub: string, want: (b: ReturnType<typeof randomBuild>) => boolean, name: string): Promise<{ id: string; rec: CharacterRecord }> {
  const c = realCompendium();
  for (let seed = 1; seed < 400; seed++) {
    const b = randomBuild(c, arch, sub, seed);
    if (want(b)) return { id: await saveRecord(s, b.record, name), rec: b.record };
  }
  throw new Error(`no ${arch}/${sub} seed fits`);
}

/** The text of every table cell of a .docx, in order. */
const docxCells = (zip: Uint8Array): string[] =>
  [...unzipEntry(zip, "word/document.xml").matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((m) =>
    [...m[1].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((x) => x[1]).join("").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim(),
  );

export async function downloadStatesFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const sister = await seeded(s, "adepta-sororitas", c.archetypes.get("adepta-sororitas")!.subtypes[0].id, () => true, "E2E Sister");
    const engi = await seeded(s, "enginseers", c.archetypes.get("enginseers")!.subtypes[0].id, (b) => b.character.companions.length > 0, "E2E Enginseer");
    const steps = ["saved characters: E2E Sister, an Enginseer with a Technical Servitor (E2E Enginseer)"];
    await s.step("a Warband download holds every character and the companion's own sheet", { steps: [...steps, "open E2E Enginseer", "Include other characters: E2E Sister", "Download Warband Docx"] }, async () => {
      const set = await api(page, "POST", "/api/v1/settings", { format: "docx", character_id: engi.id, with: [sister.id] });
      if (set.status !== 200) throw new Error(`settings ${set.status}`);
      await openCharacter(page, s.app.url, engi.id);
      await page.waitFor(() => [...document.querySelectorAll(".dl-main")].every((b) => (b.getAttribute("aria-label") ?? b.textContent) === "Download Warband Docx"), [], { what: "Download Warband Docx" });
      const t0 = Date.now();
      await page.click(".char-tools .dl-main");
      const file = await s.chrome.download(t0, "E2E Enginseer, Technical Servitor, E2E Sister.docx");
      const cells = s.readDownload(file, (b) => docxCells(b));
      const names = cells.filter((x) => x === "E2E Enginseer" || x === "E2E Sister" || /Servitor/.test(x));
      // The book's p. 15: "May be accompanied by a Technical Servitor": its sheet follows the Enginseer's.
      if (!names.some((x) => /Servitor/.test(x))) throw new Error(`no Servitor block: ${JSON.stringify(names)}`);
      const text = s.readDownload(file, (b) => docxText(unzipEntry(b, "word/document.xml")));
      const at = ["E2E Enginseer", "Servitor", "E2E Sister"].map((n) => text.indexOf(n));
      if (at.some((x) => x < 0) || !(at[0] < at[1] && at[1] < at[2])) throw new Error(`order in the .docx: ${at}`);
    });
    await s.step("Preview shows the character's sheet and its companion's", { steps: [...steps, "open E2E Enginseer", "Preview"] }, async () => {
      await page.click('.view-tab[data-tab="preview"]');
      await page.waitFor(() => document.querySelectorAll(".char-sheet .sheet").length >= 2 && !document.querySelector(".ccard"), [], { what: "two sheets" });
      await s.checkText("a Preview with a companion", { steps }, page, ["E2E"]);
      await page.click('.view-tab[data-tab="edit"]');
      await page.waitFor(() => !!document.querySelector(".ccard"));
    });
    // Many characters: the list scrolls inside the dropdown, and search finds one.
    const many: string[] = [];
    for (let i = 0; i < 36; i++) many.push(await seeded(s, "imperial-guard", "fighter", () => true, `E2E Trooper ${String(i + 1).padStart(2, "0")}`).then((x) => x.id));
    await s.step("with many characters the dropdown stays in the window, its list scrolls, and search finds one", { steps: ["36 more characters", "open E2E Sister", "Include other characters", "search: 27"] }, async () => {
      await openCharacter(page, s.app.url, sister.id);
      await page.click(".char-tools .dl-arrow");
      await page.waitFor(() => !!document.querySelector(".dl-drop .dl-row"));
      const box = await page.eval(() => {
        const d = document.querySelector(".dl-drop")!.getBoundingClientRect();
        const l = document.querySelector(".dl-drop .dl-list")!;
        return { top: d.top, bottom: d.bottom, h: innerHeight, rows: l.querySelectorAll(".dl-row").length, scrolls: l.scrollHeight > l.clientHeight };
      });
      if (box.top < 0 || box.bottom > box.h) throw new Error(`the dropdown leaves the window: ${JSON.stringify(box)}`);
      if (box.rows !== 37) throw new Error(`${box.rows} rows, 37 others`);
      if (!box.scrolls) throw new Error("the list doesn't scroll");
      await page.click(".dl-drop input.dl-search");
      await page.type("27");
      await page.waitFor(() => [...document.querySelectorAll(".dl-drop .dl-row-name")].map((x) => x.textContent).join() === "E2E Trooper 27", [], { what: "one row" });
      await page.click(".dl-drop .dl-row input");
      await idle(page);
      const st = (await api(page, "GET", "/api/v1/settings")).body.settings;
      if (JSON.stringify(st.with[sister.id]) !== JSON.stringify([many[26]])) throw new Error(`kept ${JSON.stringify(st.with[sister.id])}`);
      await page.key("Escape");
    });
    await s.step("at phone width the dropdown fits the screen and its rows are big enough to tap", { steps: ["phone", "open E2E Sister", "Include other characters"] }, async () => {
      const phone = await s.newPage(PHONE);
      try {
        await phone.goto(`${s.app.url}/c/${sister.id}`);
        await phone.waitFor(() => !!document.querySelector(".char-tools .dl-arrow"), [], { what: "the arrow" });
        await idle(phone);
        await phone.click(".char-tools .dl-arrow");
        await phone.waitFor(() => !!document.querySelector(".dl-drop .dl-row"));
        const box = await phone.eval(() => {
          const d = document.querySelector(".dl-drop")!.getBoundingClientRect();
          const rows = [...document.querySelectorAll(".dl-drop .dl-row, .dl-drop .dl-format-opt")].map((x) => x.getBoundingClientRect().height);
          return { l: d.left, r: d.right, t: d.top, b: d.bottom, w: innerWidth, h: innerHeight, small: rows.filter((x) => x < 24).length };
        });
        if (box.l < 0 || box.r > box.w || box.t < 0 || box.b > box.h) throw new Error(`leaves the screen: ${JSON.stringify(box)}`);
        if (box.small) throw new Error(`${box.small} rows under 24 px`);
        await s.screenshot("phone dropdown", phone);
      } finally {
        await phone.close();
      }
    });
  });
}

// --- history ------------------------------------------------------------------------------------

type RulesBody = { packs: { pack: { id: string }; entries: any[] }[]; meta: Record<string, Record<string, { commit: string }>> };
/** A rules edit through the API (as the editor saves): `fn` changes the entry. */
async function editEntry(page: Page, pack: string, kind: string, id: string, fn: (e: any) => any): Promise<void> {
  const rules = (await api<RulesBody>(page, "GET", "/api/v1/rules")).body;
  const e = structuredClone(rules.packs.find((p) => p.pack.id === pack)!.entries.find((x) => x.kind === kind && x.id === id));
  const next = fn(e);
  const res = next === null
    ? await api(page, "POST", "/api/v1/rules/entries/delete", { pack, kind, id, base: rules.meta[pack][`${kind}/${id}`].commit })
    : await api(page, "POST", "/api/v1/rules/entries", { pack, entry: next, base: rules.meta[pack][`${kind}/${id}`].commit });
  if (res.status !== 200) throw new Error(`rules edit ${kind}/${id}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
}
const addDodgeToInquisitors = (e: any) => {
  e.sections.find((x: { name: string }) => x.name === "Talents").effects.push({ talent: "dodge" });
  return e;
};

export async function historyStatesFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    page.allow.push(/409 \(Conflict\) \S+\/api\/v1\/balance/);
    await s.step("sign up", {}, () => signUp(s, page));
    const id = await newCharacter(page, "inquisitor", "sage");
    const base: Repro = { archetype: "inquisitor", subtype: "sage", steps: ["Create account", "New character Inquisitor Sage", "rules edit: Inquisitors gain Dodge", "reload", "Update to the current rules", "Apply"] };
    await s.step("an update to new rules is a version of its own", base, async () => {
      await editEntry(page, "loyalist", "archetype", "inquisitor", addDodgeToInquisitors);
      await openCharacter(page, s.app.url, id);
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 20_000 });
      const n0 = await versions(page, id);
      await page.clickLabel("Update to the current rules");
      await page.waitFor(() => !!document.querySelector(".rules-update"));
      await page.clickLabel("Apply");
      await idle(page);
      if ((await versions(page, id)) !== n0 + 1) throw new Error("no version for the update");
    });
    await s.step("History compares versions across the rules update", { ...base, steps: [...base.steps!, "History", "Compare with the current version (the version before the update)"] }, async () => {
      await page.clickLabel("History");
      await page.waitFor((x: string) => location.pathname === `/c/${x}/history` && document.querySelectorAll(".hv-card").length >= 2, [id], { what: "the history" });
      await idle(page);
      if (await page.eval(() => !!document.querySelector('[aria-label="Zoom to fit"]'))) await page.clickLabel("Zoom to fit");
      await page.click('.hv-card:not(.is-head) [aria-label="Compare with the current version"]');
      await page.waitFor(() => !!document.querySelector(".hv-compare"));
      const text = await page.eval(() => document.querySelector(".hv-compare")!.textContent ?? "");
      if (!text.includes("Dodge")) throw new Error(`the comparison doesn't name Dodge: "${text.slice(0, 300)}"`);
      await s.checkText("the history comparison across rules", base);
      await page.click('.hv-compare [aria-label="Close"]');
    });
    await s.step("an old version made current again offers the update again", { ...base, steps: [...base.steps!, "History", "Make this the current version (before the update)", "Open in the builder"] }, async () => {
      await page.click('.hv-card:not(.is-head) [aria-label="Make this the current version"]');
      await idle(page);
      await openCharacter(page, s.app.url, id);
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 20_000 });
    });
    // A duplicate of a duplicate: its history leads to its own source.
    await s.step("a duplicate of a duplicate's history links to the first duplicate", { steps: ["Duplicate", "Duplicate (of the copy)", "History", "Duplicated from"] }, async () => {
      await page.clickLabel("Duplicate");
      await idle(page);
      const d1 = /^\/c\/([^/]+)/.exec(new URL(await page.url()).pathname)![1];
      await page.clickLabel("Duplicate");
      await idle(page);
      const d2 = /^\/c\/([^/]+)/.exec(new URL(await page.url()).pathname)![1];
      if (d1 === id || d2 === d1) throw new Error(`ids ${id} ${d1} ${d2}`);
      await page.goto(`${s.app.url}/c/${d2}/history`);
      await page.waitFor(() => !!document.querySelector('[aria-label="Duplicated from"]'), [], { what: "Duplicated from" });
      await page.click('[aria-label="Duplicated from"]');
      await page.waitFor((x: string) => location.pathname.startsWith(`/c/${x}`), [d1], { what: "the first duplicate" });
    });
  });
}

// --- the Word export's cells --------------------------------------------------------------------

export async function docxFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    // Characters with armour, firearms with reloads, quantities, derived changes.
    const picks: { arch: string; sub: string; want: (b: ReturnType<typeof randomBuild>) => boolean }[] = [
      { arch: "eversor-assassin", sub: c.archetypes.get("eversor-assassin")!.subtypes[0].id, want: () => true },
      { arch: "skitarii", sub: "fighter", want: (b) => b.character.items.some((i) => i.qty > 1) && Object.values(b.character.armour).some((a) => a.av > 0) },
      { arch: "imperial-guard", sub: "marksman", want: (b) => b.character.items.some((i) => i.reloads !== undefined || i.qty > 1) },
      { arch: "mutants", sub: "fighter", want: (b) => b.character.weapons.length > 0 || b.character.derived.BIV.mods.length > 0 },
    ];
    for (const [i, p] of picks.entries()) {
      const name = `E2E Sheet ${i}`;
      const rep: Repro = { archetype: p.arch, subtype: p.sub, steps: [`a saved ${p.arch} ${p.sub}`, "Download Docx"] };
      await s.step("the .docx holds the sheet's cells", rep, async () => {
        const { id, rec } = await seeded(s, p.arch, p.sub, p.want, name);
        await openCharacter(page, s.app.url, id);
        const t0 = Date.now();
        await page.click('.char-tools [aria-label="Download Docx"]');
        const file = await s.chrome.download(t0, `${name}.docx`);
        const cells = s.readDownload(file, docxCells);
        const sheet = toSheetCharacter({ ...ops.view(c, rec).character, name }, c);
        const run = (want: string[]) => cells.some((_, k) => want.every((w, j) => cells[k + j] === w));
        const starting = SHEET_STATS.map((x) => sheet.starting[x]);
        if (!run(starting)) throw new Error(`the Starting row ${starting.join(" ")} isn't a run of cells`);
        const armour = SHEET_LOCATIONS.map((x) => sheet.armour[x]);
        if (armour.some(Boolean) && !run(armour)) throw new Error(`the Armour row ${armour.join(" ")} isn't a run of cells`);
        for (const f of sheet.firearms) {
          if (!cells.some((x) => x === f.name)) throw new Error(`firearm ${f.name} has no cell`);
          if (f.reloads && !cells.some((x) => x.replace(/\s/g, "") === `/${f.reloads}`)) throw new Error(`${f.name}: # Rld ${f.reloads} not in a cell`);
        }
        for (const m of sheet.melee) if (!cells.some((x) => x === m.name)) throw new Error(`melee ${m.name} has no cell`);
        const all = cells.join("\n");
        for (const x of sheet.other) if (!all.includes(x)) throw new Error(`"${x}" not in Other Equipment`);
        for (const it of ops.view(c, rec).character.items.filter((x) => x.qty > 1)) if (!all.includes(`×${it.qty}`)) throw new Error(`${it.name} ×${it.qty}: no quantity`);
        void powerScore;
      });
    }
  });
}

// --- rules updates in the UI --------------------------------------------------------------------

export async function rulesUpdateStatesFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    page.allow.push(/409 \(Conflict\) \S+\/api\/v1\/balance/);
    await s.step("sign up", {}, () => signUp(s, page));
    // An Inquisitor whose faction pick (its first named pick) is then taken out of the rules.
    const inq = await seeded(s, "inquisitor", "fighter", () => true, "E2E Faction");
    const arch = c.archetypes.get("inquisitor")!;
    // the first named-option pick the character made
    let pickEff: { id: string; from: { id: string; name?: string }[] } | undefined;
    for (const sec of arch.sections)
      walkEffects(sec.effects, (e) => {
        if (!pickEff && "pick" in e && e.from?.some((y) => "name" in y) && inq.rec.choices[`inquisitor/${e.id}`]?.length) pickEff = e as never;
      });
    if (!pickEff) throw new Error("the Inquisitor made no named pick");
    const chosen = inq.rec.choices[`inquisitor/${pickEff!.id}`]?.[0];
    const optName = pickEff.from.find((y) => y.id === chosen)?.name ?? chosen;
    const base: Repro = { archetype: "inquisitor", subtype: "fighter", record: inq.rec, steps: ["Create account", `a saved Inquisitor (${optName})`, `rules edit: ${optName} removed from ${pickEff!.id}`] };
    // Overrides on it first: a stat set.
    await s.step("a change removing the character's option: Update names it, Apply chooses again, overrides kept", { ...base, steps: [...base.steps!, "WS set to 33 (an override)", "reload", "Update", "Apply", "Choose at random"] }, async () => {
      await openCharacter(page, s.app.url, inq.id);
      const withStat = ops.setStat(c, inq.rec, "WS", 33);
      await api(page, "POST", `/api/v1/characters/${inq.id}/versions`, { parent_id: (await api(page, "GET", `/api/v1/characters/${inq.id}`)).body.character.head_id, record: { ...withStat, rulesVersion: s.rulesVersion }, rules_version: s.rulesVersion, kind: "override" });
      await editEntry(page, "loyalist", "archetype", "inquisitor", (e) => {
        for (const sec of e.sections)
          walkEffects(sec.effects, (x) => {
            if ("pick" in x && x.id === pickEff!.id && x.from) x.from = x.from.filter((y) => !("id" in y && y.id === chosen));
          });
        return e;
      });
      await openCharacter(page, s.app.url, inq.id);
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 20_000 });
      await page.clickLabel("Update to the current rules");
      await page.waitFor(() => !!document.querySelector(".rules-update"));
      const text = await page.eval(() => document.querySelector(".rules-update")!.textContent ?? "");
      if (optName && !text.includes(optName)) throw new Error(`the panel doesn't name ${optName}: "${text.slice(0, 300)}"`);
      await s.checkText("the update panel (an option removed)", base);
      await page.clickLabel("Apply");
      await idle(page);
      if (await page.eval(() => !!document.querySelector(".csec-pending"))) {
        await page.click('.pending-all [aria-label="Choose at random"]');
        await idle(page);
      }
      const rec = await headRecord(page, inq.id);
      const v = ops.view(c, rec);
      if (v.pending.length) throw new Error(`open: ${v.pending.map((p) => p.key)}`);
      if (rec.choices[`inquisitor/${pickEff!.id}`]?.[0] === chosen) throw new Error("the removed option is still chosen");
      if (v.character.stats.WS.final !== 33) throw new Error(`WS ${v.character.stats.WS.final}: the override was lost`);
    });
    await s.step("Apply, Undo, Redo", { ...base, steps: [...base.steps!, "Undo", "Redo"] }, async () => {
      const h0 = (await api(page, "GET", `/api/v1/characters/${inq.id}`)).body.character.head_id;
      await page.clickLabel("Undo");
      await idle(page);
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]'), [], { what: "Update again after Undo" });
      await page.clickLabel("Redo");
      await idle(page);
      const h1 = (await api(page, "GET", `/api/v1/characters/${inq.id}`)).body.character.head_id;
      if (h1 !== h0) throw new Error("Redo didn't go back to the updated version");
      if (await page.eval(() => !!document.querySelector('[aria-label="Update to the current rules"]'))) throw new Error("Update offered after Redo");
    });
    // The character's archetype deleted: its page shows something, no exception.
    const kroot = await seeded(s, "kroot", c.archetypes.get("kroot")!.subtypes[0].id, () => true, "E2E Gone");
    await s.step("a character whose archetype was deleted still opens", { steps: ["a saved Kroot", "rules edit: the Kroot archetype deleted", `/c/<id>`] }, async () => {
      await editEntry(page, c.origin.get("archetype/kroot")!, "archetype", "kroot", () => null);
      await page.goto(`${s.app.url}/c/${kroot.id}`);
      await page.waitFor(() => !!document.querySelector(".builder, .error-page, main"), [], { what: "a page" });
      await idle(page);
      const shown = await page.eval(() => (document.querySelector(".page")?.textContent ?? "").trim().length);
      if (!shown) throw new Error("a blank page");
    });
    await s.checkText("a character whose archetype is gone", { steps: ["the Kroot archetype deleted"] }, page, ["E2E Gone"]);
    // The Update button after an edit made while on another page (the rules page, the history).
    for (const where of ["rules", "history"] as const) {
      const ch = await seeded(s, "inquisitor-acolyte", "fighter", () => true, `E2E ${where}`);
      const steps = [`a saved Acolyte`, `open its ${where} page`, "rules edit: Acolytes gain Catfall (while there)", "go to the character in place"];
      await s.step(`back from the ${where} page after a rules edit, the character offers the update`, { steps }, async () => {
        if (where === "rules") {
          await openCharacter(page, s.app.url, ch.id);
          await page.click('a.site-tab[href="/rules"]');
          await page.waitFor(() => location.pathname === "/rules" && !!document.querySelector(".rb"), [], { what: "the rules page" });
          await idle(page);
        } else {
          await page.goto(`${s.app.url}/c/${ch.id}/history`);
          await page.waitFor(() => document.querySelectorAll(".hv-card").length > 0);
          await idle(page);
        }
        await editEntry(page, "loyalist", "archetype", "inquisitor-acolyte", (e) => {
          e.sections.find((x: { name: string }) => x.name === "Talents").effects.push({ talent: "catfall" });
          return e;
        });
        await new Promise((res) => setTimeout(res, 1500));
        if (where === "rules") await page.click('a.site-tab[href="/"]');
        else await page.click('.hv-card.is-head [aria-label="Open in the builder"]');
        await page.waitFor((x: string) => location.pathname === `/c/${x}` && !!document.querySelector(".char-view"), [ch.id], { what: "the character" });
        await idle(page);
        await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 10_000 });
      });
    }
  });
}
