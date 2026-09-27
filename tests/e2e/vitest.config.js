import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * The end-to-end project.
 *
 * Separate from the main config for one reason: `setupFiles` there installs
 * nothing, but the unit suite's tests stub `fetch`. Here there is no stub of
 * any kind — jsdom's fetch goes to the real API over real HTTP, which is
 * the whole point.
 *
 * `VITE_API_BASE_URL` is injected from the live server's port, so the
 * application's own configuration path is the one under test rather than a
 * value written into the test.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(process.env.E2E_API_BASE),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/e2e/**/*.test.jsx"],
    setupFiles: ["./tests/e2e/setup.js"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file, in order: the flows share a live database on purpose, and
    // running them in parallel would make "this account already exists"
    // depend on scheduling.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
