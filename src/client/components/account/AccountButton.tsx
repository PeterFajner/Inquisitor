// The account: one icon. Signed out (no account, or a visitor's) it opens a
// small dialog with "Sign in" and "Create account" (passkeys,
// src/client/lib/account.ts; the only words it shows); signed in it offers
// "Sign out". A visitor's characters stay with either (the server keeps or
// moves them).
//
// The passkey options and the WebAuthn library are fetched when the dialog
// opens, so the tap that starts the ceremony still counts as a gesture
// (Safari). Browsers without passkeys never see the icon (html.no-passkeys).
import { LogOut, UserRound, UserRoundCheck } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  account,
  loadWebauthn,
  passkeyOptions,
  passkeysUsable,
  runPasskey,
  signOut,
  type PasskeyMode,
  type PasskeyOptions,
  type SignedIn,
} from "../../lib/account.ts";
import { useStore } from "../../lib/store.ts";
import "./account.css";

type Props = {
  onSignedIn?: (r: SignedIn) => void;
  onSignedOut?: () => void;
};

const ACCOUNT = "Account";

export function AccountButton(p: Props) {
  const { signedIn } = useStore(account);
  const [open, setOpen] = useState(false);
  if (!passkeysUsable() && !signedIn) return null;
  return (
    <>
      <button
        type="button"
        class="icon-btn account-btn"
        aria-label={ACCOUNT}
        title={ACCOUNT}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {signedIn ? <UserRoundCheck size={20} /> : <UserRound size={20} />}
      </button>
      {open && <AccountDialog {...p} signedIn={signedIn} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccountDialog(p: Props & { signedIn: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const options = useRef<Partial<Record<PasskeyMode, Promise<PasskeyOptions>>>>({});

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    if (!p.signedIn) {
      void loadWebauthn().catch(() => {});
      for (const m of ["sign-in", "register"] as const) {
        const o = passkeyOptions(m);
        o.catch(() => {});
        options.current[m] = o;
      }
    }
    return () => d?.close();
  }, []);

  const ceremony = async (mode: PasskeyMode) => {
    setBusy(true);
    setFailed(false);
    try {
      const opts = await (options.current[mode] ?? passkeyOptions(mode));
      const r = await runPasskey(mode, opts);
      p.onSignedIn?.(r);
      p.onClose();
    } catch {
      // Options are single-use: fetch fresh ones for another try.
      options.current[mode] = passkeyOptions(mode);
      options.current[mode]!.catch(() => {});
      setFailed(true);
      setBusy(false);
    }
  };

  const out = async () => {
    setBusy(true);
    if (await signOut()) {
      p.onSignedOut?.();
      p.onClose();
    } else {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      class={`account-dialog${failed ? " failed" : ""}`}
      aria-label={ACCOUNT}
      aria-busy={busy}
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) p.onClose();
      }}
    >
      {p.signedIn ? (
        <button type="button" class="account-action" disabled={busy} onClick={out}>
          <LogOut size={18} aria-hidden="true" />
          Sign out
        </button>
      ) : (
        <>
          <button type="button" class="account-action" disabled={busy} onClick={() => ceremony("sign-in")}>
            Sign in
          </button>
          <button type="button" class="account-action secondary" disabled={busy} onClick={() => ceremony("register")}>
            Create account
          </button>
        </>
      )}
    </dialog>
  );
}
