import { describe, expect, it, vi } from 'vitest'
import { resetHwidEndpoint, AccessKeys } from '@/collections/AccessKeys'

describe('AccessKeys /reset-hwid endpoint', () => {
  it('is configured with path /reset-hwid and method post', () => {
    expect(resetHwidEndpoint.path).toBe('/reset-hwid')
    expect(resetHwidEndpoint.method).toBe('post')

    const endpointInCollection = AccessKeys.endpoints && Array.isArray(AccessKeys.endpoints)
      ? AccessKeys.endpoints.find((ep) => ep.path === '/reset-hwid' && ep.method === 'post')
      : null

    expect(endpointInCollection).toBeDefined()
  })

  it('returns 403 Unauthorized when req.user is missing', async () => {
    const handler = resetHwidEndpoint.handler as any
    const response = await handler({
      json: vi.fn().mockResolvedValue({ key: 'SFCP-TEST-123' }),
      payload: { update: vi.fn() },
    })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.message || body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 Unauthorized when req.user does not have admin or owner role', async () => {
    const handler = resetHwidEndpoint.handler as any
    const response = await handler({
      user: { id: 123, roles: ['viewer'] },
      json: vi.fn().mockResolvedValue({ key: 'SFCP-TEST-123' }),
      payload: { update: vi.fn() },
    })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.message || body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when key is missing in body', async () => {
    const handler = resetHwidEndpoint.handler as any
    const response = await handler({
      user: { id: 1, roles: ['admin'] },
      json: vi.fn().mockResolvedValue({}),
      payload: { update: vi.fn() },
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.message || body.error).toBeDefined()
  })

  it('returns 400 when key is empty or not a string', async () => {
    const handler = resetHwidEndpoint.handler as any
    const response = await handler({
      user: { id: 1, roles: ['admin'] },
      json: vi.fn().mockResolvedValue({ key: 12345 }),
      payload: { update: vi.fn() },
    })

    expect(response.status).toBe(400)
  })

  it('calls payload.update with collection access-keys, where { key: { equals: key } }, and data { hwid: null }', async () => {
    const handler = resetHwidEndpoint.handler as any
    const mockUpdate = vi.fn().mockResolvedValue({
      docs: [{ id: 1, key: 'SFCP-ADMIN-KEY', hwid: null }],
    })

    const response = await handler({
      user: { id: 1, roles: ['admin'] },
      json: vi.fn().mockResolvedValue({ key: 'SFCP-ADMIN-KEY' }),
      payload: { update: mockUpdate },
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'access-keys',
        where: {
          key: {
            equals: 'SFCP-ADMIN-KEY',
          },
        },
        data: {
          hwid: null,
        },
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      success: true,
      message: 'HWID reset successfully',
    })
  })

  it('returns 404 if key is not found in the database', async () => {
    const handler = resetHwidEndpoint.handler as any
    const mockUpdate = vi.fn().mockResolvedValue({
      docs: [],
    })

    const response = await handler({
      user: { id: 1, roles: ['admin'] },
      json: vi.fn().mockResolvedValue({ key: 'NON-EXISTENT-KEY' }),
      payload: { update: mockUpdate },
    })

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.message || body.error).toMatch(/not found/i)
  })

  it('returns 500 when database update throws an error', async () => {
    const handler = resetHwidEndpoint.handler as any
    const mockUpdate = vi.fn().mockRejectedValue(new Error('PostgreSQL connection error'))

    const response = await handler({
      user: { id: 1, roles: ['admin'] },
      json: vi.fn().mockResolvedValue({ key: 'SFCP-ERR-KEY' }),
      payload: { update: mockUpdate },
    })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.message || body.error).toBeDefined()
  })

  it('accepts body via req.data (pre-parsed payload request data)', async () => {
    const handler = resetHwidEndpoint.handler as any
    const mockUpdate = vi.fn().mockResolvedValue({
      docs: [{ id: 2, key: 'SFCP-DATA-KEY', hwid: null }],
    })

    const response = await handler({
      user: { id: 2, roles: ['owner'] },
      data: { key: 'SFCP-DATA-KEY' },
      payload: { update: mockUpdate },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      success: true,
      message: 'HWID reset successfully',
    })
  })
})
