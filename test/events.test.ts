// The rules event stream across a server restart (src/lib/events.ts): a
// page whose stream saw no event yet still catches up when it reconnects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Broadcaster } from "../src/lib/events.ts";

/** A stream subscribed to `b`, with what was written to it. */
function open(b: Broadcaster, lastEventId?: string) {
  const written: string[] = [];
  const res = { writeHead: () => res, write: (s: string) => (written.push(s), true), end: () => {}, on: () => res } as any;
  const req = { headers: lastEventId ? { "last-event-id": lastEventId } : {}, on: () => req } as any;
  b.subscribe({ req, res, url: new URL("http://x/") } as any);
  return { text: () => written.join(""), lastId: () => [...written.join("").matchAll(/^id: (.*)$/gm)].pop()?.[1] };
}

test("events: a new stream is given an id at once, with no event", () => {
  const b = new Broadcaster();
  const s = open(b);
  assert.equal(s.lastId(), `${b.boot}-0`);
  assert.doesNotMatch(s.text(), /^data:/m);
  b.closeAll();
});

test("events: a stream that saw no event reconnects to a restarted server and gets the reset", () => {
  const before = new Broadcaster({ reset: () => ({ type: "reset", version: "v1" }) });
  const id = open(before).lastId();
  before.closeAll();
  // The restart: a new process, and an edit before the browser reconnects.
  const after = new Broadcaster({ reset: () => ({ type: "reset", version: "v2" }) });
  after.publish({ type: "entry", version: "v2" });
  const again = open(after, id);
  assert.match(again.text(), /^data: \{"type":"reset","version":"v2"\}$/m);
  after.closeAll();
});

test("events: a stream that saw no event reconnects to the same server and gets what it missed", () => {
  const b = new Broadcaster();
  const id = open(b).lastId();
  b.publish({ type: "entry", version: "v2" });
  const again = open(b, id);
  assert.match(again.text(), /^data: \{"type":"entry","version":"v2"\}$/m);
  assert.doesNotMatch(again.text(), /reset/);
  b.closeAll();
});
