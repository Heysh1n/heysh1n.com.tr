import { AccessKeys } from '@/collections/AccessKeys'
import { sfcpVerifyEndpoint } from '@/endpoints/sfcp'
import { describe, expect, it, vi } from 'vitest'

type AccessKeyStub = {
  id: number
  key: string
  hwid?: string | null
  status: 'active' | 'revoked' | 'expired'
  expiresAt?: string | null
  owner?: string | null
}

const invokeVerify = async ({
  body,
  licenses = [],
}: {
  body: unknown
  licenses?: AccessKeyStub[]
}) => {
  const find = vi.fn().mockResolvedValue({ docs: licenses })
  const update = vi.fn().mockResolvedValue({})

  const response = await sfcpVerifyEndpoint.handler({
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

describe('AccessKeys collection configuration', () => {
  it('defines expected slug, admin title, fields, and admin-only access control', () => {
    expect(AccessKeys.slug).toBe('access-keys')
    expect(AccessKeys.admin?.useAsTitle).toBe('key')

    const fieldNames = AccessKeys.fields.map((field) => ('name' in field ? field.name : undefined))
    expect(fieldNames).toEqual(['key', 'hwid', 'status', 'expiresAt', 'owner'])

    expect(AccessKeys.access?.read?.({ req: { user: null } } as never)).toBe(false)
    expect(AccessKeys.access?.create?.({ req: { user: null } } as never)).toBe(false)
    expect(AccessKeys.access?.update?.({ req: { user: null } } as never)).toBe(false)
    expect(AccessKeys.access?.delete?.({ req: { user: null } } as never)).toBe(false)

    const adminReq = { req: { user: { id: 1, roles: ['admin'] } } } as never
    expect(AccessKeys.access?.read?.(adminReq)).toBe(true)
    expect(AccessKeys.access?.create?.(adminReq)).toBe(true)
    expect(AccessKeys.access?.update?.(adminReq)).toBe(true)
    expect(AccessKeys.access?.delete?.(adminReq)).toBe(true)
  })
})

describe('SFCP license verification endpoint (POST /api/sfcp/verify)', () => {
  it('returns 401 when key does not exist', async () => {
    const { response, update } = await invokeVerify({
      body: { key: 'NON-EXISTENT', hwid: 'HWID-1' },
      licenses: [],
    })

    expect(response.status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('returns 401 when key status is not active', async () => {
    const { response, update } = await invokeVerify({
      body: { key: 'SFCP-KEY', hwid: 'HWID-1' },
      licenses: [{ id: 1, key: 'SFCP-KEY', hwid: 'HWID-1', status: 'revoked' }],
    })

    expect(response.status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('returns 401 and updates status to expired when expiresAt is in the past', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString()

    const { response, update } = await invokeVerify({
      body: { key: 'SFCP-KEY', hwid: 'HWID-1' },
      licenses: [
        {
          id: 1,
          key: 'SFCP-KEY',
          hwid: 'HWID-1',
          status: 'active',
          expiresAt: pastDate,
        },
      ],
    })

    expect(response.status).toBe(401)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'access-keys',
        id: 1,
        data: { status: 'expired' },
        overrideAccess: true,
      }),
    )
  })

  it('binds incoming HWID and returns 200 { valid: true } when hwid in DB is empty/null', async () => {
    const { body, response, update } = await invokeVerify({
      body: { key: 'SFCP-KEY', hwid: 'HWID-1' },
      licenses: [{ id: 1, key: 'SFCP-KEY', hwid: null, status: 'active' }],
    })

    expect(response.status).toBe(200)
    expect(body).toEqual({ valid: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'access-keys',
        id: 1,
        data: { hwid: 'HWID-1' },
        overrideAccess: true,
      }),
    )
  })

  it('returns 403 Forbidden when HWID in DB does not match incoming HWID', async () => {
    const { response, update } = await invokeVerify({
      body: { key: 'SFCP-KEY', hwid: 'HWID-2' },
      licenses: [{ id: 1, key: 'SFCP-KEY', hwid: 'HWID-1', status: 'active' }],
    })

    expect(response.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('returns 200 { valid: true } when HWID matches active non-expired key', async () => {
    const futureDate = new Date(Date.now() + 3_600_000).toISOString()

    const { body, response, update } = await invokeVerify({
      body: { key: 'SFCP-KEY', hwid: 'HWID-1' },
      licenses: [
        {
          id: 1,
          key: 'SFCP-KEY',
          hwid: 'HWID-1',
          status: 'active',
          expiresAt: futureDate,
        },
      ],
    })

    expect(response.status).toBe(200)
    expect(body).toEqual({ valid: true })
    expect(update).not.toHaveBeenCalled()
  })
})
