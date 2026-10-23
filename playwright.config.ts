import { defineConfig, devices } from '@playwright/test';

const CLIENT = 'http://127.0.0.1:5174';
const EDITOR = 'http://127.0.0.1:5173';

/**
 * A session whose image ships a different Chromium build than this Playwright
 * pins, and cannot download one, points at its own. CI installs the pinned
 * build and leaves this unset.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

/**
 * Browser tests exercise the shipped game client and the shipped editor, not
 * a second test-only app. Keep this separate from Vitest's `*.test.ts` lane
 * under packages/: Playwright owns tests/e2e and starts the real Vite servers
 * on their normal ports.
 *
 * Do not write that lane as a glob in this comment. Its slash-star-star-slash
 * closes the comment, and this file failed to parse from the day it landed
 * (#360) to #1891 — three weeks in which `npm run test:e2e` could not start
 * and nothing ran it to say so.
 *
 * The EDITOR has its own project (#1891). It booted to a blank page for a day
 * and three of its views had been dead for twelve, with every unit test
 * green: Node's `structuredClone` accepts the Vue proxy that Chromium's
 * refuses, so only a browser could see it.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/editor.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: CLIENT },
    },
    {
      name: 'editor',
      testMatch: '**/editor.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: EDITOR, viewport: { width: 1400, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'npm run dev --workspace @ed/client -- --host 127.0.0.1 --strictPort',
      url: CLIENT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // `--workspace`, not the root `dev` script: `npm run dev -- --host …` at
      // the root swallows the flags and vite takes 127.0.0.1 as its root.
      command: 'npm run dev --workspace @ed/editor -- --host 127.0.0.1 --strictPort',
      url: EDITOR,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
