import { useEffect, useMemo, useRef, useState } from 'react'

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/'
const RECENT_TRACK_POLL_MS = 30_000

interface MusicWidgetIslandProps {
  username?: string
  apiKey?: string
}

interface LastFmTextValue {
  '#text'?: string
  name?: string
}

interface LastFmImage {
  '#text'?: string
  size?: string
}

interface LastFmTrack {
  '@attr'?: {
    nowplaying?: string
  }
  album?: LastFmTextValue | string
  artist?: LastFmTextValue | string
  image?: LastFmImage[]
  name?: string
  url?: string
}

interface LastFmRecentTracks {
  track?: LastFmTrack | LastFmTrack[]
}

interface LastFmTopTracks {
  track?: LastFmTrack | LastFmTrack[]
}

interface LastFmResponse {
  error?: number
  message?: string
  recenttracks?: LastFmRecentTracks
  toptracks?: LastFmTopTracks
}

type PlaybackState = 'now-playing' | 'favorite'

interface NormalizedTrack {
  albumArt?: string
  artist?: string
  name: string
  playbackState: PlaybackState
  url?: string
}

interface MarqueeTextProps {
  as?: 'h3' | 'p'
  children: string
  className?: string
  id?: string
}

const normalizeText = (value?: string | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const readTextValue = (value?: LastFmTextValue | string): string | undefined => {
  if (typeof value === 'string') {
    return normalizeText(value)
  }

  return normalizeText(value?.['#text']) ?? normalizeText(value?.name)
}

const ensureArray = <T,>(value?: T | T[]): T[] => {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

const getLargestImage = (images?: LastFmImage[]): string | undefined => {
  if (!images) {
    return undefined
  }

  return [...images]
    .reverse()
    .map((image) => normalizeText(image['#text']))
    .find(Boolean)
}

const normalizeTrack = (
  track: LastFmTrack,
  playbackState: PlaybackState,
): NormalizedTrack | null => {
  const name = normalizeText(track.name)

  if (!name) {
    return null
  }

  return {
    albumArt: getLargestImage(track.image),
    artist: readTextValue(track.artist),
    name,
    playbackState,
    url: normalizeText(track.url),
  }
}

const createLastFmUrl = (
  method: 'user.getRecentTracks' | 'user.getTopTracks',
  username: string,
  apiKey: string,
): string => {
  const params = new URLSearchParams({
    api_key: apiKey,
    format: 'json',
    limit: method === 'user.getRecentTracks' ? '1' : '5',
    method,
    user: username,
  })

  if (method === 'user.getTopTracks') {
    params.set('period', 'overall')
  }

  return `${LASTFM_ENDPOINT}?${params.toString()}`
}

const getLatestTrack = (payload: LastFmResponse): LastFmTrack | undefined =>
  ensureArray(payload.recenttracks?.track)[0]

const getFavoriteTrack = (payload: LastFmResponse): LastFmTrack | undefined =>
  ensureArray(payload.toptracks?.track)[0]

const isNowPlaying = (track?: LastFmTrack): boolean =>
  track?.['@attr']?.nowplaying === 'true'

function MarqueeText({
  as: Component = 'p',
  children,
  className = '',
  id,
}: MarqueeTextProps) {
  const containerRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLSpanElement | null>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const setContainerRef = (node: HTMLElement | null) => {
    containerRef.current = node
  }

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current

    if (!container || !content) {
      return
    }

    const measure = () => {
      setIsOverflowing(content.scrollWidth > container.clientWidth)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(content)

    return () => observer.disconnect()
  }, [children])

  const content = (
    <>
      <span
        className="music-marquee-track inline-flex min-w-full"
        data-overflow={isOverflowing ? 'true' : 'false'}
      >
        <span ref={contentRef} className="min-w-0 shrink-0 truncate pr-8">
          {children}
        </span>
        {isOverflowing && (
          <span aria-hidden="true" className="shrink-0 pr-8">
            {children}
          </span>
        )}
      </span>
    </>
  )

  const sharedClassName = `music-marquee block min-w-0 overflow-hidden whitespace-nowrap ${className}`

  if (Component === 'h3') {
    return (
      <h3 id={id} ref={setContainerRef} className={sharedClassName} title={children}>
        {content}
      </h3>
    )
  }

  return (
    <p id={id} ref={setContainerRef} className={sharedClassName} title={children}>
      {content}
    </p>
  )
}

function EqualizerIcon() {
  return (
    <span
      aria-hidden="true"
      className="music-equalizer flex h-4 w-4 items-end gap-0.5 text-emerald-300"
    >
      <span className="h-2 w-0.5 rounded-full bg-current" />
      <span className="h-3.5 w-0.5 rounded-full bg-current" />
      <span className="h-2.5 w-0.5 rounded-full bg-current" />
    </span>
  )
}

function MusicSkeleton() {
  return (
    <section
      aria-label="Loading music widget"
      className="rounded-lg border border-neutral-800 bg-black/40 p-4"
    >
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 shrink-0 animate-pulse rounded-md bg-neutral-800" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-3 w-28 animate-pulse rounded-full bg-neutral-800" />
          <div className="h-4 w-4/5 animate-pulse rounded-full bg-neutral-700" />
          <div className="h-3 w-2/5 animate-pulse rounded-full bg-neutral-800" />
        </div>
      </div>
    </section>
  )
}

export default function MusicWidgetIsland({
  username,
  apiKey,
}: MusicWidgetIslandProps) {
  const normalizedUsername =
    normalizeText(username) ?? normalizeText(import.meta.env.PUBLIC_LASTFM_USER)
  const normalizedApiKey =
    normalizeText(apiKey) ?? normalizeText(import.meta.env.PUBLIC_LASTFM_API_KEY)
  const hasConfig = Boolean(normalizedUsername && normalizedApiKey)
  const [favoriteTrack, setFavoriteTrack] = useState<NormalizedTrack | null>(null)
  const [recentTrack, setRecentTrack] = useState<NormalizedTrack | null>(null)
  const [hasLoadedFavorite, setHasLoadedFavorite] = useState(false)
  const [hasLoadedRecent, setHasLoadedRecent] = useState(false)
  const [isHidden, setIsHidden] = useState(!hasConfig)

  useEffect(() => {
    if (!hasConfig || !normalizedUsername || !normalizedApiKey) {
      setIsHidden(true)
      return
    }

    const controller = new AbortController()
    let pollTimer: ReturnType<typeof window.setInterval> | undefined
    let isPollingRecent = false

    const hideOnError = (error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }

      console.warn(error instanceof Error ? error.message : String(error))
      setIsHidden(true)

      if (pollTimer) {
        window.clearInterval(pollTimer)
      }
    }

    const fetchLastFm = async (url: string): Promise<LastFmResponse> => {
      const response = await fetch(url, { signal: controller.signal })

      if (!response.ok) {
        throw new Error(`Last.fm responded with ${response.status}`)
      }

      const payload = (await response.json()) as LastFmResponse

      if (payload.error) {
        throw new Error(payload.message ?? `Last.fm error ${payload.error}`)
      }

      return payload
    }

    const fetchFavoriteTrack = async (): Promise<void> => {
      try {
        const payload = await fetchLastFm(
          createLastFmUrl('user.getTopTracks', normalizedUsername, normalizedApiKey),
        )
        const track = getFavoriteTrack(payload)

        setFavoriteTrack(track ? normalizeTrack(track, 'favorite') : null)
        setHasLoadedFavorite(true)
      } catch (error) {
        hideOnError(error)
      }
    }

    const fetchRecentTrack = async (): Promise<void> => {
      if (isPollingRecent) {
        return
      }

      isPollingRecent = true

      try {
        const payload = await fetchLastFm(
          createLastFmUrl('user.getRecentTracks', normalizedUsername, normalizedApiKey),
        )
        const latestTrack = getLatestTrack(payload)

        setRecentTrack(
          isNowPlaying(latestTrack) && latestTrack
            ? normalizeTrack(latestTrack, 'now-playing')
            : null,
        )
        setHasLoadedRecent(true)
      } catch (error) {
        hideOnError(error)
      } finally {
        isPollingRecent = false
      }
    }

    setIsHidden(false)
    setFavoriteTrack(null)
    setRecentTrack(null)
    setHasLoadedFavorite(false)
    setHasLoadedRecent(false)

    void fetchFavoriteTrack()
    void fetchRecentTrack()

    pollTimer = window.setInterval(() => {
      void fetchRecentTrack()
    }, RECENT_TRACK_POLL_MS)

    return () => {
      controller.abort()

      if (pollTimer) {
        window.clearInterval(pollTimer)
      }
    }
  }, [hasConfig, normalizedApiKey, normalizedUsername])

  const displayTrack = useMemo(
    () => recentTrack ?? favoriteTrack,
    [favoriteTrack, recentTrack],
  )

  const isLoading =
    !isHidden &&
    (!hasLoadedRecent || (!recentTrack && !hasLoadedFavorite))

  if (!hasConfig || isHidden) {
    return null
  }

  if (isLoading) {
    return <MusicSkeleton />
  }

  if (!displayTrack) {
    return null
  }

  const isLive = displayTrack.playbackState === 'now-playing'
  const statusLabel = isLive ? 'Now Playing' : 'Favorite Track'
  const badgeLabel = isLive ? 'Live' : 'On Repeat'

  return (
    <section
      aria-labelledby="music-widget-title"
      className={`rounded-xl border bg-black/50 p-5 backdrop-blur-md transition-all duration-500 ${
        isLive
          ? 'border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.1)]'
          : 'border-white/5'
      }`}
    >
      <style>{`
        @keyframes music-marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }

        @keyframes music-equalizer {
          0%, 100% { transform: scaleY(0.45); }
          50% { transform: scaleY(1); }
        }

        .music-marquee:hover .music-marquee-track[data-overflow="true"] {
          animation: music-marquee 8s linear infinite;
          overflow: visible;
        }

        .music-equalizer span {
          animation: music-equalizer 0.9s ease-in-out infinite;
          transform-origin: bottom;
        }

        .music-equalizer span:nth-child(2) {
          animation-delay: 0.15s;
        }

        .music-equalizer span:nth-child(3) {
          animation-delay: 0.3s;
        }

        @media (prefers-reduced-motion: reduce) {
          .music-marquee:hover .music-marquee-track[data-overflow="true"],
          .music-equalizer span {
            animation: none;
          }
        }
      `}</style>

      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
          {displayTrack.albumArt ? (
            <img
              src={displayTrack.albumArt}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.28),transparent_34%),linear-gradient(135deg,rgba(39,39,42,0.95),rgba(10,10,10,0.95))] text-xl font-semibold text-neutral-500">
              {displayTrack.name[0]?.toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            {isLive ? (
              <EqualizerIcon />
            ) : (
              <span className="h-2 w-2 rounded-full bg-neutral-500" aria-hidden="true" />
            )}
            <p className="text-xs font-medium uppercase text-neutral-500">
              {statusLabel}
            </p>
            <span
          className={`font-mono rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
            isLive
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-white/10 bg-white/5 text-neutral-400'
          }`}
        >
              {badgeLabel}
            </span>
          </div>

          <MarqueeText
            as="h3"
            id="music-widget-title"
            className="text-base font-semibold text-white"
          >
            {displayTrack.name}
          </MarqueeText>

          {displayTrack.artist && (
            <MarqueeText className="mt-1 text-sm text-neutral-400">
              {displayTrack.artist}
            </MarqueeText>
          )}

          {displayTrack.url && (
            <a
              href={displayTrack.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-xs text-purple-300 underline decoration-purple-500/60 underline-offset-4 transition-colors hover:text-purple-100"
            >
              Open on Last.fm
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
