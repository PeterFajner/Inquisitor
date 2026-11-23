// Writes src/shared/layout/fonts.ts: each self-hosted face's advance widths
// and vertical metrics, read from the woff2 files in src/static/fonts that
// base.css's @font-face rules name. The card layout (src/shared/layout)
// works out text widths from these, so card heights are known without a
// browser. Run again after changing the fonts:
//
//   node scripts/font-metrics.ts
//
// No dependencies: woff2 is a table directory and one brotli stream (node:zlib).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const FONTS = resolve(ROOT, "src/static/fonts");
const OUT = resolve(ROOT, "src/shared/layout/fonts.ts");

// The woff2 spec's known table tags, by index.
const KNOWN = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

type Table = { data: Buffer; transformed: boolean };

function tablesOf(buf: Buffer): Map<string, Table> {
  let p = 0;
  const u8 = () => buf[p++];
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = u8();
      v = v * 128 + (b & 127);
      if (!(b & 128)) return v;
    }
    throw new Error("bad UIntBase128");
  };
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a woff2 file");
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  p = 48;
  const dir: { tag: string; length: number; transformed: boolean }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = u8();
    const tag = (flags & 63) === 63 ? buf.toString("latin1", p, (p += 4)) : KNOWN[flags & 63];
    const version = flags >> 6;
    const orig = base128();
    // glyf/loca: version 0 is the transformed form; every other table: version 0 is as is.
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : orig, transformed });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + compressed));
  const out = new Map<string, Table>();
  let o = 0;
  for (const d of dir) {
    out.set(d.tag, { data: data.subarray(o, o + d.length), transformed: d.transformed });
    o += d.length;
  }
  return out;
}

function cmapOf(t: Buffer): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0, n = t.readUInt16BE(2); i < n; i++) {
    const off = t.readUInt32BE(8 + 8 * i);
    const format = t.readUInt16BE(off);
    if (format === 4) {
      const segs = t.readUInt16BE(off + 6) / 2;
      const ends = off + 14, starts = ends + 2 * segs + 2, deltas = starts + 2 * segs, ranges = deltas + 2 * segs;
      for (let s = 0; s < segs; s++) {
        const end = t.readUInt16BE(ends + 2 * s), start = t.readUInt16BE(starts + 2 * s);
        const delta = t.readInt16BE(deltas + 2 * s), ro = t.readUInt16BE(ranges + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g = ro === 0 ? (c + delta) & 0xffff : t.readUInt16BE(ranges + 2 * s + ro + 2 * (c - start));
          if (ro !== 0 && g) g = (g + delta) & 0xffff;
          if (g) map.set(c, g);
        }
      }
    } else if (format === 12) {
      for (let k = 0, n = t.readUInt32BE(off + 12); k < n; k++) {
        const s = t.readUInt32BE(off + 16 + 12 * k), e = t.readUInt32BE(off + 20 + 12 * k), g = t.readUInt32BE(off + 24 + 12 * k);
        for (let c = s; c <= e; c++) map.set(c, g + c - s);
      }
    }
  }
  return map;
}

type Face = { upem: number; ascent: number; descent: number; lineGap: number; adv: Map<number, number> };

function faceOf(files: string[]): Face {
  const face: Face = { upem: 0, ascent: 0, descent: 0, lineGap: 0, adv: new Map() };
  for (const file of files) {
    const t = tablesOf(readFileSync(resolve(FONTS, file)));
    const head = t.get("head")!.data, hhea = t.get("hhea")!.data, hmtx = t.get("hmtx")!;
    face.upem = head.readUInt16BE(18);
    face.ascent = hhea.readInt16BE(4);
    face.descent = -hhea.readInt16BE(6);
    face.lineGap = hhea.readInt16BE(8);
    const n = hhea.readUInt16BE(34);
    // A transformed hmtx starts with a flags byte; its advances are stored as is.
    const at = (g: number) => {
      const i = Math.min(g, n - 1);
      return hmtx.transformed ? hmtx.data.readUInt16BE(1 + 2 * i) : hmtx.data.readUInt16BE(4 * i);
    };
    for (const [cp, g] of cmapOf(t.get("cmap")!.data)) if (!face.adv.has(cp)) face.adv.set(cp, at(g));
  }
  return face;
}

// Faces from base.css's @font-face rules: family, weight, style → files.
const css = readFileSync(resolve(ROOT, "src/client/styles/base.css"), "utf8");
const faces = new Map<string, string[]>();
for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
  const body = m[1];
  const family = body.match(/font-family:\s*"([^"]+)"/)?.[1];
  const file = body.match(/url\(\/static\/fonts\/([^)]+\.woff2)\)/)?.[1];
  if (!family || !file) continue;
  const weight = body.match(/font-weight:\s*(\d+)/)?.[1] ?? "400";
  const style = body.match(/font-style:\s*(\w+)/)?.[1] ?? "normal";
  const key = `${family} ${weight} ${style}`;
  faces.set(key, [...(faces.get(key) ?? []), file]);
}

// One shared, sorted list of code points; per face an advance (font units) per code point, 0 = missing.
const parsed = new Map([...faces].map(([k, files]) => [k, faceOf(files)]));
const cps = [...new Set([...parsed.values()].flatMap((f) => [...f.adv.keys()]))].filter((c) => c >= 0x20).sort((a, b) => a - b);
const ranges: [number, number][] = [];
for (const c of cps) {
  const last = ranges.at(-1);
  if (last && last[0] + last[1] === c) last[1]++;
  else ranges.push([c, 1]);
}
const lines = [...parsed].map(([key, f]) => {
  const bytes = Buffer.alloc(cps.length * 2);
  cps.forEach((c, i) => bytes.writeUInt16LE(f.adv.get(c) ?? 0, 2 * i));
  return `  ${JSON.stringify(key)}: { upem: ${f.upem}, ascent: ${f.ascent}, descent: ${f.descent}, lineGap: ${f.lineGap}, advances: "${bytes.toString("base64")}" },`;
});

writeFileSync(
  OUT,
  `// Generated by scripts/font-metrics.ts from src/static/fonts: don't edit.
// Each face ("<family> <weight> <style>") as base.css's @font-face rules
// declare it: vertical metrics (hhea) and the advance width of every code
// point in CODE_POINTS (little-endian uint16 font units, base64; 0 = not in the face).

/** [first code point, count] runs. */
export const CODE_POINTS: [number, number][] = ${JSON.stringify(ranges)};

export type FaceData = { upem: number; ascent: number; descent: number; lineGap: number; advances: string };

export const FACES: Record<string, FaceData> = {
${lines.join("\n")}
};
`,
);
console.log(`${parsed.size} faces, ${cps.length} code points → ${OUT}`);
