const SNOWFLAKE_RE = /^\d{17,22}$/
const LANYARD_REST_URL = 'https://api.lanyard.rest/v1/users/'
const DCDN_PROFILE_URL = 'https://dcdn.dstn.to/profile/'

const PRESENCE_TTL_MS = 15_000
const PRESENCE_STALE_MS = 5 * 60_000
const PROFILE_TTL_MS = 5 * 60_000
const PROFILE_STALE_MS = 60 * 60_000
const UPSTREAM_TIMEOUT_MS = 6_000
const MAX_CACHE_ENTRIES = 100

export interface NormalizedDiscordProfile {
  id: string
  username: string | null
  global_name: string | null
  avatar: string | null
  banner: string | null
  accent_color: number | null
  banner_color: string | null
  theme_colors: number[] | null
  primary_guild: Record<string, unknown> | null
  clan: Record<string, unknown> | null
}

type CacheEntry<T> = {
  value: T
  fetchedAt: number
}

const presenceCache = new Map<string, CacheEntry<Record<string, unknown>>>()
const profileCache = new Map<string, CacheEntry<NormalizedDiscordProfile>>()

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
}

function setBoundedCache<T>(map: Map<string, CacheEntry<T>>, key: string, value: T) {
  if (map.size >= MAX_CACHE_ENTRIES && !map.has(key)) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, { value, fetchedAt: Date.now() })
}

export function clearDiscordProfileCache() {
  presenceCache.clear()
  profileCache.clear()
}

function normalizeDcdnProfile(
  id: string,
  json: Record<string, any> | null,
): NormalizedDiscordProfile | null {
  if (!json || typeof json !== 'object') return null
  const userObj = json.user && typeof json.user === 'object' ? json.user : null
  const userProfile =
    json.user_profile && typeof json.user_profile === 'object' ? json.user_profile : null

  if (!userObj && !userProfile) return null

  const rawThemeColors = userProfile?.theme_colors
  const themeColors = Array.isArray(rawThemeColors)
    ? rawThemeColors.filter((color): color is number => typeof color === 'number')
    : null

  return {
    id: typeof userObj?.id === 'string' ? userObj.id : id,
    username: typeof userObj?.username === 'string' ? userObj.username : null,
    global_name: typeof userObj?.global_name === 'string' ? userObj.global_name : null,
    avatar: typeof userObj?.avatar === 'string' ? userObj.avatar : null,
    banner:
      typeof userObj?.banner === 'string'
        ? userObj.banner
        : typeof userProfile?.banner === 'string'
          ? userProfile.banner
          : null,
    accent_color:
      typeof userObj?.accent_color === 'number'
        ? userObj.accent_color
        : typeof userProfile?.accent_color === 'number'
          ? userProfile.accent_color
          : null,
    banner_color:
      typeof userObj?.banner_color === 'string'
        ? userObj.banner_color
        : typeof userProfile?.banner_color === 'string'
          ? userProfile.banner_color
          : null,
    theme_colors: themeColors && themeColors.length > 0 ? themeColors : null,
    primary_guild:
      userObj?.primary_guild && typeof userObj.primary_guild === 'object'
        ? userObj.primary_guild
        : null,
    clan: userObj?.clan && typeof userObj.clan === 'object' ? userObj.clan : null,
  }
}

async function fetchPresence(id: string): Promise<Record<string, unknown> | null> {
  const now = Date.now()
  const cached = presenceCache.get(id)
  if (cached && now - cached.fetchedAt < PRESENCE_TTL_MS) {
    return cached.value
  }

  try {
    const res = await fetch(`${LANYARD_REST_URL}${id}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'heysh1n-portfolio/1.0',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    if (res.ok) {
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        data?: Record<string, unknown>
      } | null

      if (json?.success && json.data && typeof json.data === 'object') {
        setBoundedCache(presenceCache, id, json.data)
        return json.data
      }
    }
  } catch {
    // Fall back to stale cache if available
  }

  if (cached && now - cached.fetchedAt < PRESENCE_STALE_MS) {
    return cached.value
  }

  return null
}

async function fetchProfile(id: string): Promise<NormalizedDiscordProfile | null> {
  const now = Date.now()
  const cached = profileCache.get(id)
  if (cached && now - cached.fetchedAt < PROFILE_TTL_MS) {
    return cached.value
  }

  try {
    const res = await fetch(`${DCDN_PROFILE_URL}${id}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'heysh1n-portfolio/1.0',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    if (res.ok) {
      const json = (await res.json().catch(() => null)) as Record<string, any> | null
      const normalized = normalizeDcdnProfile(id, json)
      if (normalized) {
        setBoundedCache(profileCache, id, normalized)
        return normalized
      }
    }
  } catch {
    // Fall back to stale cache if available
  }

  if (cached && now - cached.fetchedAt < PROFILE_STALE_MS) {
    return cached.value
  }

  return null
}

export const OPTIONS = async () => {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export const GET = async (request: Request) => {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')?.trim() || ''

  if (!SNOWFLAKE_RE.test(id)) {
    return Response.json(
      { success: false, error: 'Invalid Discord user id' },
      { status: 400, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } },
    )
  }

  const [presence, profile] = await Promise.all([fetchPresence(id), fetchProfile(id)])

  if (!presence && !profile) {
    return Response.json(
      { success: false, error: 'Upstream Discord profile unavailable' },
      { status: 502, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } },
    )
  }

  return Response.json(
    {
      success: true,
      presence,
      profile,
    },
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=10, s-maxage=15, stale-while-revalidate=60',
      },
    },
  )
}
