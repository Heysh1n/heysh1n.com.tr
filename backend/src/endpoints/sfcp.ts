import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { Endpoint } from 'payload'

import type { AccessKey } from '../payload-types'
import {
  checkRateLimit,
  createRateLimitExceededResponse,
  createRateLimitHeaders,
  extractClientIp,
  parsePositiveIntEnv,
} from '../utils/rateLimit'
import { sanitizeErrorForLog } from '../utils/releaseStorage'

export {
  releaseDownloadEndpoint,
  releaseDownloadHeadEndpoint,
  updateManifestEndpoint,
  vscodeUpdateManifestEndpoint,
} from './releases'

type ValidateRequestBody = {
  hash?: unknown
  hwid?: unknown
}

export type VerifyLicenseRequestBody = {
  key?: unknown
  hwid?: unknown
}

type GenerateRequestBody = {
  associatedProject?: unknown
  expiresAt?: unknown
  keyName?: unknown
}

const HASH_SALT = 'x9!kQ#mZ$vR7@pL2&wN5'
const EXPECTED_AGENT = 'secure-client-v1'

const computeExpectedHash = (key: string, hwid: string): string =>
  createHash('sha256')
    .update(key + hwid + HASH_SALT)
    .digest('hex')

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')

  if (bufA.length !== bufB.length) {
    return false
  }

  return timingSafeEqual(bufA, bufB)
}

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init)

const readJsonBody = async <T>(req: {
  body?: unknown
  data?: unknown
  json?: () => Promise<unknown>
}): Promise<T> => {
  // If Payload or an upstream wrapper already parsed the body into req.data
  if (req.data && typeof req.data === 'object' && Object.keys(req.data).length > 0) {
    return req.data as T
  }

  // Parse JSON stream from standard Request (Payload CMS v3 Endpoint)
  if (typeof req.json === 'function') {
    try {
      const parsed = await req.json()
      if (parsed && typeof parsed === 'object') {
        return parsed as T
      }
    } catch {
      // Body stream might be already consumed or empty
    }
  }

  // Fall back to req.data if present (even if empty object)
  if (req.data && typeof req.data === 'object') {
    return req.data as T
  }

  // Fall back to req.body if it is a plain object (not a ReadableStream or Buffer)
  if (
    req.body &&
    typeof req.body === 'object' &&
    typeof (req.body as { getReader?: unknown }).getReader !== 'function' &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body as T
  }

  return {} as T
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const parseRelationshipId = (value: unknown) => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (isNonEmptyString(value)) {
    const id = Number(value)

    return Number.isInteger(id) ? id : undefined
  }

  return undefined
}

const createLicenseKey = () => {
  const raw = randomBytes(16).toString('hex').toUpperCase()
  const chunks = raw.match(/.{1,4}/g) ?? [raw]

  return `SFCP-${chunks.join('-')}`
}

