// Security, the Word export. Its own file: docx-templates' browser bundle
// replaces the global Buffer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { renderSheetDocx } from "../src/client/export/docx.ts";
import { blankSheetCharacter } from "../src/shared/sheet.ts";

function documentXml(zip: Uint8Array): string {
  const buf = Buffer.from(zip);
  let eocd = buf.length - 22;
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === "word/document.xml") {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    p += 46 + nameLen + extra;
  }
  throw new Error("no word/document.xml");
}

// docx-templates treats text between its literalXmlDelimiter as raw XML:
// a character name from someone else's share link must not write
// WordprocessingML (a DDEAUTO field) into the GM's export, whatever
// delimiter it tries.
test("a character name can't inject raw XML into the Word export", async () => {
  const template = readFileSync("src/client/export/sheet-template.docx");
  const c = blankSheetCharacter();
  c.name = '||<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/c calc"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>||';
  const docx = await renderSheetDocx([c], template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength));
  const xml = documentXml(docx);
  assert.ok(!xml.includes("<w:instrText>DDEAUTO"), "the name came out as raw XML (a DDE field)");
  c.name = c.name.replaceAll("||", "\uE000");
  const again = documentXml(await renderSheetDocx([c], template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength)));
  assert.ok(!again.includes("<w:instrText>DDEAUTO"), "the private-use delimiter came through");
});

