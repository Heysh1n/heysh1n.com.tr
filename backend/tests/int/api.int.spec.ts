import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, expect } from 'vitest'

let payload: Payload

describe('API', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
  })

  it('fetches users', async () => {
    const users = await payload.find({
      collection: 'users',
    })
    expect(users).toBeDefined()
  })

  it('fetches home-page global and projects', async () => {
    const homePage = await payload.findGlobal({
      slug: 'home-page',
    })
    console.log('Home page fetched:', JSON.stringify(homePage, null, 2))
    expect(homePage).toBeDefined()
    expect(homePage.socials).toBeDefined()

    const projects = await payload.find({
      collection: 'projects',
    })
    console.log('Projects fetched count:', projects.docs.length)
    expect(projects.docs.length).toBeGreaterThan(0)
  })
})
