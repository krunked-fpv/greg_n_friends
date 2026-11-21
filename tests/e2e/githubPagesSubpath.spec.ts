import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { WildPulseMapDiagnostics } from '../../src/vite-env.d.ts';

type DiagWindow = Window & {
  __WILDPULSE_MAP_DIAGNOSTICS__?: WildPulseMapDiagnostics;
};

const SUBPATH_PORT = 4273;
const SUBPATH_URL = `http://127.0.0.1:${SUBPATH_PORT}/wildpulse/`;

async function waitForSubpathServerReady(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // Server not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Subpath preview server failed to become ready at ${url}`);
}

test.describe('Challenge 5: GitHub Pages Subpath (/wildpulse/) Static Unleashed E2E', () => {
  let serverProc: ChildProcess | null = null;

  test.beforeAll(async () => {
    const scriptPath = path.resolve('scripts', 'serve-subpath-preview.mjs');
    serverProc = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        SUBPATH_PORT: String(SUBPATH_PORT),
        SUBPATH_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForSubpathServerReady(SUBPATH_URL);
  });

  test.afterAll(async () => {
    if (!serverProc || serverProc.killed) return;
    const exited = new Promise<void>((resolve) => {
      serverProc?.once('exit', () => resolve());
    });
    serverProc.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (serverProc.exitCode === null) {
      serverProc.kill('SIGKILL');
    }
  });

  test('hydrates fleet under /wildpulse/ with /api/health returning 404, renders MapLibre, opens kalani-7, and scrubs playback', async ({
    page,
  }) => {
    // Verify Express /api is completely absent under subpath hosting
    const apiHealthRes = await fetch(`http://127.0.0.1:${SUBPATH_PORT}/wildpulse/api/health`);
    expect(apiHealthRes.status).toBe(404);
    const rootRes = await fetch(`http://127.0.0.1:${SUBPATH_PORT}/`);
    expect(rootRes.status).toBe(404);

    const pageErrors: string[] = [];
    const appConsoleErrors: string[] = [];
    const unexpectedRootRequests: string[] = [];
    const cartoRequests: string[] = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const lower = text.toLowerCase();
        const isThirdPartyNetErr =
          (lower.includes('failed to load resource') ||
            lower.includes('err_name_not_resolved') ||
            lower.includes('err_connection') ||
            lower.includes('err_internet_disconnected') ||
            lower.includes('cors')) &&
          !lower.includes('127.0.0.1') &&
          !lower.includes('localhost');
        if (!isThirdPartyNetErr) {
          appConsoleErrors.push(text);
        }
      }
    });
    page.on('request', (req) => {
      const reqUrl = req.url();
      if (reqUrl.includes('basemaps.cartocdn.com/dark_all')) {
        cartoRequests.push(reqUrl);
      }
      if (
        reqUrl.startsWith(`http://127.0.0.1:${SUBPATH_PORT}/`) &&
        !reqUrl.startsWith(SUBPATH_URL)
      ) {
        unexpectedRootRequests.push(reqUrl);
      }
    });

    await page.goto(SUBPATH_URL, { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('operator-header')).toContainText('GREG');
    await expect(page.getByTestId('connection-mode-pill')).toContainText('CI SNAPSHOT', {
      timeout: 20000,
    });

    const fleetCards = page.locator('[data-testid^="fleet-card-"]');
    await expect
      .poll(async () => fleetCards.count(), { timeout: 20000 })
      .toBeGreaterThanOrEqual(34);

    const cardCount = await fleetCards.count();
    const cardTestIds = await fleetCards.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid') ?? ''),
    );
    expect(cardTestIds.length).toBe(cardCount);
    expect(new Set(cardTestIds).size).toBe(cardCount);

    await expect(page.getByTestId('guild-count-ALL')).toHaveText(String(cardCount));

    const mapCanvas = page.locator('[data-testid="wildpulse-map-container"] canvas');
    await expect(mapCanvas).toBeVisible();
    await expect
      .poll(
        async () =>
          page.evaluate(() => ({
            segments:
              (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedSegmentCount ?? 0,
            heads:
              (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedHeadCount ?? 0,
          })),
        { timeout: 20000 },
      )
      .toEqual({
        segments: expect.any(Number),
        heads: expect.any(Number),
      });
    const initialDiag = await page.evaluate(
      () => (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__,
    );
    expect(initialDiag?.renderedSegmentCount ?? 0).toBeGreaterThan(0);
    expect(initialDiag?.renderedHeadCount ?? 0).toBeGreaterThan(0);

    // Switch across all 4 basemaps and verify MapLibre retains rendered tracks & heads
    for (const bm of ['satellite', 'terrain', 'ocean', 'dark-tactical'] as const) {
      await page.getByTestId(`basemap-btn-${bm}`).click();
      await expect
        .poll(
          async () =>
            page.evaluate(() => ({
              basemap: (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.basemap,
              segments:
                (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedSegmentCount ?? 0,
              heads:
                (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedHeadCount ?? 0,
            })),
          { timeout: 10000 },
        )
        .toEqual({
          basemap: bm,
          segments: expect.any(Number),
          heads: expect.any(Number),
        });
      const diag = await page.evaluate(
        () => (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__,
      );
      expect(diag?.renderedSegmentCount ?? 0).toBeGreaterThan(0);
      expect(diag?.renderedHeadCount ?? 0).toBeGreaterThan(0);
    }

    // Open kalani-7 Bio-Dossier and verify clean rendering
    await page.getByTestId('fleet-card-kalani-7').click();
    const dossier = page.getByTestId('animal-bio-dossier');
    await expect(dossier).toBeVisible();
    await expect(dossier).toContainText('Dermochelys coriacea');
    await expect(dossier.getByTestId('chart-speed')).toBeVisible();
    await expect(dossier.getByTestId('chart-altitude-depth')).toBeVisible();
    await expect(dossier.getByTestId('chart-daily-distance')).toBeVisible();

    const dossierText = await dossier.innerText();
    expect(dossierText).not.toMatch(/\bNaN\b/);
    expect(dossierText).not.toMatch(/\bundefined\b/);

    // Scrub playback across the timeline scrubber after drawer layout transition completes
    const scrubber = page.getByTestId('timeline-scrubber');
    let prevWidth = -1;
    await expect
      .poll(
        async () => {
          const cur = await scrubber.boundingBox();
          const w = cur?.width ?? 0;
          const settled = w > 0 && Math.abs(w - prevWidth) < 0.5;
          prevWidth = w;
          return settled;
        },
        { timeout: 5000, intervals: [150, 150, 150] },
      )
      .toBe(true);

    const timeReadout = page.getByTestId('timeline-current-time');
    const beforeScrub = (await timeReadout.innerText()).trim();

    const earlyBox = await scrubber.boundingBox();
    expect(earlyBox).not.toBeNull();
    await scrubber.click({
      position: { x: Math.round(earlyBox!.width * 0.2), y: Math.round(earlyBox!.height / 2) },
    });
    await page.waitForTimeout(100);
    const earlyScrub = (await timeReadout.innerText()).trim();
    expect(earlyScrub).toContain('UTC');
    expect(earlyScrub).not.toBe(beforeScrub);

    const lateBox = await scrubber.boundingBox();
    expect(lateBox).not.toBeNull();
    await scrubber.click({
      position: { x: Math.round(lateBox!.width * 0.8), y: Math.round(lateBox!.height / 2) },
    });
    await page.waitForTimeout(100);
    const lateScrub = (await timeReadout.innerText()).trim();
    expect(lateScrub).toContain('UTC');
    expect(lateScrub).not.toBe(earlyScrub);
    expect(lateScrub > earlyScrub).toBe(true);

    const timelineText = await page.getByTestId('migration-timeline-bar').innerText();
    expect(timelineText).not.toMatch(/\bNaN\b/);
    expect(timelineText).not.toMatch(/\bundefined\b/);

    expect(cartoRequests).toEqual([]);
    expect(unexpectedRootRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(appConsoleErrors).toEqual([]);
  });
});
