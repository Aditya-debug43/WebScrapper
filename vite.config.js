import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /**
   * Where the dev server forwards `/api` to.
   *
   * This is dev-server configuration, not application configuration — it
   * never reaches the bundle — so a localhost default is safe here in a way
   * it would not be in `src/`. Point it elsewhere with `API_PROXY_TARGET`.
   *
   * With the proxy in place the browser and the API share an origin during
   * development, so the app's default relative base URL (`/api/v1`) works
   * with no .env file and no CORS preflight. A deployed build talks to a
   * different origin and sets `VITE_API_BASE_URL` instead.
   */
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:4000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.js'],
      include: ['tests/**/*.test.{js,jsx}'],
      // The end-to-end run drives two real servers and is started
      // deliberately, not as part of `npm test`.
      exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    },
  }
})
