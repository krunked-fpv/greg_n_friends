import fs from 'node:fs';
import path from 'node:path';
import { chromium, defineConfig } from '@playwright/test';

function resolveChromiumExecutable(): string | undefined {
  const defaultPath = chromium.executablePath();
  if (fs.existsSync(defaultPath)) return undefined;
  const msDir = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (fs.existsSync(msDir)) {
    const dirs = fs
      .readdirSync(msDir)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidate = path.join(msDir, dir, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return fs.existsSync(chromeExe) ? chromeExe : undefined;
}

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: resolveChromiumExecutable(),
      headless: true,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
      ],
    },
  },
});
