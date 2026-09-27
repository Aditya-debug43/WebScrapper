import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import { CodeField, FormNotice, SubmitButton } from "../../components/auth/AuthForm";
import { clearPending, readPending, writePending } from "../../components/auth/pendingEmail";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/http";

const STEPS = ["Credentials", "Verify address", "Open the desk"];

/** Codes that can only be resolved by asking for a new code. */
const NEEDS_NEW_CODE = new Set(["OTP_EXPIRED", "OTP_ALREADY_USED", "OTP_TOO_MANY_ATTEMPTS"]);

/**
 * VERIFY EMAIL — step two of three.
 *
 * Confirming the address also opens the session: to arrive here the reader
 * has already supplied the password AND now proves control of the mailbox,
 * which is strictly more than a normal sign-in establishes.
 *
 * The screen states what is recoverable. A wrong code says how many
 * attempts are left; an exhausted or expired code stops asking for a code
 * and offers a new one instead, because letting someone keep typing into a
 * dead challenge is the cruellest possible failure mode.
 */
export default function VerifyEmail() {
  const { confirmEmail, resendVerification } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const pending = readPending();
  const email = location.state?.email ?? pending?.email ?? null;

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [sent, setSent] = useState(location.state?.justRegistered ? "A code is on its way." : null);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  // Keep the address available across a reload of this screen.
  const stored = useRef(false);
  useEffect(() => {
    if (email && !stored.current) {
      stored.current = true;
      writePending(email, "verify");
    }
  }, [email]);

  // The resend cooldown the server reported, counted down locally so the
  // button says when it will work rather than simply failing again.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  if (!email) return <Navigate to="/create-account" replace />;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await confirmEmail(email, code);
      clearPending();
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setStale(NEEDS_NEW_CODE.has(err.code));
        const remaining = err.details?.attemptsRemaining;
        setError(
          typeof remaining === "number" && remaining > 0
            ? `${err.message} ${remaining} attempt${remaining === 1 ? "" : "s"} left on this code.`
            : err.message
        );
      } else {
        setError("Something went wrong checking that code. Try again.");
      }
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    setSent(null);
    try {
      await resendVerification(email);
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
      eyebrow="Verify address"
      title="Check your email"
      lede={
        <>
          We sent a six-digit code to <span className="auth-target">{email}</span>. It expires in ten minutes and
          works once.
        </>
      }
      steps={STEPS}
      activeStep={1}
      aside={
        <>
          A code proves the address. Your <em>password</em> is what signs you in.
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice tone="error">{error}</FormNotice>
        <FormNotice tone="good">{sent}</FormNotice>

        <CodeField value={code} onChange={setCode} disabled={busy || stale} autoFocus />

        <SubmitButton busy={busy} busyLabel="Verifying…" disabled={code.length !== 6 || stale}>
          Verify and continue
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
          Use a different account
        </Link>
      </div>

      <p className="auth-meta">
        Wrong address? Create the account again with the correct one — an unverified signup is replaced, not
        duplicated.
      </p>
    </AuthLayout>
  );
}
