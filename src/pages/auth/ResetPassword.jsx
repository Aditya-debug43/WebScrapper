import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import { CodeField, FormNotice, PasswordField, SubmitButton } from "../../components/auth/AuthForm";
import { clearPending, readPending, writePending } from "../../components/auth/pendingEmail";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/http";

const STEPS = ["Identify", "Code and new password", "Sign in"];
const NEEDS_NEW_CODE = new Set(["OTP_EXPIRED", "OTP_ALREADY_USED", "OTP_TOO_MANY_ATTEMPTS"]);

/**
 * RESET PASSWORD — step two of two.
 *
 * Two server calls behind one screen: the code is exchanged for a
 * short-lived reset token, and that token is spent on the new password.
 * They are separate on the wire so the token can be single-use and
 * revocable, but they are one act for the reader, so they are one form.
 *
 * Finishing does NOT sign the user in. A reset revokes every session on the
 * account — including any an attacker was holding — and the point of that
 * is undermined if the browser that performed it is handed a new session
 * without the new password being typed once.
 */
export default function ResetPassword() {
  const { confirmResetCode, completePasswordReset, requestPasswordReset } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const pending = readPending();
  const email = location.state?.email ?? pending?.email ?? null;

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [sent, setSent] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const stored = useRef(false);
  useEffect(() => {
    if (email && !stored.current) {
      stored.current = true;
      writePending(email, "reset");
    }
  }, [email]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  if (!email) return <Navigate to="/forgot-password" replace />;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    setFieldErrors({});
    try {
      const { resetToken } = await confirmResetCode(email, code);
      await completePasswordReset(email, resetToken, password);
      clearPending();
      navigate("/sign-in", {
        replace: true,
        state: { notice: "Password updated. Sign in with your new password." },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setStale(NEEDS_NEW_CODE.has(err.code) || err.code === "RESET_TOKEN_INVALID");
        const remaining = err.details?.attemptsRemaining;
        setError(
          typeof remaining === "number" && remaining > 0
            ? `${err.message} ${remaining} attempt${remaining === 1 ? "" : "s"} left on this code.`
            : err.message
        );
      } else {
        setError("Could not reset your password. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    setSent(null);
    try {
      await requestPasswordReset(email);
      setSent("A new code is on its way.");
      setStale(false);
      setCode("");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.code === "OTP_COOLDOWN") setCooldown(err.details?.retryAfterSeconds ?? 60);
      } else {
        setError("Could not send a new code. Try again shortly.");
      }
    } finally {
      setResending(false);
    }
  }

  const resendLabel = resending ? "Sending…" : cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code";

  return (
    <AuthLayout
      eyebrow="Password reset"
      title="Choose a new password"
      lede={
        <>
          Enter the code sent to <span className="auth-target">{email}</span>, then the password you want to use
          from now on.
        </>
      }
      steps={STEPS}
      activeStep={1}
      aside={
        <>
          Resetting signs out <em>every</em> device. That is the point of it.
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice tone="error">{error}</FormNotice>
        <FormNotice tone="good">{sent}</FormNotice>

        <CodeField value={code} onChange={setCode} disabled={busy || stale} autoFocus />

        <PasswordField
          label="New password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="At least 8 characters, and not one you have used somewhere else."
          disabled={busy || stale}
          error={fieldErrors.password}
        />

        <SubmitButton busy={busy} busyLabel="Updating…" disabled={code.length !== 6 || stale}>
          Update password
        </SubmitButton>
      </form>

      <div className="auth-alt">
        <span>
          Nothing arrived?{" "}
          <button type="button" className="auth-linkbutton" onClick={resend} disabled={resending || cooldown > 0}>
            {resendLabel}
          </button>
        </span>
        <Link className="auth-link" to="/sign-in" onClick={clearPending}>
          Back to sign in
        </Link>
      </div>

      <p className="auth-meta">
        Every session on this account is signed out when the password changes, so you will be asked to sign in
        once with the new one.
      </p>
    </AuthLayout>
  );
}
