// `npm run dev`: pending migrations, then esbuild rebuilding the browser
// code (src/client) on every change, and the server under node --watch
// (type stripping, .env.local). The server re-reads
// dist/client/manifest.json when it changes, so a client rebuild needs no
// restart; reload the page to see it. Ctrl-C stops both.
import { spawn, spawnSync } from "node:child_process";
import { watchClient } from "./client.ts";

const node = [process.execPath, "--env-file-if-exists=.env.local", "--disable-warning=ExperimentalWarning"] as const;
const migrate = spawnSync(node[0], [...node.slice(1), "scripts/migrate.ts"], { stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const client = await watchClient();
const server = spawn(node[0], ["--watch", ...node.slice(1), "src/server.ts"], { stdio: "inherit" });

let stopping = false;
async function stop(code = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.kill("SIGTERM");
  await client.dispose();
  process.exit(code);
}
server.on("exit", (code) => void stop(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => void stop());
