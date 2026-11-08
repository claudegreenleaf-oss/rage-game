import { defineConfig, devices } from '@playwright/test';

// One browser smoke test against the production build (served at the GitHub Pages base path).
export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/rage-game/',
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/rage-game/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
