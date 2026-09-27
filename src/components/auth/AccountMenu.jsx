import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { useAuth } from "../../state/AuthContext";
import "./AccountMenu.css";

/**
 * Who is signed in, and the way out.
 *
 * The initials are derived from the address rather than from a name,
 * because a name is optional on this account and an avatar that sometimes
 * says "?" is worse than one that always says something true.
 *
 * Nothing here implies a marketplace identity. This is the operator of the
 * pricing desk; the sellers the desk measures are entities in the data and
 * are never conflated with the person reading it.
 */
export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);

  // Dismiss on an outside click or Escape, and return focus where it was.
  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const initials = initialsFor(user.email);

  async function leave() {
    setBusy(true);
    await signOut();
    setBusy(false);
    setOpen(false);
  }

  return (
    <div className="account" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="account-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account — ${user.email}`}
      >
        <span className="account-initials tabular" aria-hidden="true">
          {initials}
        </span>
      </button>

      {open ? (
        <div className="account-panel" role="menu">
          <div className="account-identity">
            <span className="eyebrow">Signed in as</span>
            <span className="account-email">{user.email}</span>
            {user.lastLoginAt ? (
              <span className="account-detail">
                Last sign-in <time dateTime={user.lastLoginAt}>{formatWhen(user.lastLoginAt)}</time>
              </span>
            ) : null}
          </div>

          <button type="button" className="account-action" onClick={leave} disabled={busy} role="menuitem">
            <LogOut size={14} strokeWidth={1.9} aria-hidden="true" />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The signed-out counterpart, so the masthead never looks half-built. */
export function SignInAction({ onNavigate }) {
  return (
    <button type="button" className="account-signin" onClick={onNavigate}>
      <UserRound size={14} strokeWidth={1.9} aria-hidden="true" />
      Sign in
    </button>
  );
}

function initialsFor(email) {
  const local = String(email).split("@")[0] ?? "";
  const parts = local.split(/[._\-+]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase() || "??";
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
