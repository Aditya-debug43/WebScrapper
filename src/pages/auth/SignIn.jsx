import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import { Field, FormNotice, PasswordField, SubmitButton } from "../../components/auth/AuthForm";
import { writePending } from "../../components/auth/pendingEmail";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/http";

/**
 * SIGN IN — email and password.
 *
 * A one-time code is not an alternative route in here. The only thing this
 * screen does with a code is offer to send a verification one when the
 * server says the address was never confirmed, which is the single case
 * where the user is stuck through no fault of their credentials.
 */
export default function SignIn() {
  const { signIn, resendVerification } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);
  // Carried here by a completed password reset, which deliberately ends
  // signed out rather than handing this browser a fresh session.
  const [notice, setNotice] = useState(location.state?.notice ?? null);

  // Where the user was heading before the guard sent them here.
  const destination = location.state?.from?.pathname ?? "/";

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setUnverified(false);
    try {
      await signIn(email, password);
      navigate(destination, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setUnverified(err.code === "EMAIL_NOT_VERIFIED");
        setError(err.message);
      } else {
        setError("Something went wrong signing you in. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Only offered once the server has said this address needs verifying. */
  async function sendVerification() {
    setResending(true);
    try {
      await resendVerification(email);
    } catch {
      /* the verify screen reports and can retry */
    } finally {
      setResending(false);
      writePending(email, "verify");
      navigate("/verify-email", { state: { email } });
    }
  }

  return (
    <AuthLayout
      eyebrow="Sign in"
      title="The desk, where you left it"
      lede="Your tracked products, marketplace comparisons and pricing recommendations."
      aside={
        <>
          Every price it shows was <em>observed</em>, not assumed.
        </>
      }
      footer={
        <>
          Prices, promotions and seller positions in this workspace describe marketplaces. They are not
          financial advice.
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice tone="good">{notice}</FormNotice>
        <FormNotice
          tone="error"
          action={
            unverified ? (
              <button type="button" onClick={sendVerification} disabled={resending}>
                {resending ? "Sending…" : "Send a new code"}
              </button>
            ) : null
          }
        >
          {error}
        </FormNotice>

        <Field
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          disabled={busy}
          autoFocus
          error={fieldErrors.email}
        />

        <PasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
          error={fieldErrors.password}
        />

        <SubmitButton busy={busy} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <div className="auth-alt">
        <span>
          No account yet?{" "}
          <Link className="auth-link" to="/create-account">
            Create one
          </Link>
        </span>
        <Link className="auth-link" to="/forgot-password">
          Forgot password?
        </Link>
      </div>
    </AuthLayout>
  );
}
