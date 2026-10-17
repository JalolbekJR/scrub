import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SCRUB_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Each test runs real on-device face detection + OCR, which is slow and gets
  // slower under parallel load — cap workers and give generous timeouts so the
  // ML work isn't starved into false-failing.
  workers: 2,
  timeout: 90000,
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: process.env.SCRUB_BROWSER_EXECUTABLE ? { executablePath: process.env.SCRUB_BROWSER_EXECUTABLE } : {} } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
