import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { Endpoint } from 'payload'

import type { AccessKey } from '../payload-types'

type ValidateRequestBody = {
  hash?: unknown
  hwid?: unknown
}

const HASH_SALT = 'x9!kQ#mZ$vR7@pL2&wN5'

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

type GenerateRequestBody = {
  associatedProject?: unknown
  expiresAt?: unknown
  keyName?: unknown
}

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init)

const readJsonBody = async <T>(req: { json?: () => Promise<unknown> }): Promise<T> => {
  if (!req.json) {
    return {} as T
  }

  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
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

const EXPECTED_AGENT = 'secure-client-v1'

const extractClientIp = (req: { headers: Headers }): string => {
  const forwarded = req.headers.get('x-forwarded-for')

  if (forwarded) {
    // x-forwarded-for can contain a comma-separated list; take the first (original client)
    const first = forwarded.split(',')[0]?.trim()

    if (first && first.length > 0) {
      return first
    }
  }

  return 'unknown'
}

export const validateLicenseEndpoint: Endpoint = {
  method: 'post',
  path: '/v1/validate',
  handler: async (req) => {
    // ── Agent guard ──────────────────────────────────────────────────────
    const agent = req.headers.get('x-sfcp-agent')

    if (agent !== EXPECTED_AGENT) {
      return json({ status: 'error', message: 'Forbidden' }, { status: 403 })
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
        { status: 400 },
      )
    }

    // Fetch all active keys and find the one whose expected hash matches
    const result = await req.payload.find({
      collection: 'access-keys',
      depth: 0,
      limit: 0, // no limit — check every key
      overrideAccess: true,
    })

    const license = (result.docs as AccessKey[]).find((doc) => {
      const expected = computeExpectedHash(doc.license_key.trim(), hwid)

      return safeEqual(expected, hash)
    })

    if (!license) {
      return json({ status: 'error', message: 'Invalid credentials' }, { status: 403 })
    }

    if (license.hwid && license.hwid !== hwid) {
      return json(
        { status: 'error', message: 'HWID mismatch. License linked to another device' },
        { status: 403 },
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
      req.payload.logger.error(
        { err: error },
        `[sfcp] Failed to write key-log for license ${String(license.id)}`,
      )
    }

    return json({ status: 'ok' })
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

export const updateManifestEndpoint: Endpoint = {
  method: 'get',
  path: '/sfcp/update.json',
  handler: () =>
    json(
      {
        product: 'sfcp',
        version: process.env.SFCP_LATEST_VERSION || '0.0.0',
        channel: 'stable',
        downloadUrl: process.env.SFCP_DOWNLOAD_URL || null,
        sha256: process.env.SFCP_SHA256 || null,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    ),
}
