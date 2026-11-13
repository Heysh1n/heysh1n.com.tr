import type { Endpoint } from 'payload'

const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize'
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing'
const RECENTLY_PLAYED_ENDPOINT = 'https://api.spotify.com/v1/me/player/recently-played?limit=1'
const SCOPES = 'user-read-currently-playing user-read-recently-played'

type SpotifyTrackItem = {
  id?: string
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
  preview_url?: string | null
}

const previewUrlCache = new Map<string, string | null>()

const resolvePreviewUrl = async (
  item: SpotifyTrackItem,
  title: string,
  primaryArtist: string,
): Promise<string | null> => {
  if (item.preview_url) {
    return item.preview_url
  }

  const cacheKey = item.id ? `id:${item.id}` : `meta:${primaryArtist.toLowerCase()}:${title.toLowerCase()}`

  if (previewUrlCache.has(cacheKey)) {
    return previewUrlCache.get(cacheKey) ?? null
  }

  if (!title || !primaryArtist) {
    previewUrlCache.set(cacheKey, null)
    return null
  }

  try {
    const searchTerm = `${primaryArtist} ${title}`
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=1`
    const res = await fetch(itunesUrl, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    })

    if (res.ok) {
      const itunesData = (await res.json().catch(() => null)) as {
        resultCount?: number
        results?: Array<{ previewUrl?: string }>
      } | null

      const itunesPreview = itunesData?.results?.[0]?.previewUrl || null

      if (previewUrlCache.size > 1000) {
        const first = previewUrlCache.keys().next().value
        if (first) previewUrlCache.delete(first)
      }

      previewUrlCache.set(cacheKey, itunesPreview)
      return itunesPreview
    }
  } catch {
    // Timeout or network error
  }

  if (previewUrlCache.size > 1000) {
    const first = previewUrlCache.keys().next().value
    if (first) previewUrlCache.delete(first)
  }
  previewUrlCache.set(cacheKey, null)
  return null
}

let cachedToken: {
  accessToken: string
  expiresAt: number
} | null = null

let currentRefreshToken: string | null = null

const getRefreshTokenValue = (): string | null => {
  if (currentRefreshToken) {
    return currentRefreshToken
  }
  const envToken = process.env.SPOTIFY_REFRESH_TOKEN?.trim()
  if (envToken && envToken !== '...' && envToken !== 'your-spotify-refresh-token') {
    currentRefreshToken = envToken
    return currentRefreshToken
  }
  return null
}

const getAccessToken = async (): Promise<string | null> => {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.accessToken
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim()
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim()
  const refreshToken = getRefreshTokenValue()

  if (!clientId || !refreshToken) {
    return null
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  if (clientSecret) {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${basicAuth}`
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
    signal: AbortSignal.timeout(8000),
  })

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
  }

  if (!response.ok) {
    if (data.error === 'invalid_grant') {
      cachedToken = null
      currentRefreshToken = null
    }
    return null
  }

  if (!data.access_token) {
    return null
  }

  // If Spotify rotates the refresh_token, keep the new one in memory
  if (data.refresh_token) {
    currentRefreshToken = data.refresh_token
  }

  const ttlMs = ((data.expires_in ?? 3600) - 60) * 1000
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(ttlMs, 60_000),
  }

  return data.access_token
}

const formatTrack = async (item: SpotifyTrackItem, isPlaying: boolean, progressMs?: number) => {
  const title = item.name || 'Unknown Track'
  const primaryArtist = item.artists?.[0]?.name || ''
  const artist = item.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Unknown Artist'
  const previewUrl = await resolvePreviewUrl(item, title, primaryArtist)

  return {
    isPlaying,
    title,
    artist,
    album: item.album?.name || '',
    albumArt: item.album?.images?.[0]?.url || null,
    trackUrl: item.external_urls?.spotify || null,
    previewUrl,
    progressMs: progressMs ?? null,
    durationMs: item.duration_ms ?? null,
  }
}

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
          { isPlaying: false, previewUrl: null, error: 'Spotify credentials are not configured' },
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
          const formatted = await formatTrack(data.item, Boolean(data.is_playing), data.progress_ms)
          return Response.json(formatted, { status: 200, headers: responseHeaders })
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
          const formatted = await formatTrack(recentTrack, false)
          return Response.json(formatted, {
            status: 200,
            headers: responseHeaders,
          })
        }
      }

      return Response.json({ isPlaying: false, previewUrl: null }, { status: 200, headers: responseHeaders })
    } catch {
      return Response.json({ isPlaying: false, previewUrl: null }, { status: 200, headers: responseHeaders })
    }
  },
}

