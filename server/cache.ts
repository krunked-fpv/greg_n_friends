import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DiagnosticStatus, FeedStatus } from '../src/types/telemetry.ts';

const NON_CACHEABLE_STATUSES = new Set<DiagnosticStatus>([
  'LICENSE_REQUIRED',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
]);

export interface TelemetryCacheOptions {
  cacheDir?: string;
  ttlMs?: number;
  ttlMinutes?: number;
  nowFn?: () => number;
}

interface CacheEnvelope<T> {
  key: string;
  storedAtMs: number;
  expiresAtMs: number;
  diagnosticStatus?: DiagnosticStatus;
  value: T;
}

export interface CacheReadResult<T> {
  value: T;
  feedStatus: Extract<FeedStatus, 'CACHED'>;
  storedAtMs: number;
  expiresAtMs: number;
}

export interface CacheWriteResult<T> {
  value: T;
  feedStatus: Extract<FeedStatus, 'LIVE_API'>;
  cached: boolean;
}

export interface CacheResolveResult<T> {
  value: T;
  feedStatus: Extract<FeedStatus, 'LIVE_API' | 'CACHED'>;
  cacheHit: boolean;
}

export function clampCacheTtlMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 30;
  return Math.max(15, Math.min(60, minutes));
}

export function resolveCacheTtlMs(options?: TelemetryCacheOptions): number {
  if (options?.ttlMs !== undefined && Number.isFinite(options.ttlMs)) {
    return Math.max(1, Math.floor(options.ttlMs));
  }
  const rawEnv = process.env.CACHE_TTL_MINUTES;
  const envMinutes =
    rawEnv !== undefined && rawEnv.trim() !== '' ? Number(rawEnv) : NaN;
  const candidateMinutes =
    options?.ttlMinutes !== undefined && Number.isFinite(options.ttlMinutes)
      ? options.ttlMinutes
      : Number.isFinite(envMinutes)
        ? envMinutes
        : 30;
  return clampCacheTtlMinutes(candidateMinutes) * 60 * 1000;
}

export function isNonCacheableStatus(status?: DiagnosticStatus | null): boolean {
  return Boolean(status && NON_CACHEABLE_STATUSES.has(status));
}

function extractDiagnosticStatus(value: unknown): DiagnosticStatus | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.diagnosticStatus === 'string') {
    return obj.diagnosticStatus as DiagnosticStatus;
  }
  return undefined;
}

function shouldSkipCache(value: unknown, explicitStatus?: DiagnosticStatus): boolean {
  if (isNonCacheableStatus(explicitStatus)) return true;
  const extracted = extractDiagnosticStatus(value);
  if (isNonCacheableStatus(extracted)) return true;

  if (value && typeof value === 'object' && Array.isArray((value as { animals?: unknown[] }).animals)) {
    const animals = (value as { animals: Array<{ diagnosticStatus?: DiagnosticStatus }> }).animals;
    if (animals.length > 0 && animals.some((a) => isNonCacheableStatus(a?.diagnosticStatus))) {
      return true;
    }
  }
  return false;
}

export class TelemetryCache {
  public readonly cacheDir: string;
  public readonly ttlMs: number;
  private readonly nowFn: () => number;
  private readonly memory = new Map<string, CacheEnvelope<unknown>>();

