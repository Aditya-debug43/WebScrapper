import { useId, useState } from "react";
import { AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import "./AuthForm.css";

/**
 * Form primitives shared by the five authentication screens.
 *
 * They hold presentation and accessibility wiring only. No screen here
 * decides whether a password is strong enough or whether a code is still
 * valid — the server owns both, and duplicating either would put two
 * disagreeing rules in the product.
 */

/** A labelled text field. `error` is a string, or null when the field is fine. */
export function Field({
  label,
  hint,
  error,
  type = "text",
  value,
  onChange,
  autoComplete,
  inputMode,
  placeholder,
  disabled,
  autoFocus,
  name,
  required = true,
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        className="field-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the first field of
        // a dedicated single-purpose screen is where the caret belongs.
        autoFocus={autoFocus}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
      />
      {hint && !error ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A password field with a reveal toggle.
 *
 * The toggle exists because the alternative — a confirm-password field — is
 * a second chance to make the same typo, and it is the reason people choose
 * passwords they can type twice rather than passwords they can remember.
 */
export function PasswordField({ label = "Password", autoComplete = "current-password", hint, error, ...rest }) {
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-affix">
        <input
          id={id}
          name={rest.name}
          className="field-input"
          type={revealed ? "text" : "password"}
          value={rest.value}
          onChange={(e) => rest.onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={rest.disabled}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={rest.autoFocus}
          required
          aria-invalid={error ? "true" : undefined}
          aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
        />
        <button
          type="button"
          className="field-reveal"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          tabIndex={-1}
        >
          {revealed ? <EyeOff size={15} strokeWidth={1.8} /> : <Eye size={15} strokeWidth={1.8} />}
        </button>
      </div>
      {hint && !error ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The six-digit code.
 *
 * One input rather than six boxes: six boxes break paste, break screen
 * readers, and break the browser's own one-time-code autofill. This is a
 * single field set in tracked mono, which is what makes a code look like a
 * code without pretending to be six controls.
 */
export function CodeField({ value, onChange, error, disabled, length = 6, autoFocus }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label className="field-label" htmlFor={id}>
        Verification code
      </label>
      <input
        id={id}
        name="code"
        className="field-input field-code tabular"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`[0-9]{${length}}`}
        maxLength={length}
        placeholder={"0".repeat(length)}
        disabled={disabled}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        required
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The form-level message.
 *
 * `role="alert"` so a screen reader announces a rejected sign-in without the
 * user having to go looking for the reason.
 */
export function FormNotice({ tone = "error", children, action }) {
  if (!children) return null;
  const Icon = tone === "good" ? Check : AlertCircle;
  return (
    <div className={`form-notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={15} strokeWidth={1.9} className="form-notice-icon" aria-hidden="true" />
      <span className="form-notice-text">{children}</span>
      {action ? <span className="form-notice-action">{action}</span> : null}
    </div>
  );
}

/** The primary action. Disabled and labelled while a request is in flight. */
export function SubmitButton({ busy, busyLabel, children, disabled }) {
  return (
    <button type="submit" className="btn btn-primary auth-submit" disabled={busy || disabled}>
      {busy ? (
        <>
          <Loader2 size={14} strokeWidth={2} className="spin" aria-hidden="true" />
          {busyLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
