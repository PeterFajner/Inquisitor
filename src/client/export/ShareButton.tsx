// The share icon: makes the read-only link (./share.ts) and copies it. A
// check mark says it was copied; when the browser won't copy, the link
// itself shows beside the icon, selected, to copy by hand.
import { Check, Link } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ICON, IconButton } from "../builder/Icon.tsx";
import { E } from "./labels.ts";
import { copyText } from "./share.ts";

export function ShareButton({ link, disabled }: { link: () => Promise<string>; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  const [shown, setShown] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [shown]);

  const go = async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      const url = await link();
      if (await copyText(url)) {
        setShown(null);
        setState("copied");
      } else {
        setShown(url);
        setState("idle");
      }
    } catch {
      setState("idle");
    }
  };
  return (
    <span class="share-btn">
      <IconButton label={state === "copied" ? E.copied : E.share} disabled={disabled || state === "busy"} onClick={() => void go()} pressed={state === "copied" ? true : undefined}>
        {state === "copied" ? <Check size={ICON} /> : <Link size={ICON} />}
      </IconButton>
      {shown && (
        <input
          ref={input}
          class="share-url"
          type="url"
          readOnly
          value={shown}
          aria-label={E.share}
          title={E.share}
          onBlur={() => setShown(null)}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </span>
  );
}
