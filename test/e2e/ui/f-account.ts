/// <reference lib="dom.iterable" />
// Accounts (a passkey from Chrome's virtual authenticator: the WebAuthn
// DevTools domain), rule edits while signed in with live updates in another
// browser (SSE), and a character brought up to changed rules, each a shard.
import * as ops from "../../../src/client/builder/ops.ts";
import type { Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import { api, headRecord, idle, newCharacter, openBuilder, Session } from "../lib/ui.ts";
import type { RunOptions } from "../shards.ts";
import { withSession } from "./f-builder.ts";
import { openRules } from "./f-rules.ts";

/** A virtual passkey authenticator on this page (resident keys, user verified, no prompts). */
export async function authenticator(page: Page): Promise<string> {
  await page.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await page.send<{ authenticatorId: string }>("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return authenticatorId;
}

const signedIn = async (page: Page) => (await api<{ account: { signed_in: boolean } }>(page, "GET", "/api/v1/page?path=/")).body.account?.signed_in ?? false;

/** Account → the dialog's button with this text. */
export async function accountAction(s: Session, page: Page, text: "Sign in" | "Sign out" | "Create account"): Promise<void> {
  await page.click('.account-btn[aria-label="Account"]');
  await page.waitFor(() => !!document.querySelector("dialog.account-dialog[open]"), [], { what: "the account dialog" });
  await s.checkText(`the account dialog (${text})`, { steps: ["Account"] }, page);
  await page.eval((t: string) => [...document.querySelectorAll("dialog.account-dialog button")].find((b) => b.textContent?.trim() === t)!.setAttribute("data-e2e", "acct"), text);
  await page.click('[data-e2e="acct"]');
  await page.waitFor(() => !document.querySelector("dialog.account-dialog[open]"), [], { what: "the dialog to close (the ceremony done)", timeout: 20_000 });
  await idle(page);
}

const listed = (page: Page) => page.eval(() => document.querySelectorAll(".char-list .char-row:not(.wb-row)").length);

export async function passkeyFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    await authenticator(page);
    await openBuilder(page, s.app.url);
    await newCharacter(page, "kroot", "kroot");
    await newCharacter(page, "cherubim", "cherub");
    const base: Repro = { steps: ["two characters as a visitor"] };
    await s.step("Create account keeps the visitor's characters", { ...base, steps: [...base.steps!, "Account", "Create account"] }, async () => {
      await accountAction(s, page, "Create account");
      if (!(await signedIn(page))) throw new Error("not signed in");
      if ((await listed(page)) !== 2) throw new Error(`${await listed(page)} characters listed`);
      const icon = await page.eval(() => document.querySelector(".account-btn svg")?.getAttribute("class") ?? "");
      if (!/check/i.test(icon)) r.note(`account icon after sign-in: ${icon}`);
    });
    await s.step("Sign out ends the session: no characters", { ...base, steps: [...base.steps!, "Create account", "Account", "Sign out"] }, async () => {
      await accountAction(s, page, "Sign out");
      if (await signedIn(page)) throw new Error("still signed in");
      await page.waitFor(() => document.querySelectorAll(".char-list .char-row:not(.wb-row)").length === 0, [], { what: "an empty list" });
    });
    await s.step("Sign in moves a new visitor's character into the account", { ...base, steps: [...base.steps!, "Sign out", "a character as a new visitor", "Account", "Sign in"] }, async () => {
      await newCharacter(page, "desperados", "desperado");
      await accountAction(s, page, "Sign in");
      if (!(await signedIn(page))) throw new Error("not signed in");
      await page.waitFor(() => document.querySelectorAll(".char-list .char-row:not(.wb-row)").length === 3, [], { what: "3 characters" });
    });
    await s.step("a reload stays signed in", { ...base, steps: [...base.steps!, "reload"] }, async () => {
      await page.reload();
      await page.waitFor(() => document.querySelector(".builder")?.getAttribute("aria-busy") === "false");
      if (!(await signedIn(page))) throw new Error("signed out by a reload");
    });
    await s.step("signed in, the rules page offers editing", { ...base, steps: [...base.steps!, "/rules"] }, async () => {
      await openRules(page, s.app.url, "#loyalist:talent/dodge");
      await page.waitFor(() => !!document.querySelector('.rb-card [aria-label="Edit"]'), [], { what: "an Edit button" });
      await page.waitFor(() => !!document.querySelector('[aria-label="New entry"]'), [], { what: "New entry" });
    });
    await s.checkText("the rules page signed in", base);
  });
}

/** Signs this page up (a new account with a passkey). */
export async function signUp(s: Session, page: Page): Promise<void> {
  await authenticator(page);
  await openBuilder(page, s.app.url);
  await accountAction(s, page, "Create account");
  if (!(await signedIn(page))) throw new Error("not signed in");
}

