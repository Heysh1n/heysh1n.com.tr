import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GET as getDiscordAsset,
  resolveUpstreamDiscordAssetUrl,
} from '@/app/api/discord/cdn/[...path]/route'
import {
  clearDiscordProfileCache,
  GET as getDiscordProfile,
} from '@/app/api/discord/profile/route'

describe('Discord CDN proxy allowlist & handler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves valid avatar, banner, emoji, clan-badge, app-asset, and external media paths', () => {
    expect(
      resolveUpstreamDiscordAssetUrl(
        ['avatars', '995737379417640961', 'a_d856e1b2e9020023eaabba559dd5b477.gif'],
        new URLSearchParams('size=256&evil=1'),
      ),
    ).toBe(
      'https://cdn.discordapp.com/avatars/995737379417640961/a_d856e1b2e9020023eaabba559dd5b477.gif?size=256',
    )

    expect(
      resolveUpstreamDiscordAssetUrl(
        ['banners', '995737379417640961', 'a_99ff0c72d758e30771f726ed416d95e5.gif'],
        new URLSearchParams('size=512'),
      ),
    ).toBe(
      'https://cdn.discordapp.com/banners/995737379417640961/a_99ff0c72d758e30771f726ed416d95e5.gif?size=512',
    )

    expect(
      resolveUpstreamDiscordAssetUrl(
        ['emojis', '1423722627297444021.webp'],
        new URLSearchParams('size=48&animated=true'),
      ),
    ).toBe('https://cdn.discordapp.com/emojis/1423722627297444021.webp?size=48&animated=true')

    expect(
      resolveUpstreamDiscordAssetUrl(
        ['clan-badges', '759270446478000179', 'e05ecd5875a2e1daee2ed1df612462b5.png'],
        new URLSearchParams('size=32'),
      ),
    ).toBe(
      'https://cdn.discordapp.com/clan-badges/759270446478000179/e05ecd5875a2e1daee2ed1df612462b5.png?size=32',
    )

    expect(
      resolveUpstreamDiscordAssetUrl(
        ['media', 'external', 'abc123', 'https', 'example.com', 'icon.png'],
        new URLSearchParams(),
      ),
    ).toBe('https://media.discordapp.net/external/abc123/https/example.com/icon.png')
  })

  it('rejects path traversal, arbitrary hosts, and invalid extensions', () => {
    expect(
      resolveUpstreamDiscordAssetUrl(
        ['avatars', '..', 'etc', 'passwd'],
        new URLSearchParams(),
      ),
    ).toBeNull()
    expect(
      resolveUpstreamDiscordAssetUrl(
        ['emojis', '1423722627297444021.svg'],
        new URLSearchParams(),
      ),
    ).toBeNull()
    expect(
      resolveUpstreamDiscordAssetUrl(
        ['attachments', '123456789012345678', 'file.png'],
        new URLSearchParams(),
      ),
    ).toBeNull()
    expect(
      resolveUpstreamDiscordAssetUrl(
        ['avatars', 'not-a-snowflake', 'a_d856e1b2e9020023eaabba559dd5b477.gif'],
        new URLSearchParams(),
      ),
    ).toBeNull()
  })

  it('streams valid image responses with CORS, CORP, and cache headers', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(pngBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    )

    const res = await getDiscordAsset(
      new Request('https://api.heysh1n.com.tr/api/discord/cdn/emojis/1423722627297444021.png?size=48'),
      { params: Promise.resolve({ path: ['emojis', '1423722627297444021.png'] }) },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400')
  })

  it('rejects non-image upstream content-types', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html>blocked</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const res = await getDiscordAsset(
      new Request('https://api.heysh1n.com.tr/api/discord/cdn/emojis/1423722627297444021.png'),
      { params: Promise.resolve({ path: ['emojis', '1423722627297444021.png'] }) },
    )

    expect(res.status).toBe(502)
  })
})

describe('Discord profile aggregation endpoint', () => {
  beforeEach(() => {
    clearDiscordProfileCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects invalid snowflake IDs', async () => {
    const res = await getDiscordProfile(
      new Request('https://api.heysh1n.com.tr/api/discord/profile?id=bad-id'),
    )
    expect(res.status).toBe(400)
  })

  it('merges Lanyard presence and DCDN profile metadata and serves from cache', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('api.lanyard.rest')) {
        return Response.json({
          success: true,
          data: {
            discord_status: 'online',
            discord_user: {
              id: '995737379417640961',
              username: 'heysh1n',
              global_name: 'Heysh1n',
              avatar: 'a_d856e1b2e9020023eaabba559dd5b477',
            },
            activities: [
              {
                type: 4,
                name: 'Custom Status',
                state: 'Hello',
                emoji: { id: '1423722627297444021', name: 'cat', animated: true },
              },
            ],
          },
        })
      }
      return Response.json({
        user: {
          id: '995737379417640961',
          username: 'heysh1n',
          global_name: 'Heysh1n',
          avatar: 'a_d856e1b2e9020023eaabba559dd5b477',
          banner: 'a_99ff0c72d758e30771f726ed416d95e5',
          banner_color: '#172124',
          accent_color: 1515812,
        },
        user_profile: {
          theme_colors: [0, 16711684],
        },
      })
    })

    const res1 = await getDiscordProfile(
      new Request('https://api.heysh1n.com.tr/api/discord/profile?id=995737379417640961'),
    )
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1.success).toBe(true)
    expect(body1.presence.discord_status).toBe('online')
    expect(body1.profile.banner).toBe('a_99ff0c72d758e30771f726ed416d95e5')
    expect(body1.profile.theme_colors).toEqual([0, 16711684])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const res2 = await getDiscordProfile(
      new Request('https://api.heysh1n.com.tr/api/discord/profile?id=995737379417640961'),
    )
    expect(res2.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
