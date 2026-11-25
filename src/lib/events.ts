// A tiny Server-Sent Events broadcaster. Each published event gets an id
// ("<boot>-<n>": unique to this process), is kept in a short replay buffer
// and is written to every open stream. A new stream is given an id at once
// (an id-only frame), so every reconnect carries Last-Event-ID. A client
// reconnecting with it gets what it missed; when that isn't possible (another
// process, or too far behind) it gets a `reset` event instead and should
// fetch everything again. Comments (": ping") keep proxies from closing
// idle streams.
import { randomBytes } from "node:crypto";
import type { Ctx } from "./http.ts";

type Sent = { id: string; n: number; data: string };

export class Broadcaster {
  readonly boot = randomBytes(4).toString("hex");
  private n = 0;
  private buffer: Sent[] = [];
  private streams = new Set<Ctx["res"]>();
  private timer: NodeJS.Timeout | null = null;
  private keep: number;
  private heartbeatMs: number;
  /** Open streams at most (each holds a socket here and in nginx). */
  readonly max: number;
  /** The event sent when a reconnect can't be replayed. */
  reset: () => object;

  constructor(opts: { keep?: number; heartbeatMs?: number; reset?: () => object; max?: number } = {}) {
    this.keep = opts.keep ?? 500;
    this.max = opts.max ?? 500;
    this.heartbeatMs = opts.heartbeatMs ?? 25_000;
    this.reset = opts.reset ?? (() => ({ type: "reset" }));
  }

  get size(): number {
    return this.streams.size;
  }

  publish(event: object): string {
    const n = ++this.n;
    const id = `${this.boot}-${n}`;
    const data = JSON.stringify(event);
    this.buffer.push({ id, n, data });
    if (this.buffer.length > this.keep) this.buffer.splice(0, this.buffer.length - this.keep);
    const frame = `id: ${id}\ndata: ${data}\n\n`;
    for (const res of this.streams) res.write(frame);
    return id;
  }

  // Turn the request into an event stream (never ends from our side). Past
  // `max` open streams a new one gets 503 (the browser retries later).
  subscribe(ctx: Ctx): void {
    const { req, res } = ctx;
    if (this.streams.size >= this.max) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "30", "cache-control": "no-store" });
      res.end("retry: 30000\n\n");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx: don't buffer
    });
    res.write("retry: 3000\n\n");
    const last = req.headers["last-event-id"] ?? ctx.url.searchParams.get("last_event_id");
    if (typeof last === "string" && last) {
      const [boot, num] = last.split("-");
      const n = Number(num);
      const first = this.buffer[0];
      if (boot === this.boot && Number.isInteger(n) && n <= this.n && (n >= this.n || (first && first.n <= n + 1))) {
        for (const e of this.buffer) if (e.n > n) res.write(`id: ${e.id}\ndata: ${e.data}\n\n`);
      } else {
        res.write(`id: ${this.boot}-${this.n}\ndata: ${JSON.stringify(this.reset())}\n\n`);
      }
    } else {
      // An id with no data: no event, but the browser now holds a
      // Last-Event-ID, so a reconnect after a restart (a stream that saw no
      // event yet) gets the `reset` and catches up.
      res.write(`id: ${this.boot}-${this.n}\n\n`);
    }
    this.streams.add(res);
    const done = () => {
      this.streams.delete(res);
      if (!this.streams.size) this.stopHeartbeat();
    };
    req.on("close", done);
    res.on("error", done);
    this.startHeartbeat();
  }

  // Ends every stream (shutdown, tests).
  closeAll(): void {
    for (const res of this.streams) res.end();
    this.streams.clear();
    this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const res of this.streams) res.write(": ping\n\n");
    }, this.heartbeatMs);
    this.timer.unref();
  }

  private stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
