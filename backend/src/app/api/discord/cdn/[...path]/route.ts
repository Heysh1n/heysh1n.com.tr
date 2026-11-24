const SNOWFLAKE_RE = /^\d{17,22}$/
const ANIMATED_HASH_RE = /^(?:a_)?[a-fA-F0-9]{16,64}\.(?:png|jpe?g|webp|gif)$/
const EMOJI_FILE_RE = /^\d{17,22}\.(?:png|webp|gif)$/
const CLAN_BADGE_RE = /^[a-fA-F0-9]{16,64}\.(?:png|webp)$/
const APP_ASSET_RE = /^[a-zA-Z0-9_-]{1,128}\.(?:png|jpe?g|webp)$/
const SAFE_MEDIA_SEGMENT_RE = /^[a-zA-Z0-9._~:@!$&'()*+,;=%-]+$/

const UPSTREAM_TIMEOUT_MS = 10_000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

function sanitizeCdnQuery(searchParams: URLSearchParams): string {
  const out = new URLSearchParams()

  const rawSize = searchParams.get('size')
  if (rawSize && /^\d{2,4}$/.test(rawSize)) {
    const size = Number(rawSize)
    if (size >= 16 && size <= 1024) {
      out.set('size', String(size))
    }
  }

  const rawAnimated = searchParams.get('animated')
  if (rawAnimated === 'true' || rawAnimated === 'false') {
    out.set('animated', rawAnimated)
  }

  const rawQuality = searchParams.get('quality')
  if (rawQuality === 'lossless') {
    out.set('quality', 'lossless')
  }

  const serialized = out.toString()
  return serialized ? `?${serialized}` : ''
}

function hasUnsafeSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return true
  if (segment.includes('..') || segment.includes('\\') || segment.includes('\0')) return true
  if (/%2e/i.test(segment) || /%2f/i.test(segment) || /%5c/i.test(segment)) return true
  return false
}

export function resolveUpstreamDiscordAssetUrl(
  segments: string[],
  searchParams: URLSearchParams,
): string | null {
  if (!Array.isArray(segments) || segments.length < 2 || segments.length > 24) {
    return null
  }

  for (const segment of segments) {
    if (typeof segment !== 'string' || hasUnsafeSegment(segment)) {
      return null
    }
  }

  const [kind] = segments
  const query = sanitizeCdnQuery(searchParams)

  if (kind === 'avatars' && segments.length === 3) {
    const [, userId, file] = segments
    if (!SNOWFLAKE_RE.test(userId) || !ANIMATED_HASH_RE.test(file)) return null
    return `https://cdn.discordapp.com/avatars/${userId}/${file}${query}`
  }

  if (kind === 'banners' && segments.length === 3) {
    const [, userId, file] = segments
    if (!SNOWFLAKE_RE.test(userId) || !ANIMATED_HASH_RE.test(file)) return null
    return `https://cdn.discordapp.com/banners/${userId}/${file}${query}`
  }

  if (kind === 'emojis' && segments.length === 2) {
    const [, file] = segments
    if (!EMOJI_FILE_RE.test(file)) return null
    return `https://cdn.discordapp.com/emojis/${file}${query}`
  }

  if (kind === 'clan-badges' && segments.length === 3) {
    const [, guildId, file] = segments
    if (!SNOWFLAKE_RE.test(guildId) || !CLAN_BADGE_RE.test(file)) return null
    return `https://cdn.discordapp.com/clan-badges/${guildId}/${file}${query}`
  }

  if (kind === 'app-assets' && segments.length === 3) {
    const [, appId, file] = segments
    if (!SNOWFLAKE_RE.test(appId) || !APP_ASSET_RE.test(file)) return null
    return `https://cdn.discordapp.com/app-assets/${appId}/${file}${query}`
  }

  if (kind === 'media' && segments[1] === 'external' && segments.length >= 4) {
    const rest = segments.slice(2)
    if (rest.some((part) => !SAFE_MEDIA_SEGMENT_RE.test(part))) return null
    return `https://media.discordapp.net/external/${rest.join('/')}`
  }

  return null
}

export const OPTIONS = async () => {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export const GET = async (
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await context.params
  const url = new URL(request.url)
  const upstreamUrl = resolveUpstreamDiscordAssetUrl(path, url.searchParams)

  if (!upstreamUrl) {
    return new Response('Invalid Discord asset path', {
      status: 400,
      headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
    })
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/gif,image/png,image/*,*/*;q=0.8',
        'User-Agent': 'heysh1n-portfolio/1.0',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    if (!upstream.ok) {
      return new Response('Upstream Discord asset unavailable', {
        status: upstream.status === 404 ? 404 : 502,
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=60' },
      })
    }

    const contentType = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!contentType || !contentType.startsWith('image/')) {
      return new Response('Upstream did not return an image', {
        status: 502,
        headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
      })
    }

    const declaredLength = Number(upstream.headers.get('content-length') || '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      return new Response('Asset exceeds size limit', {
        status: 413,
        headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
      })
    }

    const body = await upstream.arrayBuffer()
    if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
      return new Response('Invalid asset payload size', {
        status: 502,
        headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
      })
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response('Failed to fetch Discord asset', {
      status: 502,
      headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
    })
  }
}
