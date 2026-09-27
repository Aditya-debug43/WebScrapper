import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Every test starts from a browser that knows nothing.
 *
 * Storage is cleared between tests specifically because the thing under
 * test is a session: a token left behind by one test would make the next
 * one pass for the wrong reason.
 */
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom implements neither, and both are used by the layout components the
// authentication screens render inside.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!window.scrollTo) window.scrollTo = () => {};
