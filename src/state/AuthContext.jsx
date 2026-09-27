import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as authApi from "../api/authService";
import { ApiError } from "../api/http";

/**
 * WHO IS USING THE APPLICATION.
 *
 * There is no fallback user, no development bypass and no shape here that
 * can be true without the server saying so. `user` is null until `/auth/me`
 * returns one, and it goes back to null the moment a request comes back 401.
 * If the backend is down, the application is signed out — which is the
 * honest state, not a degraded one.
 *
 * ── An application user is not a marketplace seller ──────────────────────
 * The person signing in operates the pricing desk. A SELLER is an entity in
 * the analysed data — a third party on Amazon or Flipkart whose offers this
 * tool measures. They are different tables, different lifecycles and
 * different meanings, and nothing in this file may blur them. `user` here
 * NEVER carries a seller identity.
 */

/**
 * Versioned, so a change to what is stored cannot be silently misread from
 * an old browser. The token is the only thing persisted: the user record is
 * always re-fetched, because a cached copy is a claim about server state
 * that nothing keeps true.
 */
const TOKEN_KEY = "mulya.auth.token.v1";

/** localStorage throws in some privacy modes; a failure there is not fatal. */
const storage = {
  read() {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      if (value) window.localStorage.setItem(TOKEN_KEY, value);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* the session simply does not survive a reload */
    }
  },
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => storage.read());
  const [user, setUser] = useState(null);
  /** "restoring" until the stored token has been checked against the server. */
  const [status, setStatus] = useState(() => (storage.read() ? "restoring" : "anonymous"));
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const clearSession = useCallback(() => {
    storage.write(null);
    setToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  /**
   * Accept a session the server granted — and nothing less.
   *
   * A response missing either half is a failure, not a partial success: a
   * user object with no token cannot authorise a single subsequent request,
   * and treating it as a session would put the application in a signed-in
   * state that the server has no record of. That is precisely the fake
   * login state this design exists to make impossible.
   */
  const adoptSession = useCallback((result) => {
    if (!result?.token || !result?.user) {
      throw new ApiError("UNEXPECTED_ERROR", "The server did not return a usable session. Try again.");
    }
    storage.write(result.token);
    setToken(result.token);
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  /**
   * Validate the stored token exactly once on load.
   *
   * A token in localStorage proves nothing: it may be revoked, expired, or
   * left over from a database that has been reset. Until `/auth/me` answers,
   * the application is "restoring" and renders neither the signed-in nor the
   * signed-out interface — showing either would be a guess.
   */
  useEffect(() => {
    const stored = storage.read();
    if (!stored) {
      setStatus("anonymous");
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const result = await authApi.fetchCurrentUser(stored);
        if (cancelled) return;
        setToken(stored);
        setUser(result.user);
        setStatus("authenticated");
      } catch (error) {
        if (cancelled) return;
        // A network failure is not proof the session is dead, but we cannot
        // act as though it is alive either. Both paths end signed out; only
        // an actual rejection discards the token.
        if (error instanceof ApiError && error.status === 401) storage.write(null);
        setToken(null);
        setUser(null);
        setStatus("anonymous");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  /* ------------------------------------------------------------- actions */

  const signIn = useCallback(
    async (email, password) => adoptSession(await authApi.login(email, password)),
    [adoptSession]
  );

  const signUp = useCallback((email, password) => authApi.register(email, password), []);

  const confirmEmail = useCallback(
    async (email, code) => adoptSession(await authApi.verifyEmail(email, code)),
    [adoptSession]
  );

  const resendVerification = useCallback((email) => authApi.resendVerification(email), []);
  const requestPasswordReset = useCallback((email) => authApi.forgotPassword(email), []);
  const confirmResetCode = useCallback((email, code) => authApi.verifyResetOtp(email, code), []);

  /**
   * Resetting a password revokes every session, including this one. The
   * local state is cleared to match rather than left holding a token the
   * server has already killed.
   */
  const completePasswordReset = useCallback(
    async (email, resetToken, password) => {
      const result = await authApi.resetPassword(email, resetToken, password);
      clearSession();
      return result;
    },
    [clearSession]
  );

  const signOut = useCallback(async () => {
    const current = tokenRef.current;
    // Local state is cleared first and unconditionally: if the network call
    // fails, the user is still signed out of this browser, which is what
    // they asked for. The server-side revocation is idempotent.
    clearSession();
    if (current) {
      try {
        await authApi.logout(current);
      } catch {
        /* already signed out locally */
      }
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      token,
      status,
      isAuthenticated: status === "authenticated" && user != null,
      isRestoring: status === "restoring",
      signIn,
      signUp,
      confirmEmail,
      resendVerification,
      requestPasswordReset,
      confirmResetCode,
      completePasswordReset,
      signOut,
    }),
    [
      user,
      token,
      status,
      signIn,
      signUp,
      confirmEmail,
      resendVerification,
      requestPasswordReset,
      confirmResetCode,
      completePasswordReset,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
