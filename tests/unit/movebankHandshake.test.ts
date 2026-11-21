import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryCache } from '../../server/cache.ts';
import { MovebankQueue } from '../../server/movebankQueue.ts';
import { MovebankProvider } from '../../server/providers/movebankProvider.ts';
import { TelemetryProvider } from '../../server/telemetryProvider.ts';

describe('Challenge 2: Movebank handshake, JSON/RFC-4180 CSV, AUTH_REQUIRED & TAG_SILENT', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildpulse-mb-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('(a) parses clean Movebank public JSON and RFC-4180 CSV payloads (with quoted commas & CRLF) into OK dossiers', async () => {
    const queue = new MovebankQueue({ minIntervalMs: 0 });

    const jsonPayload = JSON.stringify({
      individuals: [
        {
          individual_id: 4262,
          individual_local_identifier: '4262-84830876',
          individual_taxon_canonical_name: 'Phoebastria irrorata',
          sensor_type_id: 653,
          locations: [
            {
              timestamp: 1730000000000,
              location_lat: -1.35,
              location_long: -89.62,
              height_above_msl: 42.5,
              ground_speed: 12.0,
              heading: 245,
              external_temperature: 22.1,
              tag_voltage: 3.92,
            },
            {
              timestamp: 1730003600000,
              location_lat: -1.52,
              location_long: -89.95,
              height_above_msl: 58.0,
              ground_speed: 11.5,
              heading: 242,
              external_temperature: 21.8,
              tag_voltage: 3.91,
            },
          ],
        },
      ],
    });

    const csvPayload = [
      'timestamp,location-long,location-lat,individual-local-identifier,individual-taxon-canonical-name,height-above-msl,ground-speed,external-temperature,tag-voltage,argos-lc',
      '2025-11-10 06:00:00.000,-122.4194,37.7749,"Tag, ""Alpha-1""","Aquila chrysaetos",640.5,14.2,8.4,4.05,G',
      '2025-11-10 07:00:00.000,-122.6194,37.9749,"Tag, ""Alpha-1""","Aquila chrysaetos",710.0,15.0,7.9,4.04,G',
    ].join('\r\n');

    const jsonProvider = new MovebankProvider({
      queue,
      fetchFn: async () =>
        new Response(jsonPayload, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const jsonRes = await jsonProvider.fetchStudy('2911040', {
      preferPublicJson: true,
    });
    expect(jsonRes.diagnosticStatus).toBe('OK');
    expect(jsonRes.feedStatus).toBe('LIVE_API');
    expect(jsonRes.animals).toHaveLength(1);
    expect(jsonRes.animals[0]!.scientificName).toBe('Phoebastria irrorata');
    expect(jsonRes.animals[0]!.fixes).toHaveLength(2);
    expect(jsonRes.animals[0]!.fixes[1]!.groundSpeedKmh).toBeCloseTo(41.4, 1);

    const csvProvider = new MovebankProvider({
      queue,
      username: 'demo-user',
      password: 'demo-password',
      fetchFn: async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('entity_type=study')) {
          return new Response('', { status: 404 });
        }
        return new Response(csvPayload, {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        });
      },
    });

    const csvRes = await csvProvider.fetchStudy('777001', {
      preferDirectRead: true,
    });
    expect(csvRes.diagnosticStatus).toBe('OK');
    expect(csvRes.animals).toHaveLength(1);
    expect(csvRes.animals[0]!.localIdentifier).toBe('Tag, "Alpha-1"');
    expect(csvRes.animals[0]!.scientificName).toBe('Aquila chrysaetos');
    expect(csvRes.animals[0]!.guild).toBe('AVIAN');
    expect(csvRes.animals[0]!.fixes).toHaveLength(2);
    expect(csvRes.animals[0]!.fixes[0]!.altitudeOrDepthMeters).toBe(640.5);
  });

  it('(b) executes license-md5 handshake without caching LICENSE_REQUIRED, then returns OK on replay with license-md5', async () => {
    const rawLicenseText =
      'By downloading data from Movebank Study 999001, you agree to cite the Principal Investigators and prohibit commercial redistribution.\n';
    const expectedMd5 = crypto
      .createHash('md5')
      .update(rawLicenseText, 'utf8')
      .digest('hex');

    const requestedUrls: string[] = [];
    const receivedCookies: Array<string | null> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const urlStr = String(input);
      requestedUrls.push(urlStr);
      const headers = new Headers(init?.headers);
      receivedCookies.push(headers.get('cookie'));

      if (urlStr.includes('entity_type=study')) {
        return new Response(
          `study_id,name,principal_investigator_name,license_terms\n999001,"Pacific Leatherbacks","Dr. S. Benson","Standard Movebank Academic License"`,
          { status: 200, headers: { 'Content-Type': 'text/csv' } },
        );
      }

      const parsed = new URL(urlStr);
      const suppliedMd5 = parsed.searchParams.get('license-md5');
      if (!suppliedMd5) {
        return new Response(rawLicenseText, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Set-Cookie': 'JSESSIONID=test-session-token; Path=/; HttpOnly',
          },
        });
      }

      if (suppliedMd5 !== expectedMd5) {
        return new Response('Invalid license-md5 digest', { status: 403 });
      }

      const eventCsv = [
        'timestamp,location-long,location-lat,individual-local-identifier,individual-taxon-canonical-name',
        '2025-11-12 00:00:00.000,179.6,-13.65,kalani-test,Dermochelys coriacea',
        '2025-11-12 06:00:00.000,-179.4,-13.95,kalani-test,Dermochelys coriacea',
      ].join('\n');
      return new Response(eventCsv, {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      });
    };

    const queue = new MovebankQueue({ minIntervalMs: 0 });
    const cache = new TelemetryCache({ cacheDir, ttlMs: 60_000 });
    const movebank = new MovebankProvider({
      queue,
      fetchFn: mockFetch,
      username: 'researcher',
      password: 'secret',
    });
    const provider = new TelemetryProvider({ queue, cache, movebank });

    // Step 1: Initial query without licenseMd5 triggers LICENSE_REQUIRED
    const challengeRes = await provider.getStudy('999001');
    expect(challengeRes.diagnosticStatus).toBe('LICENSE_REQUIRED');
    expect(challengeRes.licenseTermsText).toBe(rawLicenseText);
    expect(challengeRes.licenseMd5).toBe(expectedMd5);
    expect(challengeRes.animals).toHaveLength(0);

    // Must NOT be cached!
    expect(cache.getEntryCount()).toBe(0);
    expect(await cache.get('movebank:study:999001:none')).toBeNull();

    // Step 2: Re-query with computed licenseMd5 -> succeeds with OK and sends license-md5 + session cookie
    const unlockedRes = await provider.getStudy('999001', expectedMd5);
    expect(unlockedRes.diagnosticStatus).toBe('OK');
    expect(unlockedRes.feedStatus).toBe('LIVE_API');
    expect(unlockedRes.licenseMd5).toBe(expectedMd5);
    expect(unlockedRes.animals).toHaveLength(1);
    expect(unlockedRes.animals[0]!.scientificName).toBe('Dermochelys coriacea');
    expect(
      requestedUrls.some((u) => u.includes(`license-md5=${expectedMd5}`)),
    ).toBe(true);
    expect(
      receivedCookies.some((c) => c?.includes('JSESSIONID=test-session-token')),
    ).toBe(true);

    // Step 3: Subsequent identical request with accepted licenseMd5 hits cache cleanly
    const cachedRes = await provider.getStudy('999001', expectedMd5);
    expect(cachedRes.diagnosticStatus).toBe('OK');
    expect(cachedRes.feedStatus).toBe('CACHED');
  });

  it('(c) maps HTTP 401 and HTTP 403 permission denials to AUTH_REQUIRED without caching', async () => {
    const queue = new MovebankQueue({ minIntervalMs: 0 });
    const cache = new TelemetryCache({ cacheDir, ttlMs: 60_000 });

    const provider401 = new TelemetryProvider({
      queue,
      cache,
      movebank: new MovebankProvider({
        queue,
        fetchFn: async () => new Response('HTTP Status 401 - Unauthorized', { status: 401 }),
      }),
    });

    const res401 = await provider401.getStudy('888001');
    expect(res401.diagnosticStatus).toBe('AUTH_REQUIRED');
    expect(res401.animals).toHaveLength(0);
    expect(cache.getEntryCount()).toBe(0);

    const provider403 = new TelemetryProvider({
      queue,
      cache,
      movebank: new MovebankProvider({
        queue,
        fetchFn: async () =>
          new Response('HTTP Status 403 - Access is denied for this study', { status: 403 }),
      }),
    });

    const res403 = await provider403.getStudy('888002');
    expect(res403.diagnosticStatus).toBe('AUTH_REQUIRED');
    expect(res403.animals).toHaveLength(0);
    expect(cache.getEntryCount()).toBe(0);
  });

  it('(d) classifies empty locations:[] JSON and header-only CSV studies as TAG_SILENT', async () => {
    const queue = new MovebankQueue({ minIntervalMs: 0 });

    const emptyJsonProvider = new MovebankProvider({
      queue,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            individuals: [
              {
                individual_id: 55,
                individual_local_identifier: 'silent-tag-55',
                individual_taxon_canonical_name: 'Ciconia ciconia',
                locations: [],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const emptyJsonRes = await emptyJsonProvider.fetchStudy('666001', {
      preferPublicJson: true,
    });
    expect(emptyJsonRes.diagnosticStatus).toBe('TAG_SILENT');
    expect(emptyJsonRes.animals).toHaveLength(0);

    const headerOnlyCsvProvider = new MovebankProvider({
      queue,
      fetchFn: async () =>
        new Response(
          'timestamp,location-long,location-lat,individual-local-identifier\n',
          { status: 200, headers: { 'Content-Type': 'text/csv' } },
        ),
    });

    const headerOnlyRes = await headerOnlyCsvProvider.fetchStudy('666002', {
      preferDirectRead: true,
    });
    expect(headerOnlyRes.diagnosticStatus).toBe('TAG_SILENT');
    expect(headerOnlyRes.animals).toHaveLength(0);
  });
});
