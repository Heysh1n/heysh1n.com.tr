export interface RateLimitOptions {
  bucket: string
  key: string
  limit: number
  windowMs: number
  now?: number
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

const MAX_STORE_ENTRIES = 10_000
const store = new Map<string, RateLimitEntry>()

const pruneExpiredEntries = (now: number): void => {
  for (const [entryKey, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(entryKey)
    }
  }

  // Hard cap protection against memory exhaustion from spoofed keys
  while (store.size >= MAX_STORE_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    store.delete(oldestKey)
  }
}

const sanitizeIpCandidate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64) {
    return null
  }

  // Strip control characters
  const cleaned = trimmed.replace(/[\r\n\t\0]/g, '')
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Extracts client IP from reverse proxy headers (Cloudflare / Nginx).
 * Prioritizes headers set directly by trusted proxies over client-appendable headers.
 */
export const extractClientIp = (req: { headers?: Headers }): string => {
  if (!req.headers || typeof req.headers.get !== 'function') {
    return 'unknown'
  }

  const cfIp = sanitizeIpCandidate(req.headers.get('cf-connecting-ip'))
  if (cfIp) {
    return cfIp
  }

  const realIp = sanitizeIpCandidate(req.headers.get('x-real-ip'))
  if (realIp) {
    return realIp
  }

  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = sanitizeIpCandidate(forwarded.split(',')[0])
    if (first) {
      return first
    }
  }

  return 'unknown'
}

export const parsePositiveIntEnv = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const checkRateLimit = (options: RateLimitOptions): RateLimitResult => {
  const now = options.now ?? Date.now()
  const limit = Math.max(1, options.limit)
  const windowMs = Math.max(1_000, options.windowMs)
  const storeKey = `${options.bucket}:${options.key}`

  const existing = store.get(storeKey)

  if (!existing || existing.resetAt <= now) {
    if (store.size >= MAX_STORE_ENTRIES) {
      pruneExpiredEntries(now)
    }

    const resetAt = now + windowMs
    store.set(storeKey, { count: 1, resetAt })

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1_000)),
    }
  }

  existing.count += 1
  const remaining = Math.max(0, limit - existing.count)
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1_000))

  return {
    allowed: existing.count <= limit,
    limit,
    remaining,
    resetAt: existing.resetAt,
    retryAfterSeconds,
  }
}

export const createRateLimitHeaders = (result: RateLimitResult): Record<string, string> => ({
  'X-RateLimit-Limit': String(result.limit),
  'X-RateLimit-Remaining': String(result.remaining),
  'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1_000)),
})

export const createRateLimitExceededResponse = (result: RateLimitResult): Response =>
  Response.json(
    {
      error: 'Too many requests. Please try again later.',
    },
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Retry-After': String(result.retryAfterSeconds),
        'X-Content-Type-Options': 'nosniff',
        ...createRateLimitHeaders(result),
      },
    },
  )

export const resetRateLimitStore = (): void => {
  store.clear()
}