/**
 * Resolves the Spotify OAuth redirect URI.
 * Prioritizes SPOTIFY_REDIRECT_URI environment variable, falling back to
 * PAYLOAD_PUBLIC_SERVER_URL or NEXT_PUBLIC_SERVER_URL or http://127.0.0.1:3000.
 * Guarantees that both /login and /callback share the exact identical string.
 */
export const getSpotifyRedirectUri = (): string => {
  const envRedirect = process.env.SPOTIFY_REDIRECT_URI?.trim()
  if (envRedirect) {
    try {
      const parsed = new URL(envRedirect)
      if (parsed.pathname === '/' || parsed.pathname === '') {
        return `${envRedirect.replace(/\/+$/, '')}/api/spotify/callback`
      }
      return envRedirect
    } catch {
      return envRedirect
    }
  }

  const serverUrl = (
    process.env.PAYLOAD_PUBLIC_SERVER_URL ||
    process.env.NEXT_PUBLIC_SERVER_URL ||
    'http://127.0.0.1:3000'
  ).replace(/\/+$/, '')

  return `${serverUrl}/api/spotify/callback`
}

/**
 * Helper endpoint (dev / initial setup only) to obtain SPOTIFY_REFRESH_TOKEN:
 * Open /api/spotify/login in browser -> authorizes Spotify -> redirects to /api/spotify/callback
 */
export const spotifyLoginEndpoint: Endpoint = {
  method: 'get',
  path: '/spotify/login',
  handler: (req) => {
    if (process.env.NODE_ENV === 'production' && getRefreshTokenValue()) {
      return Response.json({ error: 'Not available in production' }, { status: 403 })
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID?.trim()
    if (!clientId) {
      return Response.json({ error: 'SPOTIFY_CLIENT_ID is not set in .env' }, { status: 400 })
    }

    const redirectUri = getSpotifyRedirectUri()

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
    })

    const serverUrl = (
      process.env.PAYLOAD_PUBLIC_SERVER_URL ||
      process.env.NEXT_PUBLIC_SERVER_URL ||
      'http://127.0.0.1:3000'
    ).replace(/\/+$/, '')
    const reqUrl = req.url || `${serverUrl}/api/spotify/login`
    return Response.redirect(new URL(`${AUTHORIZE_ENDPOINT}?${params.toString()}`, reqUrl), 302)
  },
}

export const spotifyCallbackEndpoint: Endpoint = {
  method: 'get',
  path: '/spotify/callback',
  handler: async (req) => {
    if (process.env.NODE_ENV === 'production' && getRefreshTokenValue()) {
      return Response.json({ error: 'Not available in production' }, { status: 403 })
    }

    const serverUrl = (
      process.env.PAYLOAD_PUBLIC_SERVER_URL ||
      process.env.NEXT_PUBLIC_SERVER_URL ||
      'http://127.0.0.1:3000'
    ).replace(/\/+$/, '')
    const url = new URL(req.url || `${serverUrl}/api/spotify/callback`)
    const code = url.searchParams.get('code')

    if (!code) {
      return Response.json({ error: 'Missing authorization code' }, { status: 400 })
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID?.trim()
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim()

    if (!clientId || !clientSecret) {
      return Response.json(
        { error: 'SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing in .env' },
        { status: 400 },
      )
    }

    const redirectUri = getSpotifyRedirectUri()
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }

    if (!response.ok || !data.refresh_token) {
      return Response.json(
        { error: data.error || 'Failed to exchange code', details: data.error_description },
        { status: 400 },
      )
    }

    currentRefreshToken = data.refresh_token
    if (data.access_token) {
      cachedToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
      }
    }

    return Response.json(
      {
        message: 'Copy this refresh_token into your backend/.env as SPOTIFY_REFRESH_TOKEN',
        SPOTIFY_REFRESH_TOKEN: data.refresh_token,
      },
      { status: 200, headers: responseHeaders },
    )
  },
}

export default spotifyNowPlayingEndpoint
