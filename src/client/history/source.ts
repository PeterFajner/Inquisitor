// A duplicated character's first version names the version it was copied
// from (Version.source_id) but not its character: find it among the
// characters this backend can list (the viewer's own, or this browser's).
// One that came from someone else's share link isn't found (null).
import type { Backend } from "../lib/characters.ts";

const found = new Map<string, Promise<string | null>>();

/** The id of the character holding version `versionId`, or null. `skip`: a character not to look in (the duplicate itself). */
export function findSource(backend: Backend, versionId: string, skip?: string): Promise<string | null> {
  const key = `${backend.local ? "local" : "server"}:${versionId}`;
  let p = found.get(key);
  if (!p) {
    p = (async () => {
      try {
        const rows = await backend.list();
        for (const r of rows) {
          if (r.id === skip) continue;
          if (r.head.id === versionId) return r.id;
        }
        for (const r of rows) {
          if (r.id === skip || r.head.id === versionId) continue;
          const c = await backend.get(r.id);
          if (c.versions.some((v) => v.id === versionId)) return c.id;
        }
      } catch {}
      return null;
    })();
    found.set(key, p);
  }
  return p;
}
