// The app's one entry (scripts/client.ts ENTRIES.app): every page is this,
// with what it shows in the page data (PageData, src/shared/api.ts). A
// placeholder until the builder exists: an empty <main>.
import { render } from "preact";
import type { PageData } from "../shared/api.ts";
import { account } from "./lib/account.ts";
import { pageData } from "./lib/api.ts";

const data = pageData<PageData>();
if (data?.account) account.set({ signedIn: data.account.signed_in, publicId: data.account.public_id });

render(<main />, document.getElementById("app")!);
