import { Link } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../state/ThemeContext";
import "./AuthLayout.css";

/**
 * The shell every authentication screen is set in.
 *
 * Not a centred card floating on a gradient. The same idea that governs the
 * rest of the application governs the door to it: a document, set in two
 * columns. The left column is the masthead of that document — the wordmark,
 * one editorial line, and a numbered ledger showing where in a multi-step
 * flow the reader currently stands. The right column is the form, set on a
 * measure narrow enough to read and left-aligned like everything else.
 *
 * Below 860px the ledger collapses into a single horizontal line above the
 * form: the progress information still shows, the decorative half does not
 * take a phone screen hostage.
 */
export default function AuthLayout({ eyebrow, title, lede, steps, activeStep = 0, aside, children, footer }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Link to="/" className="auth-brand" aria-label="Mulya — home">
          <span className="auth-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="auth-word">Mulya</span>
        </Link>

        <p className="display auth-statement">
          {aside ?? (
            <>
              A pricing desk for <em>every</em> marketplace your catalogue sells on.
            </>
          )}
        </p>

        {steps?.length ? (
          <ol className="auth-ledger" aria-label="Progress">
            {steps.map((label, index) => {
              const state = index < activeStep ? "done" : index === activeStep ? "current" : "ahead";
              return (
                <li key={label} className={`auth-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
                  <span className="auth-step-n tabular" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="auth-step-label">{label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <p className="auth-aside-foot">
          Observed prices, landed cost and promotion terms — measured, never asserted.
        </p>
      </aside>

      <main className="auth-stage">
        <div className="auth-stage-top">
          <ThemeToggle />
        </div>

        <div className="auth-sheet">
          {eyebrow ? <p className="eyebrow auth-eyebrow">{eyebrow}</p> : null}
          <h1 className="display auth-title">{title}</h1>
          {lede ? <p className="auth-lede">{lede}</p> : null}
          {children}
        </div>

        {footer ? <div className="auth-stage-foot">{footer}</div> : null}
      </main>
    </div>
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {resolved === "dark" ? <Sun size={15} strokeWidth={1.9} /> : <Moon size={15} strokeWidth={1.9} />}
    </button>
  );
}
