// Run by app.ts in a child process with CLIENT_OUT and LAYOUT_OUT set (scripts/client.ts reads them when loaded):
// the browser bundle (development: readable stacks, source maps) and the card layout bundle.
import { build } from "esbuild";
import { clientOptions, layoutBuild, layoutOptions } from "../../../scripts/client.ts";

const stamp = await layoutBuild();
await build({ ...clientOptions("development", stamp), logLevel: "warning" });
await build({ ...layoutOptions("development", stamp), logLevel: "warning" });