const cardText = (page: Page, key: string) => page.eval((k: string) => document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent ?? "", key);

export async function ruleEditFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    const KEY = "loyalist:talent/dodge";
    const base: Repro = { steps: ["Create account", `/rules#${KEY}`] };
    await s.step("sign up", base, () => signUp(s, page));
    // Another browser, not signed in, watching the same card.
    const other = await s.newPage(undefined, { isolated: true });
    await openRules(other, s.app.url, `#${KEY}`);
    await s.step("not signed in, no Edit", { steps: [`another browser: /rules#${KEY}`] }, async () => {
      if (await other.eval(() => !!document.querySelector('[aria-label="Edit"], [aria-label="New entry"]'))) throw new Error("edit controls for a visitor");
    }, other);
    await openRules(page, s.app.url, `#${KEY}`);
    const before = await cardText(page, KEY);
    await s.step("Edit, change the text, Save: the card shows it", { ...base, steps: [...base.steps!, "Edit", "Text += E2E-live", "Save"] }, async () => {
      await page.click(`.rb-card[data-key="${KEY}"] [aria-label="Edit"]`);
      await page.waitFor(() => !!document.querySelector('.rb-panel textarea[aria-label="Text"]'), [], { what: "the editor" });
      await s.checkText("the rules editor", base);
      await page.eval(() => {
        const t = document.querySelector('.rb-panel textarea[aria-label="Text"]') as HTMLTextAreaElement;
        t.focus();
        t.selectionStart = t.selectionEnd = t.value.length;
      });
      await page.type(" E2E-live");
      await page.click('.rb-panel [aria-label="Save"]');
      await idle(page);
      await page.waitFor((k: string) => !!document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent?.includes("E2E-live"), [KEY], { what: "the card's new text" });
    });
    await s.step("the other browser shows the edit live (no reload)", { steps: [`another browser: /rules#${KEY}`, "(the edit)"] }, async () => {
      await other.waitFor((k: string) => !!document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent?.includes("E2E-live"), [KEY], { what: "the edit, live", timeout: 15_000 });
    }, other);
    await s.step("the card's History lists the edit; revert", { ...base, steps: [...base.steps!, "History", "Revert to this version (the book's)"] }, async () => {
      if (await page.eval(() => !!document.querySelector(".rb-panel .rules-panel.history"))) await page.click('.rb-panel [aria-label="Close"]').catch(() => {});
      await page.click(`.rb-card[data-key="${KEY}"] [aria-label="History"]`);
      await page.waitFor(() => document.querySelectorAll('.rb-panel [aria-label="Revert to this version"]').length >= 1, [], { what: "the history's versions" });
      await s.checkText("the rules history", base);
      const n = await page.eval(() => document.querySelectorAll('.rb-panel [aria-label="Revert to this version"]').length);
      await page.click('.rb-panel [aria-label="Revert to this version"]', n - 1);
      await idle(page);
      await page.waitFor((k: string) => !document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent?.includes("E2E-live"), [KEY], { what: "the text back" });
      if ((await cardText(page, KEY)) !== before) throw new Error("not back to the book's text");
    });
    await s.step("the other browser shows the revert live", { steps: ["(the revert)"] }, async () => {
      await other.waitFor((k: string) => !document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent?.includes("E2E-live"), [KEY], { what: "the revert, live", timeout: 15_000 });
    }, other);
    // Two editors at once: the second save mustn't silently overwrite the first.
    const second = await s.newPage();
    await openRules(second, s.app.url, `#${KEY}`);
    await s.step("a save against a stale version is refused and shown", { ...base, steps: ["two tabs edit the same card", "tab 1 saves", "tab 2 saves"] }, async () => {
      for (const p of [page, second]) {
        await p.click(`.rb-card[data-key="${KEY}"] [aria-label="Edit"]`);
        await p.waitFor(() => !!document.querySelector('.rb-panel textarea[aria-label="Text"]'));
      }
      for (const [p, t] of [[page, " E2E-one"], [second, " E2E-two"]] as const) {
        await p.eval(() => {
          const t = document.querySelector('.rb-panel textarea[aria-label="Text"]') as HTMLTextAreaElement;
          t.focus();
          t.selectionStart = t.selectionEnd = t.value.length;
        });
        await p.type(t);
      }
      await page.click('.rb-panel [aria-label="Save"]');
      await idle(page);
      second.allow.push(/409/);
      await second.click('.rb-panel [aria-label="Save"]').catch(() => {});
      await idle(second);
      const conflict = await second.eval(() => !!document.querySelector('[aria-label="Changed by someone else"], [aria-label="Keep the newer version"], [aria-label="Keep mine"]'));
      const text = await cardText(page, KEY);
      if (!conflict && text.includes("E2E-two") && !text.includes("E2E-one")) throw new Error("the second save overwrote the first without a word");
      if (!conflict) throw new Error("no conflict shown for a stale save");
    }, second);
    await s.checkText("the conflict", base, second);
    await other.close();
    await second.close();
  });
}

