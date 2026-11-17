import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// The UI runs against the in-memory backend (ui/src/mock.ts), so these tests
// need no desktop session. Set FEDIT_E2E_BROWSER=webkit to use the engine
// Tauri embeds on Linux and macOS.
const browserName = (process.env.FEDIT_E2E_BROWSER ?? 'chromium') as 'chromium' | 'webkit' | 'firefox';
const systemChromium = ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1421',
    browserName,
    launchOptions:
      browserName === 'chromium' && process.env.FEDIT_E2E_SYSTEM_BROWSER && systemChromium
        ? { executablePath: systemChromium }
        : {},
    permissions: browserName === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [],
  },
  webServer: {
    command: 'npx vite --port 1421 --strictPort',
    url: 'http://localhost:1421',
    reuseExistingServer: !process.env.CI,
  },
});
