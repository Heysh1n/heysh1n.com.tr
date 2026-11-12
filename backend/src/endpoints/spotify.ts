import type { Endpoint } from 'payload'

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing'
const RECENTLY_PLAYED_ENDPOINT = 'https://api.spotify.com/v1/me/player/recently-played?limit=1'

type SpotifyTrackItem = {
  name?: string
  artists?: Array<{ name?: string }>
  album?: {
    name?: string
    images?: Array<{ url?: string }>
  }
  external_urls?: {
    spotify?: string
  }
  duration_ms?: number
}

let cachedToken: {
  accessToken: string
  expiresAt: number
} | null = null

const getAccessToken = async (): Promise<string | null> => {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim()
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim()
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN?.trim()

  if (!clientId || !clientSecret || !refreshToken) {
    return null
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }

  if (!data.access_token) {
    return null
  }

  const ttlMs = ((data.expires_in ?? 3600) - 60) * 1000
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(ttlMs, 60_000),
  }

  return data.access_token
}

const formatTrack = (item: SpotifyTrackItem, isPlaying: boolean, progressMs?: number) => ({
  isPlaying,
  title: item.name || 'Unknown Track',
  artist: item.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Unknown Artist',
  album: item.album?.name || '',
  albumArt: item.album?.images?.[0]?.url || null,
  trackUrl: item.external_urls?.spotify || null,
  progressMs: progressMs ?? null,
  durationMs: item.duration_ms ?? null,
})

const responseHeaders = {
  'Cache-Control': 'no-store, max-age=0',
}

export const spotifyNowPlayingEndpoint: Endpoint = {
  method: 'get',
  path: '/spotify/now-playing',
  handler: async () => {
    try {
      const accessToken = await getAccessToken()

      if (!accessToken) {
        return Response.json(
          { isPlaying: false, error: 'Spotify credentials are not configured' },
          { status: 200, headers: responseHeaders },
        )
      }

      const nowPlayingRes = await fetch(NOW_PLAYING_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(8000),
      })

      if (nowPlayingRes.status === 200) {
        const data = (await nowPlayingRes.json()) as {
          is_playing?: boolean
          progress_ms?: number
          item?: SpotifyTrackItem | null
        }

        if (data?.item) {
          return Response.json(
            formatTrack(data.item, Boolean(data.is_playing), data.progress_ms),
            { status: 200, headers: responseHeaders },
          )
        }
      }

      // Fallback: fetch last played track from /recently-played
      const recentRes = await fetch(RECENTLY_PLAYED_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(8000),
      })

      if (recentRes.ok) {
        const recentData = (await recentRes.json()) as {
          items?: Array<{ track?: SpotifyTrackItem | null }>
        }
        const recentTrack = recentData?.items?.[0]?.track

        if (recentTrack) {
          return Response.json(formatTrack(recentTrack, false), {
            status: 200,
            headers: responseHeaders,
          })
        }
      }

      return Response.json({ isPlaying: false }, { status: 200, headers: responseHeaders })
    } catch {
      return Response.json({ isPlaying: false }, { status: 200, headers: responseHeaders })
    }
  },
}

export default spotifyNowPlayingEndpoint
