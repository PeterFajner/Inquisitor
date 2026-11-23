// HTML templating with escaping by default, for the one page shell every
// page shares (src/views/shell.ts). The pages themselves render in the
// browser (src/client).
//
//   html`<p>${userText}</p>`         userText is escaped
//   html`<ul>${items.map(...)}</ul>` arrays are joined; nested html`` isn't re-escaped
//   raw(trusted)                     opt out, for markup we built ourselves

export class Safe {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export type Html = Safe;
type Value = Safe | string | number | null | undefined | false | Value[];

export const raw = (s: string): Safe => new Safe(s);

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value: Value): string {
  if (value == null || value === false) return "";
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escape(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Safe {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Safe(out);
}

// The page shell shared by every page.
export function page(opts: {
  title: string;
  body: Safe;
  scripts?: string[];
  /** Stylesheets: the client build's (src/views/shell.ts manifest()). */
  css?: string[];
  noindex?: boolean;
  /** Extra markup for <head> (modulepreloads). */
  head?: Safe;
}): string {
  const { title, body, scripts = [], css = [], noindex = false, head } = opts;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ""}
<link rel="icon" href="/static/favicon.ico" sizes="16x16 24x24 32x32 64x64">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
${raw("<script>window.PublicKeyCredential||document.documentElement.classList.add('no-passkeys')</script>")}
${css.map((href) => html`<link rel="stylesheet" href="${href}">`)}
${head ?? ""}
</head>
<body>
${body}
${scripts.map((s) => html`<script type="module" src="${s}"></script>`)}
</body>
</html>`.value;
}
