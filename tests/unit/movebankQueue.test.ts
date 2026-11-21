import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TelemetryCache,
  clampCacheTtlMinutes,
} from '../../server/cache.ts';
import {
  MovebankQueue,
  RetryableUpstreamError,
} from '../../server/movebankQueue.ts';

interface MockPayload {
  studyId: string;
  pingCount: number;
  diagnosticStatus: 'OK' | 'LICENSE_REQUIRED' | 'AUTH_REQUIRED' | 'RATE_LIMITED';
}

describe('Challenge 1: MovebankQueue serialization, coalescing & TelemetryCache', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildpulse-queue-cache-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('serializes 8 concurrent requests (maxConcurrency=1), enforces min spacing, coalesces duplicates, and serves <5ms CACHED hits', async () => {
    const minIntervalMs = 45;
    const queue = new MovebankQueue({ minIntervalMs });
    const cache = new TelemetryCache({ cacheDir, ttlMs: 60_000 });

    let activeUpstreamCalls = 0;
    let maxUpstreamConcurrency = 0;
    const timeline: Array<{ key: string; startMs: number; endMs: number }> = [];
    const upstreamCallsByKey = new Map<string, number>();

    const mockUpstream = async (key: string): Promise<MockPayload> => {
      activeUpstreamCalls += 1;
      if (activeUpstreamCalls > maxUpstreamConcurrency) {
        maxUpstreamConcurrency = activeUpstreamCalls;
      }
      const startMs = performance.now();
      upstreamCallsByKey.set(key, (upstreamCallsByKey.get(key) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, 12));
      const endMs = performance.now();
      activeUpstreamCalls -= 1;
      timeline.push({ key, startMs, endMs });

      return {
        studyId: key,
        pingCount: 140,
        diagnosticStatus: 'OK',
      };
    };

    const requestKeys = [
      'study:2911040',
      'study:300101',
      'study:2911040', // duplicate in-flight
      'study:300202',
      'study:300101', // duplicate in-flight
      'study:300303',
      'study:300404',
      'study:2911040', // triplicate in-flight
    ];

    const firstPass = await Promise.all(
      requestKeys.map((key) =>
        cache.resolve(key, () => queue.enqueue(key, () => mockUpstream(key))),
      ),
    );

    expect(firstPass).toHaveLength(8);
    for (const res of firstPass) {
      expect(res.feedStatus).toBe('LIVE_API');
      expect(res.cacheHit).toBe(false);
    }

    // Strict maxConcurrency === 1 on both queue metrics and instrumented handler
    expect(queue.maxObservedConcurrency).toBe(1);
    expect(maxUpstreamConcurrency).toBe(1);

    // 5 unique keys + 3 duplicates coalesced
    expect(queue.coalescedHits).toBe(3);
    expect(queue.totalExecuted).toBe(5);
    expect(timeline).toHaveLength(5);
    for (const count of upstreamCallsByKey.values()) {
      expect(count).toBe(1);
    }

    // Verify minimum inter-request spacing between end of request i-1 and start of request i
    // Allow 3ms clock quantization tolerance on Windows timer interrupts.
    for (let i = 1; i < timeline.length; i += 1) {
      const gapMs = timeline[i]!.startMs - timeline[i - 1]!.endMs;
      expect(gapMs).toBeGreaterThanOrEqual(minIntervalMs - 3);
    }

    // Second pass: cache hits must return feedStatus === 'CACHED' in < 5ms without calling upstream
    const uniqueKeys = Array.from(new Set(requestKeys));
    for (const key of uniqueKeys) {
      const t0 = performance.now();
      const cached = await cache.resolve(key, () =>
        queue.enqueue(key, () => mockUpstream(key)),
      );
      const elapsedMs = performance.now() - t0;

      expect(cached.feedStatus).toBe('CACHED');
      expect(cached.cacheHit).toBe(true);
      expect(cached.value.studyId).toBe(key);
      expect(elapsedMs).toBeLessThan(5);
    }

    expect(queue.totalExecuted).toBe(5);
    expect(cache.getEntryCount()).toBe(5);
  });

  it('enforces exact virtual-clock spacing and handles 429 Retry-After backoff', async () => {
    let virtualNow = 1_000_000;
    const sleepCalls: number[] = [];

    const queue = new MovebankQueue({
      minIntervalMs: 450,
      maxRetries: 2,
      baseBackoffMs: 500,
      nowFn: () => virtualNow,
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
        virtualNow += ms;
      },
    });

    let attempts = 0;
    const p1 = queue.enqueue('study:retry', async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new RetryableUpstreamError(429, 'Too Many Requests', 1200);
      }
      virtualNow += 25;
      return 'ok-after-retry';
    });

    const p2 = queue.enqueue('study:second', async () => {
      virtualNow += 15;
      return 'second-ok';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('ok-after-retry');
    expect(r2).toBe('second-ok');
    expect(attempts).toBe(2);
    // Retry-After of 1200ms followed by minIntervalMs 450ms spacing before second task
    expect(sleepCalls).toEqual([1200, 450]);
    expect(queue.maxObservedConcurrency).toBe(1);
  });

  it('clamps TTL to 15-60 minutes and never caches LICENSE_REQUIRED, AUTH_REQUIRED, or RATE_LIMITED', async () => {
    expect(clampCacheTtlMinutes(2)).toBe(15);
    expect(clampCacheTtlMinutes(30)).toBe(30);
    expect(clampCacheTtlMinutes(180)).toBe(60);

    const cache = new TelemetryCache({ cacheDir, ttlMs: 60_000 });
    const blockedStatuses = [
      'LICENSE_REQUIRED',
      'AUTH_REQUIRED',
      'RATE_LIMITED',
    ] as const;

    for (const diagnosticStatus of blockedStatuses) {
      const writeRes = await cache.set(`blocked:${diagnosticStatus}`, {
        diagnosticStatus,
        animals: [],
      });
      expect(writeRes.cached).toBe(false);
      expect(writeRes.feedStatus).toBe('LIVE_API');
      expect(await cache.get(`blocked:${diagnosticStatus}`)).toBeNull();
    }

    expect(cache.getEntryCount()).toBe(0);
  });

  it('promotes Tier-2 disk cache hits back to Tier-1 memory when a new TelemetryCache instance starts', async () => {
    const firstCache = new TelemetryCache({ cacheDir, ttlMs: 60_000 });
    await firstCache.set('study:persisted', {
      diagnosticStatus: 'OK',
      animals: [{ id: 'a1' }],
    });

    const coldRestartCache = new TelemetryCache({ cacheDir, ttlMs: 60_000 });
    const diskHit = await coldRestartCache.get<{ diagnosticStatus: string; animals: Array<{ id: string }> }>('study:persisted');
    expect(diskHit).not.toBeNull();
    expect(diskHit?.feedStatus).toBe('CACHED');
    expect(diskHit?.value.animals[0]?.id).toBe('a1');

    // Subsequent hit comes directly from promoted Tier-1 memory in < 5ms
    const t0 = performance.now();
    const memHit = await coldRestartCache.get('study:persisted');
    const elapsedMs = performance.now() - t0;
    expect(memHit?.feedStatus).toBe('CACHED');
    expect(elapsedMs).toBeLessThan(5);
  });
});
