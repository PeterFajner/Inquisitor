// Saving an export (the Word and PDF sheets): the file is named `name` (a
// warband's) or after the characters.

export function saveFile(data: Uint8Array, type: string, ext: string, names: string[], name?: string): void {
  const base = name?.trim() || names.map((n) => n.trim()).filter(Boolean).join(", ");
  const fileName = `${(base || "sheet").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120)}.${ext}`;
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