export async function rulesUpdateFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await s.step("sign up", {}, () => signUp(s, page));
    const id = await newCharacter(page, "inquisitor", "fighter");
    const rec0 = await headRecord(page, id);
    const had = ops.view(c, rec0).character;
    const base: Repro = { archetype: "inquisitor", subtype: "fighter", record: rec0, steps: ["Create account", "New character Inquisitor Fighter", "a rules edit: Inquisitors gain Dodge and pick one of Catfall/Medic"] };
    // The rules change (as the editor saves it): a grant and a new pick on the Inquisitor's Talents.
    await page.click('a.site-tab[href="/rules"]');
    await page.waitFor(() => location.pathname === "/rules" && document.querySelectorAll(".rb-card").length > 0, [], { what: "the rules page", timeout: 30_000 });
    // (the balance distributions are served for the current rules only: a character on older rules is answered 409 "stale" and the client estimates; by design)
    page.allow.push(/409 \(Conflict\) \S+\/api\/v1\/balance/);
    await s.step("a rules edit through the API", base, async () => {
      const rules = (await api(page, "GET", "/api/v1/rules")).body as { packs: { pack: { id: string }; entries: any[] }[]; meta: Record<string, Record<string, { commit: string }>> };
      const entry = structuredClone(rules.packs.find((p) => p.pack.id === "loyalist")!.entries.find((e) => e.kind === "archetype" && e.id === "inquisitor"));
      const talents = entry.sections.find((x: { name: string }) => x.name === "Talents");
      talents.effects.push({ talent: "dodge" }, { id: "e2e-pick", pick: 1, from: [{ talent: "catfall" }, { talent: "medic" }] });
      const res = await api(page, "POST", "/api/v1/rules/entries", { pack: "loyalist", entry, base: rules.meta.loyalist["archetype/inquisitor"].commit });
      if (res.status !== 200) throw new Error(`save: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
      // The rules page shows it live.
      await page.waitFor(() => !!document.querySelector('.rb-card[data-key="loyalist:archetype/inquisitor"]')?.textContent?.includes("Catfall"), [], { what: "the edit on the rules page", timeout: 15_000 }).catch(() => {});
      await page.click('a.site-tab[href="/"]');
      await page.waitFor(() => !!document.querySelector(".char-view")?.checkVisibility(), [], { what: "the character" });
      await idle(page);
    });
    // The edit is made while this tab shows the rules page (it follows the edit live), then back to Characters.
    await s.step("back from the rules page, the character offers the update", { ...base, steps: [...base.steps!, "Rules (top bar), the edit arrives live", "Characters (top bar)"] }, async () => {
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 10_000 });
    });
    await s.step("after a reload, the character offers the update", { ...base, steps: [...base.steps!, "reload"] }, async () => {
      await page.reload();
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 20_000 });
    });
    page.allow.pop();
    await s.step("Update shows what changes, Apply makes it", { ...base, steps: [...base.steps!, "Update to the current rules", "Apply"] }, async () => {
      await page.clickLabel("Update to the current rules");
      await page.waitFor(() => !!document.querySelector(".rules-update"), [], { what: "the update panel" });
      const text = await page.eval(() => document.querySelector(".rules-update")!.textContent ?? "");
      if (!had.talents.some((t) => t.id === "dodge") && !text.includes("Dodge")) throw new Error(`the panel doesn't name Dodge: "${text}"`);
      await s.checkText("the rules update panel", base);
      await page.clickLabel("Apply");
      await idle(page);
      const rec = await headRecord(page, id);
      const after = ops.view(c, rec);
      if (after.pending.length) throw new Error(`open after the update: ${after.pending.map((p) => p.key)}`);
      if (!rec.choices["inquisitor/e2e-pick"]) throw new Error("the new pick wasn't made");
      if (await page.eval(() => !!document.querySelector('[aria-label="Update to the current rules"]'))) throw new Error("still offers the update");
      const shown = await page.eval(() => document.querySelector(".char-view")!.textContent ?? "");
      if (!shown.includes("Dodge")) throw new Error("Dodge not shown after the update");
    });
    await s.step("the old version still shows under its own rules (history)", { ...base, steps: [...base.steps!, "Undo"] }, async () => {
      await page.clickLabel("Undo");
      await idle(page);
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]'), [], { what: "the Update button again" });
    });
  });
}
