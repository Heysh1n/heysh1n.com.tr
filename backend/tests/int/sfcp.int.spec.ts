import { createHash } from 'crypto'

import { validateLicenseEndpoint } from '@/endpoints/sfcp'
import { describe, expect, it, vi } from 'vitest'

type AccessKeyStub = {
  hwid?: null | string
  id: number
  license_key: string
  status?: 'active' | 'inactive' | 'revoked'
}

const HASH_SALT = 'x9!kQ#mZ$vR7@pL2&wN5'

const makeHash = (key: string, hwid: string): string =>
  createHash('sha256')
    .update(key + hwid + HASH_SALT)
    .digest('hex')

const invokeValidate = async ({
  body,
  licenses = [],
}: {
  body: unknown
  licenses?: AccessKeyStub[]
}) => {
  const find = vi.fn().mockResolvedValue({ docs: licenses })
  const update = vi.fn().mockResolvedValue({})

  const response = await validateLicenseEndpoint.handler({
    json: vi.fn().mockResolvedValue(body),
    payload: {
      find,
      update,
    },
  } as never)

  return {
    body: await response.json(),
    find,
    response,
    update,
  }
}

describe('SFCP license validation endpoint (hash-based auth)', () => {
  it('returns 400 when hash or hwid is missing', async () => {
    const { body, response } = await invokeValidate({
      body: { hwid: 'HWID-1' },
    })

    expect(response.status).toBe(400)
    expect(body).toEqual({ status: 'error', message: 'Missing HWID or hash.' })
  })

  it('returns 403 when no license matches the hash', async () => {
    const { body, response, update } = await invokeValidate({
      body: { hwid: 'HWID-1', hash: 'deadbeef' },
      licenses: [{ id: 1, license_key: 'SFCP-KEY', hwid: null }],
    })

    expect(response.status).toBe(403)
    expect(body).toEqual({ status: 'error', message: 'Invalid credentials' })
    expect(update).not.toHaveBeenCalled()
  })

  it('binds the HWID and activates the license on first validation', async () => {
    const key = 'SFCP-KEY'
    const hwid = 'HWID-1'
    const hash = makeHash(key, hwid)

    const { body, response, update } = await invokeValidate({
      body: { hwid, hash },
      licenses: [{ hwid: null, id: 1, license_key: key, status: 'inactive' }],
    })

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        collection: 'access-keys',
        data: expect.objectContaining({
          hwid: 'HWID-1',
          status: 'active',
          lastValidatedAt: expect.any(String),
        }),
        overrideAccess: true,
      }),
    )
  })

  it('refreshes lastValidatedAt when the HWID already matches', async () => {
    const key = 'SFCP-KEY'
    const hwid = 'HWID-1'
    const hash = makeHash(key, hwid)

    const { body, response, update } = await invokeValidate({
      body: { hwid, hash },
      licenses: [{ hwid: 'HWID-1', id: 1, license_key: key, status: 'active' }],
    })
    const updateData = update.mock.calls[0]?.[0]?.data

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
    expect(updateData).toEqual({
      lastValidatedAt: expect.any(String),
    })
  })

  it('rejects validation when the HWID belongs to another device', async () => {
    const key = 'SFCP-KEY'
    const hwid = 'HWID-2'
    const hash = makeHash(key, hwid)

    const { body, response, update } = await invokeValidate({
      body: { hwid, hash },
      licenses: [{ hwid: 'HWID-1', id: 1, license_key: key, status: 'active' }],
    })

    expect(response.status).toBe(403)
    expect(body).toEqual({
      status: 'error',
      message: 'HWID mismatch. License linked to another device',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('matches the correct key among multiple licenses', async () => {
    const hwid = 'HWID-1'
    const targetKey = 'SFCP-TARGET'
    const hash = makeHash(targetKey, hwid)

    const { body, response, update } = await invokeValidate({
      body: { hwid, hash },
      licenses: [
        { hwid: null, id: 1, license_key: 'SFCP-DECOY-1' },
        { hwid: null, id: 2, license_key: targetKey },
        { hwid: null, id: 3, license_key: 'SFCP-DECOY-2' },
      ],
    })

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
    )
  })
})
