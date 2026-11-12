import { randomBytes } from 'crypto'
import type { Endpoint, PayloadRequest } from 'payload'

import type { AccessKey } from '../payload-types'

export type VerifyLicenseRequestBody = {
  key?: unknown
  hwid?: unknown
}

type GenerateRequestBody = {
  expiresAt?: unknown
  owner?: unknown
  key?: unknown
}

type ExpressLikeResponse = {
  status?: (code: number) => {
    json: (body: unknown) => unknown
  }
}

const sendJson = (body: unknown, status = 200, res?: ExpressLikeResponse): Response => {
  if (res && typeof res.status === 'function') {
    res.status(status).json(body)
  }

  return Response.json(body, { status })
}

const readJsonBody = async <T>(
  req: PayloadRequest & { body?: unknown; data?: unknown },
): Promise<T> => {
  if (req.body && typeof req.body === 'object') {
    return req.body as T
  }

  if (typeof req.json === 'function') {
    try {
      return (await req.json()) as T
    } catch {
      return {} as T
    }
  }

  if (req.data && typeof req.data === 'object') {
    return req.data as T
  }

  return {} as T
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const createLicenseKey = () => {
  const raw = randomBytes(16).toString('hex').toUpperCase()
  const chunks = raw.match(/.{1,4}/g) ?? [raw]

  return `SFCP-${chunks.join('-')}`
}

export const sfcpVerifyEndpoint: Endpoint = {
  method: 'post',
  path: '/sfcp/verify',
  handler: async (req, res?: ExpressLikeResponse) => {
    const body = await readJsonBody<VerifyLicenseRequestBody>(req)
    const key = isNonEmptyString(body.key) ? body.key.trim() : ''
    const hwid = isNonEmptyString(body.hwid) ? body.hwid.trim() : ''

    if (!key || !hwid) {
      return sendJson({ valid: false, error: 'Unauthorized' }, 401, res)
    }

    const result = await req.payload.find({
      collection: 'access-keys',
      where: {
        key: {
          equals: key,
        },
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    const license = (result.docs as AccessKey[])[0]

    // 1. If key doesn't exist or status !== 'active' -> Return 401 Unauthorized
    if (!license || license.status !== 'active') {
      return sendJson({ valid: false, error: 'Unauthorized' }, 401, res)
    }

    // 2. If expiresAt is set and in the past -> Return 401 Unauthorized (and update status to 'expired' if possible)
    if (license.expiresAt) {
      const expiresAtTime = new Date(license.expiresAt).getTime()

      if (!Number.isNaN(expiresAtTime) && expiresAtTime < Date.now()) {
        try {
          await req.payload.update({
            collection: 'access-keys',
            id: license.id,
            data: {
              status: 'expired',
            },
            overrideAccess: true,
          })
        } catch {
          // Ignore if status update fails
        }

        return sendJson({ valid: false, error: 'License expired' }, 401, res)
      }
    }

    // 3. If hwid in DB is empty/null -> Bind the incoming hwid to this key (payload.update) and authorize
    const existingHwid = isNonEmptyString(license.hwid) ? license.hwid.trim() : ''

    if (!existingHwid) {
      await req.payload.update({
        collection: 'access-keys',
        id: license.id,
        data: {
          hwid,
        },
        overrideAccess: true,
      })

      return sendJson({ valid: true }, 200, res)
    }

    // 4. If hwid in DB exists but !== incoming hwid -> Return 403 Forbidden (HWID mismatch)
    if (existingHwid !== hwid) {
      return sendJson({ valid: false, error: 'HWID mismatch' }, 403, res)
    }

    // Success: Return 200 OK with { "valid": true }
    return sendJson({ valid: true }, 200, res)
  },
}

export const verifyLicenseEndpoint = sfcpVerifyEndpoint
export const validateLicenseEndpoint = sfcpVerifyEndpoint
export const sfcpEndpoint = sfcpVerifyEndpoint

export const generateLicenseEndpoint: Endpoint = {
  method: 'post',
  path: '/v1/licenses/generate',
  handler: async (req) => {
    if (!req.user) {
      return sendJson({ status: 'error', message: 'Unauthorized.' }, 401)
    }

    const body = await readJsonBody<GenerateRequestBody>(req)
    const owner = isNonEmptyString(body.owner) ? body.owner.trim() : undefined
    const expiresAt = isNonEmptyString(body.expiresAt) ? body.expiresAt : undefined
    const key = isNonEmptyString(body.key) ? body.key.trim() : createLicenseKey()

    const license = await req.payload.create({
      collection: 'access-keys',
      data: {
        expiresAt,
        owner,
        key,
        status: 'active',
      },
      overrideAccess: true,
    })

    return sendJson({
      status: 'ok',
      license,
    })
  },
}

export const updateManifestEndpoint: Endpoint = {
  method: 'get',
  path: '/sfcp/update.json',
  handler: () =>
    Response.json(
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

export default sfcpVerifyEndpoint