  constructor(options?: TelemetryCacheOptions) {
    this.cacheDir =
      options?.cacheDir ?? path.resolve(process.cwd(), '.cache', 'telemetry');
    this.ttlMs = resolveCacheTtlMs(options);
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  private filePathForKey(key: string): string {
    const slug = key
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
    const fileName = slug ? `${slug}-${hash}.json` : `${hash}.json`;
    return path.join(this.cacheDir, fileName);
  }

  private async ensureDir(): Promise<void> {
    await fsp.mkdir(this.cacheDir, { recursive: true });
  }

  private async removeDiskFile(filePath: string): Promise<void> {
    try {
      await fsp.unlink(filePath);
    } catch {
      // Ignore ENOENT or transient unlink errors.
    }
  }

  public async get<T>(key: string): Promise<CacheReadResult<T> | null> {
    const now = this.nowFn();
    const memEntry = this.memory.get(key) as CacheEnvelope<T> | undefined;
    if (memEntry) {
      if (now < memEntry.expiresAtMs && !shouldSkipCache(memEntry.value, memEntry.diagnosticStatus)) {
        return {
          value: memEntry.value,
          feedStatus: 'CACHED',
          storedAtMs: memEntry.storedAtMs,
          expiresAtMs: memEntry.expiresAtMs,
        };
      }
      this.memory.delete(key);
      await this.removeDiskFile(this.filePathForKey(key));
      return null;
    }

    const filePath = this.filePathForKey(key);
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as CacheEnvelope<T>;
      if (
        !parsed ||
        typeof parsed.expiresAtMs !== 'number' ||
        now >= parsed.expiresAtMs ||
        shouldSkipCache(parsed.value, parsed.diagnosticStatus)
      ) {
        await this.removeDiskFile(filePath);
        return null;
      }
      // Promote disk cache hit into Tier-1 memory Map.
      this.memory.set(key, parsed as CacheEnvelope<unknown>);
      return {
        value: parsed.value,
        feedStatus: 'CACHED',
        storedAtMs: parsed.storedAtMs,
        expiresAtMs: parsed.expiresAtMs,
      };
    } catch {
      return null;
    }
  }

  public async set<T>(
    key: string,
    value: T,
    options?: { diagnosticStatus?: DiagnosticStatus; ttlMs?: number },
  ): Promise<CacheWriteResult<T>> {
    if (shouldSkipCache(value, options?.diagnosticStatus)) {
      return {
        value,
        feedStatus: 'LIVE_API',
        cached: false,
      };
    }

    const storedAtMs = this.nowFn();
    const effectiveTtl =
      options?.ttlMs !== undefined && Number.isFinite(options.ttlMs)
        ? Math.max(1, Math.floor(options.ttlMs))
        : this.ttlMs;

    const envelope: CacheEnvelope<T> = {
      key,
      storedAtMs,
      expiresAtMs: storedAtMs + effectiveTtl,
      diagnosticStatus: options?.diagnosticStatus ?? extractDiagnosticStatus(value),
      value,
    };

    this.memory.set(key, envelope as CacheEnvelope<unknown>);

    try {
      await this.ensureDir();
      const filePath = this.filePathForKey(key);
      const serialized = JSON.stringify(envelope);
      const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await fsp.writeFile(tmpPath, serialized, 'utf8');
      try {
        await fsp.rename(tmpPath, filePath);
      } catch {
        await fsp.writeFile(filePath, serialized, 'utf8');
        await this.removeDiskFile(tmpPath);
      }
    } catch {
      // Memory tier remains populated even if disk write fails in read-only env.
    }

    return {
      value,
      feedStatus: 'LIVE_API',
      cached: true,
    };
  }

  public async resolve<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: { shouldCache?: (value: T) => boolean; diagnosticStatus?: (value: T) => DiagnosticStatus | undefined },
  ): Promise<CacheResolveResult<T>> {
    const hit = await this.get<T>(key);
    if (hit) {
      return {
        value: hit.value,
        feedStatus: 'CACHED',
        cacheHit: true,
      };
    }

    const fresh = await fetcher();
    const status = options?.diagnosticStatus ? options.diagnosticStatus(fresh) : extractDiagnosticStatus(fresh);
    const allowed = options?.shouldCache ? options.shouldCache(fresh) : true;

    if (allowed && !shouldSkipCache(fresh, status)) {
      await this.set(key, fresh, { diagnosticStatus: status });
    }

    return {
      value: fresh,
      feedStatus: 'LIVE_API',
      cacheHit: false,
    };
  }

  public async delete(key: string): Promise<void> {
    this.memory.delete(key);
    await this.removeDiskFile(this.filePathForKey(key));
  }

  public async clear(): Promise<void> {
    this.memory.clear();
    try {
      const files = await fsp.readdir(this.cacheDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map((f) => this.removeDiskFile(path.join(this.cacheDir, f))),
      );
    } catch {
      // Cache dir may not exist yet.
    }
  }

  public getEntryCount(): number {
    const now = this.nowFn();
    let validMem = 0;
    for (const [k, entry] of this.memory.entries()) {
      if (now < entry.expiresAtMs) {
        validMem += 1;
      } else {
        this.memory.delete(k);
      }
    }

    try {
      const files = fs.readdirSync(this.cacheDir).filter((f) => f.endsWith('.json'));
      return Math.max(validMem, files.length);
    } catch {
      return validMem;
    }
  }
}
