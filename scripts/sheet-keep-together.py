# Makes each character block of the GM's sheet template keep together:
# no table row splits across pages, every paragraph of a block (its name line
# and every table row but the last) keeps with the next, and the forced page
# break between pages goes, so pages fill with whole blocks.
#   python3 scripts/sheet-keep-together.py src/client/export/sheet-template.docx
import re, sys, zipfile, shutil, tempfile

path = sys.argv[1]
with zipfile.ZipFile(path) as z:
    items = [(i, z.read(i.filename)) for i in z.infolist()]

def keep_next(p: str) -> str:
    if "<w:keepNext/>" in p:
        return p
    m = re.match(r"(<w:p\b[^>]*>)(<w:pPr>)(<w:pStyle [^>]*/>)?", p)
    if m:
        return p[: m.end()] + "<w:keepNext/>" + p[m.end():]
    head = re.match(r"<w:p\b[^>]*>", p)
    if p.startswith("<w:p/>") or head is None:
        return p
    return p[: head.end()] + "<w:pPr><w:keepNext/></w:pPr>" + p[head.end():]

PARA = re.compile(r"<w:p\b(?:[^>]*/>|[^>]*>.*?</w:p>)", re.S)

def row(tr: str, last: bool) -> str:
    if "<w:cantSplit/>" not in tr:
        if "<w:trPr>" in tr:
            tr = tr.replace("<w:trPr>", "<w:trPr><w:cantSplit/>", 1)
        else:
            m = re.match(r"<w:tr\b[^>]*>(<w:tblPrEx>.*?</w:tblPrEx>)?", tr, re.S)
            tr = tr[: m.end()] + "<w:trPr><w:cantSplit/></w:trPr>" + tr[m.end():]
    return tr if last else PARA.sub(lambda m: keep_next(m.group(0)), tr)

def table(tbl: str) -> str:
    rows = list(re.finditer(r"<w:tr\b.*?</w:tr>", tbl, re.S))
    out, at = [], 0
    for n, m in enumerate(rows):
        out += [tbl[at : m.start()], row(m.group(0), n == len(rows) - 1)]
        at = m.end()
    return "".join(out) + tbl[at:]

def document(x: str) -> str:
    x = x.replace("<w:pageBreakBefore/>", "")
    out, at = [], 0
    for m in re.finditer(r"<w:tbl>.*?</w:tbl>", x, re.S):  # the sheet's tables aren't nested
        # the paragraphs between the previous table and this one (the block's name line) keep with it
        out += [PARA.sub(lambda p: keep_next(p.group(0)), x[at : m.start()]), table(m.group(0))]
        at = m.end()
    return "".join(out) + x[at:]

tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".docx").name
with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
    for info, data in items:
        if info.filename == "word/document.xml":
            data = document(data.decode("utf-8")).encode("utf-8")
        z.writestr(info, data)
shutil.move(tmp, path)