const checkAuthRateLimit = (req: { headers?: Headers }, bucket: string) =>
  checkRateLimit({
    bucket,
    key: extractClientIp(req),
    limit: parsePositiveIntEnv(process.env.SFCP_AUTH_RATE_LIMIT_MAX, 30),
    windowMs: parsePositiveIntEnv(process.env.SFCP_AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
  })

const mergeHeaders = (
  rateHeaders: Record<string, string>,
  extra?: HeadersInit,
): Headers => {
  const headers = new Headers(extra)
  for (const [k, v] of Object.entries(rateHeaders)) {
    headers.set(k, v)
  }
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store, max-age=0')
  headers.set('X-Content-Type-Options', 'nosniff')
  return headers
}

export const validateLicenseEndpoint: Endpoint = {
  method: 'post',
  path: '/v1/validate',
  handler: async (req) => {
    const rateLimit = checkAuthRateLimit(req, 'sfcp-v1-validate')
    if (!rateLimit.allowed) {
      return createRateLimitExceededResponse(rateLimit)
    }

    const headers = mergeHeaders(createRateLimitHeaders(rateLimit))

    // ── Agent guard ──────────────────────────────────────────────────────
    if (req.headers && typeof req.headers.get === 'function') {
      const agent = req.headers.get('x-sfcp-agent')

      if (agent !== EXPECTED_AGENT) {
        return json({ status: 'error', message: 'Forbidden' }, { status: 403, headers })
      }
    }

    // ── Body parsing ─────────────────────────────────────────────────────
    const body = await readJsonBody<ValidateRequestBody>(req)
    const hwid = isNonEmptyString(body.hwid) ? body.hwid.trim() : ''
    const hash = isNonEmptyString(body.hash) ? body.hash.trim().toLowerCase() : ''

    if (!hwid || !hash) {
      return json(
        {
          status: 'error',
          message: 'Missing HWID or hash.',
        },
        { status: 400, headers },
      )
    }

    // Fetch all keys and find the one whose expected hash matches
    const result = await req.payload.find({
      collection: 'access-keys',
      depth: 0,
      limit: 0,
      overrideAccess: true,
    })

    const license = (result.docs as AccessKey[]).find((doc) => {
      if (!doc.license_key) return false
      const expected = computeExpectedHash(doc.license_key.trim(), hwid)

      return safeEqual(expected, hash)
    })

    if (!license || license.status === 'revoked') {
      return json({ status: 'error', message: 'Invalid credentials' }, { status: 403, headers })
    }

    if (license.expiresAt) {
      const expiresAtTime = new Date(license.expiresAt).getTime()
      if (!Number.isNaN(expiresAtTime) && expiresAtTime < Date.now()) {
        return json({ status: 'error', message: 'License expired' }, { status: 403, headers })
      }
    }

    if (license.hwid && license.hwid !== hwid) {
      return json(
        { status: 'error', message: 'HWID mismatch. License linked to another device' },
        { status: 403, headers },
      )
    }

    const dataToUpdate: Partial<AccessKey> & { status?: 'active' } = {
      lastValidatedAt: new Date().toISOString(),
    }

    if (!license.hwid) {
      dataToUpdate.hwid = hwid
      dataToUpdate.status = 'active'
    }

    await req.payload.update({
      id: license.id,
      collection: 'access-keys',
      data: dataToUpdate,
      overrideAccess: true,
    })

    // ── Telemetry: log the validation event ──────────────────────────────
    if (typeof req.payload.create === 'function') {
      try {
        await req.payload.create({
          collection: 'key-logs',
          data: {
            licenseKey: license.id,
            hwid,
            ipAddress: extractClientIp(req),
          },
          overrideAccess: true,
        })
      } catch (error: unknown) {
        req.payload.logger?.error?.(
          { error: sanitizeErrorForLog(error), licenseId: license.id },
          '[sfcp] Failed to write key-log',
        )
      }
    }

    return json({ status: 'ok' }, { headers })
  },
}

export const sfcpVerifyEndpoint: Endpoint = {
  method: 'post',
  path: '/sfcp/verify',
  handler: async (req) => {
    const rateLimit = checkAuthRateLimit(req, 'sfcp-verify')
    if (!rateLimit.allowed) {
      return createRateLimitExceededResponse(rateLimit)
    }

    const headers = mergeHeaders(createRateLimitHeaders(rateLimit))

    const body = await readJsonBody<VerifyLicenseRequestBody>(req)
    const key = isNonEmptyString(body.key) ? body.key.trim() : ''
    const hwid = isNonEmptyString(body.hwid) ? body.hwid.trim() : ''

    if (!key || !hwid) {
      return json({ valid: false, error: 'Unauthorized' }, { status: 401, headers })
    }

    const result = await req.payload.find({
      collection: 'access-keys',
      where: {
        license_key: {
          equals: key,
        },
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    const license = (result.docs as AccessKey[])[0]

    if (!license || license.status !== 'active') {
      return json({ valid: false, error: 'Unauthorized' }, { status: 401, headers })
    }

    if (license.expiresAt) {
      const expiresAtTime = new Date(license.expiresAt).getTime()

      if (!Number.isNaN(expiresAtTime) && expiresAtTime < Date.now()) {
        try {
          await req.payload.update({
            collection: 'access-keys',
            id: license.id,
            data: {
              status: 'inactive',
            },
            overrideAccess: true,
          })
        } catch {
          // Ignore update error
        }

        return json({ valid: false, error: 'License expired' }, { status: 401, headers })
      }
    }

    const existingHwid = isNonEmptyString(license.hwid) ? license.hwid.trim() : ''

    if (!existingHwid) {
      await req.payload.update({
        collection: 'access-keys',
        id: license.id,
        data: {
          hwid,
          lastValidatedAt: new Date().toISOString(),
        },
        overrideAccess: true,
      })

      return json({ valid: true }, { status: 200, headers })
    }

    if (existingHwid !== hwid) {
      return json({ valid: false, error: 'HWID mismatch' }, { status: 403, headers })
    }

    await req.payload.update({
      collection: 'access-keys',
      id: license.id,
      data: {
        lastValidatedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return json({ valid: true }, { status: 200, headers })
  },
}

export const generateLicenseEndpoint: Endpoint = {
  method: 'post',
  path: '/v1/licenses/generate',
  handler: async (req) => {
    if (!req.user) {
      return json({ status: 'error', message: 'Unauthorized.' }, { status: 401 })
    }

    const body = await readJsonBody<GenerateRequestBody>(req)
    const keyName = isNonEmptyString(body.keyName) ? body.keyName.trim() : 'SFCP License'
    const expiresAt = isNonEmptyString(body.expiresAt) ? body.expiresAt : undefined
    const associatedProject = parseRelationshipId(body.associatedProject)

    const license = await req.payload.create({
      collection: 'access-keys',
      data: {
        associatedProject,
        expiresAt,
        keyName,
        license_key: createLicenseKey(),
        status: 'active',
      },
      overrideAccess: true,
    })

    return json({
      status: 'ok',
      license,
    })
  },
}
