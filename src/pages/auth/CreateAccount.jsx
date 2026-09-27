import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/auth/AuthLayout";
import { Field, FormNotice, PasswordField, SubmitButton } from "../../components/auth/AuthForm";
import { writePending } from "../../components/auth/pendingEmail";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/http";

const STEPS = ["Credentials", "Verify address", "Open the desk"];

/**
 * CREATE ACCOUNT — step one of three.
 *
 * Registering does not sign anybody in, and this screen does not pretend
 * otherwise: it ends by handing the reader to verification with the address
 * they typed, because the account is inert until that address is proven.
 *
 * The password rules shown as a hint are the server's, stated once. They
 * are not re-implemented here — an empty or obviously short password is
 * caught by the field's own `required`/`minLength`, and everything else is
 * the server's answer, rendered.
 */
export default function CreateAccount() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [emailInUse, setEmailInUse] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setEmailInUse(false);
    setFieldErrors({});
    try {
      await signUp(email, password);
      writePending(email, "verify");
      navigate("/verify-email", { state: { email, justRegistered: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setEmailInUse(err.code === "EMAIL_IN_USE");
        setError(err.message);
      } else {
        setError("Something went wrong creating your account. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Create account"
      title="Set up your pricing desk"
      lede="Two steps: choose a password, then confirm the address we send a code to."
      steps={STEPS}
      activeStep={0}
      aside={
        <>
          One catalogue, <em>every</em> marketplace it is listed on.
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormNotice
          tone="error"
          action={
            emailInUse ? (
              <Link className="auth-link" to="/sign-in">
                Sign in
              </Link>
            ) : null
          }
        >
          {error}
        </FormNotice>

        <Field
          label="Work email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          hint="We send a six-digit code here to confirm the address."
          disabled={busy}
          autoFocus
          error={fieldErrors.email}
        />

        <PasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="At least 8 characters. Length matters far more than symbols."
          disabled={busy}
          error={fieldErrors.password}
        />

        <SubmitButton busy={busy} busyLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>

      <p className="auth-meta">
        Creating an account gives you a workspace. It does not create a seller account on any marketplace — the
        sellers this tool measures are third parties in the data.
      </p>

      <div className="auth-alt">
        <span>
          Already have an account?{" "}
          <Link className="auth-link" to="/sign-in">
            Sign in
          </Link>
        </span>
      </div>
    </AuthLayout>
  );
}
