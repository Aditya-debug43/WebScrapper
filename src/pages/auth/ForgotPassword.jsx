import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import { Field, FormNotice, SubmitButton } from "../../components/auth/AuthForm";
import { writePending } from "../../components/auth/pendingEmail";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/http";

const STEPS = ["Identify", "Code and new password", "Sign in"];

/**
 * FORGOT PASSWORD — step one of two.
 *
 * The response is the same whether or not an account exists, and this
 * screen is written so that it stays the same. There is no "we don't know
 * that address" state to render, no different copy on the two paths, and no
 * difference in where the reader is sent next — an unauthenticated visitor
 * does not get to learn who has an account here.
 */
export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await requestPasswordReset(email);
      writePending(email, "reset");
      // Always the same destination. Branching here would undo the
      // server's careful refusal to say whether the account exists.
      navigate("/reset-password", { state: { email } });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setError(err.message);
      } else {
        setError("Could not start a password reset. Try again shortly.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Password reset"
      title="Let's get you back in"
      lede="Tell us the address on the account. If there is one, a six-digit code is on its way to it."
      steps={STEPS}
      activeStep={0}
      aside={
        <>
          We will not say <em>whether</em> an account exists. That is not ours to disclose.
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice tone="error">{error}</FormNotice>

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

        <SubmitButton busy={busy} busyLabel="Sending…">
          Send reset code
        </SubmitButton>
      </form>

      <div className="auth-alt">
        <span>
          Remembered it?{" "}
          <Link className="auth-link" to="/sign-in">
            Back to sign in
          </Link>
        </span>
      </div>
    </AuthLayout>
  );
}
