/**
 * The address a multi-step flow is currently about.
 *
 * Verification and reset both span two screens, so the address has to
 * survive a navigation — and a reload, because "I refreshed the tab while
 * waiting for the email" is the normal case, not the edge case.
 *
 * It is kept in sessionStorage and deliberately NOT in the URL. An address
 * in a query string ends up in browser history, in referrer headers and in
 * every access log the request passes through; sessionStorage ends when the
 * tab does, which is exactly the lifetime of the flow.
 */
const KEY = "mulya.auth.pending.v1";

export function readPending() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.email === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function writePending(email, flow) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ email, flow }));
  } catch {
    /* the flow still works within a single navigation */
  }
}

export function clearPending() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clean up */
  }
}
