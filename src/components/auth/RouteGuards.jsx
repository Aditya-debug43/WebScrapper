import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../state/AuthContext";
import "./RouteGuards.css";

/**
 * Who may see what.
 *
 * Both guards deliberately render NOTHING decisive while the stored token
 * is still being checked against the server. A token in localStorage is not
 * evidence of a session, so treating it as one would flash the signed-in
 * interface at someone who is signed out; treating its absence as proof
 * would bounce a signed-in user to the door on every reload. Until
 * `/auth/me` answers, the only honest thing to show is that we are asking.
 */

export function RequireAuth() {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) return <RestoringSession />;
  if (!isAuthenticated) return <Navigate to="/sign-in" state={{ from: location }} replace />;
  return <Outlet />;
}

/** The mirror: a signed-in user has no business on the sign-in screen. */
export function RedirectIfAuthenticated() {
  const { isAuthenticated, isRestoring } = useAuth();
  if (isRestoring) return <RestoringSession />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * Held for the length of one `/auth/me` round trip. Quiet on purpose: a
 * spinner here would make a 40ms check look like a problem.
 */
function RestoringSession() {
  return (
    <div className="session-restoring" role="status" aria-live="polite">
      <span className="session-restoring-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="session-restoring-text">Restoring your session…</span>
    </div>
  );
}
