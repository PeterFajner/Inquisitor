// A condition in the book's words: the names it's about, joined by symbols
// ("not" is a Ban icon labelled "Not").
import type { ComponentChildren } from "preact";
import { Ban } from "lucide-preact";
import type { Condition } from "../../../shared/rules/schema.ts";
import type { Ctx, RefKind } from "../ctx.ts";
import { L } from "../labels.ts";
import { Ic } from "./ui.tsx";

/** "Not …": the Ban icon before what's negated. */
export const Not = ({ children }: { children: ComponentChildren }) => (
  <span class="not">
    <Ic icon={Ban} label={L.not} size={12} />
    {children}
  </span>
);

export function condText(c: Condition, ctx: Ctx): ComponentChildren {
  if (c && typeof c === "object" && "not" in c) return <Not>{condText(c.not, ctx)}</Not>;
  if (c && typeof c === "object" && "psyker" in c && !c.psyker) return <Not>Psyker</Not>;
  if (c && typeof c === "object" && ("any" in c || "all" in c)) {
    const list = "any" in c ? c.any : c.all;
    return list.map((x, i) => (
      <>
        {i > 0 && ("any" in c ? " / " : " + ")}
        {condText(x, ctx)}
      </>
    ));
  }
  return condString(c, ctx);
}

function condString(c: Condition, ctx: Ctx): string {
  if (!c || typeof c !== "object") return "";
  if ("alignment" in c) return c.alignment.join(" · ");
  if ("subtype" in c) return c.subtype.map((s) => ctx.subtypes.get(s) ?? cap(s)).join(" · ");
  if ("option" in c) return c.option.map((o) => ctx.options.get(o) ?? o).join(" · ");
  if ("archetype" in c) return c.archetype.map((a) => ctx.names.name("archetype", a)).join(" · ");
  if ("has" in c)
    return Object.entries(c.has)
      .filter(([, v]) => v)
      .map(([k, v]) => ctx.names.name(k as RefKind, v as string))
      .join(" + ");
  if ("not" in c || "any" in c || "all" in c) return "";
  if ("stat" in c) return [c.above !== undefined ? `${c.stat} > ${c.above}` : "", c.below !== undefined ? `${c.stat} < ${c.below}` : ""].filter(Boolean).join(" · ");
  if ("rolled" in c) return c.rolled.map((t) => ctx.names.name("table", t)).join(" · ");
  if ("psyker" in c) return c.psyker ? "Psyker" : "";
  if ("generates" in c) return c.generates.join(" · ");
  return Object.values(c as object)
    .flat()
    .filter((v) => typeof v === "string" || typeof v === "number")
    .join(" · ");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
