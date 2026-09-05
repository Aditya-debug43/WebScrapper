import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "mulya-theme";

/**
 * Three states, not two. "system" is the default and follows the operating
 * system live; "light" and "dark" are explicit choices that stamp
 * `data-theme` on the root element and win over the media query.
 *
 * The initial value is read here and also inline in index.html — the inline
 * copy prevents a white flash before React mounts, this copy keeps the toggle
 * honest about what is actually stored.
 */
function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    // Transitions must be suppressed across the swap, for two reasons. The
    // cosmetic one: 120ms of every colour in the page cross-fading at once
    // reads as a smear, not as a switch. The load-bearing one: when a
    // transitioned property's value comes from a custom property, Chrome can
    // freeze it at the pre-swap colour and never arrive at the new one —
    // leaving, for instance, the masthead links in light-theme grey on a dark
    // ground. Cutting transitions for a frame avoids both.
    root.classList.add("theme-switching");
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => root.classList.remove("theme-switching"))
    );

    if (preference === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", preference);
    try {
      if (preference === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* private mode — the attribute is still applied for this session */
    }

    return () => cancelAnimationFrame(frame);
  }, [preference]);

  const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  // Toggling from "system" commits to the opposite of whatever is on screen,
  // which is what a reader means when they press it.
  const toggle = useCallback(() => {
    setPreference(resolved === "dark" ? "light" : "dark");
  }, [resolved]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
