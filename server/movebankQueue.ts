export interface MovebankQueueOptions {
  minIntervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
}

export interface MovebankQueueMetrics {
  maxObservedConcurrency: number;
  queueDepth: number;
  coalescedHits: number;
  totalExecuted: number;
}

export class RetryableUpstreamError extends Error {
  public readonly status: number;
  public readonly retryAfterMs: number | null;
  public readonly responseBody?: string;

  constructor(
    status: number,
    message: string,
    retryAfterMs: number | null = null,
    responseBody?: string,
  ) {
    super(message);
    this.name = 'RetryableUpstreamError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.responseBody = responseBody;
  }
}

export function parseRetryAfterMs(
  retryAfterHeader: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!retryAfterHeader) return null;
  const trimmed = retryAfterHeader.trim();
  if (!trimmed) return null;

  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  const parsedDateMs = Date.parse(trimmed);
  if (Number.isFinite(parsedDateMs)) {
    return Math.max(0, parsedDateMs - nowMs);
  }

  return null;
}

interface QueueEntry<T> {
  key: string;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface RetryInfo {
  retryable: boolean;
  retryAfterMs: number | null;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isResponseLike429Or503(value: unknown): { status: number; headers: { get: (name: string) => string | null } } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.status === 'number' &&
    (candidate.status === 429 || candidate.status === 503) &&
    candidate.headers &&
    typeof (candidate.headers as { get?: unknown }).get === 'function'
  ) {
    return candidate as unknown as { status: number; headers: { get: (name: string) => string | null } };
  }
  return null;
}

function extractErrorRetryInfo(err: unknown, nowMs: number): RetryInfo {
  if (!err || typeof err !== 'object') {
    return { retryable: false, retryAfterMs: null };
  }
  const obj = err as Record<string, unknown>;
  const status =
    typeof obj.status === 'number'
      ? obj.status
      : typeof obj.statusCode === 'number'
        ? obj.statusCode
        : null;

  if (status !== 429 && status !== 503) {
    return { retryable: false, retryAfterMs: null };
  }

  let retryAfterMs: number | null = null;
  if (typeof obj.retryAfterMs === 'number' && Number.isFinite(obj.retryAfterMs)) {
    retryAfterMs = Math.max(0, obj.retryAfterMs);
  } else if (typeof obj.retryAfter === 'string') {
    retryAfterMs = parseRetryAfterMs(obj.retryAfter, nowMs);
  } else if (
    obj.headers &&
    typeof (obj.headers as { get?: unknown }).get === 'function'
  ) {
    retryAfterMs = parseRetryAfterMs(
      (obj.headers as { get: (name: string) => string | null }).get('retry-after'),
      nowMs,
    );
  }

  return { retryable: true, retryAfterMs };
}

export class MovebankQueue {
  public readonly maxConcurrency = 1 as const;
  public readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;

  private readonly pending: Array<QueueEntry<unknown>> = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private processing = false;
  private activeCount = 0;
  private lastCompletedAtMs = 0;

  private _maxObservedConcurrency = 0;
  private _coalescedHits = 0;
  private _totalExecuted = 0;

  constructor(optionsOrMinIntervalMs?: number | MovebankQueueOptions) {
    const opts: MovebankQueueOptions =
      typeof optionsOrMinIntervalMs === 'number'
        ? { minIntervalMs: optionsOrMinIntervalMs }
        : (optionsOrMinIntervalMs ?? {});

    this.minIntervalMs = Math.max(0, opts.minIntervalMs ?? 450);
    this.maxRetries = Math.max(0, opts.maxRetries ?? 3);
    this.baseBackoffMs = Math.max(
      1,
      opts.baseBackoffMs ?? (this.minIntervalMs >= 450 ? 500 : Math.max(10, this.minIntervalMs * 2)),
    );
    this.maxBackoffMs = Math.max(this.baseBackoffMs, opts.maxBackoffMs ?? 30_000);
    this.sleepFn = opts.sleepFn ?? defaultSleep;
    this.nowFn = opts.nowFn ?? (() => Date.now());
  }

  public get maxObservedConcurrency(): number {
    return this._maxObservedConcurrency;
  }

  public get queueDepth(): number {
    return this.pending.length + this.activeCount;
  }

  public get coalescedHits(): number {
    return this._coalescedHits;
  }

  public get totalExecuted(): number {
    return this._totalExecuted;
  }

  public getMetrics(): MovebankQueueMetrics {
    return {
      maxObservedConcurrency: this._maxObservedConcurrency,
      queueDepth: this.queueDepth,
      coalescedHits: this._coalescedHits,
      totalExecuted: this._totalExecuted,
    };
  }

  public enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const normalizedKey = key.trim();
    if (normalizedKey.length > 0) {
      const existing = this.inFlight.get(normalizedKey);
      if (existing) {
        this._coalescedHits += 1;
        return existing as Promise<T>;
      }
    }

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.push({
        key: normalizedKey,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });

    if (normalizedKey.length > 0) {
      this.inFlight.set(normalizedKey, promise);
    }

    void this.pump();
    return promise;
  }

  private computeRetryDelayMs(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs !== null && Number.isFinite(retryAfterMs)) {
      return Math.min(this.maxBackoffMs, Math.max(this.minIntervalMs, retryAfterMs));
    }
    const exp = this.baseBackoffMs * Math.pow(2, attempt);
    return Math.min(this.maxBackoffMs, Math.max(this.minIntervalMs, exp));
  }

  private async executeWithRetry(entry: QueueEntry<unknown>): Promise<unknown> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await entry.task();
        const retryableResp = isResponseLike429Or503(result);
        if (retryableResp && attempt < this.maxRetries) {
          const retryAfterMs = parseRetryAfterMs(
            retryableResp.headers.get('retry-after'),
            this.nowFn(),
          );
          const delayMs = this.computeRetryDelayMs(attempt, retryAfterMs);
          await this.sleepFn(delayMs);
          continue;
        }
        return result;
      } catch (err) {
        const info = extractErrorRetryInfo(err, this.nowFn());
        if (info.retryable && attempt < this.maxRetries) {
          const delayMs = this.computeRetryDelayMs(attempt, info.retryAfterMs);
          await this.sleepFn(delayMs);
          continue;
        }
        throw err;
      }
    }
    // Unreachable, satisfies strict return check.
    throw new Error('MovebankQueue exhausted retries');
  }

  private async pump(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.pending.length > 0) {
        const entry = this.pending.shift()!;

        if (this.lastCompletedAtMs > 0 && this.minIntervalMs > 0) {
          const elapsed = this.nowFn() - this.lastCompletedAtMs;
          const remaining = this.minIntervalMs - elapsed;
          if (remaining > 0) {
            await this.sleepFn(remaining);
          }
        }

        this.activeCount += 1;
        if (this.activeCount > this._maxObservedConcurrency) {
          this._maxObservedConcurrency = this.activeCount;
        }

        try {
          const value = await this.executeWithRetry(entry);
          this._totalExecuted += 1;
          if (entry.key.length > 0) {
            this.inFlight.delete(entry.key);
          }
          entry.resolve(value);
        } catch (err) {
          this._totalExecuted += 1;
          if (entry.key.length > 0) {
            this.inFlight.delete(entry.key);
          }
          entry.reject(err);
        } finally {
          this.activeCount -= 1;
          this.lastCompletedAtMs = this.nowFn();
        }
      }
    } finally {
      this.processing = false;
      if (this.pending.length > 0) {
        void this.pump();
      }
    }
  }
}
