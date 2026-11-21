import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createApp } from '../../server/app.ts';
import type { StudyImportResponse } from '../../src/types/telemetry.ts';
import type { WildPulseMapDiagnostics } from '../../src/vite-env.d.ts';

type DiagWindow = Window & {
  __WILDPULSE_MAP_DIAGNOSTICS__?: WildPulseMapDiagnostics;
};

const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function isBenignThirdPartyConsoleError(text: string): boolean {
  const lower = text.toLowerCase();
  const isNetworkStatusFailure =
    lower.includes('failed to load resource') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_connection') ||
    lower.includes('err_internet_disconnected') ||
    lower.includes('cors');
  if (!isNetworkStatusFailure) return false;
  return !lower.includes('127.0.0.1') && !lower.includes('localhost');
}

test.describe('Gate 4: WildPulse Mission Control Full-Stack E2E', () => {
  let server: http.Server;

  test.beforeAll(async () => {
    const app = createApp({ distDir: path.resolve('dist') });
    server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '127.0.0.1', () => resolve());
    });
  });

  test.afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  test('validates HUD, 35-species roster, WebGL map, basemaps, historical focus, expanded species charts, playback, and Movebank license-md5 importer', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const appConsoleErrors: string[] = [];
    const cartoRequests: string[] = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!isBenignThirdPartyConsoleError(text)) {
          appConsoleErrors.push(text);
        }
      }
    });
    page.on('request', (req) => {
      const reqUrl = req.url();
      if (reqUrl.includes('basemaps.cartocdn.com/dark_all')) {
        cartoRequests.push(reqUrl);
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // 1. Header, UTC clock, Proxy Live connection, WebGL map canvas & diagnostics
    await expect(page.getByTestId('operator-header')).toContainText('GREG');
    await expect(page.getByTestId('utc-live-clock')).toContainText('UTC');
    await expect(page.getByTestId('connection-mode-pill')).toContainText('PROXY LIVE', {
      timeout: 20000,
    });

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
    expect(initialDiag?.basemap).toBe('dark-tactical');
    expect(initialDiag?.renderedSegmentCount ?? 0).toBeGreaterThan(0);
    expect(initialDiag?.renderedHeadCount ?? 0).toBeGreaterThan(0);

    // 2. 35-species deduplicated fleet hydration, guild counts & Recency filter pills
    const fleetCards = page.locator('[data-testid^="fleet-card-"]');
    await expect
      .poll(async () => fleetCards.count(), { timeout: 20000 })
      .toBeGreaterThanOrEqual(34);

    const allCount = await fleetCards.count();
    const cardTestIds = await fleetCards.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid') ?? ''),
    );
    expect(cardTestIds.length).toBe(allCount);
    expect(new Set(cardTestIds).size).toBe(allCount);

    const guildAllText = (await page.getByTestId('guild-count-ALL').innerText()).trim();
    const guildAvianText = (await page.getByTestId('guild-count-AVIAN').innerText()).trim();
    const guildMarineText = (await page.getByTestId('guild-count-MARINE').innerText()).trim();
    const guildTerrestrialText = (
      await page.getByTestId('guild-count-TERRESTRIAL').innerText()
    ).trim();
    const guildReptileText = (await page.getByTestId('guild-count-REPTILE').innerText()).trim();
    expect(guildAllText).toMatch(/^\d+$/);
    expect(guildAvianText).toMatch(/^\d+$/);
    expect(guildMarineText).toMatch(/^\d+$/);
    expect(guildTerrestrialText).toMatch(/^\d+$/);
    expect(guildReptileText).toMatch(/^\d+$/);

    const guildAllNum = Number(guildAllText);
    const guildSum =
      Number(guildAvianText) +
      Number(guildMarineText) +
      Number(guildTerrestrialText) +
      Number(guildReptileText);
    expect(guildAllNum).toBe(allCount);
    expect(guildSum).toBe(allCount);
    expect(Number(guildAvianText)).toBeGreaterThan(0);
    expect(Number(guildMarineText)).toBeGreaterThan(0);
    expect(Number(guildTerrestrialText)).toBeGreaterThan(0);
    expect(Number(guildReptileText)).toBeGreaterThan(0);

    await page.getByTestId('guild-filter-AVIAN').click();
    const avianCount = await fleetCards.count();
    expect(avianCount).toBe(Number(guildAvianText));
    expect(avianCount).toBeLessThan(allCount);

    await page.getByTestId('guild-filter-REPTILE').click();
    const reptileCount = await fleetCards.count();
    expect(reptileCount).toBe(Number(guildReptileText));
    expect(reptileCount).toBeLessThan(allCount);

    await page.getByTestId('guild-filter-ALL').click();
    await expect(fleetCards).toHaveCount(allCount);

    await page.getByTestId('recency-filter-ACTIVE_24H').click();
    const active24hCount = await fleetCards.count();
    expect(active24hCount).toBeGreaterThan(0);
    expect(active24hCount).toBeLessThan(allCount);

    await page.getByTestId('recency-filter-LAST_7D').click();
    const last7dCount = await fleetCards.count();
    expect(last7dCount).toBeGreaterThan(0);
    expect(last7dCount).toBeLessThan(allCount);

    await page.getByTestId('recency-filter-HISTORICAL').click();
    const historicalCount = await fleetCards.count();
    expect(historicalCount).toBeGreaterThan(0);
    expect(historicalCount).toBeLessThan(allCount);

    await page.getByTestId('recency-filter-ALL').click();
    await expect(fleetCards).toHaveCount(allCount);

    // 3. Animal Bio-Dossier inspection for kalani-7, luna-01, expanded kuaka-e7, and null-altitude track
    await page.getByTestId('fleet-card-kalani-7').click();
    const dossier = page.getByTestId('animal-bio-dossier');
    await expect(dossier).toBeVisible();
    await expect(dossier).toContainText('Dermochelys coriacea');
    await expect(dossier).toContainText('VU');
    await expect(dossier.locator('[data-testid^="provenance-badge-"]').first()).toBeVisible();
    await expect(dossier).toContainText('Biometrics & Sensor Hardware');
    await expect(dossier.getByTestId('chart-speed')).toBeVisible();
    await expect(dossier.getByTestId('chart-altitude-depth')).toBeVisible();
    await expect(dossier.getByTestId('chart-daily-distance')).toBeVisible();
    await expect(dossier).toContainText('Live Habitat & Weather Context');
    await expect(dossier.locator('footer[aria-label="Researcher Attribution"]')).toBeVisible();

    const kalaniDossierText = await dossier.innerText();
    expect(kalaniDossierText).not.toMatch(/\bNaN\b/);
    expect(kalaniDossierText).not.toMatch(/\bundefined\b/);

    await page.getByTestId('fleet-card-luna-01').click();
    await expect(dossier).toContainText('Carcharodon carcharias');
    const lunaDossierText = await dossier.innerText();
    expect(lunaDossierText).not.toMatch(/\bNaN\b/);
    expect(lunaDossierText).not.toMatch(/\bundefined\b/);

    // Expanded 35-species roster: Bar-tailed Godwit (kuaka-e7) with all 3 telemetry charts
    await page.getByTestId('fleet-card-kuaka-e7').click();
    await expect(dossier).toContainText('Limosa lapponica');
    await expect(dossier).toContainText('Bar-tailed Godwit');
    await expect(dossier.getByTestId('chart-speed')).toBeVisible();
    await expect(dossier.getByTestId('chart-altitude-depth')).toBeVisible();
    await expect(dossier.getByTestId('chart-daily-distance')).toBeVisible();
    expect(await dossier.getByTestId('chart-speed').locator('svg path').count()).toBeGreaterThan(0);
    expect(
      await dossier.getByTestId('chart-altitude-depth').locator('svg path').count(),
    ).toBeGreaterThan(0);
    expect(
      await dossier.getByTestId('chart-daily-distance').locator('svg rect').count(),
    ).toBeGreaterThan(0);
    const kuakaText = await dossier.innerText();
    expect(kuakaText).not.toMatch(/\bNaN\b/);
    expect(kuakaText).not.toMatch(/\bundefined\b/);

    const albatrossCard = page.getByTestId('fleet-card-mb-2911040-4262-84830876');
    if ((await albatrossCard.count()) > 0) {
      await albatrossCard.click();
      await expect(dossier).toContainText('Phoebastria irrorata');
      await expect(dossier.getByTestId('chart-altitude-depth')).toContainText('2D TAG');
      const albText = await dossier.innerText();
      expect(albText).not.toMatch(/\bNaN\b/);
      expect(albText).not.toMatch(/\bundefined\b/);
    }

    // 4. Basemap switcher & Track Color modes preserve rendered WebGL segments & heads across all 35 tracks
    const basemaps = ['satellite', 'terrain', 'ocean', 'dark-tactical'] as const;
    for (const bm of basemaps) {
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

    const trackModes = ['altitude', 'recency', 'animal', 'speed'] as const;
    for (const mode of trackModes) {
      await page.getByTestId(`track-mode-btn-${mode}`).click();
      await expect
        .poll(
          async () =>
            page.evaluate(() => ({
              mode: (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.trackColorMode,
              segments:
                (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedSegmentCount ?? 0,
              heads:
                (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedHeadCount ?? 0,
            })),
          { timeout: 10000 },
        )
        .toEqual({
          mode,
          segments: expect.any(Number),
          heads: expect.any(Number),
        });
      const diag = await page.evaluate(
        () => (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__,
      );
      expect(diag?.renderedSegmentCount ?? 0).toBeGreaterThan(0);
      expect(diag?.renderedHeadCount ?? 0).toBeGreaterThan(0);
    }

    // 5. Last 14d timeline filter + historical live animal selection + Focus Track Window
    await page.getByTestId('timeline-window-14d').click();
    const spottedSealCard = page.getByTestId('fleet-card-atn-174822-spotted-seal');
    const hasSpottedSeal = (await spottedSealCard.count()) > 0;
    const historicalCard = hasSpottedSeal ? spottedSealCard : albatrossCard;
    expect(await historicalCard.count()).toBeGreaterThan(0);

    await historicalCard.click();
    await expect(dossier).toBeVisible();
    await expect(dossier).toContainText(
      hasSpottedSeal ? 'Phoca largha' : 'Phoebastria irrorata',
    );
    await expect
      .poll(
        async () =>
          page.evaluate(() => ({
            segments:
              (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedSegmentCount ?? 0,
            heads:
              (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__?.renderedHeadCount ?? 0,
          })),
        { timeout: 10000 },
      )
      .toEqual({
        segments: expect.any(Number),
        heads: expect.any(Number),
      });
    const histDiag = await page.evaluate(
      () => (window as DiagWindow).__WILDPULSE_MAP_DIAGNOSTICS__,
    );
    expect(histDiag?.renderedSegmentCount ?? 0).toBeGreaterThan(0);
    expect(histDiag?.renderedHeadCount ?? 0).toBeGreaterThan(0);

    const timeReadout = page.getByTestId('timeline-current-time');
    await page.getByTestId('focus-track-window-btn').click();
    const expectedDeploymentYear = hasSpottedSeal ? '2018' : '2008';
    await expect(timeReadout).toContainText(`${expectedDeploymentYear}-`);
    await expect(page.getByTestId('migration-timeline-bar')).toContainText(
      expectedDeploymentYear,
    );
    await page.getByTestId('timeline-window-full').click();

    // 6. Playback clock, Follow-Cam toggle, and Timeline DOM hygiene
    const initialTimeText = (await timeReadout.innerText()).trim();
    expect(initialTimeText).toContain('UTC');

    await page.getByTestId('timeline-play-btn').click();
    await page.waitForTimeout(550);
    const playingTimeText = (await timeReadout.innerText()).trim();
    expect(playingTimeText).toContain('UTC');
    expect(playingTimeText).not.toBe(initialTimeText);

    await page.getByTestId('follow-cam-btn').click();
    await page.waitForTimeout(150);
    await page.getByTestId('timeline-play-btn').click();
    await page.getByTestId('follow-cam-btn').click();

    const timelineText = await page.getByTestId('migration-timeline-bar').innerText();
    expect(timelineText).not.toMatch(/\bNaN\b/);
    expect(timelineText).not.toMatch(/\bundefined\b/);

    // 6. Study Importer Modal: invalid/empty check + deterministic license-md5 -> OK flow + Escape
    const mockTerms =
      'Movebank Study 999001 Terms: Academic & conservation telemetry attribution required.';
    const mockMd5 = crypto.createHash('md5').update(mockTerms, 'utf8').digest('hex');

    await page.route('**/api/studies/999001**', async (route) => {
      const reqUrl = new URL(route.request().url());
      const suppliedMd5 = reqUrl.searchParams.get('licenseMd5');
      if (suppliedMd5 === mockMd5) {
        const now = Date.now();
        const okPayload: StudyImportResponse = {
          studyId: '999001',
          diagnosticStatus: 'OK',
          feedStatus: 'LIVE_API',
          licenseTermsText: mockTerms,
          licenseMd5: mockMd5,
          message: 'Loaded 1 tracked individual from Movebank study 999001.',
          animals: [
            {
              id: 'mb-999001-albatross-demo',
              localIdentifier: 'ALB-999001',
              nickname: 'Waved Albatross (ALB-999001)',
              scientificName: 'Phoebastria irrorata',
              commonName: 'Waved Albatross',
              guild: 'AVIAN',
              sex: 'Female',
              lifeStage: 'Adult',
              massKg: 3.4,
              deploymentStartIso: new Date(now - 7200_000).toISOString(),
              feedStatus: 'LIVE_API',
              sourceProvider: 'MOVEBANK_DIRECT',
              studyId: '999001',
              diagnosticStatus: 'OK',
              colorHex: '#38bdf8',
              latestFix: {
                id: 'mb-999001-f2',
                timestamp: new Date(now - 1800_000).toISOString(),
                timestampMs: now - 1800_000,
                lat: -1.45,
                lon: -89.72,
                altitudeOrDepthMeters: null,
                groundSpeedKmh: 38.5,
                speedIsDerived: false,
                headingDeg: 210,
                externalTempC: null,
                tagVoltage: null,
                argosLc: null,
                accuracyRadiusMeters: null,
                sensorType: 'GPS-GSM',
                segmentDistanceKm: 28.4,
                isOutlierSpike: false,
              },
              fixes: [
                {
                  id: 'mb-999001-f1',
                  timestamp: new Date(now - 7200_000).toISOString(),
                  timestampMs: now - 7200_000,
                  lat: -1.22,
                  lon: -89.58,
                  altitudeOrDepthMeters: null,
                  groundSpeedKmh: 34.0,
                  speedIsDerived: false,
                  headingDeg: 205,
                  externalTempC: null,
                  tagVoltage: null,
                  argosLc: null,
                  accuracyRadiusMeters: null,
                  sensorType: 'GPS-GSM',
                  segmentDistanceKm: 0,
                  isOutlierSpike: false,
                },
                {
                  id: 'mb-999001-f2',
                  timestamp: new Date(now - 1800_000).toISOString(),
                  timestampMs: now - 1800_000,
                  lat: -1.45,
                  lon: -89.72,
                  altitudeOrDepthMeters: null,
                  groundSpeedKmh: 38.5,
                  speedIsDerived: false,
                  headingDeg: 210,
                  externalTempC: null,
                  tagVoltage: null,
                  argosLc: null,
                  accuracyRadiusMeters: null,
                  sensorType: 'GPS-GSM',
                  segmentDistanceKm: 28.4,
                  isOutlierSpike: false,
                },
              ],
              kinematics: {
                totalDistanceKm: 28.4,
                displacement24hKm: 28.4,
                distance24hKm: 28.4,
                avgSpeedKmh: 36.25,
                maxSpeedKmh: 38.5,
                currentSpeedKmh: 38.5,
                currentBearingDeg: 210,
                currentCardinal: 'SSW',
                pingFreshnessMs: 1800_000,
                pingFreshnessLabel: '30m ago',
                daysTracked: 1,
                dailyDistanceSeries: [
                  {
                    dateIso: new Date(now - 1800_000).toISOString().slice(0, 10),
                    distanceKm: 28.4,
                    fixCount: 2,
                    avgSpeedKmh: 36.25,
                  },
                ],
                hasAltitudeOrDepth: false,
              },
              ecology: {
                photoUrl: null,
                photoAttribution: null,
                iucnStatus: 'CR',
                taxonomy: {
                  kingdom: 'Animalia',
                  phylum: 'Chordata',
                  class: 'Aves',
                  order: 'Procellariiformes',
                  family: 'Diomedeidae',
                  genus: 'Phoebastria',
                  species: 'Phoebastria irrorata',
                },
                summaryExtract: 'Critically endangered Galápagos pelagic seabird.',
                wikiUrl: 'https://en.wikipedia.org/wiki/Waved_albatross',
                enriched: true,
              },
              environment: {
                airTempC: 21.4,
                windSpeedKmh: 18.2,
                windDirectionDeg: 155,
                surfacePressureHpa: 1013,
                elevationMeters: 0,
                seaSurfaceTempC: 22.8,
                waveHeightMeters: 1.4,
                oceanCurrentKmh: 1.9,
                solarPhase: 'Daylight',
                solarElevationDeg: 48,
                regionLabel: 'Galápagos Marine Reserve',
                fetchedAt: new Date(now).toISOString(),
              },
              attribution: {
                studyTitle: 'Test Study 999001',
                principalInvestigators: 'Dr. Test Investigator',
                institution: 'Field Institute',
                studyUrl: 'https://www.movebank.org',
                licenseTerms: mockTerms,
                licenseMd5Required: true,
              },
            },
          ],
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(okPayload),
        });
        return;
      }

      const challengePayload: StudyImportResponse = {
        studyId: '999001',
        diagnosticStatus: 'LICENSE_REQUIRED',
        feedStatus: 'LIVE_API',
        animals: [],
        licenseTermsText: mockTerms,
        licenseMd5: mockMd5,
        message: 'Movebank study 999001 requires license acceptance.',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(challengePayload),
      });
    });

    await page.getByTestId('open-study-importer-btn').click();
    const modal = page.getByTestId('study-importer-modal');
    await expect(modal).toBeVisible();

    // Invalid empty input validation
    const studyInput = page.getByTestId('study-id-input');
    await studyInput.fill('   ');
    await page.getByTestId('study-import-submit-btn').click();
    await expect(modal.getByRole('alert')).toContainText('Enter a valid Movebank Study ID');

    // Submit 999001 -> LICENSE_REQUIRED -> accept license -> OK
    await studyInput.fill('999001');
    await page.getByTestId('study-import-submit-btn').click();
    await expect(page.getByTestId('study-import-status-LICENSE_REQUIRED')).toBeVisible();
    await expect(page.getByTestId('license-terms-drawer')).toBeVisible();
    await expect(page.getByTestId('license-md5-hash')).toContainText(mockMd5);
    await expect(page.getByTestId('license-terms-text')).toContainText(mockTerms);

    await page.getByTestId('accept-license-btn').click();
    await expect(page.getByTestId('study-import-status-OK')).toBeVisible();
    await expect(page.getByTestId('fleet-card-mb-999001-albatross-demo')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // Verify imported sparse 2D-tag dossier renders without NaN/undefined
    await expect(dossier.getByTestId('chart-altitude-depth')).toContainText('2D TAG');
    const importedText = await dossier.innerText();
    expect(importedText).not.toMatch(/\bNaN\b/);
    expect(importedText).not.toMatch(/\bundefined\b/);

    expect(cartoRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(appConsoleErrors).toEqual([]);
  });
});
