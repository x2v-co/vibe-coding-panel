import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: true, forbidOnly: !!process.env.CI,
  retries: 0, timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  // API fixtures must not be bypassed by a previously installed service worker.
  use: { serviceWorkers: 'block', baseURL: 'http://127.0.0.1:4189', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'node tests/browser/server.mjs', url: 'http://127.0.0.1:4189', reuseExistingServer: false },
});
