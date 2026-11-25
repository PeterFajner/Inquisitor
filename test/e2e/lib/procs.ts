// The processes a shard starts (servers, Chromes), by PID: only these are
// ever killed, on exit or on a signal. Never a broad pkill.
import type { ChildProcess } from "node:child_process";

const mine = new Set<ChildProcess>();

export function track(p: ChildProcess): ChildProcess {
  hookSignals();
  mine.add(p);
  p.on("exit", () => mine.delete(p));
  return p;
}

/** SIGTERM each, then SIGKILL what is still running after a moment. */
export async function stop(p: ChildProcess): Promise<void> {
  if (p.exitCode !== null || p.signalCode !== null || !p.pid) return;
  const gone = new Promise<void>((ok) => p.once("exit", () => ok()));
  p.kill("SIGTERM");
  const t = setTimeout(() => p.kill("SIGKILL"), 3000);
  await gone;
  clearTimeout(t);
}

export async function killAll(): Promise<void> {
  await Promise.all([...mine].map(stop));
}

let hooked = false;
export function hookSignals(): void {
  if (hooked) return;
  hooked = true;
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      for (const p of mine) if (p.pid) p.kill("SIGKILL");
      process.exit(130);
    });
  }
  process.on("exit", () => {
    for (const p of mine) if (p.pid && p.exitCode === null) p.kill("SIGKILL");
  });
}
