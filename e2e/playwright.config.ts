import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5055);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end tests drive the real, built application: one Node process serving the API, the
 * WebSocket endpoint and the client, backed by an in-memory MongoDB seeded with demo data.
 * Run `npm run build` first (CI does).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Calls are tested for real, with generated camera and microphone streams.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    permissions: ['camera', 'microphone'],
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // The phone-sized run covers layout; the long two-person flows run once, on desktop.
      testMatch: /responsive\.spec\.ts|public\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'node ../server/dist/index.js',
    url: `${BASE_URL}/api/health/ready`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Let the server shut down cleanly: it stops its in-memory MongoDB and removes that database's
    // temporary directory (about 200 MB), which a hard kill would leave behind.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    env: {
      NODE_ENV: 'development',
      PORT: String(PORT),
      CLIENT_ORIGINS: BASE_URL,
      MONGODB_URI: '',
      DEMO_MODE: 'true',
      LOG_LEVEL: 'warn',
      UPLOAD_DIR: './e2e/test-results/uploads',
    },
  },
});
